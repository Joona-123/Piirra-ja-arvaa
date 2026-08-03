/* engine.js – pelin sääntömoottori.
   Tämä ajetaan VAIN pelin luojan (hostin) selaimessa. Moottori ei tiedä
   mitään verkosta: se saa pelaajien toiminnot sisään ja lähettää tapahtumia
   ulos annetun io-olion kautta. Sama koodi toimii myös Nodessa testeissä. */
(function (root) {
  'use strict';

  var CHOOSE_SECONDS = 10;
  var START_COUNTDOWN = 5;      // sekuntia hostin napin painalluksesta pelin alkuun
  var TURN_END_SECONDS = 6;
  var MAX_PLAYERS = 12;
  var MAX_OPS = 4000;

  var rnd = function (n) { return Math.floor(Math.random() * n); };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rnd(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function cleanName(name) {
    return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Pelaaja';
  }

  function normalize(str) {
    return String(str).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    var prev = [], i, j;
    for (i = 0; i <= b.length; i++) prev[i] = i;
    for (i = 1; i <= a.length; i++) {
      var last = prev[0];
      prev[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
        last = tmp;
      }
    }
    return prev[b.length];
  }

  /* ================================================================ */

  function Engine(opts) {
    this.io = opts.io;                                  // { all, to, except }
    this.categories = opts.categories || root.CATEGORIES;
    this.hostId = opts.hostId;

    this.players = new Map();
    this.retired = new Map();       // nimi -> { score, id } paluuta varten
    this.settings = { rounds: 3, drawTime: 80, isPublic: false };
    this.phase = 'lobby';
    this.round = 0;
    this.order = [];
    this.turnIndex = -1;
    this.drawerId = null;
    this.word = null;
    this.category = null;
    this.choices = [];
    this.revealedIdx = {};
    this.revealPlan = [];
    this.usedWords = {};
    this.ops = [];
    this.correctOrder = [];
    this.deltas = null;
    this.endsAt = 0;
    this.interval = null;
    this.timeout = null;
  }

  /* ---------------- pelaajat ---------------- */

  Engine.prototype.uniqueName = function (name) {
    var taken = {};
    this.players.forEach(function (p) { taken[p.name.toLowerCase()] = true; });
    if (!taken[name.toLowerCase()]) return name;
    for (var i = 2; i < 50; i++) {
      if (!taken[(name + ' ' + i).toLowerCase()]) return name + ' ' + i;
    }
    return name + ' ' + rnd(999);
  };

  Engine.prototype.addPlayer = function (id, rawName) {
    if (this.players.size >= MAX_PLAYERS) return { ok: false, error: 'Peli on täynnä.' };
    var name = this.uniqueName(cleanName(rawName));
    var back = this.retired.get(name.toLowerCase());

    // Kesken pelin sisään pääsee vain se, joka oli mukana kun peli alkoi
    // (esim. yhteys katkesi) – tunnistus tapahtuu nimen perusteella.
    // Päättyneeseen peliin saa liittyä: se odottaa aulassa uutta aloitusta.
    if (this.phase !== 'lobby' && this.phase !== 'gameend' && !back) {
      return {
        ok: false,
        error: 'Peli on jo käynnissä. Kesken pelin mukaan pääsee vain, jos oli mukana alusta asti – ' +
               'kirjoita silloin täsmälleen sama nimi kuin aiemmin.'
      };
    }

    var player = { id: id, name: name, score: back ? back.score : 0, hasGuessed: false };
    this.players.set(id, player);
    if (back) {
      this.retired.delete(name.toLowerCase());
      // paluumuuttaja perii oman piirtovuoronsa
      for (var oi = 0; oi < this.order.length; oi++) if (this.order[oi] === back.id) this.order[oi] = id;
      this.sys(name + ' palasi peliin.', 'good');
    }

    if (this.phase !== 'lobby') {
      this.io.to(id, 'sync', { ops: this.ops });
      if (this.phase === 'draw') this.io.to(id, 'pattern', { pattern: this.patternOf() });
    }
    if (!back) this.sys(name + ' liittyi peliin.', 'info');
    this.broadcast();
    return { ok: true, player: player };
  };

  Engine.prototype.removePlayer = function (id) {
    var player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    if (this.phase !== 'lobby') {
      this.retired.set(player.name.toLowerCase(), { score: player.score, id: player.id });
    }
    this.sys(player.name + ' poistui.', 'info');

    // Jos pelinjohtaja jostain syystä katoaa pelaajista, ohjat siirtyvät seuraavalle,
    // jottei peli jää lukkoon. (P2P-pelissä johtajan lähtö päättää pelin muutenkin.)
    if (this.hostId === id && this.players.size > 0) {
      this.hostId = this.players.keys().next().value;
      var uusi = this.players.get(this.hostId);
      if (uusi) this.sys(uusi.name + ' on nyt pelinjohtaja.', 'info');
    }

    if (this.drawerId === id && (this.phase === 'draw' || this.phase === 'choose')) {
      this.sys('Piirtäjä poistui – vuoro päättyy.', 'bad');
      return this.endTurn('left');
    }
    if (this.phase === 'draw' && this.guessers().length && this.guessers().every(function (p) { return p.hasGuessed; })) {
      return this.endTurn('all');
    }
    if (this.players.size < 2 && this.phase !== 'lobby' && this.phase !== 'gameend') {
      this.stopTimers();
      this.phase = 'lobby';
      this.drawerId = null;
      this.sys('Peli keskeytyi – pelaajia ei ole tarpeeksi.', 'bad');
      this.io.all('lobby', {});
    }
    this.broadcast();
  };

  Engine.prototype.guessers = function () {
    var drawerId = this.drawerId, out = [];
    this.players.forEach(function (p) { if (p.id !== drawerId) out.push(p); });
    return out;
  };

  /* ---------------- tilan lähetys ---------------- */

  Engine.prototype.playerList = function () {
    var self = this, out = [];
    this.players.forEach(function (p) {
      out.push({
        id: p.id, name: p.name, score: p.score, guessed: p.hasGuessed,
        isHost: p.id === self.hostId, isDrawer: p.id === self.drawerId
      });
    });
    return out.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
  };

  Engine.prototype.state = function () {
    var drawer = this.drawerId ? this.players.get(this.drawerId) : null;
    return {
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      drawTime: this.settings.drawTime,
      isPublic: !!this.settings.isPublic,
      drawerId: this.drawerId,
      drawerName: drawer ? drawer.name : null,
      category: this.phase === 'draw' ? this.category : null,
      pattern: this.phase === 'draw' ? this.patternOf() : null,
      secondsLeft: this.endsAt ? Math.max(0, Math.round((this.endsAt - Date.now()) / 1000)) : 0,
      players: this.playerList()
    };
  };

  Engine.prototype.broadcast = function () { this.io.all('state', this.state()); };
  Engine.prototype.sys = function (text, tone) { this.io.all('chat', { kind: 'system', text: text, tone: tone || 'neutral' }); };

  /* ---------------- sana ---------------- */

  Engine.prototype.patternOf = function () {
    if (!this.word) return null;
    var out = [];
    for (var i = 0; i < this.word.length; i++) {
      var ch = this.word[i];
      if (ch === ' ' || ch === '-') out.push(ch);
      else out.push(this.revealedIdx[i] ? ch.toUpperCase() : null);
    }
    return out;
  };

  Engine.prototype.makeRevealPlan = function () {
    var letters = [];
    for (var i = 0; i < this.word.length; i++) if (!/[\s-]/.test(this.word[i])) letters.push(i);
    letters = shuffle(letters);
    // Ensimmäinen vihje jo noin neljänneksen kohdalla, ja kirjaimia hieman enemmän.
    var count = Math.max(1, Math.min(Math.round(letters.length * 0.45), letters.length - 2));
    var picked = letters.slice(0, count);
    var t = this.settings.drawTime;
    return picked.map(function (idx, i) {
      return { idx: idx, at: Math.round(t * 0.75 - (i * (t * 0.6)) / Math.max(1, picked.length)) };
    }).sort(function (a, b) { return b.at - a.at; });
  };

  Engine.prototype.pickChoices = function () {
    var cat = this.categories[rnd(this.categories.length)];
    var used = this.usedWords, self = this;
    var pool = cat.words.filter(function (w) { return !used[w]; });
    if (pool.length < 5) {
      cat.words.forEach(function (w) { delete self.usedWords[w]; });
      pool = cat.words.slice();
    }
    return { category: cat.name, words: shuffle(pool).slice(0, 5) };
  };

  /* ---------------- ajastimet ---------------- */

  Engine.prototype.stopTimers = function () {
    if (this.interval) clearInterval(this.interval);
    if (this.timeout) clearTimeout(this.timeout);
    this.interval = null;
    this.timeout = null;
  };

  Engine.prototype.runTimer = function (seconds, onTick, onEnd) {
    var self = this;
    this.stopTimers();
    this.endsAt = Date.now() + seconds * 1000;
    this.interval = setInterval(function () {
      var left = Math.max(0, Math.round((self.endsAt - Date.now()) / 1000));
      self.io.all('tick', { secondsLeft: left });
      if (onTick) onTick(left);
      if (left <= 0) { self.stopTimers(); onEnd(); }
    }, 1000);
  };

  /* ---------------- pelin kulku ---------------- */

  /* Peli ei ala heti napin painalluksesta: kaikki ehtivät asettua. */
  Engine.prototype.startCountdown = function () {
    var self = this;
    var seconds = START_COUNTDOWN;
    this.phase = 'countdown';
    this.broadcast();
    this.io.all('countdown', { seconds: seconds });
    this.stopTimers();
    this.endsAt = Date.now() + seconds * 1000;
    this.interval = setInterval(function () {
      var left = Math.max(0, Math.round((self.endsAt - Date.now()) / 1000));
      self.io.all('tick', { secondsLeft: left });
      if (left <= 0) {
        self.stopTimers();
        self.start();
      }
    }, 250);
  };

  Engine.prototype.start = function () {
    if (this.players.size < 2) return;
    this.players.forEach(function (p) { p.score = 0; });
    this.retired.clear();
    this.usedWords = {};
    this.round = 1;
    this.order = shuffle(Array.from(this.players.keys()));
    this.turnIndex = -1;
    this.deltas = null;
    this.sys('Peli alkaa!', 'good');
    this.nextTurn();
  };

  /* Sama järjestys kierroksesta toiseen: poistuneet pois, uudet perään.
     Näin vuoro kiertää aina seuraavalle eikä sama pelaaja piirrä kahdesti peräkkäin. */
  Engine.prototype.rotationOrder = function () {
    var self = this;
    var jarjestys = this.order.filter(function (id) { return self.players.has(id); });
    this.players.forEach(function (p, id) {
      if (jarjestys.indexOf(id) === -1) jarjestys.push(id);
    });
    return jarjestys;
  };

  /* Montako piirtovuoroa on vielä jäljellä nykyisen vuoron jälkeen.
     Laskee vain paikalla olevat pelaajat, joten poistuminen lyhentää arviota heti. */
  Engine.prototype.turnsLeft = function () {
    if (this.phase === 'lobby' || this.phase === 'countdown' || this.phase === 'gameend') return 0;
    var loput = 0;
    for (var i = this.turnIndex + 1; i < this.order.length; i++) {
      if (this.players.has(this.order[i])) loput++;
    }
    var kierroksia = Math.max(0, this.settings.rounds - this.round);
    return loput + kierroksia * this.players.size;
  };

  Engine.prototype.nextTurn = function () {
    this.stopTimers();
    this.turnIndex++;
    var guard = 0;
    while (guard++ < 100) {
      if (this.turnIndex >= this.order.length) {
        this.round++;
        if (this.round > this.settings.rounds) return this.endGame();
        this.order = this.rotationOrder();
        this.turnIndex = 0;
        this.sys('Kierros ' + this.round + '/' + this.settings.rounds, 'info');
      }
      var id = this.order[this.turnIndex];
      if (id && this.players.has(id)) break;
      this.turnIndex++;
    }
    if (this.players.size < 2) {
      this.phase = 'lobby';
      this.drawerId = null;
      this.sys('Peli keskeytyi – pelaajia ei ole tarpeeksi.', 'bad');
      this.io.all('lobby', {});
      return this.broadcast();
    }
    this.beginChoose();
  };

  Engine.prototype.beginChoose = function () {
    var self = this;
    this.stopTimers();
    this.phase = 'choose';
    this.drawerId = this.order[this.turnIndex];
    this.word = null;
    this.ops = [];
    this.revealedIdx = {};
    this.correctOrder = [];
    this.players.forEach(function (p) { p.hasGuessed = false; });

    var pick = this.pickChoices();
    this.category = pick.category;
    this.choices = pick.words;
    this.endsAt = Date.now() + CHOOSE_SECONDS * 1000;

    this.io.all('clear', {});
    this.broadcast();
    this.io.to(this.drawerId, 'choices', { category: pick.category, words: pick.words, seconds: CHOOSE_SECONDS });

    this.runTimer(CHOOSE_SECONDS, null, function () {
      self.chooseWord(self.drawerId, rnd(self.choices.length), true);
    });
  };

  Engine.prototype.chooseWord = function (playerId, index, auto) {
    if (this.phase !== 'choose' || playerId !== this.drawerId) return;
    var word = this.choices[index];
    if (!word) return;
    this.beginDraw(word, auto);
  };

  Engine.prototype.beginDraw = function (word, auto) {
    var self = this;
    this.stopTimers();
    this.phase = 'draw';
    this.word = word;
    this.usedWords[word] = true;
    this.revealedIdx = {};
    this.revealPlan = this.makeRevealPlan();
    this.ops = [];
    this.endsAt = Date.now() + this.settings.drawTime * 1000;

    this.io.all('clear', {});
    this.broadcast();
    this.io.to(this.drawerId, 'secret', { word: word });
    if (auto) this.io.to(this.drawerId, 'chat', { kind: 'system', text: 'Aika loppui – sana arvottiin.', tone: 'info' });

    this.runTimer(this.settings.drawTime, function (left) {
      while (self.revealPlan.length && left <= self.revealPlan[0].at) {
        var hint = self.revealPlan.shift();
        self.revealedIdx[hint.idx] = true;
        self.io.all('pattern', { pattern: self.patternOf() });
      }
    }, function () { self.endTurn('time'); });
  };

  Engine.prototype.award = function (player) {
    var total = this.settings.drawTime;
    var left = Math.max(0, (this.endsAt - Date.now()) / 1000);
    var ratio = Math.max(0, Math.min(1, left / total));
    var points = Math.round(120 + 280 * ratio) + (this.correctOrder.length === 0 ? 40 : 0);
    player.score += points;

    var drawer = this.players.get(this.drawerId);
    var drawerPoints = Math.round(50 + 90 * ratio);
    if (drawer) drawer.score += drawerPoints;

    this.deltas = this.deltas || {};
    this.deltas[player.id] = (this.deltas[player.id] || 0) + points;
    if (drawer) this.deltas[drawer.id] = (this.deltas[drawer.id] || 0) + drawerPoints;
  };

  Engine.prototype.endTurn = function (reason) {
    if (this.phase !== 'draw' && this.phase !== 'choose') return;
    var self = this;
    this.stopTimers();
    var word = this.word;
    this.phase = 'turnend';
    this.endsAt = Date.now() + TURN_END_SECONDS * 1000;

    this.io.all('turnend', {
      word: word || null, reason: reason, drawerId: this.drawerId,
      deltas: this.deltas || {}, players: this.playerList()
    });
    this.deltas = null;
    this.broadcast();
    this.timeout = setTimeout(function () { self.nextTurn(); }, TURN_END_SECONDS * 1000);
  };

  Engine.prototype.endGame = function () {
    this.stopTimers();
    this.phase = 'gameend';
    this.drawerId = null;
    this.word = null;
    this.endsAt = 0;
    this.io.all('gameend', { players: this.playerList() });
    this.broadcast();
  };

  Engine.prototype.backToLobby = function () {
    this.stopTimers();
    this.phase = 'lobby';
    this.drawerId = null;
    this.word = null;
    this.round = 0;
    this.ops = [];
    this.retired.clear();
    this.players.forEach(function (p) { p.score = 0; p.hasGuessed = false; });
    this.io.all('clear', {});
    this.io.all('lobby', {});
    this.broadcast();
  };

  /* ---------------- pelaajien toiminnot ---------------- */

  Engine.prototype.action = function (id, ev, data) {
    var player = this.players.get(id);
    if (!player) return;
    data = data || {};
    var isHost = id === this.hostId;
    var isDrawer = id === this.drawerId;

    switch (ev) {
      case 'settings':
        if (!isHost || (this.phase !== 'lobby' && this.phase !== 'gameend')) return;
        if (isFinite(data.rounds)) this.settings.rounds = Math.max(1, Math.min(10, Math.round(data.rounds)));
        if (isFinite(data.drawTime)) this.settings.drawTime = Math.max(20, Math.min(300, Math.round(data.drawTime)));
        if (typeof data.isPublic === 'boolean') this.settings.isPublic = data.isPublic;
        return this.broadcast();

      case 'start':
        if (!isHost || (this.phase !== 'lobby' && this.phase !== 'gameend')) return;
        if (this.players.size < 2) {
          return this.io.to(id, 'chat', { kind: 'system', text: 'Peliin tarvitaan vähintään 2 pelaajaa.', tone: 'bad' });
        }
        return this.startCountdown();

      case 'rename':
        if (this.phase !== 'lobby' && this.phase !== 'countdown' && this.phase !== 'gameend') return;
        var toivottu = cleanName(data.name);
        if (!toivottu || toivottu.toLowerCase() === player.name.toLowerCase()) return;
        var otetut = false;
        this.players.forEach(function (p) {
          if (p.id !== id && p.name.toLowerCase() === toivottu.toLowerCase()) otetut = true;
        });
        if (otetut) {
          return this.io.to(id, 'chat', { kind: 'system', text: 'Nimi on jo käytössä.', tone: 'bad' });
        }
        this.sys(player.name + ' on nyt ' + toivottu + '.', 'info');
        player.name = toivottu;
        return this.broadcast();

      case 'backToLobby':
        if (isHost) this.backToLobby();
        return;

      case 'choose':
        return this.chooseWord(id, Number(data.index), false);

      case 'op':
        if (!isDrawer || this.phase !== 'draw' || !data || typeof data !== 'object') return;
        if (data.pts && data.pts.length > 4000) return;
        if (this.ops.length < MAX_OPS) this.ops.push(data);
        return this.io.except(id, 'op', data);

      case 'live':
        if (!isDrawer || this.phase !== 'draw') return;
        return this.io.except(id, 'live', data);

      case 'undo':
        if (!isDrawer) return;
        this.ops.pop();
        return this.io.all('sync', { ops: this.ops });

      case 'clearCanvas':
        if (!isDrawer) return;
        this.ops = [];
        return this.io.all('clear', {});

      case 'guess':
        return this.guess(player, data.text);
    }
  };

  Engine.prototype.guess = function (player, text) {
    var raw = String(text || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
    if (!raw) return;
    var self = this;
    var isDrawer = player.id === this.drawerId;
    var inGame = this.phase === 'draw';

    // piirtäjä ja jo arvanneet eivät voi vuotaa sanaa muille
    if (inGame && (isDrawer || player.hasGuessed)) {
      var seen = {};
      [this.drawerId].concat(this.correctOrder).forEach(function (pid) {
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        self.io.to(pid, 'chat', { kind: 'team', name: player.name, playerId: player.id, text: raw });
      });
      return;
    }

    if (inGame && this.word) {
      var guess = normalize(raw), answer = normalize(this.word);
      if (guess === answer) {
        player.hasGuessed = true;
        this.award(player);
        this.correctOrder.push(player.id);
        this.io.all('chat', { kind: 'correct', name: player.name, playerId: player.id, text: 'Oikein!' });
        this.io.to(player.id, 'secret', { word: this.word });
        this.broadcast();
        if (this.guessers().every(function (p) { return p.hasGuessed; })) this.endTurn('all');
        return;
      }
      if (levenshtein(guess, answer) <= 1 || (guess.length > 3 && answer.indexOf(guess) >= 0)) {
        this.io.to(player.id, 'chat', { kind: 'system', text: '"' + raw + '" on lähellä!', tone: 'info' });
      }
    }

    this.io.all('chat', { kind: 'guess', name: player.name, playerId: player.id, text: raw });
  };

  Engine.prototype.destroy = function () { this.stopTimers(); };

  root.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);

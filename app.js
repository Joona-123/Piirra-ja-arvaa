/* app.js – käyttöliittymä. Sama koodi ajetaan sekä pelin luojalla että muilla;
   ainoa ero on, että luojan selaimessa pyörii lisäksi engine.js. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var link = new Link();

  var S = { me: null, code: null, state: null, isDrawer: false, word: null, total: 1, phase: 'lobby' };

  /* ---------------- ruudut ---------------- */

  function show(id) {
    if (id === 'screen-game' && typeof board !== 'undefined' && board) {
      setTimeout(function () { board.resize(); }, 0);
    }
    ['screen-home', 'screen-lobby', 'screen-game'].forEach(function (s) {
      $(s).classList.toggle('active', s === id);
    });
  }

  var modal = $('modal'), modalCard = $('modalCard');
  function openModal(html, kind) {
    S.modalKind = kind || null;
    modalCard.innerHTML = html;
    modal.hidden = false;
  }
  function closeModal() { modal.hidden = true; modalCard.innerHTML = ''; S.modalKind = null; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---------------- aloitusruutu ---------------- */

  var nameInput = $('nameInput'), codeInput = $('codeInput'), homeError = $('homeError');
  var btnCreate = $('btnCreate'), btnJoin = $('btnJoin');
  nameInput.value = localStorage.getItem('pja.name') || '';

  var urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) codeInput.value = urlCode.toUpperCase().slice(0, 4);
  (nameInput.value ? codeInput : nameInput).focus();

  function myName() {
    var n = nameInput.value.trim();
    localStorage.setItem('pja.name', n);
    return n || 'Pelaaja';
  }

  function busy(on, btn, text) {
    btnCreate.disabled = btnJoin.disabled = on;
    if (btn) btn.textContent = on ? text : btn.dataset.label;
  }
  btnCreate.dataset.label = btnCreate.textContent;
  btnJoin.dataset.label = btnJoin.textContent;

  btnCreate.addEventListener('click', function () {
    homeError.textContent = '';
    busy(true, btnCreate, 'Avataan peliä…');
    link.createGame(myName(), function (err, code) {
      busy(false, btnCreate);
      if (err) return (homeError.textContent = err);
      enterRoom(code);
    });
  });

  btnJoin.addEventListener('click', joinFromInput);
  codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') joinFromInput(); });
  nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') codeInput.focus(); });

  function joinFromInput() {
    var code = codeInput.value.trim().toUpperCase();
    homeError.textContent = '';
    if (code.length !== 4) return (homeError.textContent = 'Koodissa on 4 merkkiä.');
    busy(true, btnJoin, 'Yhdistetään…');
    link.joinGame(code, myName(), function (err, joined) {
      busy(false, btnJoin);
      if (err) return (homeError.textContent = err);
      enterRoom(joined);
    });
  }

  function enterRoom(code) {
    S.me = link.me;
    S.code = code;
    buildLobby(code);
    $('hostNote').hidden = !link.isHost;
    show('screen-lobby');
    // tila on voitu lähettää jo ennen kuin tiedettiin kuka olen -> piirrä uudelleen
    if (link.isHost && link.engine) onState(link.engine.state());
    else if (S.state) onState(S.state);
  }

  $('btnLeave').addEventListener('click', function () {
    link.leave();
    location.href = location.pathname;
  });

  /* ---------------- aula ---------------- */

  function joinUrl(code) { return location.origin + location.pathname + '?code=' + code; }

  function buildLobby(code) {
    $('lobbyCode').textContent = code;
    var url = joinUrl(code);
    $('lobbyUrl').textContent = url.replace(/^https?:\/\//, '');
    try {
      $('qrBox').innerHTML = QR.svg(url, { quiet: 2 });
    } catch (e) {
      $('qrBox').innerHTML = '<p class="hint">QR-koodia ei voitu luoda</p>';
    }
  }

  $('btnCopy').addEventListener('click', function () {
    var url = joinUrl(S.code), btn = this;
    var done = function () { btn.textContent = 'Kopioitu!'; setTimeout(function () { btn.textContent = 'Kopioi linkki'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Kopioi osoite yltä'; }
      document.body.removeChild(ta);
    }
  });

  var setRounds = $('setRounds'), setTime = $('setTime');
  [setRounds, setTime].forEach(function (el) {
    el.addEventListener('input', function () {
      $('roundsValue').textContent = setRounds.value;
      $('timeValue').textContent = setTime.value;
      updateTurnsNote();
    });
    el.addEventListener('change', function () {
      link.send('settings', { rounds: Number(setRounds.value), drawTime: Number(setTime.value) });
    });
  });

  function updateTurnsNote() {
    var n = S.state ? S.state.players.length : 0;
    var turns = n * Number(setRounds.value);
    var mins = Math.round((turns * (Number(setTime.value) + 16)) / 60);
    $('turnsNote').textContent = n >= 2
      ? 'Jokainen piirtää ' + setRounds.value + ' kertaa · yhteensä ' + turns + ' vuoroa · noin ' + mins + ' min.'
      : 'Tarvitaan vähintään 2 pelaajaa.';
  }

  $('btnStart').addEventListener('click', function () { link.send('start'); });

  function renderLobby(st) {
    var list = $('lobbyPlayers');
    list.innerHTML = '';
    st.players.forEach(function (p, i) {
      var li = document.createElement('li');
      li.style.setProperty('--tilt', (i % 2 ? 1.6 : -1.8) + 'deg');
      li.className = p.isHost ? 'host' : '';
      li.appendChild(document.createTextNode(p.name + (p.id === S.me ? ' (sinä)' : '')));
      list.appendChild(li);
    });
    $('lobbyCount').textContent = st.players.length + '/12';

    var isHost = st.hostId === S.me;
    setRounds.disabled = setTime.disabled = !isHost;
    setRounds.value = st.rounds; setTime.value = st.drawTime;
    $('roundsValue').textContent = st.rounds;
    $('timeValue').textContent = st.drawTime;
    updateTurnsNote();

    $('btnStart').hidden = !isHost;
    $('btnStart').disabled = st.players.length < 2;
    $('lobbyHint').textContent = isHost
      ? (st.players.length < 2 ? 'Kutsu vielä yksi pelaaja koodilla tai QR-koodilla.' : 'Kaikki valmiina!')
      : 'Odota, että pelinjohtaja aloittaa.';
  }

  /* ---------------- piirtoalusta ja työkalut ---------------- */

  var board = new Board({
    sheet: $('sheet'), base: $('base'), overlay: $('overlay'),
    onOp: function (op) { link.send('op', op); },
    onLive: function (seg) { link.send('live', seg); }
  });

  var TOOLS = [
    { id: 'pen', title: 'Kynä', svg: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>' },
    { id: 'line', title: 'Viiva', svg: '<path d="M5 19L19 5"/>' },
    { id: 'rect', title: 'Nelikulmio', svg: '<path d="M4 6h16v12H4z"/>' },
    { id: 'circle', title: 'Ympyrä', svg: '<circle cx="12" cy="12" r="8"/>' },
    { id: 'eraser', title: 'Pyyhekumi', svg: '<path d="M8 19h11"/><path d="M15 5l5 5-8 8H8l-3-3z"/>' }
  ];
  var COLORS = ['#23201d', '#7a7168', '#ffffff', '#e04b3c', '#f08a2c', '#f2b830',
    '#3f9b53', '#2aa39b', '#2f6fae', '#8759a8', '#e07ab0', '#8a5a2b'];
  var WIDTHS = [4, 9, 18, 34];

  function buildTools() {
    var row = $('toolButtons');
    TOOLS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tool' + (t.id === 'pen' ? ' on' : '');
      b.title = t.title;
      b.setAttribute('aria-label', t.title);
      b.dataset.tool = t.id;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t.svg + '</svg>';
      b.addEventListener('click', function () {
        board.tool = t.id;
        row.querySelectorAll('.tool[data-tool]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      row.appendChild(b);
    });

    var fillBtn = document.createElement('button');
    fillBtn.className = 'tool';
    fillBtn.title = 'Täyttö päälle/pois (nelikulmio ja ympyrä)';
    fillBtn.setAttribute('aria-label', 'Täyttö');
    fillBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path class="fill" d="M4 12h16v6H4z"/></svg>';
    fillBtn.addEventListener('click', function () {
      board.fill = !board.fill;
      fillBtn.classList.toggle('on', board.fill);
    });
    row.appendChild(fillBtn);

    var crow = $('colorRow');
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', 'Väri ' + c);
      b.addEventListener('click', function () {
        board.color = c;
        if (board.tool === 'eraser') {
          board.tool = 'pen';
          $('toolButtons').querySelectorAll('.tool[data-tool]').forEach(function (x) {
            x.classList.toggle('on', x.dataset.tool === 'pen');
          });
        }
        crow.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      crow.appendChild(b);
    });

    var wrow = $('widthRow');
    WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.className = 'width-btn' + (i === 1 ? ' on' : '');
      b.title = 'Paksuus';
      b.setAttribute('aria-label', 'Viivan paksuus ' + (i + 1));
      var dot = document.createElement('span');
      var px = Math.max(4, Math.round(w * 0.6));
      dot.style.width = px + 'px'; dot.style.height = px + 'px';
      b.appendChild(dot);
      b.addEventListener('click', function () {
        board.width = w;
        wrow.querySelectorAll('.width-btn').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      wrow.appendChild(b);
    });
    board.width = WIDTHS[1];
  }
  buildTools();

  $('btnUndo').addEventListener('click', function () { link.send('undo'); });
  $('btnClear').addEventListener('click', function () { link.send('clearCanvas'); });

  /* ---------------- HUD ---------------- */

  var RING = 2 * Math.PI * 17;
  $('ringFill').style.strokeDasharray = RING;

  function setTimer(left, total) {
    $('timerText').textContent = left;
    var frac = total ? Math.max(0, Math.min(1, left / total)) : 0;
    $('ringFill').style.strokeDashoffset = RING * (1 - frac);
    document.querySelector('.hud-timer').classList.toggle('low', left <= 10);
  }

  function renderPattern(pattern, known) {
    var box = $('patternBox');
    box.innerHTML = '';
    box.classList.toggle('known', !!known);
    (pattern || []).forEach(function (ch) {
      var i = document.createElement('i');
      if (ch === ' ') { i.className = 'space'; }
      else if (ch === '-') { i.className = 'space'; i.textContent = '-'; }
      else i.textContent = ch || '';
      box.appendChild(i);
    });
  }

  function countLetters(pattern) {
    return (pattern || []).filter(function (c) { return c !== ' ' && c !== '-'; }).length;
  }

  function renderPlayers(st) {
    var ul = $('players');
    ul.innerHTML = '';
    st.players.forEach(function (p) {
      var li = document.createElement('li');
      li.className = (p.isDrawer ? 'drawer ' : '') + (p.guessed ? 'guessed ' : '') + (p.id === S.me ? 'me' : '');
      li.innerHTML = '<b>' + (p.isDrawer ? '✏️ ' : '') + escapeHtml(p.name) + '</b>' +
        '<span class="pts">' + p.score + ' p' + (p.guessed ? ' ✓' : '') + '</span>';
      ul.appendChild(li);
    });
  }

  /* ---------------- chat ja kuplat ---------------- */

  var chat = $('chat'), floats = $('floats');

  function addBubble(o) {
    var div = document.createElement('div');
    if (o.kind === 'system') {
      div.className = 'sysline ' + (o.tone || '');
      div.textContent = o.text;
    } else {
      div.className = 'bubble' + (o.kind === 'correct' ? ' ok' : '') +
        (o.kind === 'team' ? ' team' : '') + (o.playerId === S.me ? ' mine' : '');
      div.innerHTML = '<span class="who">' + escapeHtml(o.name) +
        (o.kind === 'team' ? ' · vain arvanneille' : '') + '</span>' + escapeHtml(o.text);
      addFloat(o);
    }
    chat.appendChild(div);
    while (chat.children.length > 60) chat.removeChild(chat.firstChild);
    chat.scrollTop = chat.scrollHeight;
  }

  function addFloat(o) {
    if (o.kind === 'team') return;
    var d = document.createElement('div');
    d.className = 'float' + (o.kind === 'correct' ? ' ok' : '');
    d.textContent = o.name + ': ' + o.text;
    floats.appendChild(d);
    while (floats.children.length > 4) floats.removeChild(floats.firstChild);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3900);
  }

  $('chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('chatInput').value.trim();
    if (!v) return;
    link.send('guess', { text: v });
    $('chatInput').value = '';
  });

  /* ---------------- pelitapahtumat ---------------- */

  function onState(st) {
    S.state = st;
    S.phase = st.phase;
    S.isDrawer = st.drawerId === S.me;

    if (st.phase === 'lobby') {
      renderLobby(st);
      if ($('screen-game').classList.contains('active')) { show('screen-lobby'); closeModal(); }
      return;
    }

    if (!$('screen-game').classList.contains('active') && st.phase !== 'gameend') show('screen-game');

    // uusi vuoro alkoi -> edellisen vuoron tulosruutu pois, muuten peli näyttää jumittuneen
    if ((st.phase === 'choose' || st.phase === 'draw') && S.modalKind === 'turnend') closeModal();

    $('roundLabel').textContent = 'Kierros\n' + st.round + '/' + st.rounds;
    renderPlayers(st);

    var me = st.players.filter(function (p) { return p.id === S.me; })[0];
    board.setEnabled(S.isDrawer && st.phase === 'draw');
    $('tools').hidden = !S.isDrawer || st.phase !== 'draw';
    $('chatInput').placeholder = S.isDrawer ? 'Vinkkejä ei saa antaa…' : (me && me.guessed ? 'Kirjoita arvanneille…' : 'Kirjoita arvaus…');

    var wait = $('waitNote');
    if (st.phase === 'choose') {
      S.total = 10;
      wait.classList.add('show');
      wait.textContent = S.isDrawer ? 'Valitse sana…' : (st.drawerName || 'Pelaaja') + ' valitsee sanaa…';
      $('catLabel').textContent = 'Odotetaan sanaa';
      renderPattern([]);
      S.word = null;
    } else if (st.phase === 'draw') {
      S.total = st.drawTime;
      wait.classList.remove('show');
      $('catLabel').textContent = st.category + ' · ' + countLetters(st.pattern) + ' kirjainta';
      if (S.word) renderPattern(S.word.toUpperCase().split(''), true);
      else renderPattern(st.pattern, false);
    } else if (st.phase === 'turnend') {
      S.total = 6;
      wait.classList.remove('show');
    }

    if (st.secondsLeft) setTimer(st.secondsLeft, S.total);
  }
  link.on('state', onState);

  link.on('lobby', function () { closeModal(); show('screen-lobby'); });

  link.on('tick', function (d) {
    setTimer(d.secondsLeft, S.total);
    var bar = document.querySelector('.choose-bar i');
    if (bar) bar.style.width = Math.round((d.secondsLeft / 10) * 100) + '%';
  });

  link.on('choices', function (d) {
    var html = '<h2>Valitse sana</h2><p class="hint">Kategoria: <b>' + escapeHtml(d.category) + '</b></p><div class="word-choice">';
    d.words.forEach(function (w, i) {
      html += '<button class="btn" data-i="' + i + '">' + escapeHtml(w) + '</button>';
    });
    html += '</div><div class="choose-bar"><i></i></div><p class="hint">Jos et valitse, sana arvotaan.</p>';
    openModal(html, 'choices');
    modalCard.querySelectorAll('button[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        link.send('choose', { index: Number(b.dataset.i) });
        closeModal();
      });
    });
  });

  link.on('secret', function (d) {
    S.word = d.word;
    renderPattern(d.word.toUpperCase().split(''), true);
    closeModal();
  });

  link.on('pattern', function (d) { if (!S.word) renderPattern(d.pattern, false); });
  link.on('chat', addBubble);
  link.on('clear', function () { board.clear(); });
  link.on('sync', function (d) { board.setOps(d.ops || []); });
  link.on('op', function (op) { board.addOp(op); });
  link.on('live', function (seg) { board.applyLive(seg); });

  link.on('turnend', function (d) {
    board.setEnabled(false);
    $('tools').hidden = true;
    S.word = null;
    var html = '<h2>' + (d.reason === 'all' ? 'Kaikki arvasivat!' : 'Aika loppui') + '</h2>' +
      '<p class="hint">Sana oli</p><div class="reveal-word">' + escapeHtml(d.word || '–') + '</div><ul class="score-list">';
    d.players.forEach(function (p) {
      var delta = d.deltas && d.deltas[p.id] ? '+' + d.deltas[p.id] : '';
      html += '<li><b>' + escapeHtml(p.name) + '</b><span><span class="delta">' + delta + '</span> ' + p.score + ' p</span></li>';
    });
    openModal(html + '</ul><p class="hint">Seuraava vuoro alkaa hetken kuluttua…</p>', 'turnend');
    // varmistus: vaikka tilaviesti jäisi tulematta, tulosruutu ei jää jumiin
    clearTimeout(S.turnEndTimer);
    S.turnEndTimer = setTimeout(function () {
      if (S.modalKind === 'turnend') closeModal();
    }, 9000);
  });

  link.on('gameend', function (d) {
    var isHost = S.state && S.state.hostId === S.me;
    var html = '<h2>Peli päättyi!</h2><ul class="score-list">';
    d.players.forEach(function (p) {
      html += '<li><b>' + escapeHtml(p.name) + '</b><span>' + p.score + ' p</span></li>';
    });
    html += '</ul>';
    html += isHost
      ? '<button class="btn btn-primary" id="btnAgain">Takaisin aulaan</button>'
      : '<p class="hint">Pelinjohtaja voi aloittaa uuden pelin.</p>';
    openModal(html, 'gameend');
    var again = $('btnAgain');
    if (again) again.addEventListener('click', function () { link.send('backToLobby'); closeModal(); });
  });

  /* pelinjohtajan yhteys katkesi -> peli loppuu muilta */
  link.on('hostgone', function () {
    board.setEnabled(false);
    openModal('<h2>Peli päättyi</h2><p>Yhteys pelinjohtajaan katkesi. Peli pyörii hänen laitteellaan, joten se päättyy kun välilehti suljetaan.</p>' +
      '<button class="btn btn-primary" id="btnHome">Takaisin alkuun</button>');
    var b = $('btnHome');
    if (b) b.addEventListener('click', function () { location.href = location.pathname; });
  });

  /* varoita hostia välilehden sulkemisesta kesken pelin */
  window.addEventListener('beforeunload', function (e) {
    if (link.isHost && link.engine && link.engine.players.size > 1 && link.engine.phase !== 'lobby') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();

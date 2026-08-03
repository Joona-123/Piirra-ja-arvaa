/* app.js – käyttöliittymä. Sama koodi ajetaan sekä pelin luojalla että muilla;
   ainoa ero on, että luojan selaimessa pyörii lisäksi engine.js. */
(function () {
  'use strict';

  var GAME_VERSION = '1.8.0';

  var $ = function (id) { return document.getElementById(id); };
  var link = new Link();

  var S = { me: null, code: null, state: null, isDrawer: false, word: null, total: 1, phase: 'lobby' };

  /* ---------------- ruudut ---------------- */

  function show(id) {
    var menu = document.getElementById('btnMenu');
    if (menu) menu.hidden = (id !== 'screen-game');
    setTimeout(syncMenuButton, 0);
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

  // Nimilaatikko venyy oikealle vain jos nimi ei mahdu, eikä koskaan ruudun ulkopuolelle.
  function laajennaNimi(li) {
    var b = li.querySelector('b');
    if (!b || li.classList.contains('expanded')) return;
    var yli = b.scrollWidth - b.clientWidth;
    if (yli <= 1) return;                       // nimi näkyy jo kokonaan

    var r = li.getBoundingClientRect();
    var reuna = 8;
    var tilaa = (window.innerWidth || 360) - r.left - reuna;
    var haluttu = Math.ceil(r.width + yli + 2);
    var leveys = Math.max(r.width, Math.min(haluttu, tilaa));

    li.style.width = Math.round(r.width) + 'px';   // lähtökohta animaatiolle
    li.classList.add('expanded');
    requestAnimationFrame(function () { li.style.width = Math.round(leveys) + 'px'; });

    clearTimeout(li._laajennus);
    li._laajennus = setTimeout(function () {
      li.style.width = Math.round(r.width) + 'px';
      setTimeout(function () {
        li.classList.remove('expanded');
        li.style.width = '';
        repositionBubbles();
      }, 240);
    }, 2500);
    setTimeout(repositionBubbles, 240);
  }

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

  var NIMI_ETU = ['Nopea', 'Iloinen', 'Utelias', 'Rohkea', 'Unelias', 'Kepeä', 'Viekas', 'Reipas', 'Hurja', 'Sitkeä', 'Tyyni', 'Vikkelä'];
  var NIMI_TAKA = ['Kettu', 'Norsu', 'Orava', 'Hylje', 'Karhu', 'Ilves', 'Mäyrä', 'Kotka', 'Susi', 'Saukko', 'Peippo', 'Hirvi'];

  function arvottuNimi() {
    return NIMI_ETU[Math.floor(Math.random() * NIMI_ETU.length)] + ' ' +
           NIMI_TAKA[Math.floor(Math.random() * NIMI_TAKA.length)];
  }

  function myName() {
    var n = nameInput.value.trim() || arvottuNimi();
    nameInput.value = n;
    localStorage.setItem('pja.name', n);
    return n;
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

  var haetaan = false;
  function haeAvoimetPelit() {
    if (haetaan) return;
    haetaan = true;
    $('openNote').textContent = 'Haetaan avoimia pelejä…';
    $('btnRefresh').disabled = true;
    link.browsePublic(function (pelit) {
      haetaan = false;
      $('btnRefresh').disabled = false;
      var ul = $('openGames');
      ul.innerHTML = '';
      if (!pelit.length) {
        $('openNote').textContent = 'Ei avoimia pelejä juuri nyt. Luo oma ja jaa koodi kavereille.';
        return;
      }
      $('openNote').textContent = '';
      pelit.forEach(function (p) {
        var kaynnissa = p.phase && p.phase !== 'lobby' && p.phase !== 'countdown';
        var li = document.createElement('li');
        li.innerHTML =
          '<span class="koodi">' + escapeHtml(p.code) + '</span>' +
          '<span class="tiedot"><span class="nimi">' + escapeHtml(p.host || 'Peli') + '</span>' +
          '<span class="tila ' + (kaynnissa ? 'kaynnissa' : 'aulassa') + '">' +
          (kaynnissa ? 'Käynnissä · kierros ' + p.round + '/' + p.rounds : 'Aulassa, odottaa aloitusta') +
          ' · ' + p.players + '/12 pelaajaa</span></span>';
        var nappi = document.createElement('button');
        nappi.className = 'btn btn-small';
        nappi.textContent = kaynnissa ? 'Täynnä peliä' : 'Liity';
        nappi.disabled = kaynnissa || p.players >= 12;
        nappi.addEventListener('click', function () {
          codeInput.value = p.code;
          joinFromInput();
        });
        li.appendChild(nappi);
        ul.appendChild(li);
      });
    });
  }

  $('btnRefresh').addEventListener('click', haeAvoimetPelit);
  if (!urlCode) setTimeout(haeAvoimetPelit, 300);

  // Linkillä tai QR-koodilla tullut liitetään suoraan aulaan.
  if (urlCode) {
    homeError.textContent = 'Liitytään peliin ' + codeInput.value + '…';
    setTimeout(joinFromInput, 60);
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

  $('btnMenu').addEventListener('click', function () {
    openModal('<h2>Valikko</h2>' +
      '<p class="hint">' + (link.isHost
        ? 'Sinä pyörität peliä, joten poistumisesi päättää pelin kaikilta.'
        : 'Peli jatkuu ilman sinua, jos poistut.') + '</p>' +
      '<div class="menu-actions">' +
      '<button class="btn" id="btnClose">Takaisin peliin</button>' +
      '<button class="btn btn-danger" id="btnQuit">' +
      (link.isHost ? 'Päätä peli ja poistu' : 'Poistu pelistä') + '</button>' +
      '</div>', 'menu');
    $('btnClose').addEventListener('click', closeModal);
    $('btnQuit').addEventListener('click', function () {
      link.leave();
      location.href = location.pathname;
    });
  });

  var julkinenPaalla = false;
  function paivitaJulkisuus() {
    if (!link.isHost) return;
    if ($('setPublic').checked) {
      if (!julkinenPaalla) {
        julkinenPaalla = true;
        link.publishPublic(function () {
          var st = S.state || {};
          var isanta = (st.players || []).filter(function (p) { return p.id === st.hostId; })[0];
          return {
            code: S.code,
            host: isanta ? isanta.name + ':n peli' : 'Peli',
            players: (st.players || []).length,
            phase: st.phase,
            round: st.round,
            rounds: st.rounds
          };
        });
        addToast('Peli näkyy nyt aloitussivun listassa', 'good');
      }
    } else if (julkinenPaalla) {
      julkinenPaalla = false;
      link.unpublishPublic();
    }
  }
  $('setPublic').addEventListener('change', paivitaJulkisuus);

  $('btnRename').addEventListener('click', function () {
    var uusi = $('renameInput').value.trim();
    if (!uusi) return;
    localStorage.setItem('pja.name', uusi);
    nameInput.value = uusi;
    link.send('rename', { name: uusi });
  });
  $('renameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('btnRename').click(); }
  });

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
      $('timeValue').textContent = muotoileAika(setTime.value);
      updateTurnsNote();
    });
    el.addEventListener('change', function () {
      link.send('settings', { rounds: Number(setRounds.value), drawTime: Number(setTime.value) });
    });
  });

  function muotoileAika(sek) {
    sek = Number(sek) || 0;
    if (sek < 60) return sek + ' s';
    var min = Math.floor(sek / 60), jaa = sek % 60;
    return jaa ? min + ' min ' + jaa + ' s' : min + ' min';
  }

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

    var oma = st.players.filter(function (p) { return p.id === S.me; })[0];
    if (oma && document.activeElement !== $('renameInput')) $('renameInput').value = oma.name;

    var isHost = st.hostId === S.me;
    setRounds.disabled = setTime.disabled = !isHost;
    $('setPublic').disabled = !isHost;
    $('setPublic').closest('.toggle').style.display = isHost ? '' : 'none';
    setRounds.value = st.rounds; setTime.value = st.drawTime;
    $('roundsValue').textContent = st.rounds;
    $('timeValue').textContent = muotoileAika(st.drawTime);
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
    { id: 'fill', title: 'Väritä alue', svg: '<path d="M6 12L12 6l7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3z"/><path d="M10 4l2 2"/><path class="fill" d="M20 20c1.2 0 2-.8 2-1.8 0-1-2-3.2-2-3.2s-2 2.2-2 3.2c0 1 .8 1.8 2 1.8z"/>' },
    { id: 'eraser', title: 'Pyyhekumi', svg: '<path d="M8 19h11"/><path d="M15 5l5 5-8 8H8l-3-3z"/>' }
  ];
  var COLORS = [
    '#23201d', '#5c554c', '#9c948a', '#ffffff',
    '#7a3b12', '#8a5a2b', '#c2410c', '#f08a2c',
    '#a01f16', '#e04b3c', '#f2b830', '#f7e463',
    '#1f6e43', '#3f9b53', '#8bc34a', '#2aa39b',
    '#26418f', '#2f6fae', '#4fc3e8', '#5a2d82',
    '#8759a8', '#c0399a', '#e07ab0', '#f6c6b0'
  ];
  var WIDTHS = [4, 9, 18, 34];

  // Kosketusnäytöllä napin 'click' voi jäädä väliin heti piirtovedon jälkeen
  // (selain odottaa mahdollista kaksoisnapautusta). Reagoidaan siksi jo painallukseen.
  function onTap(el, fn) {
    var hoidettu = false;
    el.addEventListener('pointerdown', function (e) {
      hoidettu = true;
      setTimeout(function () { hoidettu = false; }, 500);
      fn(e);
    });
    el.addEventListener('click', function (e) { if (!hoidettu) fn(e); });
  }

  function buildTools() {
    var row = $('toolButtons');
    TOOLS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tool' + (t.id === 'pen' ? ' on' : '');
      b.title = t.title;
      b.setAttribute('aria-label', t.title);
      b.dataset.tool = t.id;
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t.svg + '</svg>';
      onTap(b, function () {
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
    onTap(fillBtn, function () {
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
      onTap(b, function () {
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
      onTap(b, function () {
        board.width = w;
        wrow.querySelectorAll('.width-btn').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      wrow.appendChild(b);
    });
    board.width = WIDTHS[1];
  }
  buildTools();

  $('btnUndo').addEventListener('click', function () { link.send('undo'); });
  var clearArmed = null;
  $('btnClear').addEventListener('click', function () {
    var btn = this;
    if (clearArmed) {                       // toinen painallus 5 s sisällä
      clearTimeout(clearArmed);
      clearArmed = null;
      btn.classList.remove('armed');
      btn.title = 'Tyhjennä';
      link.send('clearCanvas');
      return;
    }
    btn.classList.add('armed');
    btn.title = 'Paina uudelleen: tyhjentää koko piirroksen';
    addToast('Paina uudelleen, niin koko piirros pyyhkiytyy', 'bad');
    clearArmed = setTimeout(function () {
      clearArmed = null;
      btn.classList.remove('armed');
      btn.title = 'Tyhjennä';
    }, 5000);
  });

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
      li.dataset.id = p.id;
      li.className = (p.isDrawer ? 'drawer ' : '') + (p.guessed ? 'guessed ' : '') + (p.id === S.me ? 'me' : '');
      li.innerHTML = '<b>' + (p.isDrawer ? '✏️ ' : '') + escapeHtml(p.name) + '</b>' +
        '<span class="pts">' + p.score + ' p' + (p.guessed ? ' ✓' : '') + '</span>';
      li.addEventListener('click', function () { laajennaNimi(this); });
      ul.appendChild(li);
    });
    repositionBubbles();
  }

  /* ---------------- chat ja kuplat ---------------- */

  var toasts = $('toasts');

  function addBubble(o) {
    if (o.kind === 'system') return addToast(o.text, o.tone);
    addFloat(o);
  }

  /* lyhyt ilmoitus ruudun alalaidassa (liittymiset, vihjeet yms.) */
  function addToast(text, tone) {
    var t = document.createElement('div');
    t.className = 'toast ' + (tone || '');
    t.textContent = text;
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.removeChild(toasts.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }

  /* kuplat pysyvät pelaajakortin kohdalla myös kun asettelu muuttuu */
  function repositionBubbles() {
    var kuplat = document.querySelectorAll('.name-bubble');
    for (var i = 0; i < kuplat.length; i++) sijoitaKupla(kuplat[i]);
  }

  function sijoitaKupla(b) {
    var id = b.getAttribute('data-player');
    var card = null, cards = $('players').children;
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.id === id) card = cards[i];
    if (!card) { if (b.parentNode) b.parentNode.removeChild(b); return; }

    var r = card.getBoundingClientRect();
    var s = b.getBoundingClientRect();
    var w = s.width || 120, h = s.height || 28;
    var lev = window.innerWidth || 360, kor = window.innerHeight || 640;
    var reuna = 6;
    b.classList.remove('below', 'side-left', 'side-right');

    var reunoilla = document.body.classList.contains('drawfull') ||
                    document.body.classList.contains('keyboard');

    if (reunoilla) {
      // pelaajat ovat piirtoalueen sivuilla -> kupla tulee sivultapäin
      var vasemmalla = (r.left + r.width / 2) < lev / 2;
      var x = vasemmalla ? r.right + 10 : r.left - w - 10;
      var y = r.top + r.height / 2 - h / 2;
      b.classList.add(vasemmalla ? 'side-left' : 'side-right');
      b.style.left = Math.round(Math.max(reuna, Math.min(lev - w - reuna, x))) + 'px';
      b.style.top = Math.round(Math.max(reuna, Math.min(kor - h - reuna, y))) + 'px';
      // nuoli pelaajan korkeudelle
      var pysty = r.top + r.height / 2 - parseFloat(b.style.top);
      b.style.setProperty('--tail-y', Math.round(Math.max(10, Math.min(h - 10, pysty))) + 'px');
      return;
    }

    var left = Math.max(reuna, Math.min(lev - w - reuna, r.left + r.width / 2 - w / 2));
    var top = r.top - h - 10;
    if (top < 4) { top = r.bottom + 8; b.classList.add('below'); }
    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
    // nuoli osoittaa pelaajan keskikohtaan myös kun kupla on siirtynyt reunan takia
    var osoitin = r.left + r.width / 2 - left;
    b.style.setProperty('--tail', Math.round(Math.max(12, Math.min(w - 12, osoitin))) + 'px');
  }

  /* poistaa kaikki kuplat kerralla (esim. kun vuoro päättyy) */
  function clearBubbles() {
    var list = document.querySelectorAll('.name-bubble');
    for (var i = 0; i < list.length; i++) list[i].parentNode.removeChild(list[i]);
  }

  var BUBBLE_MS = 3400;

  function addFloat(o) {
    if (o.kind === 'team' || !o.playerId) return;
    // vuoron tulosruutu on auki -> ei kuplia sen päälle
    if (!modal.hidden) return;
    var card = null, cards = $('players').children;
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.id === o.playerId) card = cards[i];
    if (!card) return;

    // vain uusin viesti näkyy: edellinen saman pelaajan kupla poistuu
    var vanhat = document.querySelectorAll('.name-bubble[data-player="' + o.playerId + '"]');
    for (var v = 0; v < vanhat.length; v++) vanhat[v].parentNode.removeChild(vanhat[v]);

    var b = document.createElement('div');
    b.className = 'name-bubble' + (o.kind === 'correct' ? ' ok' : '');
    b.textContent = o.text;
    b.setAttribute('data-player', o.playerId);
    document.body.appendChild(b);

    var r = card.getBoundingClientRect();
    var size = b.getBoundingClientRect();
    var w = size.width || 120, h = size.height || 28;
    var left = Math.max(6, Math.min((window.innerWidth || 360) - w - 6, r.left + r.width / 2 - w / 2));
    var top = r.top - h - 12;
    if (top < 4) { top = r.bottom + 10; b.classList.add('below'); }

    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';

    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, BUBBLE_MS);
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

    if (st.phase === 'countdown' || (st.phase === 'gameend' && S.aulassa)) {
      renderLobby(st);
      if (!$('screen-lobby').classList.contains('active')) show('screen-lobby');
      return;
    }

    if (st.phase === 'lobby') {
      renderLobby(st);
      if ($('screen-game').classList.contains('active')) { show('screen-lobby'); closeModal(); }
      return;
    }

    if (!$('screen-game').classList.contains('active') && st.phase !== 'gameend') show('screen-game');

    // uusi vuoro alkoi -> edellisen vuoron tulosruutu pois, muuten peli näyttää jumittuneen
    if ((st.phase === 'choose' || st.phase === 'draw') &&
        (S.modalKind === 'turnend' || S.modalKind === 'countdown')) closeModal();

    $('roundLabel').textContent = 'Kierros\n' + st.round + '/' + st.rounds;
    renderPlayers(st);

    var me = st.players.filter(function (p) { return p.id === S.me; })[0];
    board.setEnabled(S.isDrawer && st.phase === 'draw');
    $('tools').hidden = !S.isDrawer || st.phase !== 'draw';
    var hideInput = S.isDrawer && st.phase === 'draw';
    $('chatForm').hidden = hideInput;
    $('chatInput').placeholder = (me && me.guessed) ? 'Kirjoita arvanneille…' : 'Kirjoita arvaus…';

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
    updateOrientation();
  }
  link.on('state', onState);

  link.on('countdown', function (d) {
    S.aulassa = false;
    S.total = d.seconds || 5;
    openModal('<h2>Peli alkaa!</h2><div class="countdown" id="countNum">' + S.total + '</div>' +
      '<p class="hint">Valmistautukaa…</p>', 'countdown');
  });

  link.on('lobby', function () { closeModal(); show('screen-lobby'); });

  link.on('tick', function (d) {
    setTimer(d.secondsLeft, S.total);

    var num = $('countNum');
    if (num) num.textContent = d.secondsLeft > 0 ? d.secondsLeft : 'Nyt!';
  });

  link.on('choices', function (d) {
    var html = '<h2>Valitse sana</h2><p class="hint">Kategoria: <b>' + escapeHtml(d.category) + '</b></p><div class="word-choice">';
    d.words.forEach(function (w, i) {
      html += '<button class="btn" data-i="' + i + '">' + escapeHtml(w) + '</button>';
    });
    html += '</div><div class="choose-bar"><i></i></div><p class="hint">Jos et valitse, sana arvotaan.</p>';
    openModal(html, 'choices');
    var bar = modalCard.querySelector('.choose-bar i');
    if (bar) {
      var kesto = d.seconds || 10;
      bar.style.transition = 'none';
      bar.style.width = '100%';
      requestAnimationFrame(function () {
        bar.style.transition = 'width ' + kesto + 's linear';
        bar.style.width = '0%';
      });
    }
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
    clearBubbles();
    board.setEnabled(false);
    $('tools').hidden = true;
    S.word = null;
    var otsikko = d.reason === 'all' ? 'Kaikki arvasivat!'
      : d.reason === 'left' ? 'Piirtäjä poistui'
      : 'Aika loppui';
    var html = '<h2>' + otsikko + '</h2>' + (d.word
      ? '<p class="hint">Sana oli</p><div class="reveal-word">' + escapeHtml(d.word) + '</div>'
      : '<p class="hint">Sanaa ei ehditty valita – vuoro ohitettiin.</p>') +
      '<ul class="score-list">';
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
    html += '<button class="btn btn-primary" id="btnAgain">Takaisin aulaan</button>';
    if (!isHost) html += '<p class="hint">Pelinjohtaja voi aloittaa uuden pelin – pääset mukaan automaattisesti.</p>';
    openModal(html, 'gameend');
    $('btnAgain').addEventListener('click', function () {
      S.aulassa = true;              // vain oma näkymä, ei muille
      closeModal();
      show('screen-lobby');
      if (S.state) renderLobby(S.state);
    });
  });

  /* pelinjohtajan yhteys katkesi -> peli loppuu muilta */
  link.on('hostgone', function () {
    board.setEnabled(false);
    openModal('<h2>Peli päättyi</h2><p>Yhteys pelinjohtajaan katkesi. Peli pyörii hänen laitteellaan, joten se päättyy kun välilehti suljetaan.</p>' +
      '<button class="btn btn-primary" id="btnHome">Takaisin alkuun</button>');
    var b = $('btnHome');
    if (b) b.addEventListener('click', function () { location.href = location.pathname; });
  });

  /* ---------------- näkyvän alueen sovitus (puhelimen näppäimistö) ---------------- */

  // Valikkopainike asettuu yläpalkin viereen ja on saman korkuinen kuin palkki.
  function syncMenuButton() {
    var btn = $('btnMenu');
    var hud = document.querySelector('.hud');
    if (!btn || btn.hidden || !hud) return;
    var r = hud.getBoundingClientRect();
    if (!r.height || document.body.classList.contains('drawfull')) {
      btn.style.top = ''; btn.style.height = '';
      return;
    }
    btn.style.top = Math.round(r.top) + 'px';
    btn.style.height = Math.round(r.height) + 'px';
  }

  // Piirtoalue mitoitetaan aina 4:3-suhteessa, ei koskaan venytetä yhteen suuntaan.
  function fitSheet() {
    var holder = document.querySelector('.pad-holder');
    var sheet = $('sheet');
    if (!holder || !sheet) return;
    var w = holder.clientWidth, h = holder.clientHeight;
    if (!w || !h) return;
    var leveys = Math.min(w, h * 4 / 3);
    var korkeus = leveys * 3 / 4;
    sheet.style.width = Math.floor(leveys) + 'px';
    sheet.style.height = Math.floor(korkeus) + 'px';
    if (board) board.resize();
    syncMenuButton();
    repositionBubbles();
  }

  // Puhelin vaaka-asennossa: piirtäjälle pelkkä piirtoalue koko ruudulle.
  function updateOrientation() {
    var vaaka = window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
    var pieni = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 600;
    var full = !!(vaaka && pieni && S.isDrawer && S.phase === 'draw');
    document.body.classList.toggle('drawfull', full);
    $('btnTools').hidden = !full;
    if (!full) document.body.classList.remove('tools-open');

    // Reunoilla pelaajat ovat piirtoalueen vieressä, jolloin puhekuplatkin
    // osuvat nimien kohdalle: näin sekä näppäimistön kanssa että vaaka-asennossa.
    var reunoilla = full || document.body.classList.contains('keyboard');
    var players = $('players');
    var koti = reunoilla ? document.querySelector('.stage') : document.querySelector('.side');
    if (players.parentNode !== koti) koti.insertBefore(players, koti.firstChild);

    fitSheet();
  }

  $('btnTools').addEventListener('click', function () {
    document.body.classList.toggle('tools-open');
  });

  function fitViewport() {
    var vv = window.visualViewport || null;      // luetaan aina uudestaan
    var full = window.innerHeight || 0;
    var h = vv ? vv.height : full;
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    // näppäimistö vie yli 15 % korkeudesta -> tiivistetty tila
    var keyboard = !!full && h < full - full * 0.15;
    document.body.classList.toggle('keyboard', keyboard);
    // näppäimistön kanssa pelaajakortit siirtyvät piirtoalueen reunoille
    updateOrientation();
    fitSheet();
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  window.addEventListener('orientationchange', function () { setTimeout(fitViewport, 250); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(orientation: landscape)');
    if (mq.addEventListener) mq.addEventListener('change', function () { setTimeout(fitViewport, 100); });
  }
  fitViewport();

  // kenttään kirjoitettaessa pidetään näkymä paikallaan
  $('chatInput').addEventListener('focus', function () {
    setTimeout(function () { window.scrollTo(0, 0); fitViewport(); }, 120);
  });
  $('chatInput').addEventListener('blur', function () { setTimeout(fitViewport, 150); });

  /* ---------------- versio, välimuisti ja sovellusasennus ---------------- */

  $('versionText').textContent = GAME_VERSION;

  function nollaaVälimuisti() {
    var nimi = localStorage.getItem('pja.name');
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
    if (nimi) localStorage.setItem('pja.name', nimi);      // nimi säilyy
    var lopuksi = function () { location.reload(); };
    var työt = [];
    if (window.caches && caches.keys) {
      työt.push(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      työt.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }));
    }
    Promise.all(työt).then(lopuksi, lopuksi);
  }

  $('btnUpdate').addEventListener('click', nollaaVälimuisti);

  // Verrataan käynnissä olevaa versiota siihen, mikä palvelimella on juuri nyt.
  function tarkistaVersio() {
    if (!window.fetch) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.version && data.version !== GAME_VERSION) {
          $('updateBox').hidden = false;
          $('updateBox').querySelector('p').textContent =
            'Käytössä on vanha versio (' + GAME_VERSION + '). Uusin on ' + data.version + '.';
        }
      })
      .catch(function () {});
  }
  tarkistaVersio();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* apuri virheenetsintään ja testeihin (ei vaikuta peliin) */
  window.__pja = { link: link, board: board, fitViewport: fitViewport, state: function () { return S; } };

  /* ilmoita poistumisesta heti, jotta muut näkevät sen viiveettä */
  window.addEventListener('pagehide', function () { link.leave(); });

  /* varoita hostia välilehden sulkemisesta kesken pelin */
  window.addEventListener('beforeunload', function (e) {
    if (link.isHost && link.engine && link.engine.players.size > 1 && link.engine.phase !== 'lobby') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();

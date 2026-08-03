/* net.js – yhteydet.
   Pelin luojan selain toimii "palvelimena": se ajaa engine.js:ää ja välittää
   kaikille muille tapahtumat. Muut selaimet ovat pelkkiä näkymiä.
   Tiedonsiirto tapahtuu suoraan selainten välillä WebRTC:llä (PeerJS).

   ─────────────────────────────────────────────────────────────────────────
   ASETUKSET – näitä voi vaihtaa, jos haluat oman välityspalvelimen.
   PeerJS:n ilmainen julkinen palvelin hoitaa vain kättelyn (kuka on missäkin);
   itse peli ei kulje sen kautta. Jos se ruuhkautuu, aja oma:
       npx peerjs --port 9000 --key peerjs --path /
   ja aseta PEER_CONFIG.host/port/path alle.
   ───────────────────────────────────────────────────────────────────────── */

var PEER_CONFIG = {
  // host: 'oma-palvelin.fi', port: 443, secure: true, path: '/',
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
      // Tiukan yritysverkon tai mobiiliverkon takaa voi tarvita TURN-palvelimen:
      // { urls: 'turn:oma-turn.fi:3478', username: 'kayttaja', credential: 'salasana' }
    ]
  }
};

var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ei sekoittuvia merkkejä
var ID_PREFIX = 'pja-';
var CONNECT_TIMEOUT = 15000;

(function (root) {
  'use strict';

  function randomCode() {
    var out = '', buf;
    if (root.crypto && root.crypto.getRandomValues) {
      buf = new Uint32Array(4);
      root.crypto.getRandomValues(buf);
      for (var i = 0; i < 4; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
    } else {
      for (var j = 0; j < 4; j++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
  }

  function peerAvailable() {
    return typeof root.Peer === 'function';
  }

  var MISSING_LIB = 'Peliä ei voitu avata: yhteyskirjasto vendor/peerjs.min.js ei latautunut. ' +
    'Varmista, että kansio vendor/ tiedostoineen on viety GitHubiin.';

  /* ---------------------------------------------------------------
     Julkiset pelit ilman palvelinta.

     Varataan kahdeksan kiinteää tunnusta (pja-open-1 … pja-open-8).
     Julkiseksi merkitty peli ottaa haltuunsa ensimmäisen vapaan ja
     vastaa siihen otettuihin yhteyksiin pelin tiedoilla. Aloitusnäyttö
     kokeilee kaikkia paikkoja ja listaa ne, jotka vastaavat. Kun peli
     päättyy tai isäntä poistuu, tunnus vapautuu itsestään.
     --------------------------------------------------------------- */
  var OPEN_SLOTS = 8;
  var OPEN_PREFIX = 'pja-open-';
  var OPEN_TIMEOUT = 3000;

  function Link() {
    this.handlers = {};
    this.isHost = false;
    this.me = null;
    this.code = null;
    this.peer = null;
    this.conns = new Map();   // hostilla: pelaajaId -> DataConnection
    this.hostConn = null;     // vieraalla: yhteys hostiin
    this.engine = null;
    this.closed = false;
  }

  Link.prototype.on = function (ev, fn) {
    (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    return this;
  };

  Link.prototype.fire = function (ev, data) {
    var list = this.handlers[ev];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('virhe käsittelijässä ' + ev, e); }
    }
  };

  /* ---------------- pelin luonti (host) ---------------- */

  Link.prototype.createGame = function (name, cb) {
    var self = this;
    var attempts = 0;
    if (!peerAvailable()) return cb(MISSING_LIB);

    function attempt() {
      var code = randomCode();
      var peer;
      try {
        peer = new root.Peer(ID_PREFIX + code, PEER_CONFIG);
      } catch (e) {
        return cb(MISSING_LIB);
      }
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) {}
        cb('Yhteyttä ei saatu muodostettua. Tarkista verkkoyhteys ja yritä uudelleen.');
      }, CONNECT_TIMEOUT);

      peer.on('open', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self.peer = peer;
        self.isHost = true;
        self.code = code;
        self.me = 'host';
        self.startEngine(name);
        self.bindHost();
        cb(null, code);
      });

      peer.on('error', function (err) {
        if (settled) return;
        // koodi oli varattu -> arvotaan uusi
        if (err && err.type === 'unavailable-id' && attempts++ < 4) {
          try { peer.destroy(); } catch (e) {}
          clearTimeout(timer);
          return attempt();
        }
        settled = true;
        clearTimeout(timer);
        try { peer.destroy(); } catch (e) {}
        cb(describeError(err));
      });
    }

    attempt();
  };

  Link.prototype.startEngine = function (hostName) {
    var self = this;
    this.engine = new root.Engine({
      hostId: 'host',
      categories: root.CATEGORIES,
      io: {
        all: function (ev, data) {
          self.fire(ev, data);
          self.conns.forEach(function (c) { self.wire(c, ev, data); });
        },
        to: function (id, ev, data) {
          if (id === self.me) return self.fire(ev, data);
          var c = self.conns.get(id);
          if (c) self.wire(c, ev, data);
        },
        except: function (id, ev, data) {
          if (id !== self.me) self.fire(ev, data);
          self.conns.forEach(function (c, pid) { if (pid !== id) self.wire(c, ev, data); });
        }
      }
    });
    this.engine.addPlayer('host', hostName);
  };

  Link.prototype.wire = function (conn, ev, data) {
    if (!conn || !conn.open) return;
    try { conn.send({ e: ev, d: data }); } catch (err) { console.warn('lähetys epäonnistui', err); }
  };

  Link.prototype.bindHost = function () {
    var self = this;

    this.peer.on('connection', function (conn) {
      conn.on('data', function (msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.e === 'hello') {
          if (self.conns.has(conn.peer)) return;
          // Tarkistus ennen tervetuloviestiä, muuten hylätty pääsisi silti sisään.
          self.conns.set(conn.peer, conn);
          var res = self.engine.addPlayer(conn.peer, msg.d && msg.d.name);
          if (!res.ok) {
            self.conns.delete(conn.peer);
            self.wire(conn, 'rejected', { error: res.error });
            setTimeout(function () { try { conn.close(); } catch (e) {} }, 400);
            return;
          }
          self.wire(conn, 'welcome', { you: conn.peer, code: self.code });
          self.wire(conn, 'state', self.engine.state());
          return;
        }
        if (!self.conns.has(conn.peer)) return;
        self.engine.action(conn.peer, msg.e, msg.d);
      });

      conn.on('close', function () {
        if (!self.conns.has(conn.peer)) return;
        self.conns.delete(conn.peer);
        self.engine.removePlayer(conn.peer);
      });

      conn.on('error', function () {
        if (!self.conns.has(conn.peer)) return;
        self.conns.delete(conn.peer);
        self.engine.removePlayer(conn.peer);
      });
    });

    this.peer.on('error', function (err) {
      if (err && (err.type === 'peer-unavailable' || err.type === 'network')) return;
      console.warn('peer-virhe', err);
    });

    this.peer.on('disconnected', function () {
      if (!self.closed) { try { self.peer.reconnect(); } catch (e) {} }
    });
  };

  /* ---------------- peliin liittyminen (vieras) ---------------- */

  Link.prototype.joinGame = function (code, name, cb) {
    var self = this;
    code = String(code || '').toUpperCase().trim();
    if (!peerAvailable()) return cb(MISSING_LIB);
    var peer;
    try {
      peer = new root.Peer(PEER_CONFIG);
    } catch (e) {
      return cb(MISSING_LIB);
    }
    var settled = false;

    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch (e) {}
      cb('Peliä ei tavoitettu. Tarkista koodi ja se, että pelin luoja pitää välilehden auki.');
    }, CONNECT_TIMEOUT);

    peer.on('open', function () {
      var conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });

      conn.on('open', function () {
        conn.send({ e: 'hello', d: { name: name } });
      });

      conn.on('data', function (msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.e === 'welcome') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            self.peer = peer;
            self.hostConn = conn;
            self.isHost = false;
            self.me = msg.d.you;
            self.code = msg.d.code || code;
            cb(null, self.code);
          }
          return;
        }
        if (msg.e === 'rejected') {
          if (!settled) { settled = true; clearTimeout(timer); cb(msg.d.error || 'Peliin ei päässyt.'); }
          return;
        }
        self.fire(msg.e, msg.d);
      });

      conn.on('close', function () {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          return cb('Yhteys katkesi ennen kuin peli ehti alkaa.');
        }
        if (!self.closed) self.fire('hostgone', {});
      });

      conn.on('error', function (err) {
        if (!settled) { settled = true; clearTimeout(timer); cb(describeError(err)); }
      });
    });

    peer.on('error', function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { peer.destroy(); } catch (e) {}
      cb(describeError(err));
    });
  };

  /* ---------------- viestit ---------------- */

  Link.prototype.send = function (ev, data) {
    if (this.isHost) {
      if (this.engine) this.engine.action(this.me, ev, data);
    } else if (this.hostConn && this.hostConn.open) {
      try { this.hostConn.send({ e: ev, d: data }); } catch (err) { console.warn('lähetys epäonnistui', err); }
    }
  };

  Link.prototype.leave = function () {
    this.unpublishPublic();
    this.closed = true;
    if (this.engine) this.engine.destroy();
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
  };

  function describeError(err) {
    var type = err && err.type;
    if (type === 'peer-unavailable') return 'Peliä ei löytynyt tällä koodilla. Tarkista koodi.';
    if (type === 'browser-incompatible') return 'Tämä selain ei tue vertaisyhteyksiä. Kokeile Chromea tai Safaria.';
    if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Verkkoyhteys välityspalvelimeen ei toimi. Yritä hetken päästä uudelleen.';
    if (type === 'unavailable-id') return 'Pelikoodi oli juuri varattu. Yritä uudelleen.';
    if (type === 'disconnected') return 'Yhteys katkesi. Yritä uudelleen.';
    return 'Yhteysvirhe: ' + (err && (err.message || err.type) || 'tuntematon');
  }

  /* Isäntä: julkaisee pelin ilmoitustaululle. getInfo palauttaa tuoreet tiedot. */
  Link.prototype.publishPublic = function (getInfo) {
    var self = this;
    this.unpublishPublic();
    this._infoFn = getInfo;
    var slot = 1;

    function yritä() {
      if (slot > OPEN_SLOTS || !self._infoFn) return;
      var id = OPEN_PREFIX + slot;
      var peer;
      try { peer = new root.Peer(id, PEER_CONFIG); } catch (e) { return; }
      var ratkaistu = false;

      peer.on('open', function () {
        ratkaistu = true;
        self.openPeer = peer;
        peer.on('connection', function (conn) {
          conn.on('open', function () {
            try { conn.send({ e: 'gameinfo', d: self._infoFn ? self._infoFn() : null }); } catch (e) {}
            setTimeout(function () { try { conn.close(); } catch (e) {} }, 1500);
          });
        });
      });

      peer.on('error', function (err) {
        if (ratkaistu) return;
        ratkaistu = true;
        try { peer.destroy(); } catch (e) {}
        if (err && err.type === 'unavailable-id') { slot++; yritä(); }   // paikka varattu, kokeillaan seuraavaa
      });
    }
    yritä();
  };

  Link.prototype.unpublishPublic = function () {
    this._infoFn = null;
    if (this.openPeer) {
      try { this.openPeer.destroy(); } catch (e) {}
      this.openPeer = null;
    }
  };

  /* Aloitusnäyttö: kysyy kaikilta paikoilta, ketkä ovat auki. */
  Link.prototype.browsePublic = function (cb) {
    if (typeof root.Peer !== 'function') return cb([]);
    var peer;
    try { peer = new root.Peer(PEER_CONFIG); } catch (e) { return cb([]); }

    var löydetyt = [], jäljellä = OPEN_SLOTS, valmis = false;

    function lopeta() {
      if (valmis) return;
      valmis = true;
      try { peer.destroy(); } catch (e) {}
      löydetyt.sort(function (a, b) { return (b.players || 0) - (a.players || 0); });
      cb(löydetyt);
    }

    peer.on('error', function () {});
    peer.on('open', function () {
      for (var i = 1; i <= OPEN_SLOTS; i++) kysy(OPEN_PREFIX + i);
    });
    setTimeout(lopeta, OPEN_TIMEOUT + 500);

    function kysy(id) {
      var conn;
      try { conn = peer.connect(id, { serialization: 'json' }); } catch (e) { return valmiiksi(); }
      var saatu = false;
      var t = setTimeout(function () { if (!saatu) { try { conn.close(); } catch (e) {} valmiiksi(); } }, OPEN_TIMEOUT);
      conn.on('data', function (msg) {
        if (saatu || !msg || msg.e !== 'gameinfo') return;
        saatu = true;
        clearTimeout(t);
        if (msg.d && msg.d.code) löydetyt.push(msg.d);
        try { conn.close(); } catch (e) {}
        valmiiksi();
      });
      conn.on('error', function () { if (!saatu) { saatu = true; clearTimeout(t); valmiiksi(); } });
    }

    function valmiiksi() {
      jäljellä--;
      if (jäljellä <= 0) lopeta();
    }
  };

  root.Link = Link;
  root.randomCode = randomCode;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Link: Link, randomCode: randomCode };
})(typeof window !== 'undefined' ? window : globalThis);

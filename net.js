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

    function attempt() {
      var code = randomCode();
      var peer = new root.Peer(ID_PREFIX + code, PEER_CONFIG);
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
          self.conns.set(conn.peer, conn);
          self.wire(conn, 'welcome', { you: conn.peer, code: self.code });
          var res = self.engine.addPlayer(conn.peer, msg.d && msg.d.name);
          if (!res.ok) {
            self.wire(conn, 'rejected', { error: res.error });
            self.conns.delete(conn.peer);
            setTimeout(function () { try { conn.close(); } catch (e) {} }, 300);
          }
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
    var peer = new root.Peer(PEER_CONFIG);
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

  root.Link = Link;
  root.randomCode = randomCode;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Link: Link, randomCode: randomCode };
})(typeof window !== 'undefined' ? window : globalThis);

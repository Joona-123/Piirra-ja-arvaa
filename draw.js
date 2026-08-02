/* draw.js – piirtoalusta.
   Kaikki koordinaatit lähetetään normalisoituina (0–1), joten piirros näyttää
   samalta puhelimessa ja isolla näytöllä. Sisäinen "paperi" on 1000 x 750. */
(function (root) {
  'use strict';

  var VW = 1000, VH = 750;
  var ERASE = 'ERASE';

  function r3(n) { return Math.round(n * 1000) / 1000; }

  function Board(opts) {
    this.sheet = opts.sheet;
    this.base = opts.base;
    this.overlay = opts.overlay;
    this.bctx = this.base.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.onOp = opts.onOp || function () {};
    this.onLive = opts.onLive || function () {};

    this.ops = [];
    this.enabled = false;
    this.tool = 'pen';
    this.color = '#23201d';
    this.width = 8;
    this.fill = false;

    this.active = null;
    this.pending = [];
    this.lastSend = 0;

    this._bind();
    this.resize();

    var self = this;
    this._onResize = function () { self.resize(); };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    // Peliruutu on piilossa sivun latautuessa, jolloin mittaus antaa nollan.
    // ResizeObserver mitoittaa kanvaasin heti kun alusta saa oikean kokonsa.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(this.sheet);
    }
  }

  /* ---------- koko ---------- */

  Board.prototype.resize = function () {
    var rect = this.sheet.getBoundingClientRect();
    if (!rect.width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    [this.base, this.overlay].forEach(function (c) { c.width = w; c.height = h; });
    this.sx = w / VW;
    this.sy = h / VH;
    this.scale = (this.sx + this.sy) / 2;
    this.render();
  };

  Board.prototype._prep = function (ctx) {
    if (!this.sx) this.resize();
    if (!this.sx) return;
    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  /* ---------- piirtorutiinit ---------- */

  function stroke(ctx, op) {
    var pts = op.pts || [];
    if (!pts.length) return;
    ctx.save();
    if (op.c === ERASE) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.strokeStyle = op.c;
      ctx.fillStyle = op.c;
    }
    ctx.lineWidth = op.w;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * VW, pts[0][1] * VH, op.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * VW, pts[0][1] * VH);
      for (var i = 1; i < pts.length - 1; i++) {
        var x = pts[i][0] * VW, y = pts[i][1] * VH;
        var mx = (x + pts[i + 1][0] * VW) / 2, my = (y + pts[i + 1][1] * VH) / 2;
        ctx.quadraticCurveTo(x, y, mx, my);
      }
      var last = pts[pts.length - 1];
      ctx.lineTo(last[0] * VW, last[1] * VH);
      ctx.stroke();
    }
    ctx.restore();
  }

  function shape(ctx, op) {
    var ax = op.a[0] * VW, ay = op.a[1] * VH, bx = op.b[0] * VW, by = op.b[1] * VH;
    ctx.save();
    ctx.strokeStyle = op.c === ERASE ? '#000' : op.c;
    ctx.fillStyle = op.c === ERASE ? '#000' : op.c;
    if (op.c === ERASE) ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = op.w;
    ctx.beginPath();
    if (op.k === 'l') {
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.stroke(); ctx.restore(); return;
    }
    if (op.k === 'r') {
      ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    } else { // 'c' = ellipsi
      ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
    }
    if (op.f) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }

  Board.prototype.paint = function (ctx, op) {
    if (!op) return;
    if (op.k === 'p') stroke(ctx, op);
    else shape(ctx, op);
  };

  Board.prototype.render = function () {
    if (!this.sx) return;
    this.bctx.setTransform(1, 0, 0, 1, 0, 0);
    this.bctx.clearRect(0, 0, this.base.width, this.base.height);
    this._prep(this.bctx);
    for (var i = 0; i < this.ops.length; i++) this.paint(this.bctx, this.ops[i]);
    this.clearOverlay();
  };

  Board.prototype.clearOverlay = function () {
    this.octx.setTransform(1, 0, 0, 1, 0, 0);
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this._prep(this.octx);
  };

  /* ---------- verkosta tulevat ---------- */

  Board.prototype.setOps = function (ops) { this.ops = ops || []; this.render(); };
  Board.prototype.addOp = function (op) {
    this.ops.push(op);
    this._prep(this.bctx);
    this.paint(this.bctx, op);
    this.clearOverlay();
  };
  Board.prototype.clear = function () { this.ops = []; this.render(); };

  Board.prototype.applyLive = function (seg) {
    if (!seg) return;
    if (seg.t === 'b') {
      this.remote = { c: seg.c, w: seg.w, pts: [[seg.x, seg.y]] };
      this._paintRemote();
    } else if (seg.t === 'm' && this.remote) {
      for (var i = 0; i < seg.pts.length; i += 2) this.remote.pts.push([seg.pts[i], seg.pts[i + 1]]);
      this._paintRemote();
    } else if (seg.t === 's') {
      this.clearOverlay();
      this.paint(this.octx, { k: seg.k, c: seg.c, w: seg.w, a: seg.a, b: seg.b, f: seg.f });
    } else if (seg.t === 'e') {
      this.remote = null;
    }
  };

  Board.prototype._paintRemote = function () {
    var op = { k: 'p', c: this.remote.c, w: this.remote.w, pts: this.remote.pts };
    if (op.c === ERASE) {
      this._prep(this.bctx);
      stroke(this.bctx, { k: 'p', c: ERASE, w: op.w, pts: op.pts.slice(-2) });
    } else {
      this.clearOverlay();
      this.paint(this.octx, op);
    }
  };

  /* ---------- oma piirtäminen ---------- */

  Board.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    this.sheet.classList.toggle('drawing', this.enabled);
    if (!on) { this.active = null; this.clearOverlay(); }
  };

  Board.prototype._pos = function (e) {
    var rect = this.sheet.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    ];
  };

  Board.prototype._bind = function () {
    var self = this;

    this.sheet.addEventListener('pointerdown', function (e) {
      if (!self.enabled || e.button > 0) return;
      e.preventDefault();
      self.sheet.setPointerCapture(e.pointerId);
      var p = self._pos(e);
      var col = self.tool === 'eraser' ? ERASE : self.color;
      var wid = self.tool === 'eraser' ? self.width * 2.2 : self.width;

      if (self.tool === 'pen' || self.tool === 'eraser') {
        self.active = { k: 'p', c: col, w: wid, pts: [[r3(p[0]), r3(p[1])]] };
        self.pending = [];
        self.onLive({ t: 'b', c: col, w: wid, x: r3(p[0]), y: r3(p[1]) });
        self._drawActive();
      } else {
        var kind = self.tool === 'line' ? 'l' : self.tool === 'rect' ? 'r' : 'c';
        self.active = { k: kind, c: col, w: wid, a: [r3(p[0]), r3(p[1])], b: [r3(p[0]), r3(p[1])], f: self.fill ? 1 : 0 };
      }
    });

    this.sheet.addEventListener('pointermove', function (e) {
      if (!self.enabled || !self.active) return;
      e.preventDefault();
      var p = self._pos(e);
      if (self.active.k === 'p') {
        var last = self.active.pts[self.active.pts.length - 1];
        if (Math.abs(last[0] - p[0]) < 0.002 && Math.abs(last[1] - p[1]) < 0.002) return;
        self.active.pts.push([r3(p[0]), r3(p[1])]);
        self.pending.push(r3(p[0]), r3(p[1]));
        var now = Date.now();
        if (now - self.lastSend > 45) {
          self.onLive({ t: 'm', pts: self.pending });
          self.pending = [];
          self.lastSend = now;
        }
      } else {
        self.active.b = [r3(p[0]), r3(p[1])];
        self.onLive({ t: 's', k: self.active.k, c: self.active.c, w: self.active.w, a: self.active.a, b: self.active.b, f: self.active.f });
      }
      self._drawActive();
    });

    function finish(e) {
      if (!self.active) return;
      if (self.active.k === 'p' && self.pending.length) self.onLive({ t: 'm', pts: self.pending });
      self.pending = [];
      self.onLive({ t: 'e' });
      var op = self.active;
      self.active = null;
      if (op.k !== 'p' && op.a[0] === op.b[0] && op.a[1] === op.b[1]) { self.clearOverlay(); return; }
      self.addOp(op);
      self.onOp(op);
    }

    this.sheet.addEventListener('pointerup', finish);
    this.sheet.addEventListener('pointercancel', finish);
    this.sheet.addEventListener('lostpointercapture', finish);
  };

  Board.prototype._drawActive = function () {
    if (!this.active) return;
    if (this.active.c === ERASE && this.active.k === 'p') {
      this._prep(this.bctx);
      stroke(this.bctx, { k: 'p', c: ERASE, w: this.active.w, pts: this.active.pts.slice(-2) });
      return;
    }
    this.clearOverlay();
    this.paint(this.octx, this.active);
  };

  root.Board = Board;
  root.ERASE = ERASE;
})(window);

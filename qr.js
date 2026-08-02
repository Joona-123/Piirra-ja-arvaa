/* qr.js – pieni QR-koodin generaattori (byte mode, virheenkorjaus M, versiot 1–9).
   Ei riippuvuuksia, toimii myös ilman nettiyhteyttä. QR Code on DENSO WAVE:n rekisteröimä tavaramerkki. */
(function (root) {
  'use strict';

  // versio -> { ec: virheenkorjaussanoja per lohko, blocks: [[lohkoja, datasanoja], ...] }
  var SPEC = {
    1: { ec: 10, blocks: [[1, 16]] },
    2: { ec: 16, blocks: [[1, 28]] },
    3: { ec: 26, blocks: [[1, 44]] },
    4: { ec: 18, blocks: [[2, 32]] },
    5: { ec: 24, blocks: [[2, 43]] },
    6: { ec: 16, blocks: [[4, 27]] },
    7: { ec: 18, blocks: [[4, 31]] },
    8: { ec: 22, blocks: [[2, 38], [2, 39]] },
    9: { ec: 22, blocks: [[3, 36], [2, 37]] }
  };

  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46]
  };

  var REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0 };

  /* --- Galois'n kunta GF(256) --- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= gmul(poly[i], 1);
        next[i + 1] ^= gmul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  /* --- Tekstistä tavuiksi (UTF-8) --- */
  function toBytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function dataCapacity(version) {
    return SPEC[version].blocks.reduce(function (sum, b) { return sum + b[0] * b[1]; }, 0);
  }

  function chooseVersion(byteLen) {
    for (var v = 1; v <= 9; v++) {
      // 4 bittiä moodi + 8 bittiä pituus
      if (byteLen + 2 <= dataCapacity(v)) return v;
    }
    return null;
  }

  /* --- Bittijono --- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  };

  function buildCodewords(bytes, version) {
    var capacity = dataCapacity(version);
    var buf = new BitBuffer();
    buf.put(4, 4);            // byte mode
    buf.put(bytes.length, 8); // pituusindikaattori (versiot 1–9)
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var maxBits = capacity * 8;
    var term = Math.min(4, maxBits - buf.bits.length);
    for (var t = 0; t < term; t++) buf.bits.push(0);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    var data = [];
    for (var b = 0; b < buf.bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | buf.bits[b + k];
      data.push(v);
    }
    var pads = [0xec, 0x11], pi = 0;
    while (data.length < capacity) data.push(pads[pi++ % 2]);

    // lohkot
    var blocks = [], ecBlocks = [], offset = 0, ecLen = SPEC[version].ec;
    SPEC[version].blocks.forEach(function (group) {
      for (var n = 0; n < group[0]; n++) {
        var chunk = data.slice(offset, offset + group[1]);
        offset += group[1];
        blocks.push(chunk);
        ecBlocks.push(rsEncode(chunk, ecLen));
      }
    });

    // limitys
    var result = [], maxData = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) if (c < blocks[bi].length) result.push(blocks[bi][c]);
    }
    for (var e = 0; e < ecLen; e++) {
      for (var bj = 0; bj < ecBlocks.length; bj++) result.push(ecBlocks[bj][e]);
    }
    return result;
  }

  /* --- Matriisi --- */
  function emptyMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, reserved, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on ? 1 : 0;
        reserved[rr][cc] = 1;
      }
    }
  }

  function placeAlignment(m, reserved, version) {
    var centers = ALIGN[version];
    for (var i = 0; i < centers.length; i++) {
      for (var j = 0; j < centers.length; j++) {
        var row = centers[i], col = centers[j], size = m.length;
        if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            m[row + r][col + c] = on ? 1 : 0;
            reserved[row + r][col + c] = 1;
          }
        }
      }
    }
  }

  function bchFormat(fmt) {
    var d = fmt << 10;
    for (var i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0x537 << (i - 10);
    return ((fmt << 10) | d) ^ 0x5412;
  }

  function bchVersion(version) {
    var d = version << 12;
    for (var i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= 0x1f25 << (i - 12);
    return (version << 12) | d;
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.length, score = 0, i, j, run, last;

    // 1) samanväriset jonot
    for (i = 0; i < size; i++) {
      run = 1; last = m[i][0];
      for (j = 1; j < size; j++) {
        if (m[i][j] === last) { run++; } else { if (run >= 5) score += run - 2; run = 1; last = m[i][j]; }
      }
      if (run >= 5) score += run - 2;
      run = 1; last = m[0][i];
      for (j = 1; j < size; j++) {
        if (m[j][i] === last) { run++; } else { if (run >= 5) score += run - 2; run = 1; last = m[j][i]; }
      }
      if (run >= 5) score += run - 2;
    }

    // 2) 2x2 alueet
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
      }
    }

    // 3) 1011101 -kuviot
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(get, start) {
      var ok1 = true, ok2 = true;
      for (var k = 0; k < 11; k++) {
        var val = get(start + k);
        if (val !== p1[k]) ok1 = false;
        if (val !== p2[k]) ok2 = false;
      }
      return (ok1 ? 1 : 0) + (ok2 ? 1 : 0);
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j <= size - 11; j++) {
        score += 40 * matches((function (row) { return function (idx) { return m[row][idx]; }; })(i), j);
        score += 40 * matches((function (col) { return function (idx) { return m[idx][col]; }; })(i), j);
      }
    }

    // 4) tummien osuus
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var percent = (dark * 100) / (size * size);
    score += 10 * Math.floor(Math.abs(percent - 50) / 5);

    return score;
  }

  function generate(text) {
    var bytes = toBytes(String(text));
    var version = chooseVersion(bytes.length);
    if (!version) throw new Error('Teksti on liian pitkä QR-koodiin (max ~180 merkkiä).');

    var size = 17 + 4 * version;
    var base = emptyMatrix(size);
    var reserved = emptyMatrix(size).map(function (r) { return r.fill(0); });

    placeFinder(base, reserved, 0, 0);
    placeFinder(base, reserved, 0, size - 7);
    placeFinder(base, reserved, size - 7, 0);

    // ajoituskuviot
    for (var t = 8; t < size - 8; t++) {
      base[6][t] = t % 2 === 0 ? 1 : 0; reserved[6][t] = 1;
      base[t][6] = t % 2 === 0 ? 1 : 0; reserved[t][6] = 1;
    }

    placeAlignment(base, reserved, version);

    // tumma moduuli + muotoinformaation varaus
    base[size - 8][8] = 1; reserved[size - 8][8] = 1;
    for (var i = 0; i < 9; i++) {
      if (!reserved[8][i]) { reserved[8][i] = 1; base[8][i] = 0; }
      if (!reserved[i][8]) { reserved[i][8] = 1; base[i][8] = 0; }
    }
    for (var k = 0; k < 8; k++) {
      if (!reserved[8][size - 1 - k]) { reserved[8][size - 1 - k] = 1; base[8][size - 1 - k] = 0; }
      if (!reserved[size - 1 - k][8]) { reserved[size - 1 - k][8] = 1; base[size - 1 - k][8] = 0; }
    }

    // versioinformaation varaus (versiot 7+)
    if (version >= 7) {
      for (var vi = 0; vi < 18; vi++) {
        var r = Math.floor(vi / 3), c = size - 11 + (vi % 3);
        reserved[r][c] = 1; base[r][c] = 0;
        reserved[c][r] = 1; base[c][r] = 0;
      }
    }

    // datan sijoittelu siksakkina
    var codewords = buildCodewords(bytes, version);
    var bits = [];
    codewords.forEach(function (cw) { for (var b = 7; b >= 0; b--) bits.push((cw >> b) & 1); });
    for (var rb = 0; rb < REMAINDER[version]; rb++) bits.push(0);

    var isData = emptyMatrix(size).map(function (row) { return row.fill(0); });
    var idx = 0, upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var d = 0; d < 2; d++) {
          var cc = col - d;
          if (reserved[row][cc]) continue;
          base[row][cc] = idx < bits.length ? bits[idx] : 0;
          isData[row][cc] = 1;
          idx++;
        }
      }
      upward = !upward;
    }

    // maskin valinta
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = base.map(function (row) { return row.slice(); });
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (isData[y][x] && MASKS[mask](y, x)) candidate[y][x] ^= 1;
        }
      }
      applyFormat(candidate, mask, size);
      if (version >= 7) applyVersion(candidate, version, size);
      var s = penalty(candidate);
      if (s < bestScore) { bestScore = s; best = candidate; bestMask = mask; }
    }

    return { size: size, modules: best, version: version, mask: bestMask };
  }

  function applyFormat(m, mask, size) {
    var bits = bchFormat((0 /* taso M */ << 3) | mask);
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      // pystysuora (vasen ylä + vasen ala)
      if (i < 6) m[i][8] = bit;
      else if (i < 8) m[i + 1][8] = bit;
      else m[size - 15 + i][8] = bit;
      // vaakasuora (vasen ylä + oikea ylä)
      if (i < 8) m[8][size - 1 - i] = bit;
      else if (i < 9) m[8][15 - i] = bit;
      else m[8][14 - i] = bit;
    }
    m[size - 8][8] = 1;
  }

  function applyVersion(m, version, size) {
    var bits = bchVersion(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var r = Math.floor(i / 3), c = size - 11 + (i % 3);
      m[r][c] = bit;
      m[c][r] = bit;
    }
  }

  /* --- SVG-tuloste --- */
  function svg(text, options) {
    var opts = options || {};
    var quiet = opts.quiet == null ? 3 : opts.quiet;
    var dark = opts.dark || '#2a2724';
    var light = opts.light || 'transparent';
    var qr = generate(text);
    var total = qr.size + quiet * 2;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" aria-label="QR-koodi">');
    if (light !== 'transparent') parts.push('<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>');
    var path = '';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      }
    }
    parts.push('<path fill="' + dark + '" d="' + path + '"/></svg>');
    return parts.join('');
  }

  var QR = { generate: generate, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  root.QR = QR;
})(typeof window !== 'undefined' ? window : globalThis);

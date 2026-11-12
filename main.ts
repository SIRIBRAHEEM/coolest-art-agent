// The Eye That Sees Cool — a make.fun coolest-art-01 entry.
//
// One deterministic, self-contained program: it renders a 1024x1024 PNG
// ("Iris of the Cosmos": a giant eye whose iris is a swirling galaxy)
// with a tiny software renderer, and writes it to $MAKEFUN_OUTPUT_DIR/entry.png.
// Rendered output: 270,962 bytes, sha256 84e873dcfbe6e7a9685d919f6caab4037d3c63e36532af047630b6311f5a7317
// (two runs in place plus one clean-room run all write identical bytes).
//
// Standard library only (node:fs, node:path, node:zlib). No network, no model
// calls, no randomness outside a fixed seed — two runs write identical bytes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---- fixed-seed PRNG (mulberry32) ---------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- small helpers -------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
// smoothstep edge: 0 below e0, 1 above e1
function ss(e0, e1, v) {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function mix3(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
// distance from point (px,py) to segment (x1,y1)-(x2,y2)
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

// ---- CRC32 (for PNG chunks) ----------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// ---- the scene ------------------------------------------------------------
// Eye geometry. Almond = intersection of two disks.
// Upper lid arc: circle through corners (130,500),(894,500) with apex (512,330).
const EYE = { cx: 512, cy: 500, halfW: 382, irisR: 205, pupilR: 74 };
const UP = { cx: 512, cy: 844, r: 514.2 };   // disk under the upper arc
const LO = { cx: 512, cy: 211, r: 479.0 };   // disk above the lower arc

// Nebula blobs: [x, y, radius, r, g, b, alpha]
const rand = rng(20261113);
const BLOBS = [];
const BLOB_COLS = [[0.55, 0.12, 0.5], [0.05, 0.38, 0.45], [0.28, 0.14, 0.6], [0.7, 0.2, 0.35]];
for (let i = 0; i < 9; i++) {
  const c = BLOB_COLS[i % BLOB_COLS.length];
  BLOBS.push([rand() * W, rand() * H, 130 + rand() * 170, c[0], c[1], c[2], 0.09 + rand() * 0.08]);
}
// Stars: [x, y, radius, brightness, blue tint]
const STARS = [];
for (let i = 0; i < 190; i++) {
  STARS.push([rand() * W, rand() * H, 0.5 + rand() * 1.3, 0.3 + rand() * 0.7, rand()]);
}
// Lashes: tapered segments along the upper lid arc, outer thirds only.
// Arc point for angle phi (radians) on the upper circle:
function arcPoint(phi) {
  return [UP.cx + UP.r * Math.cos(phi), UP.cy + UP.r * Math.sin(phi)];
}
const LASHES = [];
for (let s = 0; s < 2; s++) {
  for (let i = 0; i < 5; i++) {
    // left side phi in [226,256] deg, right side in [284,314] deg
    const deg = s === 0 ? 226 + i * 7.5 : 284 + i * 7.5;
    const phi = (deg * Math.PI) / 180;
    const p = arcPoint(phi);
    const dir = [Math.cos(phi), Math.sin(phi)]; // outward from arc
    const len = 22 + ((i * 37 + s * 11) % 11);
    LASHES.push([p[0], p[1], p[0] + dir[0] * len, p[1] + dir[1] * len, 8, 2]);
  }
}
// (Veins were dropped: straight red strokes read as scratches, not craft.)

function render() {
  const buf = new Float32Array(W * H * 3);
  const eyeCx = EYE.cx, eyeCy = EYE.cy;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i3 = (y * W + x) * 3;
      // --- background: vertical gradient, deep indigo ---
      const gy = y / H;
      let r = lerp(0.012, 0.01, gy);
      let g = lerp(0.016, 0.012, gy);
      let b = lerp(0.055, 0.045, gy);
      // mid-band lift
      const mid = Math.exp(-Math.pow((gy - 0.5) * 2.4, 2));
      r += 0.045 * mid; g += 0.055 * mid; b += 0.16 * mid;
      // --- soft glow behind the eye ---
      const dx = x - eyeCx, dy = y - eyeCy;
      const dC = Math.hypot(dx, dy);
      const glow = 0.32 * Math.exp(-Math.pow(dC / 430, 2));
      r += 0.14 * glow; g += 0.3 * glow; b += 0.62 * glow;
      // --- nebula blobs ---
      for (let k = 0; k < BLOBS.length; k++) {
        const bl = BLOBS[k];
        const d = Math.hypot(x - bl[0], y - bl[1]) / bl[2];
        if (d < 2.2) {
          const a = bl[6] * Math.exp(-d * d * 1.6);
          r += bl[3] * a; g += bl[4] * a; b += bl[5] * a;
        }
      }

      // --- eye geometry ---
      const sdU = Math.hypot(x - UP.cx, y - UP.cy) - UP.r;
      const sdL = Math.hypot(x - LO.cx, y - LO.cy) - LO.r;
      const eyeSdf = Math.max(sdU, sdL);
      const inEye = 1 - ss(-1.5, 1.5, eyeSdf);

      if (inEye > 0) {
        // --- sclera: pale lavender, darker toward corners and under lid ---
        const cornerShade = 0.8 + 0.2 * (1 - Math.pow(Math.abs(x - eyeCx) / EYE.halfW, 2));
        const lidShade = 0.9 + 0.1 * clamp((y - 330) / 340, 0, 1);
        let sr = 0.87 * cornerShade * lidShade;
        let sg = 0.9 * cornerShade * lidShade;
        let sb = 0.96 * cornerShade * lidShade;

        // --- iris ---
        const rr = Math.hypot(dx, dy);
        if (rr < EYE.irisR + 4) {
          const th = Math.atan2(dy, dx);
          const t = clamp((rr - EYE.pupilR) / (EYE.irisR - EYE.pupilR), 0, 1);
          // radial gradient: bright cyan -> violet -> magenta-violet -> deep indigo
          let ic;
          if (t < 0.45) ic = mix3([0.15, 0.85, 1.0], [0.35, 0.35, 0.95], t / 0.45);
          else if (t < 0.8) ic = mix3([0.35, 0.35, 0.95], [0.55, 0.15, 0.75], (t - 0.45) / 0.35);
          else ic = mix3([0.55, 0.15, 0.75], [0.08, 0.05, 0.35], (t - 0.8) / 0.2);
          // spiral arms: broad, soft, magenta — the "galaxy" in the iris
          const sw = Math.sin(2 * (th + rr * 0.011));
          const arm = Math.max(0, sw);
          ic = mix3(ic, [0.95, 0.25, 0.65], 0.4 * arm * arm);
          // faint radial striations (kept subtle so they never look like moire)
          const fib = 0.96 + 0.04 * (0.5 + 0.5 * Math.sin(th * 48 + rr * 0.3));
          ic = [ic[0] * fib, ic[1] * fib, ic[2] * fib];
          // collarette ring
          const ring = Math.exp(-Math.pow((rr - 125) / 6, 2));
          ic = mix3(ic, [0.7, 0.95, 1.0], 0.5 * ring);
          // limbal ring: dark edge
          const limb = ss(193, 205, rr);
          ic = mix3(ic, [0.02, 0.02, 0.12], limb);

          // pupil: deep black
          if (rr < EYE.pupilR) ic = [0.01, 0.01, 0.03];
          // neon ring just outside the pupil
          const neon = Math.exp(-Math.pow((rr - (EYE.pupilR + 4)) / 3.5, 2));
          ic = mix3(ic, [0.2, 0.9, 1.0], 0.85 * neon);
          // highlights: soft catchlights, mostly on the iris, not bald white discs
          const h1 = 1 - ss(24, 40, Math.hypot(x - 442, y - 422));
          const h2 = 1 - ss(9, 15, Math.hypot(x - 590, y - 568));
          ic = mix3(ic, [1, 1, 1], 0.85 * h1 + 0.45 * h2);
          // blend iris into sclera with a soft edge
          const irisMask = 1 - ss(EYE.irisR - 1.5, EYE.irisR + 1.5, rr);
          sr = lerp(sr, ic[0], irisMask);
          sg = lerp(sg, ic[1], irisMask);
          sb = lerp(sb, ic[2], irisMask);
        }
        // soft cyan halo in the sclera just outside the iris
        if (rr >= EYE.irisR && rr < EYE.irisR + 38) {
          const halo = (1 - (rr - EYE.irisR) / 38) * 0.3;
          sr = lerp(sr, 0.3, halo); sg = lerp(sg, 0.85, halo); sb = lerp(sb, 1.0, halo);
        }
        // composite eye over background
        r = lerp(r, sr, inEye); g = lerp(g, sg, inEye); b = lerp(b, sb, inEye);
      }

      // --- lid line: bold dark stroke on the upper arc + thin cyan rim ---
      const lid = 1 - ss(6, 9, Math.abs(sdU));
      if (lid > 0 && sdL < -4) {
        r = lerp(r, 0.02, 0.95 * lid); g = lerp(g, 0.02, 0.95 * lid); b = lerp(b, 0.05, 0.95 * lid);
      }
      const rim = (1 - ss(9, 10.5, sdU)) * ss(10.5, 14, sdU);
      if (rim > 0 && sdL < -4) {
        r = lerp(r, 0.15, 0.9 * rim); g = lerp(g, 0.85, 0.9 * rim); b = lerp(b, 1.0, 0.9 * rim);
      }
      // --- lower lid: thin dark line ---
      const llid = (1 - ss(2, 3.5, Math.abs(sdL))) * 0.6;
      if (llid > 0 && sdU < -4) {
        r = lerp(r, 0.05, llid); g = lerp(g, 0.05, llid); b = lerp(b, 0.1, llid);
      }
      // --- lashes (tapered dark strokes above the upper arc) ---
      if (sdU > -2 && sdU < 55 && y < 530 && Math.abs(x - eyeCx) < 430) {
        for (let L = 0; L < LASHES.length; L++) {
          const lh = LASHES[L];
          const d = segDist(x, y, lh[0], lh[1], lh[2], lh[3]);
          const along = clamp(((x - lh[0]) * (lh[2] - lh[0]) + (y - lh[1]) * (lh[3] - lh[1])) /
            ((lh[2] - lh[0]) ** 2 + (lh[3] - lh[1]) ** 2), 0, 1);
          const w = lerp(lh[4], lh[5], along) / 2;
          const la = 1 - ss(w - 1, w + 1, d);
          if (la > 0) {
            r = lerp(r, 0.01, 0.95 * la); g = lerp(g, 0.01, 0.95 * la); b = lerp(b, 0.03, 0.95 * la);
          }
        }
      }

      // --- vignette ---
      const dv = Math.hypot(x - 512, y - 512) / 724;
      const vig = 1 - 0.32 * dv * dv;
      buf[i3] = clamp(r * vig, 0, 1);
      buf[i3 + 1] = clamp(g * vig, 0, 1);
      buf[i3 + 2] = clamp(b * vig, 0, 1);
    }
  }

  // --- stars, stamped as small discs (background only) ---
  function eyeSdfAt(x, y) {
    return Math.max(Math.hypot(x - UP.cx, y - UP.cy) - UP.r,
      Math.hypot(x - LO.cx, y - LO.cy) - LO.r);
  }
  for (let s = 0; s < STARS.length; s++) {
    const st = STARS[s];
    const sx = st[0], sy = st[1], sr0 = st[2], br = st[3];
    const R = Math.ceil(sr0 + 1);
    for (let yy = Math.max(0, Math.floor(sy - R)); yy <= Math.min(H - 1, Math.ceil(sy + R)); yy++) {
      for (let xx = Math.max(0, Math.floor(sx - R)); xx <= Math.min(W - 1, Math.ceil(sx + R)); xx++) {
        if (eyeSdfAt(xx, yy) < 3) continue; // keep the eye clean
        const d = Math.hypot(xx - sx, yy - sy);
        const a = br * (1 - ss(sr0 * 0.4, sr0 + 0.6, d));
        if (a <= 0) continue;
        const i3 = (yy * W + xx) * 3;
        const tint = st[4] > 0.5 ? [1, 1, 1] : [0.75, 0.85, 1];
        buf[i3] = clamp(buf[i3] + tint[0] * a, 0, 1);
        buf[i3 + 1] = clamp(buf[i3 + 1] + tint[1] * a, 0, 1);
        buf[i3 + 2] = clamp(buf[i3 + 2] + tint[2] * a, 0, 1);
      }
    }
  }
  return buf;
}
// ---- PNG encode (8-bit RGB, adaptive row filter, zlib level 9) -----------
function encodePNG(buf) {
  const raw = Buffer.alloc(H * (1 + W * 3));
  const prev = Buffer.alloc(W * 3);
  for (let y = 0; y < H; y++) {
    // quantize this row
    const row = Buffer.alloc(W * 3);
    for (let x = 0; x < W; x++) {
      const i3 = (y * W + x) * 3;
      row[x * 3] = Math.round(clamp(buf[i3], 0, 1) * 255);
      row[x * 3 + 1] = Math.round(clamp(buf[i3 + 1], 0, 1) * 255);
      row[x * 3 + 2] = Math.round(clamp(buf[i3 + 2], 0, 1) * 255);
    }
    // try filters 0..4, keep the one with smallest sum |signed byte|
    let bestType = 0, bestScore = Infinity, bestRow = null;
    for (let f = 0; f <= 4; f++) {
      const out = Buffer.alloc(W * 3);
      let score = 0;
      for (let x = 0; x < W * 3; x++) {
        const left = x >= 3 ? row[x - 3] : 0;
        const up = prev[x];
        const upLeft = x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        const v = (row[x] - pred) & 0xff;
        out[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = f; bestRow = out; }
    }
    raw[y * (1 + W * 3)] = bestType;
    bestRow.copy(raw, y * (1 + W * 3) + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, RGB
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- main -----------------------------------------------------------------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG(render());
writeFileSync(join(outDir, 'entry.png'), png);
console.log('wrote entry.png', png.length, 'bytes');

import { h } from "./dom.js";

/* ===============================================================
   Minimal dependency-free QR code encoder.

   Supports byte-mode encoding only (sufficient for short verification
   codes and URLs), versions 1-10, and all four error-correction
   levels. No external dependency -- this whole file is the encoder.

   Implements ISO/IEC 18004 (the public QR Code standard): Reed-Solomon
   error correction over GF(256), the standard block/codeword tables
   for versions 1-10, all 8 data-masking patterns with the standard
   penalty scoring, and the format/version information bits. These are
   fixed technical parameters defined by the standard itself, not
   anyone's creative work.

   Usage:
     const { encodeQR } = ...;
     const { size, get } = encodeQR("some text", "M");
     // get(row, col) -> true if that module is dark
   =============================================================== */

// ---------------- GF(256) tables ----------------
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Reed-Solomon generator polynomial for `degree` EC codewords.
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Array(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return res.slice(data.length, data.length + ecCount);
}

// ---------------- version tables (versions 1-10) ----------------
// total data capacity (codewords), and per-ECC-level block layout:
// [ecCodewordsPerBlock, blocksGroup1, dataCwPerBlockGroup1, blocksGroup2, dataCwPerBlockGroup2]
const VERSION_INFO = {
  1:  { total: 26,  L: [7, 1, 19, 0, 0],  M: [10, 1, 16, 0, 0],  Q: [13, 1, 13, 0, 0],  H: [17, 1, 9, 0, 0] },
  2:  { total: 44,  L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0],  Q: [22, 1, 22, 0, 0],  H: [28, 1, 16, 0, 0] },
  3:  { total: 70,  L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0],  Q: [18, 2, 17, 0, 0],  H: [22, 2, 13, 0, 0] },
  4:  { total: 100, L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0],  Q: [26, 2, 24, 0, 0],  H: [16, 4, 9, 0, 0] },
  5:  { total: 134, L: [26, 1, 108, 0, 0],M: [24, 2, 43, 0, 0],  Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6:  { total: 172, L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0],  Q: [24, 4, 19, 0, 0],  H: [28, 4, 15, 0, 0] },
  7:  { total: 196, L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0],  Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8:  { total: 242, L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9:  { total: 292, L: [30, 2, 116, 0, 0],M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { total: 346, L: [18, 2, 68, 2, 69],M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};
// Alignment pattern center coordinates per version (2-10; version 1 has none).
const ALIGN_COORDS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

function charCountBits(version) {
  return version <= 9 ? 8 : 16; // byte mode
}

// ---------------- bit buffer ----------------
class BitBuffer {
  constructor() { this.bits = []; }
  put(val, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  }
  get length() { return this.bits.length; }
}

function pickVersion(byteLength, ecLevel) {
  for (let v = 1; v <= 10; v++) {
    const info = VERSION_INFO[v][ecLevel];
    const dataCodewords = info[1] * info[2] + info[3] * info[4];
    const headerBits = 4 + charCountBits(v);
    const capacityBits = dataCodewords * 8;
    const neededBits = headerBits + byteLength * 8;
    if (neededBits + 4 <= capacityBits) return v; // +4 terminator (may be less; safe bound)
  }
  return null; // too big for this encoder's supported range
}

function buildDataCodewords(text, version, ecLevel) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const info = VERSION_INFO[version][ecLevel];
  const dataCodewordTotal = info[1] * info[2] + info[3] * info[4];

  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, charCountBits(version));
  for (const b of bytes) buf.put(b, 8);

  // terminator
  const capacityBits = dataCodewordTotal * 8;
  const termLen = Math.min(4, capacityBits - buf.length);
  if (termLen > 0) buf.put(0, termLen);
  // pad to byte boundary
  while (buf.length % 8 !== 0) buf.bits.push(0);
  // pad codewords
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (buf.length < capacityBits) {
    buf.put(padBytes[pi % 2], 8);
    pi++;
  }

  const codewords = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

function interleave(dataCodewords, version, ecLevel) {
  const info = VERSION_INFO[version][ecLevel];
  const [ecPerBlock, b1, dc1, b2, dc2] = info;
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) { blocks.push(dataCodewords.slice(offset, offset + dc1)); offset += dc1; }
  for (let i = 0; i < b2; i++) { blocks.push(dataCodewords.slice(offset, offset + dc2)); offset += dc2; }

  const ecBlocks = blocks.map((block) => rsEncode(block, ecPerBlock));

  const maxDataLen = Math.max(...blocks.map((b) => b.length));
  const result = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of ecBlocks) result.push(ec[i]);
  }
  return result;
}

// ---------------- matrix building ----------------
function makeMatrix(version) {
  const size = version * 4 + 17;
  const m = new Array(size);
  const reserved = new Array(size);
  for (let i = 0; i < size; i++) { m[i] = new Array(size).fill(0); reserved[i] = new Array(size).fill(false); }
  return { size, m, reserved };
}

function placeFinder(m, reserved, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const isFinder = (r >= 0 && r <= 6 && c >= 0 && c <= 6) &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      m[rr][cc] = isFinder ? 1 : 0;
      reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(m, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r, cc = col + c;
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      m[rr][cc] = dark ? 1 : 0;
      reserved[rr][cc] = true;
    }
  }
}

function placeTiming(m, reserved) {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) { m[6][i] = i % 2 === 0 ? 1 : 0; reserved[6][i] = true; }
    if (!reserved[i][6]) { m[i][6] = i % 2 === 0 ? 1 : 0; reserved[i][6] = true; }
  }
}

function reserveFormatAreas(reserved) {
  const size = reserved.length;
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  reserved[size - 8][8] = true;
}

function placeDark(m, reserved, version) {
  const size = m.length;
  m[size - 8][8] = 1;
  reserved[size - 8][8] = true;
}

function bchFormat(data) {
  // (15,5) BCH code, generator 0x537, per the QR spec, XORed with mask 0x5412.
  let d = data << 10;
  const g = 0x537;
  for (let i = 4; i >= 0; i--) {
    if (d & (1 << (i + 10))) d ^= g << i;
  }
  return ((data << 10) | d) ^ 0x5412;
}

function placeFormatInfo(m, reserved, ecLevel, mask) {
  const size = m.length;
  const data = (ECC_BITS[ecLevel] << 3) | mask;
  const bits = bchFormat(data);
  const bit = (i) => (bits >> i) & 1;

  // "vertical" copy — column 8
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i);

  // "horizontal" copy — row 8
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i);
  m[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);
}

function bchVersion(v) {
  let d = v << 12;
  const g = 0x1f25;
  for (let i = 5; i >= 0; i--) {
    if (d & (1 << (i + 12))) d ^= g << i;
  }
  return (v << 12) | d;
}

function placeVersionInfo(m, reserved, version) {
  if (version < 7) return;
  const size = m.length;
  const bits = bchVersion(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    m[size - 11 + col][row] = bit;
    m[row][size - 11 + col] = bit;
    reserved[size - 11 + col][row] = true;
    reserved[row][size - 11 + col] = true;
  }
}

function placeData(m, reserved, codewords) {
  const size = m.length;
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  let bitIndex = 0;
  let col = size - 1;
  let dir = -1; // -1 = upward, 1 = downward
  while (col > 0) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = dir === -1 ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
          m[row][c] = bit;
          bitIndex++;
        }
      }
    }
    dir = -dir;
    col -= 2;
  }
}

function applyMask(m, reserved, maskFn) {
  const size = m.length;
  const out = new Array(size);
  for (let r = 0; r < size; r++) {
    out[r] = new Array(size);
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) out[r][c] = m[r][c];
      else out[r][c] = m[r][c] ^ (maskFn(r, c) ? 1 : 0);
    }
  }
  return out;
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m) {
  const size = m.length;
  let score = 0;
  // rule 1: runs
  for (let r = 0; r < size; r++) {
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) { runLen++; }
      else { if (runLen >= 5) score += 3 + (runLen - 5); runLen = 1; }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) { runLen++; }
      else { if (runLen >= 5) score += 3 + (runLen - 5); runLen = 1; }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  // rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  // rule 3: finder-like patterns
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  function matchesAt(arr, start, pat) {
    for (let i = 0; i < pat.length; i++) if (arr[start + i] !== pat[i]) return false;
    return true;
  }
  for (let r = 0; r < size; r++) {
    const row = m[r];
    for (let c = 0; c <= size - 11; c++) {
      if (matchesAt(row, c, pat1) || matchesAt(row, c, pat2)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const col = [];
    for (let r = 0; r < size; r++) col.push(m[r][c]);
    for (let r = 0; r <= size - 11; r++) {
      if (matchesAt(col, r, pat1) || matchesAt(col, r, pat2)) score += 40;
    }
  }
  // rule 4: dark module ratio
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  const percent = (dark * 100) / (size * size);
  const prevMultipleOf5 = Math.floor(percent / 5) * 5;
  const nextMultipleOf5 = prevMultipleOf5 + 5;
  score += Math.min(Math.abs(prevMultipleOf5 - 50) / 5, Math.abs(nextMultipleOf5 - 50) / 5) * 10;
  return score;
}

export function encodeQR(text, ecLevel = "M") {
  const bytes = new TextEncoder().encode(text).length;
  const version = pickVersion(bytes, ecLevel);
  if (!version) throw new Error("Text too long for this QR encoder (max version 10)");

  const dataCodewords = buildDataCodewords(text, version, ecLevel);
  const allCodewords = interleave(dataCodewords, version, ecLevel);

  const { size, m, reserved } = makeMatrix(version);
  placeFinder(m, reserved, 0, 0);
  placeFinder(m, reserved, 0, size - 7);
  placeFinder(m, reserved, size - 7, 0);
  const aligns = ALIGN_COORDS[version] || [];
  for (const r of aligns) for (const c of aligns) {
    // skip positions overlapping finder patterns
    const nearTopLeft = r <= 8 && c <= 8;
    const nearTopRight = r <= 8 && c >= size - 9;
    const nearBottomLeft = r >= size - 9 && c <= 8;
    if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
    placeAlignment(m, reserved, r, c);
  }
  placeTiming(m, reserved);
  reserveFormatAreas(reserved);
  placeDark(m, reserved, version);
  placeVersionInfo(m, reserved, version);

  placeData(m, reserved, allCodewords);

  let best = null, bestScore = Infinity, bestMask = 0;
  for (let mi = 0; mi < 8; mi++) {
    const masked = applyMask(m, reserved, MASK_FNS[mi]);
    placeFormatInfo(masked, reserved, ecLevel, mi);
    const s = penalty(masked);
    if (s < bestScore) { bestScore = s; best = masked; bestMask = mi; }
  }

  return {
    size,
    version,
    get: (r, c) => best[r][c] === 1,
  };
}

/**
 * Build the QR as an inline SVG node via the project's safe h() helper
 * (one <path> combining every dark module — never innerHTML). Vector
 * output prints crisply at any size, which matters here since this
 * lands on a printed report card, not just a screen.
 */
export function qrSvg(text, { ecLevel = "M", size = 78, quiet = 2, label } = {}) {
  const qr = encodeQR(text, ecLevel);
  const n = qr.size;
  const dim = n + quiet * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.get(r, c)) path += `M${c + quiet},${r + quiet}h1v1h-1z`;
    }
  }
  return h("svg", {
    viewBox: `0 0 ${dim} ${dim}`,
    width: size, height: size,
    role: "img",
    "aria-label": label || "Verification QR code",
    style: { display: "block" },
  },
    h("rect", { x: 0, y: 0, width: dim, height: dim, fill: "#fff" }),
    h("path", { d: path, fill: "#000" }),
  );
}

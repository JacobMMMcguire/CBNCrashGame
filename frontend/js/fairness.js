// Independent, in-browser check of a finished round (docs/GAME_CONTRACT.md §4.3).
//
// Repeats the server's maths from public inputs only:
//   commitment == SHA-256(serverSeed)
//   crash      == min(max, max(1.00, floor(rtp / (1 - r / 2^52) * 100) / 100))
//   where r is the first 13 hex digits of HMAC-SHA256(key = serverSeed, msg = roundId).
// SHA-256 is implemented here (not WebCrypto) so the check also works on plain
// http:// LAN addresses, where browsers disable crypto.subtle.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a byte array, as bytes. */
export function sha256(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

const enc = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = (text) => hex(sha256(enc.encode(text)));

export function hmacSha256Hex(key, message) {
  let k = enc.encode(key);
  if (k.length > 64) k = sha256(k);
  const block = new Uint8Array(64);
  block.set(k);
  const inner = new Uint8Array(64), outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; }
  const msg = enc.encode(message);
  const innerHash = sha256(concat(inner, msg));
  return hex(sha256(concat(outer, innerHash)));
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** The crash point (as a number like 2.47) for an HMAC hex digest, in exact integer maths. */
export function crashFromHmac(hmacHex, targetRtp, maxMultiplier) {
  const TWO_52 = 2n ** 52n;
  const r = BigInt("0x" + hmacHex.slice(0, 13));
  const num = BigInt(Math.round(targetRtp * 1e6));
  const raw = (num * 100n * TWO_52) / (1000000n * (TWO_52 - r));
  const hundredths = Math.min(Math.round(maxMultiplier * 100), Math.max(100, Number(raw)));
  return hundredths / 100;
}

/** Check a revealed round. Returns what matched, so the UI can show each step. */
export function verifyRound({ roundId, serverSeed, commitment, crash }, { targetRtp, maxMultiplier }) {
  const hash = sha256Hex(serverSeed);
  const mac = hmacSha256Hex(serverSeed, roundId);
  const computed = crashFromHmac(mac, targetRtp, maxMultiplier);
  return {
    hash,
    hmac: mac,
    computed,
    commitmentOk: hash === commitment,
    crashOk: Math.round(computed * 100) === Math.round(crash * 100),
  };
}

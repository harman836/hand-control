// Generates electron/icon.png (256x256 RGBA) with no dependencies: node electron/make-icon.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const S = 256, px = Buffer.alloc(S * S * 4);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const blend = (i, r, g, b, a) => { const ia = 1 - a; px[i] = px[i] * ia + r * a; px[i + 1] = px[i + 1] * ia + g * a; px[i + 2] = px[i + 2] * ia + b * a; px[i + 3] = Math.min(255, px[i + 3] + 255 * a); };
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d)); // anti-aliased coverage from signed distance
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4, dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2, r = Math.hypot(dx, dy);
  blend(i, 18, 22, 32, cov(r - 120));                       // dark disc
  blend(i, 45, 212, 191, cov(Math.abs(r - 78) - 14));       // teal ring (cursor ring)
  blend(i, 255, 255, 255, cov(r - 26));                     // white centre dot (pinch point)
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('wrote electron/icon.png', png.length, 'bytes');

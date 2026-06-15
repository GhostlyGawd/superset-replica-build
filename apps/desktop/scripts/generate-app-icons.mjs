/**
 * Grove desktop app-icon generator.
 *
 * Rasterizes the Grove brand mark (docs/brand/assets/grove-mark.svg — one trunk
 * forking into three node-tipped shoots) onto the dark app tile and emits the
 * platform icon set electron-builder consumes from `buildResources` (build/):
 *
 *   build/icon.ico        Windows  (NSIS) — multi-size, generated via png2icons
 *   build/icon.icns       macOS    (dmg/zip) — generated via png2icons
 *   build/icon.png        1024x1024 master (electron-builder fallback)
 *   build/icons/<n>x<n>.png  Linux (AppImage/deb) — natively rendered per size
 *
 * The mark + tile are rendered by a dependency-free supersampled software
 * rasterizer in the 32-unit SVG model space plus a hand-rolled RGB PNG encoder
 * (deflate via node:zlib) — the same reproducible approach as the mobile PWA
 * generator. The .ico/.icns containers are assembled from that master PNG by
 * png2icons (MIT, pure JS, no native deps). No network, reproducible on any OS.
 *
 *   node apps/desktop/scripts/generate-app-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import png2icons from "png2icons";

// --- Brand geometry (model space matches the 0..32 SVG viewBox) ----------------
const NODES = [
  { x: 8.5, y: 9.6 },
  { x: 16, y: 5.6 },
  { x: 23.5, y: 9.6 },
];
const NODE_RADIUS = 2.3;
const SEGMENTS = [
  [16, 30, 16, 17],
  [16, 19, 8.5, 11],
  [16, 17, 16, 7],
  [16, 19, 23.5, 11],
];
const STROKE_HALF = 1.2;

// Artwork bounds (height is the larger dimension), used to centre + scale.
const ART_MIN_Y = NODES[1].y - NODE_RADIUS;
const ART_MAX_Y = 30;
const ART_CENTER_X = 16;
const ART_CENTER_Y = (ART_MIN_Y + ART_MAX_Y) / 2;
const ART_EXTENT = ART_MAX_Y - ART_MIN_Y;

// Token colours: surface tile #141817, accent mark #3fb950 (design-system §3).
const TILE = [20, 24, 23];
const MARK = [63, 185, 80];

// Fraction of the icon's shorter edge the mark spans; a touch of tile padding.
const MARK_FRACTION = 0.58;
const SUPERSAMPLE = 4;

function distanceToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function isInk(mx, my) {
  for (const node of NODES) {
    if (Math.hypot(mx - node.x, my - node.y) <= NODE_RADIUS) {
      return true;
    }
  }
  for (const segment of SEGMENTS) {
    if (distanceToSegment(mx, my, segment) <= STROKE_HALF) {
      return true;
    }
  }
  return false;
}

/** Render an opaque RGB icon: the dark tile with the brand mark centred. */
function renderIcon(size) {
  const rgb = new Uint8Array(size * size * 3);
  const scale = (MARK_FRACTION * size) / ART_EXTENT;
  const half = size / 2;
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let ink = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const cx = x + (sx + 0.5) * step;
          const cy = y + (sy + 0.5) * step;
          const mx = (cx - half) / scale + ART_CENTER_X;
          const my = (cy - half) / scale + ART_CENTER_Y;
          if (isInk(mx, my)) {
            ink += 1;
          }
        }
      }
      const coverage = ink / samples;
      const offset = (y * size + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        rgb[offset + c] = Math.round(TILE[c] + (MARK[c] - TILE[c]) * coverage);
      }
    }
  }
  return rgb;
}

// --- Minimal RGB PNG encoder ---------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgb) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgb.subarray(y * stride, y * stride + stride)).copy(raw, rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Build the complete PNG file buffer for a single square size. */
function pngForSize(size) {
  return encodePng(size, renderIcon(size));
}

// --- Emit the platform icon set ------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const buildDir = join(here, "..", "build");
const iconsDir = join(buildDir, "icons");
mkdirSync(iconsDir, { recursive: true });

// 1024x1024 master feeds both png2icons containers and serves as the fallback.
const MASTER_SIZE = 1024;
const master = pngForSize(MASTER_SIZE);
writeFileSync(join(buildDir, "icon.png"), master);
process.stdout.write(`wrote icon.png (${MASTER_SIZE}x${MASTER_SIZE}, ${master.length} bytes)\n`);

// Windows .ico — forWinExe stores PNG chunks (BMP for <64px) for broad support.
const ico = png2icons.createICO(master, png2icons.BICUBIC, 0, false, true);
if (ico === null) {
  throw new Error("png2icons.createICO returned null — could not build build/icon.ico");
}
writeFileSync(join(buildDir, "icon.ico"), ico);
process.stdout.write(`wrote icon.ico (${ico.length} bytes)\n`);

// macOS .icns.
const icns = png2icons.createICNS(master, png2icons.BICUBIC, 0);
if (icns === null) {
  throw new Error("png2icons.createICNS returned null — could not build build/icon.icns");
}
writeFileSync(join(buildDir, "icon.icns"), icns);
process.stdout.write(`wrote icon.icns (${icns.length} bytes)\n`);

// Linux — a directory of natively-rendered PNGs named <size>x<size>.png.
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
for (const size of LINUX_SIZES) {
  const png = pngForSize(size);
  writeFileSync(join(iconsDir, `${size}x${size}.png`), png);
  process.stdout.write(`wrote icons/${size}x${size}.png (${png.length} bytes)\n`);
}

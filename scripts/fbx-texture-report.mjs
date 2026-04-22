/**
 * Scan FBX binaries under public/ for embedded PNG / JPEG blobs and print dimensions.
 * Does not load Three (no WebGL); does not resolve external texture paths referenced by name only.
 *
 * Usage: npm run texture-report
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Drop binary garbage that looks like SOF markers (common inside FBX / PNG zlib). */
const MAX_WH = 8192;
const MIN_WH = 8;

function plausibleDims(w, h) {
  return (
    w >= MIN_WH &&
    h >= MIN_WH &&
    w <= MAX_WH &&
    h <= MAX_WH &&
    w * h <= 64 * 1024 * 1024
  );
}

/** @returns {{ w: number, h: number } | null} */
function readPngIhdr(buf, offset) {
  if (offset + 24 > buf.length) return null;
  const len = buf.readUInt32BE(offset + 8);
  const type = buf.toString('ascii', offset + 12, offset + 16);
  if (type !== 'IHDR' || len !== 13) return null;
  const w = buf.readUInt32BE(offset + 16);
  const h = buf.readUInt32BE(offset + 20);
  if (w > 0 && w < 65536 && h > 0 && h < 65536) return { w, h };
  return null;
}

/** Find PNG signature; IHDR must immediately follow standard layout. */
function findEmbeddedPngs(buf) {
  const hits = [];
  let i = 0;
  while (i < buf.length - 24) {
    const j = buf.indexOf(PNG_SIG, i);
    if (j < 0) break;
    const dims = readPngIhdr(buf, j);
    if (dims && plausibleDims(dims.w, dims.h)) hits.push({ offset: j, format: 'PNG', ...dims });
    i = j + 8;
  }
  return hits;
}

/** @returns {{ w: number, h: number } | null} */
function parseJpegFrom(buf, start) {
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8) return null;
  let p = start + 2;
  while (p < buf.length - 3) {
    if (buf[p] !== 0xff) {
      p++;
      continue;
    }
    const m = buf[p + 1];
    if (m === 0xd9) break;
    if (m === 0xd8 || m === 0x00) {
      p += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(p + 2);
    if (segLen < 2 || p + 2 + segLen > buf.length) break;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (p + 9 <= buf.length) {
        const h = buf.readUInt16BE(p + 5);
        const w = buf.readUInt16BE(p + 7);
        if (w > 0 && h > 0) return { w, h };
      }
      return null;
    }
    p += 2 + segLen;
  }
  return null;
}

function findEmbeddedJpegs(buf) {
  const hits = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const dims = parseJpegFrom(buf, i);
      if (dims && plausibleDims(dims.w, dims.h)) hits.push({ offset: i, format: 'JPEG', ...dims });
      i += 3;
      continue;
    }
    i++;
  }
  return hits;
}

/** Loose hints for path-like texture references (ASCII regions only). */
function findTexturePathHints(buf) {
  const hints = new Set();
  const ascii = buf.toString('latin1');
  const re = /([\w\-./\\]+\.(png|jpg|jpeg|tga))\b/gi;
  let m;
  while ((m = re.exec(ascii)) !== null) {
    const s = m[1].replace(/\\/g, '/');
    if (s.length < 256 && !s.includes('\0')) hints.add(s);
  }
  return [...hints].slice(0, 40);
}

function walkFbx(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFbx(full, out);
    else if (name.toLowerCase().endsWith('.fbx')) out.push(full);
  }
  return out;
}

function megapixels(w, h) {
  return ((w * h) / 1e6).toFixed(2);
}

function main() {
  const files = walkFbx(PUBLIC);
  if (files.length === 0) {
    console.log('No .fbx files under', PUBLIC);
    process.exit(0);
  }

  console.log('FBX embedded raster scan (PNG / JPEG signatures in file bytes)\n');
  console.log(
    `— Only listings with both sides ≤${MAX_WH}px (and sane area) — random SOF-like bytes inside FBX are ignored.\n`
  );
  console.log('— External textures referenced by path only are listed as "path hints" when found.\n');

  let grandTotalBytes = 0;
  /** @type {Map<string, number>} */
  const dimCounts = new Map();
  for (const file of files.sort()) {
    const buf = fs.readFileSync(file);
    grandTotalBytes += buf.length;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const pngs = findEmbeddedPngs(buf);
    const jpgs = findEmbeddedJpegs(buf);
    const hints = findTexturePathHints(buf);

    console.log(`## ${rel}  (${(buf.length / 1024).toFixed(1)} KiB file)`);

    const rows = [...pngs, ...jpgs].sort((a, b) => b.w * b.h - a.w * a.h);
    if (rows.length === 0) {
      console.log('  (no embedded PNG/JPEG blobs detected)');
    } else {
      for (const r of rows) {
        const key = `${r.format} ${r.w}×${r.h}`;
        dimCounts.set(key, (dimCounts.get(key) || 0) + 1);
        const mp = megapixels(r.w, r.h);
        const flag = r.w > 1024 || r.h > 1024 ? '  >1024 — consider resizing for mobile' : '';
        console.log(`  ${r.format.padEnd(5)} ${r.w}×${r.h}  (~${mp} MP)  @0x${r.offset.toString(16)}${flag}`);
      }
    }

    if (hints.length) {
      console.log('  Path-like hints (may be false positives):');
      for (const h of hints) console.log(`    ${h}`);
    }
    console.log('');
  }

  console.log(`Total FBX payload on disk: ${(grandTotalBytes / 1024 / 1024).toFixed(2)} MiB\n`);

  if (dimCounts.size > 0) {
    console.log('Summary (embedded blobs this run):');
    const sorted = [...dimCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sorted) console.log(`  ${n}×  ${k}`);
  }
}

main();

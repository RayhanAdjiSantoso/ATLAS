import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

// Vite plugin: every folder in /extensions becomes a downloadable zip for the
// Extensions page, built from the source at build time (and on the fly in
// dev), so the zip is never committed and never lags behind the code.
//
//   import extensions from 'virtual:atlas-extensions'
//   -> [{ id, name, version, description, file, bytes, files }]
//
// The zip is written here with Node's zlib (deflate) — no archive
// dependency. Its single top folder is the extension's id, ready for
// chrome://extensions › Load unpacked.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extensions');
const PUBLIC_DIR = 'downloads/extensions';
const VIRTUAL = 'virtual:atlas-extensions';
const SKIP = /(^|\/)(\.DS_Store|\.git|node_modules|.*\.map)$/;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (SKIP.test(rel)) return [];
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

// A standard zip (PKWARE APPNOTE): local headers, deflated data, central
// directory. Fixed timestamp so the same source gives the same bytes.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export function readExtensions() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'manifest.json')))
    .map((d) => {
      const dir = path.join(ROOT, d.name);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const files = walk(dir);
      const buffer = zip(files.map((f) => ({ name: `${d.name}/${f}`, data: fs.readFileSync(path.join(dir, f)) })));
      const file = `${PUBLIC_DIR}/${d.name}-${manifest.version}.zip`;
      return {
        id: d.name,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        permissions: [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])],
        file,
        bytes: buffer.length,
        files: files.length,
        buffer,
      };
    });
}

export default function extensionZips() {
  let cache = null;
  const all = () => (cache ??= readExtensions());
  return {
    name: 'atlas-extension-zips',
    resolveId(id) {
      return id === VIRTUAL ? `\0${VIRTUAL}` : null;
    },
    load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      const meta = all().map(({ buffer, ...rest }) => rest);
      return `export default ${JSON.stringify(meta)};`;
    },
    generateBundle() {
      for (const x of all()) this.emitFile({ type: 'asset', fileName: x.file, source: x.buffer });
    },
    // Dev: serve the zip fresh from the source folder on every request.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(`/${PUBLIC_DIR}/`)) return next();
        cache = null;
        const hit = all().find((x) => req.url.split('?')[0] === `/${x.file}`);
        if (!hit) return next();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(hit.file)}"`);
        res.end(hit.buffer);
      });
      server.watcher.add(ROOT);
      server.watcher.on('change', (f) => {
        if (!f.startsWith(ROOT)) return;
        cache = null;
        const mod = server.moduleGraph.getModuleById(`\0${VIRTUAL}`);
        if (mod) server.moduleGraph.invalidateModule(mod);
      });
    },
  };
}

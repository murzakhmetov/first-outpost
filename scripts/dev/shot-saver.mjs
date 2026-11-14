// Dev helper: receives PNG or JPEG pictures from the browser (window.gfxlab.shot) and saves them as files.
// Usage: node scripts/dev/shot-saver.mjs [folder] [port]
// Then POST the PNG bytes to http://localhost:5199/save?name=<name> (any origin is allowed).
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_FOLDER = join(import.meta.dirname, '..', '..', '..', 'gfx-shots2');
const folder = resolve(process.argv[2] || DEFAULT_FOLDER);
const port = Number(process.argv[3] || 5199);
mkdirSync(folder, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '600',
};

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  if (url.pathname === '/ping') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' }).end(folder);
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/save') {
    res.writeHead(404, CORS).end('POST /save?name=<name>');
    return;
  }
  const name = (url.searchParams.get('name') || '').replace(/\.(png|jpe?g)$/i, '');
  if (!/^[\w.-]{1,120}$/.test(name) || name.startsWith('.')) {
    res.writeHead(400, CORS).end('bad name');
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const png = body.length > 8 && body.readUInt32BE(0) === 0x89504e47;
      const jpg = body.length > 8 && body[0] === 0xff && body[1] === 0xd8;
      if (!png && !jpg) {
        res.writeHead(400, CORS).end('not a PNG or JPEG');
        return;
      }
      const path = join(folder, `${name}.${png ? 'png' : 'jpg'}`);
      writeFileSync(path, body);
      console.log(`saved ${path} (${body.length} bytes)`);
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' }).end(path);
    } catch (error) {
      console.error('save failed', error);
      res.writeHead(500, CORS).end(`error: ${String(error)}`);
    }
  });
}).listen(port, () => console.log(`shot saver on http://localhost:${port}, folder ${folder}`));

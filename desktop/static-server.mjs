import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { inside, contentPolicy } from './security.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

export async function listenLocal(server, preferred = 47821) {
  const listen = (port) => new Promise((resolve, reject) => {
    const failed = (error) => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolve(server.address().port); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  try { return await listen(preferred); }
  catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; return listen(0); }
}

export async function serveDesktop(root, preferred = 5481) {
  const actualRoot = await fs.realpath(root);
  let origin = '', companionOrigin = '';
  const server = http.createServer(async (req, res) => {
    const fail = (status) => { res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end(status === 404 ? 'Not found' : 'Request refused'); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return fail(403);
      if (!['GET', 'HEAD'].includes(req.method)) return fail(405);
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part === '..' || part.includes(':'))) return fail(403);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const extension = path.extname(relative).toLowerCase();
      if (!MIME[extension]) return fail(404);
      const target = path.resolve(actualRoot, relative);
      if (!inside(actualRoot, target)) return fail(403);
      const actual = await fs.realpath(target);
      if (!inside(actualRoot, actual)) return fail(403);
      const stat = await fs.stat(actual);
      if (!stat.isFile()) return fail(404);
      res.writeHead(200, {
        'Content-Type': MIME[extension], 'Content-Length': stat.size,
        'Content-Security-Policy': contentPolicy(companionOrigin),
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') return res.end();
      res.end(await fs.readFile(actual));
    } catch { fail(404); }
  });
  // A stable preferred UI port preserves local preferences. Collisions are
  // handled within the companion's allowed preview-port range.
  let port;
  const choices = [preferred, ...Array.from({ length: 3001 }, (_, i) => 3000 + i).filter((value) => value !== preferred)];
  for (const candidate of choices) {
    try {
      port = await new Promise((resolve, reject) => {
        const error = (value) => { server.off('listening', ready); reject(value); };
        const ready = () => { server.off('error', error); resolve(server.address().port); };
        server.once('error', error); server.once('listening', ready); server.listen(candidate, '127.0.0.1');
      });
      break;
    } catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error; }
  }
  if (!port) throw new Error('No local UI port is available between 3000 and 6000.');
  origin = `http://127.0.0.1:${port}`;
  return { origin, server, setCompanionOrigin: (value) => { companionOrigin = value; }, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

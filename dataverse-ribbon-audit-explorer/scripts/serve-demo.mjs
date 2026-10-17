import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};
export function createDemoServer() {
  return http.createServer(async (req, res) => {
    const fail = (code) => {
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end('Unavailable');
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return fail(405);
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return fail(403);
      let requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (requested === '/') requested = '/demo/index.html';
      if (!/^\/(demo|src|assets)\//.test(requested) || requested.includes('\0')) return fail(404);
      const target = await realpath(path.resolve(root, '.' + requested));
      if (
        !target.startsWith(root + path.sep) ||
        !['demo', 'src', 'assets'].includes(path.relative(root, target).split(path.sep)[0])
      )
        return fail(404);
      const content = await readFile(target);
      res.writeHead(200, {
        'Content-Type': types[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      return fail(404);
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.indexOf('--port'),
    port = arg < 0 ? 4175 : Number(process.argv[arg + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('Use --port with a port between 1024 and 65535.');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () =>
    console.log(`Synthetic demo: http://127.0.0.1:${port}/demo/index.html`),
  );
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

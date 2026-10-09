import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/logo.svg', ['logo.svg', 'image/svg+xml']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
  ['/mobile/logo.svg', ['dist/logo.svg', 'image/svg+xml']],
  ['/mobile/icon-192.png', ['dist/icon-192.png', 'image/png']],
  ['/mobile/icon-512.png', ['dist/icon-512.png', 'image/png']],
  ['/sw.js', ['sw.js', 'text/javascript']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/mobile/', ['dist/index.html', 'text/html']],
  ['/mobile/index.html', ['dist/index.html', 'text/html']],
  ['/mobile/mobile.js', ['dist/mobile.js', 'text/javascript']],
  ['/mobile/styles.css', ['dist/styles.css', 'text/css']],
  ['/mobile/sw.js', ['dist/sw.js', 'text/javascript']],
  ['/mobile/manifest.webmanifest', ['dist/manifest.webmanifest', 'application/manifest+json']],
]);

createServer(async (request, response) => {
  const file = files.get(new URL(request.url, 'http://localhost').pathname);
  if (request.method !== 'GET' || !file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }).end(data);
  } catch {
    response.writeHead(500).end('Unable to load app asset');
  }
}).listen(5501, '127.0.0.1', () => console.log('FuelWise: http://127.0.0.1:5501'));

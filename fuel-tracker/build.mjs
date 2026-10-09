import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
await writeFile(new URL('./dist/index.html', import.meta.url), html.replace('src="app.js"', 'src="mobile.js"'));
const worker = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
await writeFile(new URL('./dist/sw.js', import.meta.url), worker.replace('"app.js"', '"mobile.js"'));
await Promise.all(['styles.css', 'manifest.webmanifest', 'logo.svg', 'icon-192.png', 'icon-512.png'].map(file =>
  copyFile(new URL(file, import.meta.url), new URL(`./dist/${file}`, import.meta.url))
));
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['native-entry.js'],
  outfile: 'dist/mobile.js',
  bundle: true,
  format: 'iife',
  target: ['chrome109', 'safari15'],
  minify: true,
});
console.log('Built self-contained mobile assets in dist/');

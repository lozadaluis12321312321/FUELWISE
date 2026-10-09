import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const source = await readFile(new URL('./logo.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const render = async (path, size, svg, background = 'transparent') => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${background}}svg{display:block;width:100%;height:100%}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL(path, import.meta.url)), omitBackground: background === 'transparent' });
};
try {
  for (const size of [192, 512]) await render(`./icon-${size}.png`, size, source);
  await render('./ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024, source.replace('rx="26"', 'rx="0"'), '#111111');
  const foreground = source.replace(/<rect[^>]+\/>/, '');
  for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const root = `./android/app/src/main/res/mipmap-${density}/`;
    await render(`${root}ic_launcher.png`, 48 * scale, source);
    await render(`${root}ic_launcher_round.png`, 48 * scale, source.replace('rx="26"', 'rx="54"'));
    await render(`${root}ic_launcher_foreground.png`, 108 * scale, foreground);
  }
  const splashPaths = [
    './android/app/src/main/res/drawable/splash.png',
    ...['land', 'port'].flatMap(orientation => ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map(density => `./android/app/src/main/res/drawable-${orientation}-${density}/splash.png`)),
    ...['', '-1', '-2'].map(suffix => `./ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${suffix}.png`),
  ];
  for (const path of splashPaths) {
    const file = new URL(path, import.meta.url);
    const png = await readFile(file);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const size = width === height ? 180 : Math.round(Math.min(width, height) * .2);
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#f7f7f7}body{display:grid;place-items:center}svg{width:${size}px;height:${size}px}</style>${source}`);
    await page.screenshot({ path: fileURLToPath(file) });
  }
  console.log('Generated monochrome web, Android, and iOS icons and launch images from logo.svg.');
} finally {
  await browser.close();
}

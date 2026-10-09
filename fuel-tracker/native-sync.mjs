import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('./ios/App/CapApp-SPM/Package.swift', import.meta.url);
try {
  const source = await readFile(file, 'utf8');
  const normalized = source.replace(/path: "([^"]+)"/g, (_, path) => `path: "${path.replaceAll('\\', '/')}"`);
  if (normalized !== source) await writeFile(file, normalized);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

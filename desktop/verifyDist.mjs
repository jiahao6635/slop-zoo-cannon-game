import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distributionDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const files = await collectFiles(distributionDirectory);
const forbiddenText = [
  'http://127.0.0.1:5173',
  'ws://127.0.0.1:5173',
  'VITE_DEV_SERVER_URL',
  'sourceMappingURL=',
];

if (files.some((path) => extname(path) === '.map')) {
  throw new Error('Production distribution must not contain source-map files.');
}

for (const path of files.filter(isTextAsset)) {
  const contents = await readFile(path, 'utf8');
  const match = forbiddenText.find((text) => contents.includes(text));
  if (match) throw new Error(`Production distribution contains forbidden marker: ${match}`);
}

const indexHtml = await readFile(join(distributionDirectory, 'index.html'), 'utf8');
if (!indexHtml.includes("connect-src 'self';")) {
  throw new Error('Production CSP must restrict network connections to its own offline bundle.');
}

console.log(`DESKTOP_DIST_OK files=${files.length}`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return nested.flat();
}

function isTextAsset(path) {
  return ['.html', '.js', '.css', '.json'].includes(extname(path));
}

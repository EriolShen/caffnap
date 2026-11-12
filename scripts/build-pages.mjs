import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const runtimeFiles = [
  'index.html', 'app.js', 'db.js', 'model.js', 'reactions.js', 'storage.js', 'tour.js',
  'assets/drinks.png', 'vendor/lucide.min.js', 'vendor/LUCIDE-LICENSE',
  'vendor/driver.js.iife.js', 'vendor/driver.css', 'vendor/DRIVER-LICENSE', 'LICENSE',
];

export function buildPages(outDir, { includeTitleFont = true } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of runtimeFiles) {
    const destination = path.join(outDir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  let css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const fontPath = path.join(outDir, 'assets/NanoTikBazHei-Bold.ttf');
  if (includeTitleFont) {
    fs.copyFileSync(path.join(root, 'assets/NanoTikBazHei-Bold.ttf'), fontPath);
  } else {
    // Keep the local face unchanged when a deployment opts into system fonts.
    const titleFace = /^@font-face\s*\{[^}]*NanoTikBazHei-Bold\.ttf[^}]*\}\s*/;
    if (!titleFace.test(css)) throw new Error('Title font declaration changed; review the public font build.');
    css = css.replace(titleFace, '');
    fs.rmSync(fontPath, { force: true });
  }
  fs.writeFileSync(path.join(outDir, 'style.css'), css);
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.join(root, 'dist');
  fs.rmSync(outDir, { recursive: true, force: true });
  buildPages(outDir, { includeTitleFont: process.env.PUBLISH_TITLE_FONT !== 'false' });
  console.log('Prepared GitHub Pages artifact in dist/.');
}

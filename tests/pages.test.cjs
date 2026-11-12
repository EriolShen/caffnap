const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('Pages build includes runtime assets and can omit the optional title font', async () => {
  const { buildPages } = await import('../scripts/build-pages.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'caffnap-pages-'));
  try {
    buildPages(out);
    assert.ok(fs.existsSync(path.join(out, 'assets/NanoTikBazHei-Bold.ttf')));
    assert.ok(fs.readFileSync(path.join(out, 'style.css'), 'utf8').includes('NanoTikBazHei-Bold.ttf'));
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /src="app\.js\?v=[a-f0-9]{12}"/);
    assert.match(html, /href="style\.css\?v=[a-f0-9]{12}"/);
    assert.match(html, /src="reactions\.js\?v=[a-f0-9]{12}"/);
    buildPages(out, { includeTitleFont: false });
    assert.notEqual(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), html, 'Changed public CSS must receive a new revision');
    for (const file of ['index.html', 'app.js', 'model.js', 'db.js', 'reactions.js', 'storage.js', 'tour.js', 'style.css', 'assets/drinks.png', 'vendor/driver.js.iife.js', 'vendor/lucide.min.js', '.nojekyll'])
      assert.ok(fs.existsSync(path.join(out, file)), file);
    for (const file of ['tests', 'docs', 'legacy', 'output', '.git', 'assets/NanoTikBazHei-Bold.ttf'])
      assert.equal(fs.existsSync(path.join(out, file)), false, file);
    const css = fs.readFileSync(path.join(out, 'style.css'), 'utf8');
    assert.equal(css.includes('NanoTikBazHei-Bold.ttf'), false);
    assert.ok(css.includes('PingFang SC'));
    assert.ok(fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8').includes('NanoTikBazHei-Bold.ttf'), 'Local design must retain its font');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

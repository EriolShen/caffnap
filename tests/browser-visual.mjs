import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { checkInterface } from './interface-checks.mjs';

// A separate QA origin/profile: never reads or edits the user's file:// records.
const root = path.resolve(import.meta.dirname, '..');
const profile = path.join(root, '.taste-skill/chrome-preview');
const out = path.join(root, 'output/qa');
const appUrl = process.env.CAFFNAP_QA_URL || 'http://127.0.0.1:5300/index.html';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, file);
  const allowed = /^(index\.html|style\.css|(?:app|db|model|reactions|storage|tour)\.js|(?:assets|vendor)\/[^/]+)$/.test(relative);
  if (!allowed || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5300, '127.0.0.1', resolve); });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
    chrome.stderr.on('data', chunk => {
      const found = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    });
  });
  ws = new WebSocket(endpoint);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise(resolve => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = async (method, params) => {
    const answer = await send(method, params, sessionId);
    if (answer.error) throw new Error(JSON.stringify(answer.error));
    return answer.result;
  };
  const evaluate = async expression => {
    const answer = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || expression);
    return answer.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shot = async (name, selector) => {
    if (selector) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'start' })`);
      await sleep(100);
    }
    const clip = selector && await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 1 }; })()`);
    const { data } = await command('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.navigate', { url: appUrl });
  await sleep(800);
  await evaluate('localStorage.removeItem("caffnap_workspace_v2")');
  await command('Page.reload');
  await sleep(800);
  await evaluate('document.fonts.ready');
  if (await evaluate('document.querySelector("#orientation").open')) await click('#orientationExplore');
  await checkInterface({ command, evaluate, click, shot, sleep, out });
  for (const [width, height] of [[1440,900],[1280,720],[1024,768],[820,1180],[768,1024],[390,844],[320,740]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate('scrollTo(0,0)');
    await sleep(400);
    const state = await evaluate(`(() => {
      const button = document.querySelector('#startPlan').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        actionVisible: button.top >= 0 && button.bottom < innerHeight,
        actionHeights: ['startPlan', 'startRecord'].map(id => document.getElementById(id).getBoundingClientRect().height),
        charts: [...document.querySelectorAll('.model-chart canvas')].map(c => ({
          width: c.width, height: c.height,
          ink: [...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((n,i) => i%4 === 3 && n > 0).length,
          axis: c.dataset.axisLabel
        })) };
    })()`);
    assert.equal(state.overflow, false, `${width}: horizontal overflow`);
    assert.equal(state.actionVisible, true, `${width}: primary action below fold`);
    state.actionHeights.forEach(h => assert.ok(h >= 44 && h <= 56, `${width}: action label wraps or target too small`));
    assert.equal(state.charts.length, 3);
    state.charts.forEach(c => assert.ok(c.ink > 1000 && c.axis, `${width}: chart missing`));
    await shot('lifestyle-home-' + width);
    console.log(`${width}x${height}: no overflow, action visible, three nonblank labeled charts`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('#startPlan');
  assert.equal(await evaluate('document.querySelector("#drinkDialog").open'), true);
  await click('[data-drink]');
  await click('#drinkSubmit');
  assert.equal(await evaluate('document.querySelector("#comparison").hidden'), false);
  await shot('lifestyle-compare-mobile');
  await click('#finishCompare');
  await click('#startRecord');
  assert.equal(await evaluate('document.querySelector("#drinkDialog").open'), true);
  await click('[data-drink]');
  await click('#drinkSubmit');
  assert.equal(await evaluate('document.querySelector("#drinkDialog").open'), false);
  assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 1);
  assert.notEqual(await evaluate('document.querySelector("#predSleep").textContent'), '待记录摄入');
  await command('Page.reload');
  await sleep(700);
  assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 1);
  await shot('lifestyle-recorded-mobile');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await shot('lifestyle-recorded-desktop');
  await shot('interface-curves-desktop', '.curves-section');
  await click('[data-delete]');
  assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 0);
  if (process.env.INTERFACE_BASELINE !== '1') {
    await sleep(10500);
    assert.equal(await evaluate('document.querySelector("#undoNotice").hidden'), false, 'Undo must not expire');
    await evaluate('document.querySelector("#targetBed").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.querySelector("#undoNotice").hidden'), false, 'Unrelated feedback must not replace undo');
    await click('#undoDelete');
    assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 1);
    assert.equal(await evaluate('document.activeElement.hasAttribute("data-edit")'), true);
    await click('#timeline [data-repeat]');
    await click('#drinkSubmit');
    assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 2);
    await click('#timeline [data-delete]');
    await click('#timeline [data-delete]');
    await click('#undoDelete');
    await click('#undoDelete');
    assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 2, 'Consecutive deletes remain undoable');
    await click('#timeline [data-delete]');
    await click('#timeline [data-delete]');
    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await sleep(150);
    await shot('interface-undo-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await evaluate('document.querySelector("#caffeineHelp .chart-help-trigger").focus()');
    const clearance = await evaluate(`(() => {
      const focus = document.activeElement.getBoundingClientRect();
      const notices = document.querySelector('#notifications').getBoundingClientRect();
      return focus.bottom <= notices.top || focus.top >= notices.bottom;
    })()`);
    assert.equal(clearance, true, 'Notifications obscure keyboard focus');
    await click('#dismissUndo');
    if (await evaluate('document.querySelector("#toast").checkVisibility()')) await click('#dismissToast');
    assert.equal(await evaluate('document.querySelector("#undoNotice").hidden'), true);
    console.log('Undo survives 10.5 seconds and unrelated updates; consecutive deletions restore; dismissal and focus clearance passed.');
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  await shot('interface-curves-mobile', '.curves-section');
  for (const [index, id] of ['caffeineChart', 'melatoninChart', 'alertnessChart'].entries()) {
    await evaluate(`document.getElementById('${id}').closest('.model-chart').scrollIntoView({ block: 'start' })`);
    await shot('interface-curve-viewport-' + (index + 1));
  }
  await evaluate('document.querySelector("#caffeineHelp .chart-help-trigger").focus()');
  assert.equal(await evaluate('document.querySelector("#caffeineTooltip").hidden'), false);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.querySelector("#caffeineTooltip").hidden'), true);
  await click('[data-page="settings"]');
  await shot('lifestyle-settings-mobile');
  await click('[data-page="today"]');
  await click('#guideAgain');
  await click('#orientationStart');
  for (let step = 1; step <= 5; step++) {
    await sleep(900);
    const bounds = await evaluate(`(() => {
      const pop = document.querySelector('.driver-popover').getBoundingClientRect();
      const target = document.querySelector('.driver-active-element').getBoundingClientRect();
      return { visible: pop.left >= 0 && pop.right <= innerWidth && pop.top >= 0 && pop.bottom <= innerHeight,
        overlap: Math.min(pop.right,target.right) > Math.max(pop.left,target.left) && Math.min(pop.bottom,target.bottom) > Math.max(pop.top,target.top) };
    })()`);
    assert.equal(bounds.visible, true, `tour ${step}: popover outside viewport`);
    assert.equal(bounds.overlap, false, `tour ${step}: popover covers target`);
    await shot('lifestyle-tour-mobile-' + step);
    await click('.driver-popover-next-btn');
  }
  await sleep(200);
  assert.equal(await evaluate('document.querySelector("#orientationInvite").hidden'), false);
  await click('#orientationDefault');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("caffnap_workspace_v2")).records.filter(r => !r.deletedAt).length'), 0);
  await command('Page.reload');
  await sleep(700);
  assert.equal(await evaluate('document.querySelectorAll("#timeline .record-row").length'), 0);
  await evaluate('scrollTo(0,0)');
  assert.deepEqual(errors, []);
  console.log('Comparison, saving/reloading/deleting a QA record, tooltip keyboard behavior, settings, five mobile tour targets and completion passed.');
} finally {
  ws?.close();
  const exited = once(chrome, 'exit');
  chrome.kill('SIGTERM');
  await exited;
  await new Promise(resolve => server.close(resolve));
}

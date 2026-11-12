import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function checkInterface({ command, evaluate, click, shot, sleep, out }) {
  const baseline = process.env.INTERFACE_BASELINE === '1';
  const evidence = { baseline, pages: {} };
  const key = async (name, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key: name, code: name, modifiers, windowsVirtualKeyCode: code, ...(type === 'keyDown' && name === 'Enter' ? { text: '\r' } : {}) });
  };
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const page of ['settings', 'review', 'today']) {
    await evaluate(`document.querySelector('[data-page="${page}"]').focus()`);
    await key('Enter', 13);
    const state = await evaluate(`(() => {
      const page = document.querySelector('.page:not([hidden])');
      const heading = page.querySelector('h1');
      const rgba = value => value.trim().startsWith('#') ? value.trim().slice(1).match(/../g).map(v => parseInt(v,16)) : value.match(/[\\d.]+/g).map(Number);
      const blend = (front, back) => front.slice(0,3).map((v,i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
      const bg = el => {
        const layers = [];
        for (; el; el = el.parentElement) layers.unshift(rgba(getComputedStyle(el).backgroundColor));
        return layers.reduce((back,front) => blend(front,back), [255,255,255]);
      };
      const lum = c => c.slice(0,3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s,v,i) => s + v * [.2126,.7152,.0722][i],0);
      const ratio = (a,b) => (Math.max(lum(a),lum(b)) + .05) / (Math.min(lum(a),lum(b)) + .05);
      const textPairs = [...page.querySelectorAll('*')].filter(el => el.checkVisibility() && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(el => {
        const s = getComputedStyle(el), background = bg(el), size = parseFloat(s.fontSize);
        return { selector: el.id || el.className || el.tagName, text: el.textContent.trim().slice(0,50), ratio: ratio(blend(rgba(s.color), background), background), required: size >= 24 || (size >= 18.67 && parseInt(s.fontWeight) >= 700) ? 3 : 4.5 };
      });
      const field = page.querySelector('input:not([type="checkbox"]):not([type="radio"])');
      const canvas = page.querySelector('canvas');
      const reference = getComputedStyle(document.documentElement).getPropertyValue('--chart-reference').trim() || '#9ca9a1';
      return { title: document.title, heading: heading.textContent, headingFocused: document.activeElement === heading,
        overflow: document.documentElement.scrollWidth > innerWidth,
        textFailures: textPairs.filter(p => p.ratio < p.required),
        minimumTextContrast: Math.min(...textPairs.map(p => p.ratio)),
        referenceContrast: canvas && Math.min(ratio(rgba(reference), bg(canvas)), ratio(rgba(reference), rgba(getComputedStyle(document.documentElement).getPropertyValue('--lavender')))),
        field: field && { font: getComputedStyle(field).fontSize, borderContrast: ratio(rgba(getComputedStyle(field).borderColor), bg(field)) } };
    })()`);
    const { nodes } = await command('Accessibility.getFullAXTree');
    state.unnamedControls = nodes.filter(n => !n.ignored && ['button','textbox','combobox','checkbox','radio'].includes(n.role?.value) && !n.name?.value).map(n => n.role.value);
    evidence.pages[page] = state;
    if (!baseline) {
      assert.equal(state.headingFocused, true, `${page}: navigation did not focus heading`);
      assert.ok(state.title.includes(state.heading), `${page}: title does not identify view`);
      assert.equal(state.overflow, false, `${page}: overflow`);
      assert.deepEqual(state.textFailures, [], `${page}: text contrast failures`);
      assert.deepEqual(state.unnamedControls, [], `${page}: unnamed controls`);
      if (state.referenceContrast) assert.ok(state.referenceContrast >= 3, 'Chart reference line contrast');
      if (state.field) assert.ok(state.field.borderContrast >= 3, `${page}: field boundary contrast`);
    }
  }
  await evaluate('document.querySelector("#startPlan").focus()');
  await key('Enter', 13);
  assert.equal(await evaluate('document.querySelector("#drinkDialog").open'), true);
  await evaluate('document.querySelector("#drinkSearch").value = "no-match-for-qa"; document.querySelector("#drinkSearch").dispatchEvent(new Event("input"))');
  evidence.picker = await evaluate(`({ font: getComputedStyle(document.querySelector('#drinkSearch')).fontSize,
    resetVisible: !!document.querySelector('#clearDrinkFilters')?.checkVisibility(),
    countRole: document.querySelector('#drinkResultCount').getAttribute('role'),
    overscroll: getComputedStyle(document.querySelector('#drinkDialog')).overscrollBehaviorY })`);
  await shot(baseline ? 'interface-before-empty' : 'interface-after-empty');
  if (!baseline) {
    assert.equal(evidence.picker.resetVisible, true);
    assert.equal(evidence.picker.font, '16px');
    assert.equal(evidence.picker.countRole, 'status');
    assert.equal(evidence.picker.overscroll, 'contain');
    await evaluate('document.querySelector("#clearDrinkFilters").focus()');
    await key('Enter', 13);
    assert.equal(await evaluate('document.activeElement.id'), 'drinkSearch');
  } else {
    await evaluate('document.querySelector("#drinkSearch").value = ""; document.querySelector("#drinkSearch").dispatchEvent(new Event("input"))');
  }
  // Real Tab traversal must remain in the native modal, including wraparound.
  for (let i = 0; i < 8; i++) {
    await key('Tab', 9);
    assert.equal(await evaluate('document.querySelector("#drinkDialog").contains(document.activeElement)'), true);
  }
  await evaluate('document.querySelector("#pickerCustom").focus()');
  await key('Tab', 9);
  // Chromium can visit browser chrome between the last and first modal stops.
  if (await evaluate('document.activeElement === document.body')) await key('Tab', 9);
  assert.equal(await evaluate('document.activeElement.getAttribute("data-close")'), 'drinkDialog');
  await key('Tab', 9, 8);
  if (await evaluate('document.activeElement === document.body')) await key('Tab', 9, 8);
  assert.equal(await evaluate('document.activeElement.id'), 'pickerCustom');
  await click('[data-drink]');
  await click('#drinkSubmit');
  await evaluate('document.querySelector("#backToDrink").focus()');
  await key('Enter', 13);
  evidence.returnFocus = await evaluate('document.activeElement.id');
  if (!baseline) {
    assert.equal(evidence.returnFocus, 'drinkCups');
    assert.equal(await evaluate('document.querySelector("#drinkTitle").textContent'), '这杯，准备几点喝？');
  }
  await evaluate(`document.querySelector('#drinkTime').value = '23:59'; document.querySelector('#drinkDate').value = document.querySelector('#drinkDate').max; document.querySelector('#drinkForm').requestSubmit()`);
  evidence.error = await evaluate(`({ message: document.querySelector('#drinkError').textContent, focused: document.activeElement.id,
    invalid: document.querySelector('#drinkTime').getAttribute('aria-invalid'), describedBy: document.querySelector('#drinkTime').getAttribute('aria-describedby') })`);
  if (!baseline) {
    assert.ok(evidence.error.message);
    assert.equal(evidence.error.focused, 'drinkDate');
    assert.equal(evidence.error.invalid, 'true');
    assert.equal(evidence.error.describedBy, 'drinkError');
  }
  await shot(baseline ? 'interface-before-error' : 'interface-after-error');
  if (!baseline) {
    await evaluate('document.querySelector("#drinkTime").dispatchEvent(new Event("input", { bubbles: true }))');
    assert.equal(await evaluate('document.querySelector("#drinkTime").hasAttribute("aria-invalid")'), false);
    assert.equal(await evaluate('document.querySelector("#drinkError").textContent'), '');
  }
  await key('Escape', 27);
  assert.equal(await evaluate('document.activeElement.id'), 'startPlan');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  evidence.reducedMotion = await evaluate('getComputedStyle(document.querySelector("#startPlan")).transitionDuration');
  assert.equal(evidence.reducedMotion, '0s');
  await command('Emulation.setEmulatedMedia', { features: [] });
  // 1440 physical pixels at 200% page scale have a 720 CSS-pixel layout.
  await command('Emulation.setDeviceMetricsOverride', { width: 720, height: 450, deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  evidence.zoomReflow = await evaluate('document.documentElement.scrollWidth <= innerWidth');
  assert.equal(evidence.zoomReflow, true);
  await shot(baseline ? 'interface-before-reflow' : 'interface-after-reflow');
  fs.writeFileSync(path.join(out, baseline ? 'interface-before.json' : 'interface-after.json'), JSON.stringify(evidence, null, 2));
  console.log('Interface audit:', JSON.stringify(evidence));
}

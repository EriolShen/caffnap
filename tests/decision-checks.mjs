import assert from 'node:assert/strict';

export async function checkDecision({ command, evaluate, click, shot, sleep }) {
  const saved = await evaluate('localStorage.getItem("caffnap_workspace_v2")');
  const { identifier } = await command('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const RealDate = Date, fixed = +new RealDate('2026-11-12T14:00:00');
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
  }` });
  const set = (id, value, event = 'input') => evaluate(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}; document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event(${JSON.stringify(event)}))`);
  const count = () => evaluate('JSON.parse(localStorage.getItem("caffnap_workspace_v2")).records.length');
  try {
    await evaluate(`(() => {
      const data = CaffNapStorage.defaults();
      data.onboarding = data.featureTourSeen = true;
      data.custom = [{k:'qa-heavy', brand:'QA', drink:'测试高因饮品', mg:2000, source:'personal'}];
      localStorage.setItem('caffnap_workspace_v2', JSON.stringify(data));
    })()`);
    await command('Page.reload');
    await sleep(800);
    assert.equal(await evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size === document.querySelectorAll("[id]").length'), true, 'IDs must be unique');
    await click('#startPlan');
    assert.equal(await evaluate('document.activeElement.id'), 'brandFilter');
    assert.equal(await evaluate('document.querySelectorAll("[data-drink]").length'), 0, 'Brand-first plan');
    await set('planTime', '20:00');
    await set('brandFilter', '瑞幸咖啡', 'change');
    assert.ok(await evaluate('document.querySelectorAll("[data-drink]").length > 1'));
    assert.equal(await evaluate(`[...document.querySelectorAll('[data-drink]')].every(el=>CAFFNAP_DB.items.find(b=>b.k===el.dataset.drink).brand==='瑞幸咖啡')`), true);
    await set('planCups', '0');
    assert.ok(await evaluate('document.getElementById("planError").textContent.length > 0'));
    assert.equal(await evaluate('document.querySelectorAll("[data-drink]").length'), 0, 'Invalid quantity hides stale recommendations');
    await set('planCups', '1');
    for (const width of [1440, 390, 320]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await evaluate('document.querySelector("#drinkDialog").scrollTop = 0');
      await shot('decision-brand-' + width);
      assert.equal(await evaluate('document.querySelector("#drinkDialog").scrollWidth <= document.querySelector("#drinkDialog").clientWidth'), true, 'Picker overflow at ' + width);
    }
    await click('[data-drink="b000"]');
    assert.equal(await evaluate('document.querySelector("#comparison").hidden'), false);
    assert.equal(await evaluate('document.activeElement.id'), 'decisionSummaryTitle');
    assert.equal(await evaluate('document.querySelector("#confirmConsumed").disabled'), true, 'Future plan cannot be recorded');
    assert.equal(await count(), 0);
    const original = await evaluate('document.querySelector("#decisionSleep").textContent');
    assert.ok(original.includes('明天'), 'Evening coffee crosses midnight');
    assert.equal(await evaluate('document.querySelector("#decisionDelta").textContent'), '比不加这一杯：约晚 6 小时 50 分钟');
    assert.equal(await evaluate('document.querySelector("#decisionSleep").tagName'), 'DD');
    assert.equal(await evaluate('document.querySelector("#compareOptions .option-dose").textContent'), '约 05:50');
    assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector("#decisionSleep")).fontSize) > parseFloat(getComputedStyle(document.querySelector("#decisionDelta")).fontSize)'));
    await click('input[name="comparisonChoice"][value="half"]');
    assert.notEqual(await evaluate('document.querySelector("#decisionSleep").textContent'), original);
    await click('input[name="comparisonChoice"][value="alternative"]');
    assert.ok(await evaluate('document.querySelector("#decisionContext").textContent.includes("1 份")'));
    await click('input[name="comparisonChoice"][value="none"]');
    assert.ok(await evaluate('document.querySelector("#decisionSleep").textContent.includes("23:00")'));
    assert.equal(await evaluate('document.querySelector("#confirmConsumed").hidden'), true);
    await click('input[name="comparisonChoice"][value="original"]');
    for (const [width, height] of [[1440,900],[390,844],[320,740],[720,450]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await evaluate('document.querySelector("#drinkDialog").scrollTop = 0');
      await shot('decision-result-' + width);
      assert.equal(await evaluate('document.querySelector("#drinkDialog").scrollWidth <= document.querySelector("#drinkDialog").clientWidth'), true, 'Result overflow at ' + width);
      const { nodes } = await command('Accessibility.getFullAXTree');
      assert.deepEqual(nodes.filter(n => !n.ignored && ['button','textbox','combobox','checkbox','radio'].includes(n.role?.value) && !n.name?.value), [], 'Unnamed decision control');
    }
    await click('#finishCompare');
    assert.equal(await count(), 0, 'Planning never writes a record');
    await click('#startPlan');
    await set('brandFilter', '喜茶', 'change');
    assert.equal(await evaluate(`[...document.querySelectorAll('[data-drink]')].every(el=>CAFFNAP_DB.items.find(b=>b.k===el.dataset.drink).brand==='喜茶')`), true);
    await set('brandFilter', 'QA', 'change');
    await set('planCups', '10');
    await set('planTime', '22:00');
    assert.ok(await evaluate('document.querySelector("#recommendationNote").textContent.includes("暂未满足")'));
    await click('[data-drink="qa-heavy"]');
    assert.ok(await evaluate('document.querySelector("#decisionSleep").textContent.includes("超出")'));
    assert.equal(await evaluate('/NaN|Invalid Date/.test(document.querySelector("#comparison").textContent)'), false);
    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#decisionSleep")).fontSize'), '22px');
    assert.equal(await evaluate('document.querySelector("#drinkDialog").scrollWidth <= document.querySelector("#drinkDialog").clientWidth'), true);
    await shot('decision-unavailable-320');
    await click('#finishCompare');
    await click('#startRecord');
    assert.equal(await evaluate('document.querySelector("#planContext").hidden'), true);
    await click('[data-drink="b000"]');
    assert.equal(await evaluate('document.querySelector("#comparison").hidden'), true);
    await click('#drinkSubmit');
    assert.equal(await count(), 1, 'Record mode saves directly');
    await click('#startPlan');
    await set('brandFilter', '瑞幸咖啡', 'change');
    await click('[data-drink="b000"]');
    assert.equal(await evaluate('document.querySelector("#confirmConsumed").disabled'), false);
    await click('#confirmConsumed');
    assert.equal(await count(), 2, 'Only explicit consumed confirmation adds the trial');
    console.log('Decision flow: brand-first, live recommendations, future/half/alternative/none predictions, no-fit, unchanged history, direct record, responsive and AX checks passed.');
  } finally {
    await command('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await evaluate(`localStorage.setItem('caffnap_workspace_v2', ${JSON.stringify(saved)})`);
    await command('Page.reload');
    await sleep(800);
  }
}

import assert from 'node:assert/strict';

export async function checkNewcomer({ command, evaluate, click, shot, sleep }) {
  const state = () => evaluate('JSON.parse(localStorage.getItem("caffnap_workspace_v2"))');
  const seed = async (manual = false, seen = false) => {
    await evaluate(`(() => {
      const data = CaffNapStorage.defaults();
      data.featureTourSeen = ${seen};
      if (${manual}) Object.assign(data.profile, { setupMode: 'manual', halfLife: 6, threshold: .9, source: 'QA manual profile' });
      localStorage.setItem('caffnap_workspace_v2', JSON.stringify(data));
    })()`);
    await command('Page.reload');
    await sleep(800);
    await evaluate('document.fonts.ready');
  };
  const key = async (key, code, text) => {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, ...(type === 'keyDown' && text ? { text } : {}) });
  };
  const answer = async value => {
    await click(`#surveyOptions input[value="${value}"]`);
    await click('#surveyNext');
  };
  const finishTour = async () => {
    for (let step = 0; step < 5; step++) {
      await sleep(750);
      assert.equal(await evaluate('!!document.querySelector(".driver-popover")'), true);
      await click('.driver-popover-next-btn');
    }
    await sleep(150);
  };

  await seed();
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(200);
    const visible = await evaluate(`(() => {
      const dialog = document.querySelector('#orientation');
      const primary = document.querySelector('#orientationQuickSurvey').getBoundingClientRect();
      return dialog.open && primary.top >= 0 && primary.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
    })()`);
    assert.equal(visible, true, `${width}: initial questionnaire entry hidden or clipped`);
    await shot('newcomer-v2-welcome-' + width);
  }
  assert.equal(await evaluate('document.activeElement.id'), 'orientationQuickSurvey');
  await key('Enter', 13, '\r');
  assert.equal(await evaluate('document.querySelector("#onboarding").open'), true);
  assert.equal(await evaluate('!!document.querySelector(".driver-popover")'), false);
  assert.equal(await evaluate('document.querySelector("#surveyNext").disabled'), true);
  await evaluate('document.querySelector("#surveyOptions input[value=weekly]").focus()');
  await key(' ', 32, ' ');
  await click('#surveyNext');
  await click('#surveyBack');
  assert.equal(await evaluate('document.querySelector("#surveyOptions input[value=weekly]").checked'), true);
  await click('#surveyNext');
  await answer('afternoon');
  await shot('newcomer-v2-question-320');
  await answer('sometimes');
  await answer('unknown');
  await answer('sleep');
  assert.equal(await evaluate('document.querySelector("#guideSurveyResult").hidden'), false);
  assert.equal(await evaluate('document.querySelector("#surveyApply").checked'), true);
  const before = await state();
  await evaluate(`window.qaOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k === 'caffnap_workspace_v2') throw new Error('QA storage unavailable'); return window.qaOriginalSetItem.call(this,k,v); }`);
  await click('#surveySave');
  assert.equal(await evaluate('document.querySelector("#surveySaveError").hidden'), false);
  assert.equal(await evaluate('document.querySelector("#onboarding").open'), true);
  assert.deepEqual((await state()).profile, before.profile);
  assert.equal((await state()).reactionAssessment, null);
  await evaluate('Storage.prototype.setItem = window.qaOriginalSetItem; delete window.qaOriginalSetItem');
  await shot('newcomer-v2-save-error-320');
  await click('#surveySave');
  assert.equal((await state()).profile.halfLife, 7.5);
  assert.equal((await state()).reactionAssessment.answers.sleep, 'sometimes');
  assert.equal((await state()).records.length, 0);
  assert.equal(await evaluate('document.querySelector("#orientationReady").hidden'), false);
  await shot('newcomer-v2-ready-320');
  await click('#orientationReadySkip');
  await command('Page.reload');
  await sleep(800);
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);
  assert.equal(await evaluate('document.querySelector("#reactionReminder").hidden'), true);

  // Skipping an initial survey never overwrites an advanced profile or loops back to it.
  await seed(true);
  const manual = (await state()).profile;
  await click('#orientationQuickSurvey');
  await click('#surveyBack');
  assert.equal(await evaluate('document.querySelector("#orientationWelcome").hidden'), false);
  await click('#orientationQuickSurvey');
  await click('#surveyOptions input[value=weekly]');
  await click('#surveySkip');
  assert.equal((await state()).reactionAssessment, null);
  assert.deepEqual((await state()).profile, manual);
  await click('#orientationContinue');
  await finishTour();
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);
  assert.equal(await evaluate('document.querySelector("#reactionReminder").hidden'), false);

  // Already-dismissed welcomes retain a direct completion path, without an automatic modal.
  await seed(true, true);
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);
  await click('#completeReaction');
  await click('#surveyBack');
  assert.equal(await evaluate('document.querySelector("#onboarding").open'), false);
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);
  await click('#completeReaction');
  for (let i = 0; i < 5; i++) await answer('unknown');
  assert.equal(await evaluate('document.querySelector("#surveyApply").checked'), false);
  await click('#surveySave');
  assert.deepEqual((await state()).profile, manual);
  assert.equal(await evaluate('document.querySelector("#reactionReminder").hidden'), true);
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);

  await seed();
  await click('#orientationQuickSurvey');
  await key('Escape', 27);
  assert.equal(await evaluate('document.querySelector("#onboarding").open'), false);
  assert.equal(await evaluate('document.querySelector("#orientation").open'), false);
  assert.equal((await state()).reactionAssessment, null);
  await seed();
  await click('#orientationExplore');
  console.log('Newcomer flow: questionnaire on welcome, keyboard/back, storage failure/retry, prediction application, skip without repeat, returning-user entry and preserved manual profile passed.');
}

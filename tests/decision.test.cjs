const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../model.js');
const profile = M.profileParameters('default');
const at = (time) => new Date('2026-11-12T' + time + ':00');
const now = at('14:00'), target = at('23:00');
const coffee = { k: 'coffee', brand: 'A', drink: 'Coffee', mg_min: 180, mg_max: 220 };
const light = { k: 'light', brand: 'A', drink: 'Light', mg_min: 10, mg_max: 20 };
const other = { ...light, k: 'other', brand: 'B', mg_min: 0, mg_max: 0 };
const dose = (beverage, time, cups = 1) => ({ beverage, cups, consumedAt: at(time).toISOString() });

test('future trial dose changes the decision but never becomes an actual record', () => {
  const records = [dose(light, '10:00'), dose(coffee, '22:00')];
  const draft = dose(coffee, '20:00');
  const before = JSON.stringify({ records, draft });
  const result = M.scenario(records, draft, target, profile, {}, now);
  const actual = M.predict(records, target, profile, {}, now);
  const baseline = M.scenario(records, null, target, profile, {}, now);
  assert.ok(result.remaining.mid > baseline.remaining.mid);
  assert.ok(result.sleep > baseline.sleep);
  assert.ok(result.prediction.clear > actual.clear);
  assert.deepEqual(baseline, M.scenario([records[0]], null, target, profile, {}, now));
  assert.equal(JSON.stringify({ records, draft }), before);
});

test('original, half, same-brand alternative and none compare against one baseline', () => {
  const records = [dose(coffee, '12:00')];
  const options = M.compare(records, dose(coffee, '19:00'), target, profile, light, {}, now);
  const [original, half, alternative, none] = options;
  assert.equal(options.length, 4);
  assert.ok(original.remaining.mid > half.remaining.mid);
  assert.ok(half.remaining.mid > alternative.remaining.mid);
  assert.ok(alternative.remaining.mid > none.remaining.mid);
  for (const option of options) assert.equal(+option.baselineSleep, +none.sleep);
  assert.equal(none.delayMinutes, 0);
  assert.ok(original.delayMinutes >= half.delayMinutes);
});

test('recommendations stay within brand, use upper caffeine bound, and respond to time and portion', () => {
  const catalog = [coffee, other, light];
  const early = M.recommend([], catalog, 'A', dose(coffee, '14:00'), target, profile, {}, now);
  const late = M.recommend([], catalog, 'A', dose(coffee, '21:00', 1.5), target, profile, {}, now);
  assert.deepEqual(early.map(r => r.beverage.k), ['light', 'coffee']);
  assert.equal(late.length, 2);
  assert.ok(late.find(r => r.beverage.k === 'coffee').targetDelayMinutes > early.find(r => r.beverage.k === 'coffee').targetDelayMinutes);
  assert.equal(late[0].fitsTarget, true);
  assert.deepEqual(M.recommend([], catalog, 'missing', dose(coffee, '14:00'), target, profile, {}, now), []);
  const uncertain = { ...coffee, mg_min: 0, mg_max: 100 };
  const result = M.scenario([], dose(uncertain, '22:00'), target, profile, {}, now);
  assert.equal(result.fitsTarget, false);
});

test('no-fit, zero caffeine, deleted records and prediction horizon are explicit', () => {
  const records = [{ ...dose(coffee, '13:00', 10), deletedAt: now.toISOString() }];
  const zero = M.scenario(records, dose(other, '14:00'), target, profile, {}, now);
  assert.equal(zero.remaining.mid, 0);
  assert.equal(zero.delayMinutes, 0);
  assert.equal(+zero.sleep, +target);
  const heavy = M.scenario([], dose(coffee, '22:00', 10), target, M.profileParameters('cautious'), {}, now);
  assert.equal(heavy.sleep, null);
  assert.equal(heavy.prediction.clear, null);
  assert.equal(heavy.delayMinutes, null);
  assert.equal(heavy.fitsTarget, false);
  const noFit = M.recommend([dose(coffee, '13:00', 10)], [coffee, light], 'A', dose(coffee, '22:00'), target, M.profileParameters('cautious'), {}, now);
  assert.ok(noFit.every(r => !r.fitsTarget));
});

test('after-midnight target and nap/profile assumptions carry into scenario comparison', () => {
  const midnight = new Date('2026-11-13T01:00:00');
  const draft = dose(coffee, '21:00');
  const nap = { enabled: true, start: '17:00', duration: 40 };
  const plain = M.scenario([], draft, midnight, profile, {}, now);
  const cautious = M.scenario([], draft, midnight, M.profileParameters('cautious'), nap, now);
  assert.ok(plain.sleep >= midnight);
  assert.ok(cautious.remaining.mid > plain.remaining.mid);
  assert.ok(cautious.prediction.napDelay > plain.prediction.napDelay);
  assert.ok(cautious.sleep === null || cautious.sleep > plain.sleep);
  assert.equal(cautious.prediction.end.getDate(), 13);
});

test('zero-caffeine drinks just before bed do not introduce a clearance delay', () => {
  const zero = dose(other, '22:55');
  const decision = M.scenario([], zero, target, profile, {}, now);
  assert.equal(decision.delayMinutes, 0);
  assert.equal(+decision.sleep, +target);
  assert.equal(+M.predict([zero], target, profile, {}, at('22:56')).clear,
    +M.predict([], target, profile, {}, at('22:56')).clear);
});

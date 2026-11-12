const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../reactions.js");
const S = require("../storage.js");
const M = require("../model.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assessment = (changes = {}) => ({
  version: 1,
  updatedAt: "2026-11-12T08:00:00.000Z",
  answers: {
    frequency: "weekly",
    timing: "afternoon",
    sleep: "sometimes",
    body: "unknown",
    goal: "sleep",
    ...changes,
  },
});
const memory = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  };
};
test("all survey questions accept uncertainty without a preselected answer", () => {
  assert.equal(R.questions.length, 5);
  for (const q of R.questions)
    assert.ok(q.options.some(([key]) => key === "unknown"));
  assert.ok(
    R.valid(
      assessment(
        Object.fromEntries(R.questions.map((q) => [q.key, "unknown"])),
      ),
    ),
  );
  assert.equal(R.valid({ version: 1, answers: {} }), false);
});
test("results describe reported observations, not metabolism or a sensitivity score", () => {
  const answers = assessment().answers,
    before = structuredClone(answers);
  const result = R.summarize(answers);
  assert.equal(result.reactions[0].value, "你偶尔注意到");
  assert.equal(result.reactions[1].value, "你还不确定");
  assert.equal(
    R.summarize({ sleep: "unknown", body: "unknown" }).title,
    "你的反应还有待观察",
  );
  assert.equal(
    R.summarize({ sleep: "none", body: "none" }).title,
    "你暂未注意到明显变化",
  );
  assert.equal(
    R.summarize({ sleep: "often", body: "often" }).reactions[1].value,
    "你经常注意到",
  );
  assert.equal(result.halfLife, undefined);
  assert.equal(result.score, undefined);
  assert.deepEqual(answers, before);
});
test("older data and skipped surveys retain an empty assessment", () => {
  const old = S.defaults();
  delete old.reactionAssessment;
  assert.equal(S.validate(old).reactionAssessment, null);
  assert.equal(S.defaults().reactionAssessment, null);
});
test("saving answers alone survives reload without changing prediction parameters", () => {
  const store = S.create(memory(), []),
    data = S.defaults(),
    profile = structuredClone(data.profile);
  data.reactionAssessment = assessment();
  assert.equal(store.save(data), true);
  assert.deepEqual(store.load().reactionAssessment, data.reactionAssessment);
  assert.deepEqual(store.load().profile, profile);
});
test("self-reported effects suggest an existing cautious scenario, never a fast phenotype", () => {
  for (const key of ["sleep", "body"])
    for (const value of ["sometimes", "often"])
      assert.equal(R.recommend(assessment({ sleep: "none", body: "none", [key]: value }).answers).preset, "cautious");
  for (const frequency of ["rarely", "weekly", "daily", "unknown"])
    for (const timing of ["morning", "afternoon", "evening", "varies", "unknown"])
      assert.equal(R.recommend(assessment({ frequency, timing, sleep: "none", body: "none" }).answers).preset, "default");
  assert.equal(R.recommend(assessment({ sleep: "unknown", body: "unknown" }).answers).preset, "default");
  assert.throws(() => R.recommend({}));
  assert.throws(() => R.recommend(assessment({ sleep: "invalid" }).answers));
});
test("suggested preset changes residuals, all three curves and cutoff without changing records", () => {
  const base = M.profileParameters("default");
  const suggested = M.profileParameters(R.recommend(assessment().answers).preset);
  const drink = { k: "test", mg: 100 };
  const records = [{ id: "test", beverage: drink, cups: 1, consumedAt: new Date(2026, 10, 12, 14).toISOString() }];
  const before = structuredClone(records);
  const target = new Date(2026, 10, 12, 23);
  const now = new Date(2026, 10, 12, 16);
  assert.ok(M.assess(records, target, suggested).remaining.mid > M.assess(records, target, base).remaining.mid);
  const first = M.predict(records, target, base, {}, now);
  const next = M.predict(records, target, suggested, {}, now);
  for (const key of ["concentration", "melatonin", "alertness"])
    assert.ok(next.samples.some((sample, i) => sample[key] !== first.samples[i][key]));
  assert.ok(M.cutoff([], drink, 1, target, suggested, now).at < M.cutoff([], drink, 1, target, base, now).at);
  assert.deepEqual(records, before);
});

const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function surveyHarness(mode = "default", apply = true, fail = false) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, { checked: false, focus() {} });
    return elements.get(id);
  };
  $("surveyApply").checked = apply;
  const data = S.defaults();
  data.profile.setupMode = mode;
  const calls = [];
  const scope = {
    $, data, R, M, S, surveyDraft: assessment().answers, surveyOnly: true, surveyContinuation: null,
    save: () => !fail,
    text: (id, value) => { $(id).textContent = value; },
    escape: (value) => value,
    showGuideStep() {},
    render: () => calls.push("render"),
    icons() {},
    finishSurvey: () => calls.push("finish"),
    toast: (value) => calls.push(value),
  };
  vm.createContext(scope);
  vm.runInContext(appSource.slice(appSource.indexOf('  $("surveySave").onclick'), appSource.indexOf('  $("skipGuide").onclick')), scope);
  vm.runInContext(appSource.slice(appSource.indexOf("  function surveyResult()"), appSource.indexOf("  function finishSurvey(")), scope);
  return { $, data, calls, result: scope.surveyResult, submit: () => $("surveySave").onclick() };
}
test("newcomers apply by default; manual and report profiles require explicit opt-in", () => {
  for (const mode of ["default", "cautious", "manual", "report"]) {
    const h = surveyHarness(mode);
    h.result();
    assert.equal(h.$("surveyApply").checked, !["manual", "report"].includes(mode));
  }
});
test("confirmation saves the recommended parameters and answers together and redraws", () => {
  const h = surveyHarness();
  const target = h.data.profile.targetBed;
  h.submit();
  assert.equal(h.data.profile.halfLife, 7.5);
  assert.equal(h.data.profile.threshold, 0.8);
  assert.equal(h.data.profile.targetBed, target);
  assert.match(h.data.profile.source, /自测建议/);
  assert.equal(h.data.reactionAssessment.answers.sleep, "sometimes");
  assert.deepEqual(h.data.records, []);
  const store = S.create(memory(), []);
  assert.equal(store.save(h.data), true);
  assert.equal(store.load().profile.source, h.data.profile.source);
  assert.deepEqual(h.calls.slice(0, 2), ["render", "finish"]);
});
test("answers-only confirmation preserves advanced parameters", () => {
  const h = surveyHarness("manual", false);
  const before = structuredClone(h.data.profile);
  h.submit();
  assert.deepEqual(h.data.profile, before);
  assert.ok(h.data.reactionAssessment);
});
test("failed save rolls back both answers and prediction parameters without closing", () => {
  const h = surveyHarness("default", true, true);
  const before = structuredClone(h.data);
  h.submit();
  assert.deepEqual(h.data, before);
  assert.equal(h.$("surveySaveError").hidden, false);
  assert.deepEqual(h.calls, []);
});
test("backup imports restore a missing assessment but preserve an existing local one", () => {
  const store = S.create(memory(), []),
    incoming = S.defaults(),
    current = S.defaults();
  incoming.reactionAssessment = assessment();
  const backup = { app: "caffnap", version: 2, data: incoming };
  assert.deepEqual(
    store.importBackup(backup, current).reactionAssessment,
    incoming.reactionAssessment,
  );
  current.reactionAssessment = assessment({ sleep: "none" });
  const merged = store.importBackup(backup, current);
  assert.deepEqual(merged.reactionAssessment, current.reactionAssessment);
  assert.deepEqual(
    store.importBackup(backup, merged).reactionAssessment,
    current.reactionAssessment,
  );
  assert.equal(S.defaults().reactionAssessment, null);
});
test("malformed assessments are rejected without replacing stored data", () => {
  const store = S.create(memory(), []),
    data = S.defaults();
  data.reactionAssessment = assessment();
  store.save(data);
  for (const invalid of [
    assessment({ sleep: "slow-metabolism" }),
    { ...assessment(), version: 2 },
    { ...assessment(), updatedAt: "invalid" },
    { ...assessment(), answers: [] },
  ]) {
    const bad = structuredClone(data);
    bad.reactionAssessment = invalid;
    assert.equal(store.save(bad), false);
    assert.deepEqual(store.load().reactionAssessment, data.reactionAssessment);
    assert.throws(() =>
      store.importBackup({ app: "caffnap", version: 2, data: bad }, data),
    );
  }
});

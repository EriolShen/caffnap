const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../tour.js");
const S = require("../storage.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
test("tour starts with a sleep goal and explains the five newcomer use cases", () => {
  assert.equal(T.steps.length, 5);
  assert.equal(new Set(T.steps.map((s) => s[0])).size, 5);
  for (const selector of [
    ".prediction-section",
    ".decision-band",
    ".nap-section",
    ".cutoff-section",
    ".sleep-goal",
  ])
    assert.ok(T.steps.some((s) => s[0] === selector));
  assert.equal(T.steps[0][0], ".sleep-goal");
  assert.match(T.steps.find((s) => s[0] === ".prediction-section")[2], /三张曲线/);
});
test("blank clicks advance; completion is distinguished from skipping; reduced motion is honored", () => {
  const calls = [];
  let config;
  global.matchMedia = () => ({ matches: true });
  global.driver = {
    js: {
      driver: (c) => {
        config = c;
        return { drive: () => calls.push("drive"), isActive: () => false };
      },
    },
  };
  const tour = T.create({
    prepare: () => calls.push("prepare"),
    onExit: (reason) => calls.push(reason),
    onDaily: () => calls.push("daily"),
  });
  assert.equal(tour.start(), true);
  assert.deepEqual(calls, ["prepare", "drive"]);
  assert.equal(config.animate, false);
  assert.equal(config.smoothScroll, false);
  assert.equal(config.disableActiveInteraction, true);
  assert.equal(config.overlayClickBehavior, "nextStep");
  assert.match(config.doneBtnText, /完成/);
  for (const reason of ["close", "escape", "overlay", "done"])
    config.onDestroyed(null, null, { reason });
  assert.equal(calls.includes("daily"), false);
  assert.deepEqual(calls.slice(-4), ["close", "escape", "overlay", "done"]);
  global.matchMedia = () => ({ matches: false });
  tour.start();
  assert.equal(config.animate, true);
  assert.equal(config.smoothScroll, true);
  delete global.driver;
  delete global.matchMedia;
});
test("a missing tour asset fails without starting another workflow", () => {
  const tour = T.create({
    prepare: () => assert.fail("must not prepare"),
    onExit() {},
    onDaily() {},
  });
  assert.equal(tour.start(), false);
  assert.equal(tour.isActive(), false);
});
test("tour preference persists separately from daily setup and user data", () => {
  let raw = null;
  const store = S.create(
    { getItem: () => raw, setItem: (_key, value) => (raw = value) },
    [],
  );
  const data = S.defaults(),
    profile = structuredClone(data.profile);
  data.featureTourSeen = true;
  assert.equal(store.save(data), true);
  assert.equal(store.load().featureTourSeen, true);
  assert.equal(store.load().onboarding, false);
  assert.deepEqual(store.load().profile, profile);
  assert.deepEqual(store.load().records, []);
  assert.equal(store.load().reactionAssessment, null);
  const old = S.defaults();
  delete old.featureTourSeen;
  assert.equal(S.validate(old).featureTourSeen, false);
  assert.throws(() => S.validate({ ...old, featureTourSeen: "yes" }));
});

const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function orientationHarness() {
  const elements = new Map(), pending = [];
  let config, starts = 0, saves = 0, focus;
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, open: false, events: {},
      setAttribute(name, value) { this[name] = value; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() { focus = id; },
      addEventListener(name, cb) { this.events[name] = cb; },
    });
    return elements.get(id);
  };
  const data = S.defaults();
  const scope = {
    $, data, blocked: false, featureTour: null,
    text: (id, value) => { $(id).textContent = value; },
    save: () => { saves++; return true; },
    toast() {}, showPage() {}, renderSurvey() {},
    queueMicrotask: (fn) => pending.push(fn),
    CaffNapTour: { create: (c) => {
      config = c;
      return { start: () => { starts++; return scope.canStart; } };
    } },
    canStart: true,
  };
  vm.createContext(scope);
  vm.runInContext(app.slice(app.indexOf("  let surveyOnly = false,"), app.indexOf("  function showGuideStep(")), scope);
  vm.runInContext(app.slice(app.indexOf("  function finishSurvey()"), app.indexOf("  function cancelGuide()")), scope);
  vm.runInContext(app.slice(app.indexOf("  featureTour = CaffNapTour.create("), app.indexOf('  $("startDaily").onclick')), scope);
  return {
    $, data, scope,
    startup: () => vm.runInContext(app.slice(app.lastIndexOf("  if (!data.onboarding"), app.lastIndexOf("})();")), scope),
    exit: (reason) => { config.onExit(reason); pending.splice(0).forEach((fn) => fn()); },
    get starts() { return starts; }, get saves() { return saves; }, get focus() { return focus; },
  };
}
test("first visit opens a welcome, not a tour or survey; returning users are left alone", () => {
  const h = orientationHarness();
  h.startup();
  assert.equal(h.$("orientation").open, true);
  assert.equal(h.$("orientationWelcome").hidden, false);
  assert.equal(h.$("orientationInvite").hidden, true);
  assert.equal(h.starts, 0);
  assert.equal(h.$("onboarding").open, false);
  for (const field of ["onboarding", "featureTourSeen"]) {
    const returning = orientationHarness();
    returning.data[field] = true;
    returning.startup();
    assert.equal(returning.$("orientation").open, false);
  }
  const blocked = orientationHarness();
  blocked.scope.blocked = true;
  blocked.startup();
  assert.equal(blocked.$("orientation").open, false);
});
test("exploring or closing remembers the welcome without changing health data", () => {
  for (const control of ["orientationClose", "orientationExplore", "orientationDefault", "escape"]) {
    const h = orientationHarness(), before = structuredClone(h.data);
    h.startup();
    if (control === "escape") h.$("orientation").events.cancel({ preventDefault() {} });
    else h.$(control).onclick();
    assert.equal(h.$("orientation").open, false);
    assert.equal(h.data.featureTourSeen, true);
    assert.deepEqual({ ...h.data, featureTourSeen: false }, before);
    assert.equal(h.focus, "guideAgain");
  }
});
test("only a completed tour offers an optional survey, and only when no assessment exists", () => {
  const h = orientationHarness();
  h.startup();
  h.$("orientationStart").onclick();
  assert.equal(h.starts, 1);
  assert.equal(h.$("orientation").open, false);
  h.exit("done");
  assert.equal(h.$("orientation").open, true);
  assert.equal(h.$("orientationInvite").hidden, false);
  assert.equal(h.$("onboarding").open, false);
  assert.equal(h.$("orientationDefault").textContent, "先用默认值");
  for (const reason of ["close", "escape", "overlay"]) {
    const skipped = orientationHarness();
    skipped.exit(reason);
    assert.equal(skipped.$("orientation").open, false);
  }
  const existing = orientationHarness();
  existing.data.reactionAssessment = { answers: {} };
  existing.exit("done");
  assert.equal(existing.$("orientation").open, false);
});
test("optional survey returns focus to a visible home control; advanced settings are not reset", () => {
  const h = orientationHarness();
  h.data.profile.setupMode = "manual";
  h.exit("done");
  assert.equal(h.$("orientationDefault").textContent, "保留当前设置");
  h.$("orientationSurvey").onclick();
  assert.equal(h.$("orientation").open, false);
  assert.equal(h.$("onboarding").open, true);
  h.scope.finishSurvey();
  assert.equal(h.$("onboarding").open, false);
  assert.equal(h.focus, "startDaily");
  assert.equal(h.data.profile.setupMode, "manual");
});
test("unavailable tour returns to the welcome without marking it seen", () => {
  const h = orientationHarness();
  h.scope.canStart = false;
  h.startup();
  h.$("orientationStart").onclick();
  assert.equal(h.$("orientation").open, true);
  assert.equal(h.data.featureTourSeen, false);
});

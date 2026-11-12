const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../model.js");
const S = require("../storage.js");
const drink = {
  k: "coffee",
  drink: "Coffee",
  brand: "Test",
  mg_min: 90,
  mg_max: 110,
};
const profile = S.defaults().profile;
test("plain-language presets do not assign a genotype", () => {
  const defaults = M.profileParameters("default"),
    cautious = M.profileParameters("cautious");
  assert.equal(defaults.halfLife, 4.5);
  assert.equal(defaults.threshold, 1);
  assert.ok(cautious.halfLife > defaults.halfLife);
  assert.ok(cautious.threshold < defaults.threshold);
  assert.equal(cautious.geno, undefined);
  assert.equal(cautious.setupMode, "cautious");
  assert.throws(() => M.profileParameters("invalid"));
});
test("report choices apply the legacy mappings and support partial reports", () => {
  const genes = {
    cyp: { g: "CC" },
    ahr: { g: "TT" },
    abcg2: { g: "GG" },
    ador: { g: "CC" },
    per1: { g: "AA" },
  };
  const p = M.profileParameters("report", genes);
  assert.equal(p.halfLife, 7.5 * 1.1 * 1.05);
  assert.equal(p.threshold, 0.8);
  assert.equal(p.dlmoOffset, -60);
  assert.equal(
    M.profileParameters("report", { per1: { g: "GG" } }).dlmoOffset,
    60,
  );
  assert.equal(M.profileParameters("report", {}).halfLife, 4.5);
});
const record = {
  id: "r1",
  beverage: drink,
  cups: 1,
  consumedAt: "2026-11-10T23:00:00Z",
  updatedAt: "2026-11-10T23:00:00Z",
};
const memory = (initial = {}) => {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, v),
  };
};
test("residual halves after a half-life, including across midnight", () => {
  const r = M.residual([record], "2026-11-11T03:30:00Z", 4.5);
  assert.deepEqual(r, { low: 45, high: 55, mid: 50 });
});
test("future and deleted records do not count", () => {
  assert.equal(M.residual([record], "2026-11-10T22:00:00Z").mid, 0);
  assert.equal(
    M.residual(
      [{ ...record, deletedAt: "2026-11-11T00:00:00Z" }],
      "2026-11-11T03:30:00Z",
    ).mid,
    0,
  );
});
test("comparison is pure, cumulative, and orders reduced portions correctly", () => {
  const records = [structuredClone(record)],
    before = JSON.stringify(records);
  const draft = {
    beverage: drink,
    cups: 1,
    consumedAt: "2026-11-11T01:00:00Z",
  };
  const options = M.compare(records, draft, "2026-11-11T05:00:00Z", profile, {
    k: "low",
    drink: "Low",
    mg: 5,
  });
  assert.equal(JSON.stringify(records), before);
  assert.equal(records.length, 1);
  const [original, half, low, none] = options;
  assert.ok(original.remaining.mid > half.remaining.mid);
  assert.ok(half.remaining.mid > low.remaining.mid);
  assert.ok(low.remaining.mid > none.remaining.mid);
  assert.ok(none.remaining.mid > 0);
  assert.equal(
    none.remaining.mid,
    M.residual(records, "2026-11-11T05:00:00Z").mid,
  );
});
test("sleep target advances to the next calendar day when already passed", () => {
  const now = new Date(2026, 10, 11, 23, 30);
  const target = M.targetDate("23:00", now);
  assert.equal(S.dayKey(target), "2026-11-12");
  assert.equal(target.getHours(), 23);
  assert.equal(S.dayKey(M.targetDate("01:00", now)), "2026-11-12");
});
test("fresh storage contains no demo records or invented genotype", () => {
  const data = S.create(memory(), [drink]).load();
  assert.equal(data.records.length, 0);
  assert.equal(data.onboarding, false);
  assert.equal(data.profile.source, "默认估算参数");
});
test("legacy today overrides its duplicate history and snapshots drinks", () => {
  const legacy = {
    today: {
      day: new Date(2026, 10, 11).toDateString(),
      doses: [{ bev: "coffee", cups: 1, time: "09:00" }],
      targetBed: "23:30",
    },
    history: {
      "2026-11-11": { doses: [{ bev: "coffee", cups: 2, time: "09:00" }] },
    },
  };
  const data = S.migrate(legacy, [drink]);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].cups, 1);
  assert.notEqual(data.records[0].beverage, drink);
  assert.equal(data.profile.targetBed, "23:30");
  assert.equal(data.onboarding, true);
});
test("empty legacy today preserves deliberate deletion", () => {
  const data = S.migrate(
    {
      today: { day: new Date(2026, 10, 11).toDateString(), doses: [] },
      history: {
        "2026-11-11": { doses: [{ bev: "coffee", cups: 1, time: "09:00" }] },
      },
    },
    [drink],
  );
  assert.equal(data.records.length, 0);
});
test("legacy sleep and calibration are retained without automatic calibration", () => {
  const legacy = {
    sleep: { "2026-11-10": { bed: "23:30", wake: "07:00" } },
    calib: { offset: 2, nights: 3 },
  };
  const data = S.migrate(legacy, [drink]);
  assert.equal(data.profile.halfLife, 4.5);
  assert.equal(data.legacy.calib.offset, 2);
  assert.equal(data.sleep["2026-11-10"].bed, "23:30");
});
test("backup import is idempotent and preserves local profile", () => {
  const store = S.create(memory(), [drink]),
    data = S.defaults();
  data.onboarding = true;
  data.profile.targetBed = "00:30";
  const incoming = S.defaults();
  incoming.records.push(record);
  const backup = { app: "caffnap", version: 2, data: incoming };
  const once = store.importBackup(backup, data),
    twice = store.importBackup(backup, once);
  assert.equal(twice.records.length, 1);
  assert.equal(twice.profile.targetBed, "00:30");
  assert.equal(data.records.length, 0);
});
test("updated deletions survive importing an older backup", () => {
  const data = S.defaults();
  data.records = [
    {
      ...record,
      deletedAt: "2026-11-12T00:00:00Z",
      updatedAt: "2026-11-12T00:00:00Z",
    },
  ];
  const old = S.defaults();
  old.records = [record];
  const result = S.create(memory(), [drink]).importBackup(
    { app: "caffnap", version: 2, data: old },
    data,
  );
  assert.ok(result.records[0].deletedAt);
});
test("malformed backup is rejected without mutating current state", () => {
  const store = S.create(memory(), [drink]),
    data = S.defaults(),
    bad = S.defaults();
  bad.records = [{ ...record, cups: -1 }];
  assert.throws(() =>
    store.importBackup({ app: "caffnap", version: 2, data: bad }, data),
  );
  assert.equal(data.records.length, 0);
  bad.records = [];
  bad.recent = {};
  assert.throws(() => S.validate(bad));
});
test("corrupt local JSON blocks loading and leaves original bytes intact", () => {
  const adapter = memory({ [S.KEY]: "{broken" }),
    store = S.create(adapter, [drink]);
  assert.equal(store.load(), null);
  assert.ok(store.error);
  assert.equal(adapter.getItem(S.KEY), "{broken");
});
test("quota errors return failure, not a false saved state", () => {
  const store = S.create(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    },
    [drink],
  );
  assert.equal(store.save(S.defaults()), false);
  assert.ok(store.error);
});
test("deleting a custom catalog entry does not change historical quantities", () => {
  const data = S.defaults();
  data.records = [structuredClone(record)];
  data.custom = [drink];
  data.custom = [];
  assert.equal(M.caffeine(data.records[0].beverage).mid, 100);
});
const local = (time, day = 11) =>
  new Date(2026, 10, day, ...time.split(":").map(Number));
const actual = (time, mg = 200, day = 11) => ({
  ...record,
  beverage: { k: "test", drink: "Test", mg },
  consumedAt: local(time, day).toISOString(),
});
test("melatonin uses hours and remains continuous over midnight", () => {
  assert.equal(M.melatoninShape(0), 10);
  assert.equal(M.melatoninShape(2), 60);
  assert.equal(M.melatoninShape(4), 100);
  assert.equal(M.melatoninShape(-1), 5);
  assert.equal(M.melatoninShape(24), 10);
  const p = M.predict([], local("23:00"), profile, {}, local("23:00"));
  assert.equal(p.sleep.getHours(), 21);
  assert.equal(p.delay, 0);
  assert.equal(p.hasRecords, false);
  const midnight = p.samples.find((s) => s.at === +local("00:00", 12));
  assert.equal(midnight.natural, 80);
  assert.ok(p.samples.length > 300);
});
test("evening caffeine delays the correct night, not doses from yesterday", () => {
  const p = M.predict(
    [actual("19:00")],
    local("23:00"),
    profile,
    {},
    local("23:00"),
  );
  assert.equal(p.delay, 40);
  assert.ok(p.sleep > local("00:00", 12));
  assert.ok(p.melRise > p.dlmo);
  assert.equal(
    M.predict(
      [actual("19:00", 200, 10)],
      local("23:00"),
      profile,
      {},
      local("23:00"),
    ).delay,
    0,
  );
  const future = M.predict(
    [actual("19:00")],
    local("23:00"),
    profile,
    {},
    local("18:00"),
  );
  assert.equal(future.hasRecords, false);
  assert.equal(future.delay, 0);
});
test("PER1 offset and late nap independently affect the prediction", () => {
  const base = M.predict([], local("23:00"), profile);
  const shifted = M.predict([], local("23:00"), { ...profile, dlmoOffset: 60 });
  assert.equal(shifted.sleep - base.sleep, 3600000);
  const nap = M.predict([], local("23:00"), profile, {
    enabled: true,
    start: "16:00",
    duration: 30,
    wake: "07:00",
  });
  assert.equal(nap.napDelay, 45);
  assert.equal(nap.sleep - base.sleep, 45 * 60000);
  assert.ok(
    nap.samples.find((s) => s.at === +local("17:00")).alertness >
      base.samples.find((s) => s.at === +local("17:00")).alertness,
  );
  assert.equal(
    M.predict([], local("23:00"), profile, {
      enabled: true,
      start: "14:10",
      duration: 20,
    }).napDelay,
    0,
  );
});
test("after-midnight goals attach to the preceding evening", () => {
  const p = M.predict([], local("01:00", 12), profile);
  assert.equal(S.dayKey(p.dlmo), "2026-11-11");
  assert.equal(S.dayKey(p.end), "2026-11-12");
});
test("cutoff is cumulative, respects the upper dose range, and never adds a record", () => {
  const records = [actual("09:00", 100)],
    before = JSON.stringify(records);
  const empty = M.cutoff([], drink, 1, local("23:00"), profile, local("10:00"));
  const cumulative = M.cutoff(
    records,
    drink,
    1,
    local("23:00"),
    profile,
    local("10:00"),
  );
  assert.ok(cumulative.at < empty.at);
  const less = M.cutoff(
    records,
    drink,
    0.5,
    local("23:00"),
    profile,
    local("10:00"),
  );
  assert.ok(less.at > cumulative.at);
  assert.equal(JSON.stringify(records), before);
  const proposed = {
    ...record,
    beverage: drink,
    cups: 1,
    consumedAt: cumulative.at.toISOString(),
  };
  assert.ok(
    (M.residual([...records, proposed], local("23:00"), profile.halfLife).high /
      42) *
      1.15 <=
      profile.threshold,
  );
});
test("cutoff distinguishes zero caffeine, no room, and a passed cutoff across dates", () => {
  const zero = M.cutoff(
    [],
    { mg: 0 },
    1,
    local("23:00"),
    profile,
    local("20:00"),
  );
  assert.equal(zero.status, "no-caffeine");
  const noRoom = M.cutoff(
    [actual("20:00", 400)],
    drink,
    1,
    local("23:00"),
    profile,
    local("21:00"),
  );
  assert.equal(noRoom.status, "no-room");
  const past = M.cutoff(
    [],
    drink,
    1,
    local("01:00", 12),
    profile,
    local("23:00"),
  );
  assert.equal(past.status, "passed");
  assert.equal(S.dayKey(past.at), "2026-11-11");
});
test("nap settings migrate, persist and survive backup import without overwriting local days", () => {
  const data = S.migrate(
    {
      today: {
        day: local("12:00").toDateString(),
        napOn: true,
        napT: "16:00",
        napD: 30,
        wakeT: "08:00",
      },
      geno: { per1: { g: "GG" } },
    },
    [],
  );
  assert.deepEqual(data.naps["2026-11-11"], {
    enabled: true,
    start: "16:00",
    duration: 30,
    wake: "08:00",
  });
  assert.equal(data.profile.dlmoOffset, 60);
  const store = S.create(memory(), []);
  assert.ok(store.save(data));
  assert.deepEqual(store.load().naps, data.naps);
  const oldV2 = S.defaults();
  delete oldV2.naps;
  delete oldV2.profile.dlmoOffset;
  assert.deepEqual(S.validate(oldV2).naps, {});
  assert.equal(oldV2.profile.dlmoOffset, 0);
  const merged = store.importBackup(
    { app: "caffnap", version: 2, data },
    oldV2,
  );
  assert.equal(merged.naps["2026-11-11"].duration, 30);
  const bad = S.defaults();
  bad.naps["2026-11-11"] = {
    enabled: true,
    start: "25:00",
    duration: -5,
    wake: "07:00",
  };
  assert.throws(() => S.validate(bad));
  bad.naps = {};
  bad.profile.dlmoOffset = "60";
  assert.throws(() => S.validate(bad));
});
test("profile setup mode persists and older manually configured v2 data stays manual", () => {
  const old = S.defaults();
  delete old.profile.setupMode;
  old.profile.source = "手动设置的估算参数";
  old.profile.halfLife = 6;
  assert.equal(S.validate(old).profile.setupMode, "manual");
  const store = S.create(memory(), []);
  const data = S.defaults();
  data.profile = { ...data.profile, ...M.profileParameters("cautious") };
  assert.equal(store.save(data), true);
  assert.equal(store.load().profile.setupMode, "cautious");
});

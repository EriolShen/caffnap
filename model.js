/* Pure calculations. No browser, storage or platform dependencies. */
(function (root) {
  "use strict";
  function caffeine(b) {
    const low = Number(b.mg_min ?? b.mg ?? 0),
      high = Number(b.mg_max ?? b.mg ?? low);
    return { low, high, mid: (low + high) / 2 };
  }
  function residual(records, at, halfLife = 4.5) {
    if (!(halfLife >= 2 && halfLife <= 15))
      throw new Error("Invalid half-life");
    const total = { low: 0, high: 0, mid: 0 };
    for (const r of records) {
      const elapsed = (new Date(at) - new Date(r.consumedAt)) / 3600000;
      if (r.deletedAt || elapsed < 0 || !Number.isFinite(elapsed)) continue;
      const dose = caffeine(r.beverage);
      for (const key of Object.keys(total))
        total[key] += dose[key] * r.cups * 2 ** (-elapsed / halfLife);
    }
    return total;
  }
  function targetDate(time, now = new Date()) {
    const target = new Date(now),
      [h, m] = time.split(":").map(Number);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }
  function assess(records, target, profile) {
    const remaining = residual(records, target, profile.halfLife);
    const concentration = (remaining.mid / 42) * 1.15;
    return {
      remaining,
      aboveThreshold: concentration > profile.threshold,
      concentration,
    };
  }
  function profileParameters(mode, genes = {}) {
    if (mode === "default")
      return {
        halfLife: 4.5,
        threshold: 1,
        dlmoOffset: 0,
        source: "默认估算参数",
        setupMode: mode,
      };
    if (mode === "cautious")
      return {
        halfLife: 7.5,
        threshold: 0.8,
        dlmoOffset: 0,
        source: "保守估算情景（非个人测定）",
        setupMode: mode,
      };
    if (mode !== "report") throw new Error("未知档案类型");
    return {
      halfLife:
        ({ AA: 3.2, AC: 4.5, CC: 7.5 }[genes.cyp?.g] || 4.5) *
        ({ TT: 1.1, GT: 1, GG: 0.9 }[genes.ahr?.g] || 1) *
        ({ AA: 0.95, AG: 1, GG: 1.05 }[genes.abcg2?.g] || 1),
      threshold: { TT: 1.3, CT: 1, CC: 0.8 }[genes.ador?.g] || 1,
      dlmoOffset: { AA: -60, AG: 0, GG: 60 }[genes.per1?.g] || 0,
      source: "基因报告映射（探索性参数）",
      setupMode: mode,
    };
  }
  function compare(records, draft, target, profile, alternative, nap = {}, now = new Date()) {
    const baseline = scenario(records, null, target, profile, nap, now);
    const options = [
      {
        id: "original",
        title: "按当前选择",
        beverage: draft.beverage,
        cups: draft.cups,
      },
    ];
    if (draft.cups >= 0.02)
      options.push({
        id: "half",
        title: "减少一半",
        beverage: draft.beverage,
        cups: draft.cups / 2,
      });
    if (alternative)
      options.push({
        id: "alternative",
        title: "换低因选项",
        beverage: alternative,
        cups: draft.cups,
      });
    options.push({ id: "none", title: "这次先不喝", beverage: null, cups: 0 });
    return options.map((o) => ({
      ...o,
      ...scenario(
        records,
        o.beverage ? { ...draft, beverage: o.beverage, cups: o.cups } : null,
        target,
        profile,
        nap,
        now,
        baseline,
      ),
    }));
  }
  const MINUTE = 60000,
    HOUR = 60 * MINUTE;
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  function atTime(day, time) {
    const date = new Date(day),
      [h, m] = time.split(":").map(Number);
    date.setHours(h, m, 0, 0);
    return date;
  }
  function eveningFor(target) {
    const date = new Date(target);
    if (date.getHours() < 12) date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  // Original exploratory shape, with relative time explicitly measured in hours.
  function melatoninShape(hours) {
    const h = ((((hours + 12) % 24) + 24) % 24) - 12;
    if (h < -1 || h >= 8) return 5;
    if (h < 0) return 10 + h * 5;
    if (h < 2) return 10 + h * 25;
    if (h < 4) return 60 + (h - 2) * 20;
    return 100 - (h - 4) * 22.5;
  }
  const CIRC = [
    [0, 45],
    [4, 33],
    [6, 45],
    [7, 72],
    [9, 88],
    [12, 85],
    [14, 78],
    [15.5, 65],
    [17, 80],
    [19, 78],
    [21, 68],
    [22.5, 58],
    [24, 45],
  ];
  function circadian(at) {
    const date = new Date(at),
      h = date.getHours() + date.getMinutes() / 60;
    for (let i = 1; i < CIRC.length; i++) {
      const [t0, v0] = CIRC[i - 1],
        [t1, v1] = CIRC[i];
      if (h <= t1) return v0 + ((v1 - v0) * (h - t0)) / (t1 - t0);
    }
    return 45;
  }
  function predict(records, target, profile, nap = {}, now = new Date()) {
    return predictDoses(records.filter(
      (r) => !r.deletedAt && Date.parse(r.consumedAt) <= +now,
    ), target, profile, nap);
  }
  function predictDoses(doses, target, profile, nap = {}, includeSamples = true) {
    const evening = eveningFor(target),
      start = atTime(evening, "06:00");
    const end = atTime(evening, "12:00");
    end.setDate(end.getDate() + 1);
    const concentration = (at) =>
      (residual(doses, at, profile.halfLife).mid / 42) * 1.15;
    const dlmo = new Date(
      +atTime(evening, "21:00") + (profile.dlmoOffset || 0) * MINUTE,
    );
    const delay = Math.min(
      180,
      doses.reduce((sum, r) => {
        const phase = (new Date(r.consumedAt) - dlmo) / MINUTE;
        return (
          sum +
          (phase >= -300 && phase <= 120
            ? (caffeine(r.beverage).mid * r.cups) / 5
            : 0)
        );
      }, 0),
    );
    const shifted = new Date(+dlmo + delay * MINUTE);
    const natural = (at) => melatoninShape((at - dlmo) / HOUR);
    const melatonin = (at) =>
      melatoninShape((at - shifted) / HOUR) *
      (1 - 0.3 * Math.min(1, concentration(at) / profile.threshold));
    const napStart = nap.enabled ? atTime(evening, nap.start || "14:10") : null;
    const duration = nap.duration || 20;
    const napEnd = napStart ? new Date(+napStart + duration * MINUTE) : null;
    const napDelay = napEnd
      ? clamp(((napEnd - atTime(evening, "15:00")) / HOUR) * duration, 0, 90)
      : 0;
    const wake = atTime(evening, nap.wake || "07:00");
    function alertness(at) {
      const pressure = clamp(((at - wake) / HOUR) * 4, 0, 90);
      const afterNap = napEnd && at >= napEnd ? duration * 1.2 : 0;
      return clamp(
        circadian(at) +
          28 * Math.min(1, concentration(at) / profile.threshold) -
          0.35 * Math.max(0, pressure - afterNap),
        5,
        100,
      );
    }
    let clear = null,
      melRise = null;
    const last = Math.max(
      +atTime(evening, "12:00"),
      ...doses.filter((r) => caffeine(r.beverage).mid * r.cups > 0)
        .map((r) => Date.parse(r.consumedAt) + 30 * MINUTE),
    );
    for (let t = last; t <= +end; t += 2 * MINUTE) {
      if (concentration(t) <= profile.threshold) {
        clear = new Date(t);
        break;
      }
    }
    for (let t = +dlmo - HOUR; t <= +end; t += 2 * MINUTE) {
      if (melatonin(t) >= 10) {
        melRise = new Date(t);
        break;
      }
    }
    const sleep =
      clear && melRise
        ? new Date(Math.max(+clear, +melRise) + napDelay * MINUTE)
        : null;
    const samples = [];
    for (let t = +start; includeSamples && t <= +end; t += 5 * MINUTE)
      samples.push({
        at: t,
        concentration: concentration(t),
        natural: natural(t),
        melatonin: melatonin(t),
        circadian: circadian(t),
        alertness: alertness(t),
      });
    return {
      start,
      end,
      dlmo,
      shifted,
      delay,
      napStart,
      napEnd,
      napDelay,
      clear,
      melRise,
      sleep: sleep && sleep <= end ? sleep : null,
      samples,
      hasRecords: doses.length > 0,
    };
  }
  // A planned dose is explicit, never smuggled in by moving the actual-record clock.
  function scenario(records, draft, target, profile, nap = {}, now = new Date(), baseline = null) {
    const actual = records.filter(
      (r) => !r.deletedAt && Date.parse(r.consumedAt) <= +now,
    );
    const doses = draft ? [...actual, draft] : actual;
    const prediction = predictDoses(doses, target, profile, nap, false);
    const assessment = assess(doses, target, profile);
    // Decision estimates assume the user goes to bed at their selected target.
    const sleep = prediction.sleep ? new Date(Math.max(+new Date(target), +prediction.sleep)) : null;
    const base = baseline || (draft ? scenario(actual, null, target, profile, nap, now) : null);
    return {
      ...assessment,
      prediction,
      sleep,
      baselineSleep: base ? base.sleep : sleep,
      delayMinutes: sleep && (base ? base.sleep : sleep)
        ? Math.max(0, Math.round((sleep - (base ? base.sleep : sleep)) / MINUTE)) : null,
      targetDelayMinutes: sleep ? Math.max(0, Math.round((sleep - new Date(target)) / MINUTE)) : null,
      fitsTarget: !!sleep && sleep <= new Date(target) &&
        (assessment.remaining.high / 42) * 1.15 <= profile.threshold,
    };
  }
  function recommend(records, catalog, brand, draft, target, profile, nap = {}, now = new Date()) {
    const baseline = scenario(records, null, target, profile, nap, now);
    return catalog.filter((b) => (b.brand || "自定义") === brand).map((beverage) => ({
      beverage,
      ...scenario(records, { ...draft, beverage }, target, profile, nap, now, baseline),
    })).sort((a, b) => Number(b.fitsTarget) - Number(a.fitsTarget) ||
      (a.sleep ? +a.sleep : Infinity) - (b.sleep ? +b.sleep : Infinity) ||
      a.remaining.high - b.remaining.high || String(a.beverage.k).localeCompare(String(b.beverage.k)));
  }
  function cutoff(records, beverage, cups, target, profile, now = new Date()) {
    const actual = records.filter(
      (r) => !r.deletedAt && Date.parse(r.consumedAt) <= +now,
    );
    const baseline =
      (residual(actual, target, profile.halfLife).high / 42) * 1.15;
    const added = ((caffeine(beverage).high * cups) / 42) * 1.15;
    if (added === 0) return { status: "no-caffeine", at: null, baseline };
    const room = profile.threshold - baseline;
    if (room <= 0) return { status: "no-room", at: null, baseline };
    // Reserve 30 minutes beyond the decay calculation, matching the old cutoff margin.
    const hours = Math.max(0, profile.halfLife * Math.log2(added / room));
    const at = new Date(+target - hours * HOUR - 30 * MINUTE);
    return { status: at < now ? "passed" : "available", at, baseline };
  }
  const api = {
    caffeine,
    residual,
    targetDate,
    assess,
    compare,
    scenario,
    recommend,
    predict,
    cutoff,
    atTime,
    eveningFor,
    melatoninShape,
    profileParameters,
  };
  root.CaffNapModel = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

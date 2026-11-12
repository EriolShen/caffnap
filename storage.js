/* Persistence boundary; legacy keys are read but never overwritten. */
(function (root) {
  "use strict";
  const R =
    root.CaffNapReactions ||
    (typeof require === "function" ? require("./reactions.js") : null);
  const KEY = "caffnap_workspace_v2";
  const defaults = () => ({
    version: 2,
    profile: {
      targetBed: "23:00",
      halfLife: 4.5,
      threshold: 1,
      source: "默认估算参数",
      dlmoOffset: 0,
      setupMode: "default",
    },
    onboarding: false,
    featureTourSeen: false,
    reactionAssessment: null,
    records: [],
    sleep: {},
    naps: {},
    custom: [],
    recent: [],
    legacy: {},
    updatedAt: null,
  });
  const dayKey = (date) => {
    const d = new Date(date),
      pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const uid = () =>
    root.crypto?.randomUUID?.() ||
    `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const validTime = (s) =>
    typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const validDay = (s) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    dayKey(new Date(s + "T12:00:00")) === s;
  function validBev(b) {
    return (
      b &&
      typeof b.k === "string" &&
      typeof (b.drink ?? b.label) === "string" &&
      [b.mg_min ?? b.mg, b.mg_max ?? b.mg].every(
        (n) =>
          typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 2000,
      ) &&
      (b.mg_min ?? b.mg) <= (b.mg_max ?? b.mg)
    );
  }
  function validRecord(r) {
    return (
      r &&
      typeof r.id === "string" &&
      validBev(r.beverage) &&
      Number.isFinite(Date.parse(r.consumedAt)) &&
      typeof r.cups === "number" &&
      r.cups > 0 &&
      r.cups <= 10 &&
      (!r.deletedAt || Number.isFinite(Date.parse(r.deletedAt)))
    );
  }
  function validate(data) {
    if (
      !data ||
      data.version !== 2 ||
      !Array.isArray(data.records) ||
      !data.records.every(validRecord) ||
      !Array.isArray(data.custom) ||
      !data.custom.every(validBev) ||
      !validTime(data.profile?.targetBed) ||
      typeof data.profile.halfLife !== "number" ||
      typeof data.profile.threshold !== "number" ||
      typeof data.profile.source !== "string" ||
      !(data.profile.halfLife >= 2 && data.profile.halfLife <= 15) ||
      !(data.profile.threshold >= 0.1 && data.profile.threshold <= 5) ||
      !Array.isArray(data.recent) ||
      !data.recent.every((k) => typeof k === "string") ||
      !data.legacy ||
      typeof data.legacy !== "object" ||
      !data.sleep ||
      typeof data.sleep !== "object" ||
      !Object.entries(data.sleep).every(
        ([date, s]) =>
          validDay(date) && s && validTime(s.bed) && validTime(s.wake),
      )
    )
      throw new Error("备份包含无效数据，未导入。");
    if (
      data.profile.dlmoOffset !== undefined &&
      !(
        typeof data.profile.dlmoOffset === "number" &&
        Math.abs(data.profile.dlmoOffset) <= 180
      )
    )
      throw new Error("生物钟偏移参数无效。");
    if (
      data.naps !== undefined &&
      (!data.naps ||
        Array.isArray(data.naps) ||
        typeof data.naps !== "object" ||
        !Object.entries(data.naps).every(
          ([day, n]) =>
            validDay(day) &&
            n &&
            typeof n.enabled === "boolean" &&
            validTime(n.start) &&
            validTime(n.wake) &&
            Number.isInteger(n.duration) &&
            n.duration >= 5 &&
            n.duration <= 120,
        ))
    )
      throw new Error("小睡数据无效。");
    data.naps ||= {};
    if (
      data.featureTourSeen !== undefined &&
      typeof data.featureTourSeen !== "boolean"
    )
      throw new Error("功能导览状态无效。");
    data.featureTourSeen ??= false;
    if (data.reactionAssessment != null && !R.valid(data.reactionAssessment))
      throw new Error("饮用反应档案无效。");
    data.reactionAssessment ??= null;
    data.profile.dlmoOffset ??=
      { AA: -60, AG: 0, GG: 60 }[data.legacy.geno?.per1?.g] || 0;
    data.profile.setupMode ??= data.profile.source.includes("基因")
      ? "report"
      : data.profile.source === "默认估算参数"
        ? "default"
        : "manual";
    if (
      !["default", "cautious", "report", "manual"].includes(
        data.profile.setupMode,
      )
    )
      throw new Error("档案估算方式无效。");
    return data;
  }
  function migrate(legacy, catalog) {
    const data = defaults();
    data.legacy = legacy;
    data.custom = (Array.isArray(legacy.custom) ? legacy.custom : []).filter(
      validBev,
    );
    const drinks = [...catalog, ...data.custom],
      history = { ...(legacy.history || {}) };
    if (legacy.today?.day && Array.isArray(legacy.today.doses)) {
      const date = new Date(legacy.today.day);
      if (Number.isFinite(+date))
        history[dayKey(date)] = { doses: legacy.today.doses };
    }
    for (const [date, entry] of Object.entries(history)) {
      if (!validDay(date) || !Array.isArray(entry?.doses)) continue;
      entry.doses.forEach((dose, i) => {
        const beverage = drinks.find((b) => b.k === dose.bev);
        if (!beverage || !validTime(dose.time)) return;
        const consumedAt = new Date(`${date}T${dose.time}:00`).toISOString();
        const record = {
          id: `legacy-${date}-${i}-${dose.bev}`,
          beverage: { ...beverage },
          cups: Number(dose.cups),
          consumedAt,
          createdAt: consumedAt,
          updatedAt: consumedAt,
          source: "legacy",
        };
        if (validRecord(record)) data.records.push(record);
      });
    }
    for (const [date, s] of Object.entries(legacy.sleep || {}))
      if (validDay(date) && validTime(s?.bed) && validTime(s?.wake))
        data.sleep[date] = { ...s };
    if (validTime(legacy.today?.targetBed))
      data.profile.targetBed = legacy.today.targetBed;
    const previousDay = legacy.today?.day && new Date(legacy.today.day);
    if (previousDay && Number.isFinite(+previousDay)) {
      const duration = Number(legacy.today.napD);
      data.naps[dayKey(previousDay)] = {
        enabled: legacy.today.napOn === true,
        start: validTime(legacy.today.napT) ? legacy.today.napT : "14:10",
        duration:
          Number.isInteger(duration) && duration >= 5 && duration <= 120
            ? duration
            : 20,
        wake: validTime(legacy.today.wakeT) ? legacy.today.wakeT : "07:00",
      };
    }
    data.profile.dlmoOffset =
      { AA: -60, AG: 0, GG: 60 }[legacy.geno?.per1?.g] || 0;
    const genotype = legacy.geno?.cyp?.g;
    if (["AA", "AC", "CC"].includes(genotype)) {
      data.profile.halfLife = { AA: 3.2, AC: 4.5, CC: 7.5 }[genotype];
      data.profile.halfLife *=
        { TT: 1.1, GT: 1, GG: 0.9 }[legacy.geno?.ahr?.g] || 1;
      data.profile.halfLife *=
        { AA: 0.95, AG: 1, GG: 1.05 }[legacy.geno?.abcg2?.g] || 1;
      data.profile.threshold =
        { TT: 1.3, CT: 1, CC: 0.8 }[legacy.geno?.ador?.g] || 1;
      data.profile.source = "已导入基因档案的旧版估算参数";
      data.profile.setupMode = "report";
    }
    data.onboarding = !!(
      legacy.today ||
      data.records.length ||
      Object.keys(data.sleep).length
    );
    data.recent = [
      ...new Set(
        data.records
          .slice()
          .reverse()
          .map((r) => r.beverage.k),
      ),
    ].slice(0, 6);
    return data;
  }
  function create(adapter, catalog) {
    let lastError = null;
    function read(key, fallback) {
      try {
        const text = adapter.getItem(key);
        return text === null ? fallback : JSON.parse(text);
      } catch (error) {
        lastError = error;
        return fallback;
      }
    }
    function load() {
      try {
        const raw = adapter.getItem(KEY);
        if (raw !== null) return validate(JSON.parse(raw));
      } catch (error) {
        lastError = error;
        return null;
      }
      return migrate(
        {
          today: read("caffnap_v1", null),
          history: read("caffnap_history_v2", {}),
          sleep: read("caffnap_sleep_v1", {}),
          custom: read("caffnap_custom_bevs_v1", []),
          geno: read("caffnap_geno_v1", null),
          calib: read("caffnap_calib_v1", null),
        },
        catalog,
      );
    }
    function save(data) {
      try {
        validate(data);
        data.updatedAt = new Date().toISOString();
        adapter.setItem(KEY, JSON.stringify(data));
        lastError = null;
        return true;
      } catch (error) {
        lastError = error;
        return false;
      }
    }
    function importBackup(input, current) {
      if (input?.app !== "caffnap")
        throw new Error("这不是 CaffNap 备份文件。");
      const incoming =
        input.version === 2
          ? validate(input.data)
          : input.version === "1.2"
            ? migrate(input, catalog)
            : null;
      if (!incoming) throw new Error("暂不支持这个备份版本。");
      const merged = JSON.parse(JSON.stringify(current)),
        index = new Map(merged.records.map((r) => [r.id, r]));
      for (const r of incoming.records) {
        const old = index.get(r.id);
        if (
          !old ||
          Date.parse(r.updatedAt || r.consumedAt) >
            Date.parse(old.updatedAt || old.consumedAt)
        )
          index.set(r.id, r);
      }
      merged.records = [...index.values()];
      merged.custom = [
        ...new Map(
          [...incoming.custom, ...merged.custom].map((b) => [b.k, b]),
        ).values(),
      ];
      merged.sleep = { ...incoming.sleep, ...merged.sleep };
      merged.naps = { ...incoming.naps, ...merged.naps };
      merged.reactionAssessment =
        merged.reactionAssessment ?? incoming.reactionAssessment ?? null;
      if (!current.onboarding && !current.records.length)
        merged.profile = incoming.profile;
      merged.legacy = { ...incoming.legacy, ...merged.legacy };
      merged.onboarding = true;
      return validate(merged);
    }
    return {
      load,
      save,
      importBackup,
      get error() {
        return lastError;
      },
    };
  }
  const api = {
    KEY,
    defaults,
    dayKey,
    uid,
    validTime,
    validDay,
    validBev,
    validRecord,
    validate,
    migrate,
    create,
  };
  root.CaffNapStorage = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

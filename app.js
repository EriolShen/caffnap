"use strict";
(function () {
  const $ = (id) => document.getElementById(id),
    M = CaffNapModel,
    S = CaffNapStorage,
    R = CaffNapReactions;
  const catalog = (window.CAFFNAP_DB?.items || []).filter(S.validBev);
  const store = S.create(
    {
      getItem: (k) => window.localStorage.getItem(k),
      setItem: (k, v) => window.localStorage.setItem(k, v),
    },
    catalog,
  );
  let data = store.load(),
    blocked = data === null;
  data ||= S.defaults();
  let mode = "plan",
    selected = null,
    editingId = null,
    draft = null,
    options = [],
    chosen = "original",
    customFromPicker = false;
  const undoRecords = [];
  let noticeReturnTo;
  let featureTour;
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const icon = (name) => '<i data-lucide="' + name + '"></i>';
  const icons = () => window.lucide?.createIcons();
  const nowTime = (date) =>
    new Date(date).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const drinks = () => [...catalog, ...data.custom];
  const active = () => data.records.filter((r) => !r.deletedAt);
  const recordsOn = (date) =>
    active()
      .filter((r) => S.dayKey(r.consumedAt) === date)
      .sort((a, b) => Date.parse(a.consumedAt) - Date.parse(b.consumedAt));
  const dose = (r) => M.caffeine(r.beverage).mid * r.cups;
  const name = (b) => b.drink || b.label;
  const range = (v, cups = 1) => {
    const lo = Math.floor(v.low * cups),
      hi = Math.ceil(v.high * cups);
    return lo === hi ? String(lo) : lo + "–" + hi;
  };
  const target = () => M.targetDate(data.profile.targetBed);
  let cutoffBeverage =
    catalog.find((b) => /美式/.test(b.drink || b.label)) || catalog[0];
  const napKey = () => S.dayKey(M.eveningFor(target()));
  const napSettings = () =>
    data.naps[napKey()] || {
      enabled: false,
      start: "14:10",
      duration: 20,
      wake: "07:00",
    };
  function dateTimeLabel(date) {
    if (!date) return "暂无法估算";
    const d = new Date(date),
      day = S.dayKey(d),
      today = S.dayKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const prefix =
      day === today
        ? "今天"
        : day === S.dayKey(tomorrow)
          ? "明天"
          : `${d.getMonth() + 1}/${d.getDate()}`;
    return prefix + " " + nowTime(d);
  }
  const targetLabel = () =>
    (S.dayKey(target()) === S.dayKey(new Date()) ? "今天 " : "明天 ") +
    data.profile.targetBed;
  const text = (id, value) => {
    $(id).textContent = value;
  };
  function warning() {
    $("storageWarning").hidden = !store.error && !blocked;
    text(
      "storageWarning",
      blocked
        ? "已保存的数据无法读取，已暂停写入以保护原数据。请先导出原始备份，再检查文件。"
        : "本次数据未能保存到浏览器，刷新可能丢失。请先导出完整备份。",
    );
  }
  function save() {
    if (blocked) {
      warning();
      return false;
    }
    const success = store.save(data);
    warning();
    return success;
  }
  function toast(message) {
    if (!$("notifications").contains(document.activeElement))
      noticeReturnTo = document.activeElement;
    text("toastText", message);
    $("toast").hidden = false;
    text("announcements", message);
  }
  function updateUndo(message) {
    $("undoNotice").hidden = undoRecords.length === 0;
    if (undoRecords.length) $("toast").hidden = true;
    text("undoText", message);
    text("undoDelete", undoRecords.length > 1 ? `撤销上一条（${undoRecords.length}）` : "撤销删除");
    text("announcements", message);
  }
  function focusPageHeading() {
    const heading = document.querySelector(".page:not([hidden]) h1");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    return heading;
  }
  function restoreNoticeFocus() {
    if (noticeReturnTo?.isConnected && noticeReturnTo.checkVisibility())
      noticeReturnTo.focus();
    else focusPageHeading();
  }
  function persisted(message) {
    const ok = save();
    render();
    toast(ok ? message : "仅保留在当前页面，请导出备份。");
    return ok;
  }
  function showPage(page) {
    if (!["today", "review", "settings"].includes(page)) page = "today";
    document.querySelectorAll(".page").forEach((el) => {
      el.hidden = el.id !== "page-" + page;
    });
    document.querySelectorAll("[data-page]").forEach((b) => {
      b.classList.toggle("active", b.dataset.page === page);
      if (b.dataset.page === page) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    render();
    document.title = focusPageHeading().textContent + " · CaffNap";
    window.scrollTo(0, 0);
  }
  function recordRow(r) {
    return (
      '<div class="record-row"><time datetime="' +
      escape(r.consumedAt) +
      '">' +
      nowTime(r.consumedAt) +
      '</time><span class="drink-tile">' +
      icon("coffee") +
      '</span><div class="record-info"><strong>' +
      escape(name(r.beverage)) +
      "</strong><p>" +
      escape(r.beverage.brand || "自定义") +
      " · " +
      r.cups +
      " 份 · 约 " +
      Math.round(dose(r)) +
      ' mg</p></div><div class="record-actions"><button class="icon-button" data-repeat="' +
      escape(r.id) +
      '" title="再记一杯" aria-label="再记一杯 ' +
      escape(name(r.beverage)) +
      '">' +
      icon("rotate-ccw") +
      '</button><button class="icon-button" data-edit="' +
      escape(r.id) +
      '" title="编辑记录" aria-label="编辑 ' +
      escape(name(r.beverage)) +
      '">' +
      icon("pencil") +
      '</button><button class="icon-button" data-delete="' +
      escape(r.id) +
      '" title="删除记录" aria-label="删除 ' +
      escape(name(r.beverage)) +
      '">' +
      icon("trash-2") +
      "</button></div></div>"
    );
  }
  function renderHome() {
    const today = S.dayKey(new Date()),
      rows = recordsOn(today);
    const relevant = active().filter(
      (r) => Date.parse(r.consumedAt) <= Date.now(),
    );
    const known = rows.length > 0 || relevant.length > 0;
    const assessment = M.assess(relevant, target(), data.profile);
    text(
      "todayDate",
      new Date().toLocaleDateString("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
    );
    $("targetBed").value = data.profile.targetBed;
    text(
      "goalDay",
      S.dayKey(target()) === today ? "今晚的睡眠目标" : "下一次睡眠目标",
    );
    const total = rows.reduce((s, r) => s + dose(r), 0);
    $("dailyMg").innerHTML = rows.length
      ? Math.round(total) + "<small>mg</small>"
      : "—";
    $("targetMg").innerHTML = known
      ? range(assessment.remaining) + "<small>mg</small>"
      : "—";
    text("recordCount", rows.length + " 条记录");
    if (!rows.length) {
      text("statusTitle", "还没有今天的记录");
      text(
        "statusDescription",
        relevant.length
          ? "尚未记录今天的摄入；估算已计入此前记录的残留。"
          : "尚未记录，不代表没有摄入。可以先比较，也可以补记。",
      );
    } else if (assessment.aboveThreshold) {
      text("statusTitle", "下一杯，可以少一点");
      text(
        "statusDescription",
        "按已记录摄入估算，目标时间的残留高于模型参考值。可以比较少喝一点或暂时不喝。",
      );
    } else {
      text("statusTitle", "今天喝的，记在这里了");
      text(
        "statusDescription",
        "估算残留低于模型参考值，但不代表不会影响睡眠。未记录的饮品尚未计入。",
      );
    }
    text(
      "modelBasis",
      data.profile.source +
        "：半衰期 " +
        Number(data.profile.halfLife.toFixed(2)) +
        " 小时，参考阈值 " +
        data.profile.threshold +
        " mg/L。沿用旧版一级消除公式，累计此前实际记录；饮品含量按数据库区间计算。",
    );
    $("timeline").innerHTML = rows.length
      ? rows.map(recordRow).join("")
      : '<div class="empty-state"><div><h3>今天喝过的，还没记下来</h3><p>记下饮品和时间，预测就会一起更新。</p></div></div>';
    const recent = (data.recent || [])
      .map(
        (k) =>
          drinks().find((b) => b.k === k) ||
          active().find((r) => r.beverage.k === k)?.beverage,
      )
      .filter(Boolean)
      .slice(0, 3);
    $("recentDrinks").innerHTML = recent.length
      ? recent
          .map(
            (b) =>
              '<button class="recent-button" data-recent="' +
              escape(b.k) +
              '"><span><strong>' +
              escape(name(b)) +
              "</strong><small>" +
              escape(b.brand || "自定义") +
              " · 约 " +
              Math.round(M.caffeine(b).mid) +
              " mg / 份</small></span>" +
              icon("arrow-up-right") +
              "</button>",
          )
          .join("")
      : '<p class="small muted">还没有最近记录。</p>';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const sleep = data.sleep[S.dayKey(yesterday)];
    text(
      "feedbackPrompt",
      sleep
        ? "昨晚 " +
            sleep.bed +
            " 入睡，" +
            sleep.wake +
            " 起床。已记录，可修改。"
        : "留下实际睡眠时间，慢慢了解自己的节奏。",
    );
    renderPrediction(relevant);
  }
  function renderPrediction(records) {
    const nap = napSettings(),
      result = M.predict(records, target(), data.profile, nap);
    text(
      "predictionContext",
      result.hasRecords
        ? "已记录摄入 + 当前小睡设置"
        : "无摄入记录 · 仅模型基线",
    );
    text(
      "predSleep",
      result.hasRecords ? dateTimeLabel(result.sleep) : "待记录摄入",
    );
    text(
      "predSleepNote",
      !result.hasRecords
        ? "下方显示无摄入假设下的节律"
        : !result.sleep
          ? "至次日中午未满足模型条件"
          : result.sleep > target()
            ? "晚于睡眠目标约 " +
              Math.ceil((result.sleep - target()) / 60000) +
              " 分钟"
            : "模型条件早于或接近睡眠目标",
    );
    text("predClear", result.hasRecords ? dateTimeLabel(result.clear) : "—");
    text(
      "predDelay",
      result.hasRecords ? Math.round(result.delay) + " 分钟" : "—",
    );
    text("predNap", Math.round(result.napDelay) + " 分钟");
    text(
      "predNapNote",
      nap.enabled
        ? nap.start + " 开始 · " + nap.duration + " 分钟"
        : "未计入小睡",
    );
    text("napDay", napKey().slice(5).replace("-", "/"));
    $("napEnabled").checked = nap.enabled;
    $("wakeTime").value = nap.wake;
    $("napStart").value = nap.start;
    $("napDuration").value = nap.duration;
    text(
      "napSummary",
      nap.enabled
        ? "小睡结束 " +
            dateTimeLabel(result.napEnd) +
            " · 咖啡因仅按实际摄入记录计算。"
        : "未计入小睡，起床时间仍用于清醒度估算。",
    );
    text(
      "curveRange",
      dateTimeLabel(result.start) + " 至 " + dateTimeLabel(result.end),
    );
    renderCutoff(records);
    drawCharts(result);
  }
  function drawCharts(result) {
    const colors = getComputedStyle(document.documentElement);
    if (!$("page-today").hidden) {
      drawModelChart(
        "caffeineChart",
        result,
        "concentration",
        null,
        colors.getPropertyValue("--green").trim(),
        Math.max(
          2,
          data.profile.threshold * 1.2,
          ...result.samples.map((s) => s.concentration),
        ),
        data.profile.threshold,
      );
      drawModelChart(
        "melatoninChart",
        result,
        "melatonin",
        "natural",
        colors.getPropertyValue("--brown").trim(),
        100,
      );
      drawModelChart(
        "alertnessChart",
        result,
        "alertness",
        "circadian",
        colors.getPropertyValue("--brown-soft").trim(),
        100,
      );
    }
  }
  function renderCutoff(records = active()) {
    text("cutoffTarget", "目标 " + targetLabel());
    text(
      "cutoffDrink",
      cutoffBeverage
        ? (cutoffBeverage.brand || "自定义") + " · " + name(cutoffBeverage)
        : "选择饮品",
    );
    if (!cutoffBeverage || !$("cutoffCups").checkValidity()) {
      text("cutoffTime", "—");
      text("cutoffNote", "请选择饮品，并填写 0.01–10 份。");
      return;
    }
    const cups = Number($("cutoffCups").value);
    const result = M.cutoff(
      records,
      cutoffBeverage,
      cups,
      target(),
      data.profile,
    );
    text(
      "cutoffLabel",
      result.status === "passed" ? "估算截止时间已过" : "估算最晚饮用时间",
    );
    text(
      "cutoffTime",
      result.at
        ? dateTimeLabel(result.at)
        : result.status === "no-caffeine"
          ? "无咖啡因截止限制"
          : "当前条件下无余量",
    );
    text(
      "cutoffNote",
      result.status === "no-room"
        ? "已有摄入在目标时刻已达到参考阈值，无法为追加咖啡因反推出时间。可先不追加，并核对记录与目标。"
        : result.status === "no-caffeine"
          ? "这杯标注为 0 mg，不增加模型咖啡因残留；已有摄入仍可能影响结果。"
          : (result.status === "passed"
              ? "可以比较更少分量或低因选项。"
              : "仅为这杯反推，不会新增摄入记录。") +
            " 本次按 " +
            Math.ceil(M.caffeine(cutoffBeverage).high * cups) +
            " mg 计算。",
    );
  }
  function drawModelChart(id, result, key, reference, color, max, threshold) {
    const canvas = $(id),
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = Math.max(240, canvas.clientWidth),
      h = 210,
      ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.scale(ratio, ratio);
    const left = 34,
      right = w - 12,
      top = 40,
      bottom = h - 32;
    const x = (at) =>
      left +
      ((at - result.start) / (result.end - result.start)) * (right - left);
    const y = (v) => bottom - (v / max) * (bottom - top);
    ctx.font = "11px sans-serif";
    const colors = getComputedStyle(document.documentElement);
    ctx.fillStyle = "#52635a";
    ctx.textAlign = "left";
    ctx.font = "12px sans-serif";
    ctx.fillText(canvas.dataset.axisLabel, left, 16);
    ctx.font = "11px sans-serif";
    if (result.napStart) {
      ctx.fillStyle = colors.getPropertyValue("--lavender").trim();
      const start = Math.max(left, x(result.napStart)),
        end = Math.min(right, x(result.napEnd));
      if (end > start) ctx.fillRect(start, top, end - start, bottom - top);
    }
    for (let i = 0; i <= 4; i++) {
      const value = (max * i) / 4;
      ctx.strokeStyle = "#e0e7e2";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
      ctx.fillStyle = "#697770";
      ctx.textAlign = "right";
      ctx.fillText(
        max <= 10 ? value.toFixed(1) : Math.round(value),
        left - 7,
        y(value) + 4,
      );
    }
    function line(field, stroke, dashed = false) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = dashed ? 1.5 : 2.5;
      ctx.setLineDash(dashed ? [5, 5] : []);
      ctx.beginPath();
      result.samples.forEach((s, i) =>
        i ? ctx.lineTo(x(s.at), y(s[field])) : ctx.moveTo(x(s.at), y(s[field])),
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const referenceColor = colors.getPropertyValue("--chart-reference").trim();
    if (reference) line(reference, referenceColor, true);
    if (threshold !== undefined) {
      ctx.strokeStyle = referenceColor;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(left, y(threshold));
      ctx.lineTo(right, y(threshold));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    line(key, color);
    for (const [at, stroke, dashed] of [
      [target(), colors.getPropertyValue("--green").trim(), true],
      [
        result.hasRecords && result.sleep,
        colors.getPropertyValue("--brown").trim(),
        false,
      ],
    ]) {
      if (!at || at < result.start || at > result.end) continue;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x(at), top);
      ctx.lineTo(x(at), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const steps = w < 360 ? 2 : w < 480 ? 3 : 5;
    for (let i = 0; i <= steps; i++) {
      const at = new Date(
        +result.start + ((result.end - result.start) * i) / steps,
      );
      const label =
        (S.dayKey(at) !== S.dayKey(result.start) ? "次日 " : "") + nowTime(at);
      ctx.textAlign = i === 0 ? "left" : i === steps ? "right" : "center";
      ctx.fillStyle = "#697770";
      ctx.fillText(label, x(at), h - 9);
    }
    canvas.setAttribute(
      "aria-label",
      canvas.getAttribute("aria-label").split("；")[0] +
        "；纵轴：" + canvas.dataset.axisLabel +
        "；" +
        $("curveRange").textContent,
    );
  }
  function renderReview() {
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return S.dayKey(d);
    });
    const recorded = dates
      .map((date) => recordsOn(date))
      .filter((r) => r.length);
    const total = recorded.flat().reduce((s, r) => s + dose(r), 0),
      nights = dates.filter((d) => data.sleep[d]).length;
    $("reviewMetrics").innerHTML =
      "<div><p>有记录的日期</p><strong>" +
      recorded.length +
      " 天</strong></div><div><p>记录日平均摄入</p><strong>" +
      (recorded.length ? Math.round(total / recorded.length) + " mg" : "—") +
      "</strong></div><div><p>睡眠反馈</p><strong>" +
      nights +
      " 晚</strong></div>";
    $("historyList").innerHTML = dates
      .map((date) => {
        const rows = recordsOn(date),
          totalMg = rows.reduce((s, r) => s + dose(r), 0),
          sleep = data.sleep[date];
        return (
          '<details class="history-day"><summary class="history-row"><span>' +
          date.slice(5).replace("-", " / ") +
          "</span><div>" +
          (rows.length
            ? Math.round(totalMg) + " mg · " + rows.length + " 条记录"
            : "尚未记录") +
          '<div class="history-bar"><span style="width:' +
          Math.min(100, totalMg / 6) +
          '%"></span></div></div><span class="small muted">' +
          (sleep ? sleep.bed + " 睡 / " + sleep.wake + " 起" : "无睡眠反馈") +
          "</span></summary>" +
          (rows.length
            ? rows.map(recordRow).join("")
            : '<p class="small muted">这天没有摄入记录。</p>') +
          '<button class="text-button" data-sleep-date="' +
          date +
          '">记录 / 修改这晚睡眠</button></details>'
        );
      })
      .join("");
  }
  function renderSettings() {
    const assessment = data.reactionAssessment;
    $("reviewReaction").hidden = !assessment;
    text("reactionPredictionNote", assessment
      ? "当前预测依据：" + data.profile.source + "。可查看自测建议后决定是否替换。"
      : "完成自测后，可将建议参数应用到预测；跳过则保留当前参数。");
    text("editReactionLabel", assessment ? "修改自测" : "开始自测");
    text(
      "reactionStatus",
      assessment
        ? R.summarize(assessment.answers).title +
            " · " +
            S.dayKey(assessment.updatedAt) +
            " 更新"
        : "尚未填写。可以先使用默认估算，稍后再补充。",
    );
    $("reactionAnswers").innerHTML = assessment
      ? R.questions
          .map(
            (q) =>
              "<dt>" +
              escape(q.title) +
              "</dt><dd>" +
              escape(
                q.options.find(([key]) => key === assessment.answers[q.key])[1],
              ) +
              "</dd>",
          )
          .join("")
      : "";
    text("parameterSource", data.profile.source);
    $("halfLife").value = Number(data.profile.halfLife.toFixed(2));
    $("threshold").value = data.profile.threshold;
    $("dlmoOffset").value = data.profile.dlmoOffset || 0;
    $("profileMode").value = data.profile.setupMode || "default";
    $("manualProfileOption").hidden = data.profile.setupMode !== "manual";
    for (const [key, id] of Object.entries(geneFields)) {
      const value = data.legacy.geno?.[key]?.g || "";
      $(id).value = [...$(id).options].some((o) => o.value === value)
        ? value
        : "";
    }
    previewProfile();
    $("customList").innerHTML = data.custom.length
      ? data.custom
          .map(
            (b) =>
              '<div class="recent-button"><span><strong>' +
              escape(name(b)) +
              "</strong><small>" +
              escape(b.spec) +
              " · " +
              M.caffeine(b).mid +
              ' mg / 份</small></span><button class="icon-button" data-delete-custom="' +
              escape(b.k) +
              '" aria-label="删除饮品 ' +
              escape(name(b)) +
              '" title="删除饮品">' +
              icon("trash-2") +
              "</button></div>",
          )
          .join("")
      : '<p class="small muted">还没有自定义饮品。</p>';
  }
  function render() {
    renderHome();
    renderReview();
    renderSettings();
    icons();
  }
  let surveyOnly = false,
    surveyIndex = 0,
    surveyDraft = {},
    surveyReturnTo = "editReaction";
  function openOrientation(view = "welcome") {
    const welcome = view === "welcome";
    $("orientationWelcome").hidden = !welcome;
    $("orientationInvite").hidden = welcome;
    $("orientation").setAttribute("aria-labelledby", welcome ? "welcomeTitle" : "inviteTitle");
    text("orientationDefault", data.profile.setupMode === "default" ? "先用默认值" : "保留当前设置");
    $("orientation").showModal();
    $(welcome ? "orientationStart" : "orientationSurvey").focus();
  }
  function rememberOrientation() {
    data.featureTourSeen = true;
    if (!save()) toast("这次没能记住导览进度，下次可能会再见到它");
  }
  function dismissOrientation() {
    $("orientation").close();
    rememberOrientation();
    $("guideAgain").focus({ preventScroll: true });
  }
  function openReactionSurvey(returnTo = "editReaction") {
    surveyOnly = true;
    surveyReturnTo = returnTo;
    surveyIndex = 0;
    surveyDraft = { ...data.reactionAssessment?.answers };
    $("onboarding").showModal();
    renderSurvey();
  }
  function showGuideStep(step, titleId) {
    for (const id of [
      "guideStepOne",
      "guideSurvey",
      "guideSurveyResult",
      "guideStepTwo",
    ])
      $(id).hidden = id !== step;
    document.querySelector(".onboarding-art").hidden = [
      "guideSurvey",
      "guideSurveyResult",
    ].includes(step);
    $("onboarding").setAttribute("aria-labelledby", titleId);
    $("onboarding").scrollTop = 0;
  }
  function guide() {
    surveyOnly = false;
    surveyIndex = 0;
    surveyDraft = { ...data.reactionAssessment?.answers };
    $("guideTarget").value = data.profile.targetBed;
    text(
      "dailySurveyLabel",
      data.reactionAssessment ? "选填：更新饮用反应自测" : "选填：饮用反应自测",
    );
    showGuideStep("guideStepOne", "onboardingTitle");
    $("onboarding").showModal();
  }
  function renderSurvey() {
    const q = R.questions[surveyIndex];
    text(
      "surveyProgress",
      "饮用反应小档案 · 选填" + " · " + (surveyIndex + 1) + "/5",
    );
    $("surveyProgressBar").value = surveyIndex + 1;
    text("surveyTitle", q.title);
    $("surveyOptions").innerHTML = q.options
      .map(
        ([key, label]) =>
          '<label><input type="radio" name="answer" value="' +
          key +
          '" required' +
          (surveyDraft[q.key] === key ? " checked" : "") +
          "><span>" +
          escape(label) +
          "</span></label>",
      )
      .join("");
    $("surveyNext").disabled = !surveyDraft[q.key];
    $("surveyNext").innerHTML =
      (surveyIndex === R.questions.length - 1 ? "查看预测起点" : "下一题") +
      icon("arrow-right");
    text("surveySkip", surveyOnly ? "取消，不保存" : "跳过自测");
    showGuideStep("guideSurvey", "surveyTitle");
    icons();
    $("surveyTitle").focus();
  }
  function surveyResult() {
    const result = R.summarize(surveyDraft),
      recommendation = R.recommend(surveyDraft),
      parameters = M.profileParameters(recommendation.preset);
    text("surveyResultTitle", result.title);
    $("surveyResultRows").innerHTML = result.reactions
      .map(
        (r) =>
          "<dt>" + escape(r.label) + "</dt><dd>" + escape(r.value) + "</dd>",
      )
      .join("");
    text("surveyResultNote", result.note);
    text("surveyPresetTitle", recommendation.title);
    text("surveyPresetReason", recommendation.reason);
    text("surveyPresetParameters", "试算半衰期 " + parameters.halfLife +
      " 小时 · 参考阈值 " + parameters.threshold + " mg/L");
    $("surveyApply").checked = !["manual", "report"].includes(data.profile.setupMode);
    updateSurveyApply();
    $("surveySaveError").hidden = true;
    showGuideStep("guideSurveyResult", "surveyResultTitle");
    $("surveyResultTitle").focus();
  }
  function updateSurveyApply() {
    const apply = $("surveyApply").checked;
    text("surveySaveLabel", apply
      ? (surveyOnly ? "保存并应用预测" : "应用预测并继续")
      : (surveyOnly ? "仅保存回答" : "保存回答并继续"));
    text("surveyApplyNote", apply
      ? "保存后替换当前估算参数，同步更新预测、宵禁和曲线。睡眠目标与实际记录保持不变。"
      : "保留当前预测参数（" + data.profile.source + "），本次仅保存自测回答。");
  }
  function finishSurvey() {
    if (surveyOnly) {
      $("onboarding").close();
      $(surveyReturnTo).focus({ preventScroll: true });
    } else {
      showGuideStep("guideStepTwo", "guideActionTitle");
      $("guidePlan").focus();
    }
  }
  function cancelGuide() {
    if (surveyOnly) finishSurvey();
    else endGuide(false);
  }
  function setupChartHelp() {
    let activeHelp = null,
      closeTimer,
      pinned = false;
    const close = () => {
      clearTimeout(closeTimer);
      if (activeHelp) activeHelp.tip.hidden = true;
      activeHelp = null;
      pinned = false;
    };
    const position = () => {
      if (!activeHelp) return;
      const { trigger, tip } = activeHelp,
        anchor = trigger.getBoundingClientRect(),
        viewport = window.visualViewport,
        left = viewport?.offsetLeft || 0,
        top = viewport?.offsetTop || 0,
        width = Math.min(
          viewport?.width || window.innerWidth,
          document.documentElement.clientWidth,
        ),
        height = viewport?.height || window.innerHeight;
      tip.style.maxWidth = Math.max(0, width - 32) + "px";
      tip.style.maxHeight = Math.max(0, height - 32) + "px";
      const bounds = tip.getBoundingClientRect();
      if (anchor.bottom < top || anchor.top > top + height) {
        close();
        return;
      }
      // Prefer above the trigger so the explanation leaves its curve visible.
      const y = anchor.top - bounds.height - 8;
      tip.style.left =
        Math.max(
          left + 16,
          Math.min(anchor.left, left + width - bounds.width - 16),
        ) + "px";
      tip.style.top =
        Math.max(
          top + 16,
          Math.min(
            y >= top + 16 ? y : anchor.bottom + 8,
            top + height - bounds.height - 16,
          ),
        ) + "px";
    };
    const open = (help) => {
      clearTimeout(closeTimer);
      if (activeHelp !== help) {
        close();
        activeHelp = help;
      }
      help.tip.hidden = false;
      position();
    };
    const leave = (help) => {
      clearTimeout(closeTimer);
      if (!pinned && document.activeElement !== help.trigger)
        closeTimer = setTimeout(() => {
          if (activeHelp === help) close();
        }, 180);
    };
    document.querySelectorAll(".chart-help").forEach((element) => {
      const help = {
        trigger: element.querySelector(".chart-help-trigger"),
        tip: element.querySelector(".chart-tooltip"),
      };
      help.trigger.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") open(help);
      });
      help.trigger.addEventListener("pointerleave", () => leave(help));
      help.trigger.addEventListener("focus", () => open(help));
      help.trigger.addEventListener("blur", () => {
        if (activeHelp === help && !help.tip.matches(":hover")) close();
      });
      help.trigger.addEventListener("click", () => {
        if (activeHelp === help && pinned) close();
        else {
          open(help);
          pinned = true;
        }
      });
      help.tip.addEventListener("pointerenter", () => clearTimeout(closeTimer));
      help.tip.addEventListener("pointerleave", () => leave(help));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeHelp) {
        event.preventDefault();
        close();
      }
    });
    const dismissOutside = (event) => {
      if (
        activeHelp &&
        !activeHelp.trigger.contains(event.target) &&
        !activeHelp.tip.contains(event.target)
      )
        close();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("click", dismissOutside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, { passive: true });
    window.visualViewport?.addEventListener("resize", position);
  }
  function endGuide(useGoal) {
    if (useGoal && S.validTime($("guideTarget").value))
      data.profile.targetBed = $("guideTarget").value;
    data.onboarding = true;
    save();
    $("onboarding").close();
    render();
  }
  function showDrinkStep(step) {
    $("drinkPicker").hidden = step !== "picker";
    $("drinkForm").hidden = step !== "form";
    $("comparison").hidden = step !== "comparison";
    text("drinkTitle", step === "comparison"
      ? "这一杯，还有其他选择"
      : step === "form"
        ? editingId ? "调整这条记录" : mode === "record" ? "这杯，什么时候喝的？" : "这杯，准备几点喝？"
        : mode === "cutoff" ? "最后一杯，想喝什么？" : mode === "record" ? "刚才，喝了什么？" : "想喝哪一杯？");
    $("drinkDialog").scrollTop = 0;
    icons();
  }
  function openDrink(nextMode, beverage = null, record = null) {
    mode = nextMode;
    editingId = record?.id || null;
    selected = beverage;
    draft = null;
    text(
      "drinkEyebrow",
      record
        ? "修改实际记录"
        : mode === "cutoff"
          ? "宵禁反推 · 尚未记录"
          : mode === "plan"
            ? "饮前比较 · 尚未记录"
            : "实际摄入",
    );
    $("drinkSearch").value = "";
    $("brandFilter").innerHTML =
      '<option value="">全部品牌</option>' +
      [...new Set(drinks().map((b) => b.brand || "自定义"))]
        .map(
          (brand) =>
            '<option value="' +
            escape(brand) +
            '">' +
            escape(brand) +
            "</option>",
        )
        .join("");
    const date = record ? new Date(record.consumedAt) : new Date();
    $("drinkCups").value = record?.cups || 1;
    $("drinkDate").value = S.dayKey(date);
    $("drinkTime").value = nowTime(date);
    $("drinkDate").max =
      mode === "record" ? S.dayKey(new Date()) : S.dayKey(target());
    if (!$("drinkDialog").open) $("drinkDialog").showModal();
    if (selected) selectDrink(selected);
    else {
      showDrinkStep("picker");
      renderPicker();
      $("drinkSearch").focus();
    }
  }
  function renderPicker() {
    const query = $("drinkSearch").value.trim().toLowerCase(),
      brand = $("brandFilter").value;
    const results = drinks().filter(
      (b) =>
        (!brand || (b.brand || "自定义") === brand) &&
        [b.drink, b.label, b.brand, b.category, b.spec]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );
    text("drinkResultCount", results.length + " 款饮品");
    $("drinkResults").innerHTML = results.length
      ? results
          .map(
            (b) =>
              '<button class="drink-choice" data-drink="' +
              escape(b.k) +
              '"><span class="drink-tile">' +
              icon("coffee") +
              "</span><span><strong>" +
              escape(name(b)) +
              "</strong><small>" +
              escape(b.brand || "自定义") +
              " · " +
              escape(b.spec || "每份") +
              '</small></span><span class="dose-label">' +
              range(M.caffeine(b)) +
              " mg</span></button>",
          )
          .join("")
      : '<div class="empty-state"><div><h3>暂时没找到这杯</h3><p>可以清除筛选再看看，也可以添加自己的饮品。</p><button type="button" class="text-button" id="clearDrinkFilters">' + icon("rotate-ccw") + '清除筛选</button></div></div>';
    icons();
  }
  function selectDrink(b) {
    if (mode === "cutoff") {
      cutoffBeverage = b;
      $("drinkDialog").close();
      renderCutoff();
      return;
    }
    selected = b;
    $("selectedDrink").innerHTML =
      '<span class="drink-tile">' +
      icon("coffee") +
      "</span><div><h3>" +
      escape(name(b)) +
      "</h3><p>" +
      escape(b.brand || "自定义") +
      " · " +
      escape(b.spec || "每份") +
      "</p></div>";
    text(
      "drinkSource",
      range(M.caffeine(b)) +
        " mg / 份 · " +
        (b.source === "official"
          ? "饮品库标注：官方来源"
          : b.source === "personal"
            ? "个人提供"
            : "饮品库估算") +
        (b.collected ? " · 采集于 " + b.collected : "") +
        "。实际出品可能不同。",
    );
    $("drinkSubmit").innerHTML =
      mode === "plan"
        ? "看看不同选择" + icon("arrow-right")
        : icon("check") + (editingId ? "保存修改" : "实际喝过，确认记录");
    clearDrinkError();
    showDrinkStep("form");
    $("drinkCups").focus();
  }
  function readDraft() {
    const cups = Number($("drinkCups").value),
      date = $("drinkDate").value,
      time = $("drinkTime").value;
    const fail = (message, fields) => {
      const error = new Error(message);
      error.fields = fields;
      throw error;
    };
    if (!selected) fail("请先选一款饮品。", []);
    if (!(cups >= 0.01 && cups <= 10)) fail("分量请填写 0.01 到 10 份。", ["drinkCups"]);
    if (!S.validDay(date)) fail("请填好饮用日期。", ["drinkDate"]);
    if (!S.validTime(time)) fail("请填好饮用时间。", ["drinkTime"]);
    const when = new Date(date + "T" + time + ":00");
    if (mode === "record" && when > new Date())
      fail(
        "这个时间还没到。记录已喝的饮品，请选已经过去的时间。",
        ["drinkDate", "drinkTime"],
      );
    if (mode === "plan" && when >= target())
      fail(
        "这次比较的饮用时间需早于 " + targetLabel() + " 的睡眠目标。",
        ["drinkDate", "drinkTime"],
      );
    return { beverage: { ...selected }, cups, consumedAt: when.toISOString() };
  }
  function clearDrinkError() {
    text("drinkError", "");
    ["drinkCups", "drinkDate", "drinkTime"].forEach((id) => {
      $(id).removeAttribute("aria-invalid");
      $(id).removeAttribute("aria-describedby");
    });
  }
  function recordActual(value) {
    if (Date.parse(value.consumedAt) > Date.now()) {
      toast("还没到这个时间，暂时不能记为实际摄入。");
      return;
    }
    const timestamp = new Date().toISOString(),
      previous = data.records.find((r) => r.id === editingId);
    const r = {
      ...value,
      id: editingId || S.uid(),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
      source: "user",
    };
    if (!S.validRecord(r)) {
      toast("记录内容无效，请检查输入。");
      return;
    }
    if (previous)
      data.records = data.records.map((item) => (item.id === r.id ? r : item));
    else data.records.push(r);
    data.recent = [
      r.beverage.k,
      ...(data.recent || []).filter((k) => k !== r.beverage.k),
    ].slice(0, 6);
    $("drinkDialog").close();
    persisted(previous ? "记录已更新" : "已记录实际摄入");
  }
  function buildComparison() {
    const lower = drinks().filter(
      (b) => M.caffeine(b).high < M.caffeine(draft.beverage).low,
    );
    const coffee = (b) =>
      !/无咖啡|非咖啡/.test(b.category || "") &&
      /咖啡|美式|拿铁|冷萃|浓缩|摩卡|星冰/.test(b.category || "");
    const similarity = (b) =>
      Number(coffee(b) === coffee(draft.beverage)) * 2 +
      Number(b.brand === draft.beverage.brand);
    lower.sort(
      (a, b) =>
        similarity(b) - similarity(a) || M.caffeine(a).mid - M.caffeine(b).mid,
    );
    options = M.compare(active(), draft, target(), data.profile, lower[0]);
    chosen = "original";
    text("compareTarget", "睡眠目标 · " + targetLabel());
    $("compareOptions").innerHTML = options
      .map(
        (o) =>
          '<label class="compare-option"><span class="option-title">' +
          o.title +
          '<input type="radio" name="comparisonChoice" value="' +
          o.id +
          '" ' +
          (o.id === chosen ? "checked" : "") +
          '></span><span class="option-dose">' +
          range(o.remaining) +
          ' <small style="display:inline">mg</small></span><small>' +
          (o.beverage
            ? escape(name(o.beverage)) + " · " + o.cups + " 份"
            : "仅计算此前已记录的摄入") +
          "</small><small>" +
          (o.aboveThreshold ? "高于模型参考值" : "低于模型参考值") +
          "</small></label>",
      )
      .join("");
    showDrinkStep("comparison");
    updateChoice();
    $("compareOptions").querySelector("input")?.focus();
  }
  function updateChoice() {
    const o = options.find((o) => o.id === chosen);
    $("confirmConsumed").hidden = !o?.beverage;
    $("confirmConsumed").disabled =
      !!draft && Date.parse(draft.consumedAt) > Date.now();
    text("finishCompare", o?.beverage ? "先不记录" : "完成，不记录");
    text(
      "compareMessage",
      !o?.beverage
        ? "这次不新增摄入。已有摄入的残留仍会计入估算。"
        : Date.parse(draft.consumedAt) > Date.now()
          ? "这是未来时间的试算。实际喝过后再记录，不会自动写入摄入历史。"
          : "当前仅在比较。实际喝过后再确认，才会写入摄入记录。",
    );
  }
  function openSleep(date) {
    if (!date) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      date = S.dayKey(d);
    }
    $("sleepDate").max = S.dayKey(new Date());
    $("sleepDate").value = date;
    fillSleep();
    text("sleepError", "");
    $("sleepDialog").showModal();
  }
  function fillSleep() {
    const s = data.sleep[$("sleepDate").value];
    $("sleepBed").value = s?.bed || "23:30";
    $("sleepWake").value = s?.wake || "07:00";
  }
  function download(filename, blob) {
    const a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document
    .querySelectorAll("[data-page]")
    .forEach((b) =>
      b.addEventListener("click", () => showPage(b.dataset.page)),
    );
  document.querySelector(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    showPage("today");
  });
  document
    .querySelectorAll("[data-close]")
    .forEach((b) =>
      b.addEventListener("click", () => $(b.dataset.close).close()),
    );
  setupChartHelp();
  featureTour = CaffNapTour.create({
    prepare: () => showPage("today"),
    onExit: (reason) => {
      rememberOrientation();
      $("guideAgain").focus({ preventScroll: true });
      // Let Driver restore focus before opening the optional next dialog.
      if (reason === "done" && !data.reactionAssessment)
        queueMicrotask(() => openOrientation("invite"));
    },
  });
  $("guideAgain").onclick = () => openOrientation();
  $("orientationStart").onclick = () => {
    $("orientation").close();
    if (!featureTour.start()) {
      openOrientation();
      toast("导览暂时没能打开，可以刷新重试，或先自己逛逛");
    }
  };
  $("orientationClose").onclick = dismissOrientation;
  $("orientationExplore").onclick = dismissOrientation;
  $("orientationDefault").onclick = dismissOrientation;
  $("orientation").addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissOrientation();
  });
  $("orientationSurvey").onclick = () => {
    $("orientation").close();
    openReactionSurvey("startDaily");
  };
  $("startDaily").onclick = guide;
  $("guideNext").onclick = () => {
    if (!$("guideTarget").reportValidity()) return;
    finishSurvey();
  };
  $("dailySurvey").onclick = () => {
    if (!$("guideTarget").reportValidity()) return;
    renderSurvey();
  };
  $("guideBack").onclick = () => {
    showGuideStep("guideStepOne", "onboardingTitle");
    $("guideTarget").focus();
  };
  $("editReaction").onclick = () => openReactionSurvey();
  $("surveyForm").onchange = (event) => {
    if (event.target.name !== "answer") return;
    surveyDraft[R.questions[surveyIndex].key] = event.target.value;
    $("surveyNext").disabled = false;
  };
  $("surveyForm").onsubmit = (event) => {
    event.preventDefault();
    if (!surveyDraft[R.questions[surveyIndex].key]) return;
    if (surveyIndex < R.questions.length - 1) {
      surveyIndex++;
      renderSurvey();
    } else surveyResult();
  };
  $("surveyBack").onclick = () => {
    if (surveyIndex > 0) {
      surveyIndex--;
      renderSurvey();
    } else if (surveyOnly) finishSurvey();
    else {
      showGuideStep("guideStepOne", "onboardingTitle");
      $("guideTarget").focus();
    }
  };
  $("surveyResultBack").onclick = renderSurvey;
  $("surveyApply").onchange = updateSurveyApply;
  $("reviewReaction").onclick = () => {
    if (!data.reactionAssessment) return;
    surveyOnly = true;
    surveyReturnTo = "editReaction";
    surveyIndex = 0;
    surveyDraft = { ...data.reactionAssessment.answers };
    surveyResult();
    $("onboarding").showModal();
    $("surveyResultTitle").focus();
  };
  $("surveySkip").onclick = finishSurvey;
  $("surveyResultSkip").onclick = finishSurvey;
  $("surveySave").onclick = () => {
    const previous = data.reactionAssessment,
      previousProfile = data.profile,
      apply = $("surveyApply").checked;
    data.reactionAssessment = {
      version: 1,
      answers: { ...surveyDraft },
      updatedAt: new Date().toISOString(),
    };
    if (apply) {
      const parameters = M.profileParameters(R.recommend(surveyDraft).preset);
      data.profile = {
        ...data.profile,
        ...parameters,
        source: "自测建议（" + S.dayKey(data.reactionAssessment.updatedAt) + "）· " + parameters.source,
      };
    }
    if (!save()) {
      data.reactionAssessment = previous;
      data.profile = previousProfile;
      text(
        "surveySaveError",
        "档案未能保存，请重试或暂不保存。原有档案未被修改。",
      );
      $("surveySaveError").hidden = false;
      return;
    }
    render();
    finishSurvey();
    toast(apply ? "自测已保存，预测、宵禁和曲线已更新" : "自测回答已保存，保留原有预测参数");
  };
  $("skipGuide").onclick = cancelGuide;
  $("onboarding").addEventListener("cancel", (e) => {
    e.preventDefault();
    cancelGuide();
  });
  $("guideEmpty").onclick = () => endGuide(true);
  $("guideSleep").onclick = () => {
    endGuide(true);
    openSleep();
  };
  $("guidePlan").onclick = () => {
    endGuide(true);
    openDrink("plan");
  };
  $("guideRecord").onclick = () => {
    endGuide(true);
    openDrink("record");
  };
  $("targetBed").onchange = () => {
    if (!S.validTime($("targetBed").value)) {
      $("targetBed").value = data.profile.targetBed;
      return;
    }
    data.profile.targetBed = $("targetBed").value;
    persisted("睡眠目标已更新");
  };
  $("startPlan").onclick = () => openDrink("plan");
  $("startRecord").onclick = () => openDrink("record");
  $("napRecord").onclick = () => openDrink("record");
  $("chooseCutoff").onclick = () => openDrink("cutoff");
  $("cutoffCups").oninput = () => renderCutoff();
  $("napForm").onsubmit = (e) => {
    e.preventDefault();
    data.naps[napKey()] = {
      enabled: $("napEnabled").checked,
      wake: $("wakeTime").value,
      start: $("napStart").value,
      duration: Number($("napDuration").value),
    };
    persisted("小睡设置已更新，预测和曲线已同步");
  };
  $("napEnabled").onchange = () => $("napForm").requestSubmit();
  $("drinkSearch").oninput = renderPicker;
  $("brandFilter").onchange = renderPicker;
  $("changeDrink").onclick = () => {
    showDrinkStep("picker");
    renderPicker();
    $("drinkSearch").focus();
  };
  $("backToDrink").onclick = () => {
    showDrinkStep("form");
    $("drinkCups").focus();
  };
  $("drinkForm").addEventListener("input", clearDrinkError);
  $("drinkForm").onsubmit = (e) => {
    e.preventDefault();
    clearDrinkError();
    try {
      draft = readDraft();
      if (mode === "record") recordActual(draft);
      else buildComparison();
    } catch (error) {
      text("drinkError", error.message);
      (error.fields || []).forEach((id) => {
        $(id).setAttribute("aria-invalid", "true");
        $(id).setAttribute("aria-describedby", "drinkError");
      });
      if (error.fields?.length) $(error.fields[0]).focus();
    }
  };
  $("compareOptions").onchange = (e) => {
    if (e.target.name === "comparisonChoice") {
      chosen = e.target.value;
      updateChoice();
    }
  };
  $("confirmConsumed").onclick = () => {
    const o = options.find((o) => o.id === chosen);
    if (draft && o?.beverage)
      recordActual({ ...draft, beverage: { ...o.beverage }, cups: o.cups });
  };
  $("finishCompare").onclick = () => {
    $("drinkDialog").close();
    toast("本次比较结束，未新增摄入记录");
  };
  $("openSleep").onclick = () => openSleep();
  $("reviewSleep").onclick = () => openSleep();
  $("sleepDate").onchange = fillSleep;
  $("sleepForm").onsubmit = (e) => {
    e.preventDefault();
    const date = $("sleepDate").value,
      bed = $("sleepBed").value,
      wake = $("sleepWake").value;
    if (
      !S.validDay(date) ||
      date > S.dayKey(new Date()) ||
      !S.validTime(bed) ||
      !S.validTime(wake)
    ) {
      text("sleepError", "请填写有效的日期与时间。");
      return;
    }
    const bedDate = new Date(date + "T" + bed + ":00"),
      wakeDate = new Date(date + "T" + wake + ":00");
    if (Number(bed.slice(0, 2)) < 12) bedDate.setDate(bedDate.getDate() + 1);
    wakeDate.setDate(wakeDate.getDate() + 1);
    if (
      wakeDate > new Date() ||
      wakeDate <= bedDate ||
      wakeDate - bedDate > 24 * 3600000
    ) {
      text(
        "sleepError",
        "请检查这晚的日期：起床应晚于入睡，且不能是未来时间。",
      );
      return;
    }
    data.sleep[date] = { bed, wake, updatedAt: new Date().toISOString() };
    $("sleepDialog").close();
    persisted("睡眠反馈已保存，估算参数未改变");
  };
  const geneFields = {
    cyp: "profileCyp",
    ador: "profileAdor",
    ahr: "profileAhr",
    abcg2: "profileAbcg2",
    per1: "profilePer1",
  };
  function selectedGenes() {
    return Object.fromEntries(
      Object.entries(geneFields)
        .filter(([, id]) => $(id).value)
        .map(([key, id]) => [key, { g: $(id).value }]),
    );
  }
  function previewProfile() {
    const mode = $("profileMode").value;
    $("geneChoices").hidden = mode !== "report";
    $("saveProfile").disabled = mode === "manual";
    const p =
      mode === "manual"
        ? data.profile
        : M.profileParameters(mode, selectedGenes());
    text(
      "profileSummaryTitle",
      {
        default: "默认起点，不需要知道基因型",
        cautious: "给估算多留一点余地",
        report: "按报告位点换算",
        manual: "已使用自定义参数",
      }[mode],
    );
    const note =
      mode === "cautious"
        ? "这只是偏保守的试算情景，不表示你的实际代谢较慢。"
        : mode === "report"
          ? "未选择的位点沿用默认值；报告映射不能保证个体预测准确。"
          : mode === "manual"
            ? "可展开高级参数修改，或切换回默认估算。"
            : "默认值是模型假设，不是对你身体的测定。";
    text(
      "profileSummaryNote",
      note +
        " 当前对应半衰期 " +
        Number(p.halfLife.toFixed(2)) +
        " 小时、参考阈值 " +
        p.threshold +
        " mg/L。",
    );
  }
  $("profileMode").onchange = previewProfile;
  for (const id of Object.values(geneFields)) $(id).onchange = previewProfile;
  $("profileForm").onsubmit = (e) => {
    e.preventDefault();
    const mode = $("profileMode").value;
    if (mode === "manual") return;
    const genes = selectedGenes();
    data.profile = { ...data.profile, ...M.profileParameters(mode, genes) };
    if (mode === "report") data.legacy.geno = genes;
    persisted("代谢档案已保存，预测和曲线已同步");
  };
  $("parameterForm").onsubmit = (e) => {
    e.preventDefault();
    data.profile.halfLife = Number($("halfLife").value);
    data.profile.threshold = Number($("threshold").value);
    data.profile.dlmoOffset = Number($("dlmoOffset").value);
    data.profile.source = "手动设置的估算参数";
    data.profile.setupMode = "manual";
    persisted("估算参数已更新");
  };
  $("resetParameters").onclick = () => {
    data.profile = {
      ...S.defaults().profile,
      targetBed: data.profile.targetBed,
    };
    persisted("已恢复默认估算参数");
  };
  function openCustom(fromPicker) {
    customFromPicker = fromPicker;
    $("customForm").reset();
    $("customDialog").showModal();
  }
  $("addCustom").onclick = () => openCustom(false);
  $("pickerCustom").onclick = () => openCustom(true);
  $("customForm").onsubmit = (e) => {
    e.preventDefault();
    const drink = $("customName").value.trim();
    if (!drink) {
      $("customName").focus();
      return;
    }
    const b = {
      k: "u-" + S.uid(),
      drink,
      brand: "自定义",
      category: "自定义",
      spec: $("customSpec").value.trim(),
      mg: Number($("customMg").value),
      source: "personal",
    };
    if (!S.validBev(b)) return;
    data.custom.push(b);
    $("customDialog").close();
    persisted("饮品已保存");
    if (customFromPicker) selectDrink(b);
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "clearDrinkFilters") {
      $("drinkSearch").value = "";
      $("brandFilter").value = "";
      renderPicker();
      $("drinkSearch").focus();
    }
    if (b.dataset.drink)
      selectDrink(drinks().find((x) => x.k === b.dataset.drink));
    if (b.dataset.recent)
      openDrink(
        "plan",
        drinks().find((x) => x.k === b.dataset.recent) ||
          active().find((r) => r.beverage.k === b.dataset.recent)?.beverage,
      );
    if (b.dataset.edit || b.dataset.repeat) {
      const r = active().find(
        (r) => r.id === (b.dataset.edit || b.dataset.repeat),
      );
      if (r) openDrink("record", r.beverage, b.dataset.edit ? r : null);
    }
    if (b.dataset.delete) {
      const record = data.records.find((r) => r.id === b.dataset.delete);
      if (!record) return;
      record.deletedAt = record.updatedAt = new Date().toISOString();
      undoRecords.push({ id: record.id });
      const list = b.closest(".page"), index = [...list.querySelectorAll("[data-delete]")].indexOf(b);
      const ok = save();
      render();
      const next = [...list.querySelectorAll("[data-delete]")];
      if (next.length) next[Math.min(index, next.length - 1)].focus();
      else focusPageHeading();
      updateUndo(ok ? "记录已删除，可以撤销。" : "删除未保存，可以撤销或导出备份。");
    }
    if (b.dataset.deleteCustom) {
      const removed = data.custom.find((x) => x.k === b.dataset.deleteCustom);
      data.custom = data.custom.filter((x) => x.k !== b.dataset.deleteCustom);
      save();
      render();
      $("addCustom").focus();
      if (removed) {
        undoRecords.push({ custom: removed });
        updateUndo("饮品已移除，历史记录还在。可以撤销。");
      }
    }
    if (b.dataset.sleepDate) openSleep(b.dataset.sleepDate);
  });
  $("undoDelete").onclick = () => {
    const undoRecord = undoRecords.pop();
    if (!undoRecord) return;
    if (undoRecord.custom) {
      if (!data.custom.some((b) => b.k === undoRecord.custom.k)) data.custom.push(undoRecord.custom);
    }
    else {
      const record = data.records.find((r) => r.id === undoRecord.id);
      if (record) {
        delete record.deletedAt;
        record.updatedAt = new Date().toISOString();
      }
    }
    persisted("已撤销删除");
    updateUndo(undoRecords.length ? "已恢复一条，还可以继续撤销。" : "已撤销删除");
    if (!undoRecords.length) {
      const restored = [...document.querySelectorAll(".page:not([hidden]) [data-edit]")].find((b) => b.dataset.edit === undoRecord.id);
      if (restored) restored.focus();
      else if (undoRecord.custom) $("addCustom").focus();
      else focusPageHeading();
    }
  };
  $("dismissToast").onclick = () => {
    $("toast").hidden = true;
    restoreNoticeFocus();
  };
  $("dismissUndo").onclick = () => {
    undoRecords.length = 0;
    $("undoNotice").hidden = true;
    focusPageHeading();
  };
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--notice-height", entry.target.offsetHeight + "px");
  }).observe($("notifications"));
  $("exportJson").onclick = () => {
    if (blocked) {
      try {
        download(
          "caffnap-unreadable-backup.json",
          new Blob([localStorage.getItem(S.KEY) || "{}"], {
            type: "application/json",
          }),
        );
      } catch {
        toast("浏览器拒绝读取原始数据。");
      }
      return;
    }
    download(
      "caffnap-backup-" + S.dayKey(new Date()) + ".json",
      new Blob(
        [
          JSON.stringify(
            {
              app: "caffnap",
              version: 2,
              exportedAt: new Date().toISOString(),
              data,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
  };
  $("exportCsv").onclick = () => {
    const rows = [
      ["date", "time", "drink", "brand", "servings", "caffeine_mg"],
    ];
    active()
      .sort((a, b) => Date.parse(a.consumedAt) - Date.parse(b.consumedAt))
      .forEach((r) =>
        rows.push([
          S.dayKey(r.consumedAt),
          nowTime(r.consumedAt),
          name(r.beverage),
          r.beverage.brand || "",
          r.cups,
          dose(r),
        ]),
      );
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row
            .map((value) => {
              let s = String(value);
              if (/^[=+@-]/.test(s)) s = "'" + s;
              return '"' + s.replace(/"/g, '""') + '"';
            })
            .join(","),
        )
        .join("\r\n");
    download(
      "caffnap-records.csv",
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  };
  $("importJson").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (blocked) throw new Error("请先保存原始备份，当前已暂停写入。");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("备份文件超过 10 MB，未导入。");
      const merged = store.importBackup(JSON.parse(await file.text()), data);
      if (!store.save(merged))
        throw new Error("浏览器无法保存，未替换当前数据。");
      const added = merged.records.length - data.records.length;
      data = merged;
      render();
      warning();
      text(
        "importResult",
        "导入完成，新增 " + added + " 条摄入记录。重复导入不会重复添加。",
      );
    } catch (error) {
      text(
        "importResult",
        error instanceof SyntaxError ? "文件不是有效的 JSON。" : error.message,
      );
    }
    e.target.value = "";
  };
  $("geneFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("报告超过 30 MB。");
      const loci = {
          rs762551: ["cyp", ["AA", "AC", "CC"]],
          rs5751876: ["ador", ["TT", "CT", "CC"]],
          rs4410790: ["ahr", ["TT", "GT", "GG"]],
          rs1481012: ["abcg2", ["AA", "AG", "GG"]],
          rs7221412: ["per1", ["AA", "AG", "GG"]],
        },
        found = {};
      for (const line of (await file.text()).split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/),
          locus = loci[parts[0]];
        if (!locus) continue;
        const gt = (parts[3] || "").toUpperCase().split("").sort().join("");
        const match = locus[1].find((v) => v.split("").sort().join("") === gt);
        if (match) found[locus[0]] = { g: match };
      }
      if (!Object.keys(found).length)
        throw new Error("未找到支持的有效位点，当前档案保持不变。");
      data.profile = {
        ...data.profile,
        ...M.profileParameters("report", found),
      };
      data.legacy.geno = found;
      const ok = save();
      render();
      text(
        "geneResult",
        ok
          ? "已使用检出位点更新探索性参数。未检出位点沿用默认值。"
          : "参数仅在本页更新，未能保存。",
      );
      warning();
    } catch (error) {
      text("geneResult", error.message);
    }
    e.target.value = "";
  };
  window.addEventListener("storage", (e) => {
    if (e.key !== S.KEY) return;
    const incoming = store.load();
    if (incoming && !document.querySelector("dialog[open]")) {
      data = incoming;
      render();
      toast("已同步此浏览器其他页面的更改");
    } else {
      blocked = true;
      text("storageWarning", "其他页面修改了记录。请刷新后继续，避免覆盖。");
      $("storageWarning").hidden = false;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (
      !document.hidden &&
      !document.querySelector("dialog[open]") &&
      !featureTour?.isActive() &&
      !document.activeElement?.matches("input, select")
    )
      render();
  });
  setInterval(() => {
    if (
      !document.hidden &&
      !document.querySelector("dialog[open]") &&
      !featureTour?.isActive() &&
      !document.activeElement?.matches("input, select")
    ) {
      renderHome();
      icons();
    }
  }, 60000);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawCharts(M.predict(active(), target(), data.profile, napSettings()));
    }, 150);
  });
  render();
  warning();
  if (!data.onboarding && !data.featureTourSeen && !blocked)
    openOrientation();
})();

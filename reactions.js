/* Self-reports suggest a trial preset, not a measured metabolic phenotype. */
(function (root) {
  "use strict";
  const questions = [
    {
      key: "frequency",
      title: "一周通常有几天喝含咖啡因饮品？",
      options: [
        ["rarely", "0–1 天"],
        ["weekly", "2–4 天"],
        ["daily", "5–7 天"],
        ["unknown", "不确定"],
      ],
    },
    {
      key: "timing",
      title: "通常在什么时候喝？",
      options: [
        ["morning", "主要在上午"],
        ["afternoon", "主要在下午"],
        ["evening", "主要在晚上"],
        ["varies", "时段不固定"],
        ["unknown", "不确定／很少喝"],
      ],
    },
    {
      key: "sleep",
      title: "喝过之后，你是否注意到更难入睡或睡得不安稳？",
      options: [
        ["none", "没有注意到"],
        ["sometimes", "偶尔注意到"],
        ["often", "经常注意到"],
        ["unknown", "不确定／没留意"],
      ],
    },
    {
      key: "body",
      title: "喝过之后，你是否注意到心慌、发抖或坐立不安？",
      options: [
        ["none", "没有注意到"],
        ["sometimes", "偶尔注意到"],
        ["often", "经常注意到"],
        ["unknown", "不确定／没留意"],
      ],
    },
    {
      key: "goal",
      title: "你现在最想调整什么？",
      options: [
        ["sleep", "关注晚间睡眠"],
        ["reduce", "减少饮用量"],
        ["timing", "调整饮用时间"],
        ["observe", "先了解自己的反应"],
        ["unknown", "还没想好"],
      ],
    },
  ];
  const valid = (value) =>
    !!value &&
    value.version === 1 &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    !!value.answers &&
    typeof value.answers === "object" &&
    !Array.isArray(value.answers) &&
    questions.every((q) =>
      q.options.some(([key]) => key === value.answers[q.key]),
    );
  function summarize(answers) {
    const reactions = [
      ["sleep", "睡眠变化"],
      ["body", "心慌、发抖或坐立不安"],
    ].map(([key, label]) => ({
      label,
      value:
        {
          none: "你暂未注意到",
          sometimes: "你偶尔注意到",
          often: "你经常注意到",
          unknown: "你还不确定",
        }[answers[key]] || "尚未回答",
    }));
    const hasReaction = [answers.sleep, answers.body].some((v) =>
      ["sometimes", "often"].includes(v),
    );
    return {
      title: hasReaction
        ? "你报告过饮用后的变化"
        : answers.sleep === "none" && answers.body === "none"
          ? "你暂未注意到明显变化"
          : "你的反应还有待观察",
      reactions,
      note: "自述用于选择试算情景，不是代谢速度检测或经验证的医学量表；没有注意到反应，也不等于没有影响。",
    };
  }
  function recommend(answers) {
    if (!answers || !questions.every((q) =>
      q.options.some(([key]) => key === answers[q.key])))
      throw new Error("请先完成自测，也可以选择不确定。");
    const sleep = ["sometimes", "often"].includes(answers.sleep);
    const body = ["sometimes", "often"].includes(answers.body);
    // A product precaution using existing scenarios, not a validated questionnaire-to-half-life formula.
    if (sleep || body)
      return {
        preset: "cautious",
        title: "建议从保守估算开始",
        reason: sleep
          ? "你提到饮用后出现过睡眠变化，先用保守情景为睡眠留出更多余地。"
          : "你提到饮用后出现过身体不适，先采用保守情景；这不是对不适原因的判断。",
      };
    return {
      preset: "default",
      title: "建议从默认估算开始",
      reason: answers.sleep === "unknown" || answers.body === "unknown"
        ? "目前的信息不足以区分个人反应，先使用默认参数，不把不确定视为低敏感。"
        : "你暂未注意到明显变化，先使用默认参数，不据此推断代谢更快或放宽阈值。",
    };
  }
  const api = { questions, valid, summarize, recommend };
  root.CaffNapReactions = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

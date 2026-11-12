/* Product orientation is independent of daily entries and model parameters. */
(function (root) {
  "use strict";
  const steps = [
    [
      ".sleep-goal",
      "今晚想几点睡？",
      "先定个时间，我们就有了今晚的参考。",
    ],
    [
      ".decision-band",
      "想喝了，还是已经喝了？",
      "喝之前看看影响，喝之后记上一杯。“想喝一杯”先帮你比较，不会算作已经喝过。",
    ],
    [
      ".prediction-section",
      "看看今晚可能怎样",
      "这里是睡眠预测。下面的三张曲线，还能看看咖啡因还剩多少、睡眠节律和清醒程度怎么变化。",
    ],
    [
      ".cutoff-section",
      "最后一杯，几点合适？",
      "选好想喝的饮品，估算一下什么时候该收杯。时间只是参考，不保证睡眠不受影响。",
    ],
    [
      ".nap-section",
      "想小睡一会儿？",
      "加上你的小睡安排，再看看预测有什么变化。小睡前喝过的咖啡，也记得单独记上一杯。",
    ],
  ];
  function create({ prepare, onExit }) {
    let instance;
    const focusElement = (selector) => {
      const element = root.document.querySelector(selector);
      if (
        element &&
        root.innerWidth <= 600 &&
        element.getBoundingClientRect().height > root.innerHeight - 320
      )
        return element.querySelector(".section-heading, figcaption") || element;
      return element;
    };
    return {
      isActive: () => !!instance?.isActive(),
      start() {
        if (instance?.isActive()) return;
        if (!root.driver?.js?.driver) return false;
        prepare();
        const reduceMotion = root.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        instance = root.driver.js.driver({
          animate: !reduceMotion,
          duration: 320,
          smoothScroll: !reduceMotion,
          overlayColor: "#17221b",
          overlayOpacity: 0.64,
          stagePadding: 6,
          stageRadius: 8,
          popoverOffset: 14,
          popoverClass: "caffnap-tour",
          disableActiveInteraction: true,
          allowKeyboardControl: true,
          allowClose: true,
          overlayClickBehavior: "nextStep",
          showProgress: true,
          progressText: "{{current}} / {{total}}",
          nextBtnText: '下一步 <i data-lucide="arrow-right"></i>',
          prevBtnText: '<i data-lucide="arrow-left"></i> 上一步',
          doneBtnText: '完成 <i data-lucide="check"></i>',
          closeBtnLabel: "跳过功能导览",
          steps: steps.map(([element, title, description]) => ({
            element: () => focusElement(element),
            popover: { title, description, side: "bottom", align: "center" },
          })),
          onPopoverRender(popover) {
            popover.closeButton.textContent = "跳过";
            popover.closeButton.title = "跳过功能导览";
            root.lucide?.createIcons();
          },
          onHighlighted(element) {
            if (
              !element ||
              root.innerWidth > 600 ||
              element.matches("[data-page]") ||
              root.getComputedStyle(element).position === "fixed"
            )
              return;
            const rect = element.getBoundingClientRect();
            if (rect.bottom + 280 > root.innerHeight && rect.top > 32)
              root.scrollBy({
                top: rect.top - 32,
                behavior: reduceMotion ? "instant" : "smooth",
              });
          },
          onDestroyed(_element, _step, { reason }) {
            onExit(reason);
          },
        });
        instance.drive();
        return true;
      },
    };
  }
  const api = { steps, create };
  root.CaffNapTour = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

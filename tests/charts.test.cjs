const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
// Exercise the actual renderer without initializing the rest of the page.
const renderer = app.slice(
  app.indexOf("  function drawModelChart("),
  app.indexOf("  function renderReview("),
);
for (const id of ["caffeineChart", "melatoninChart", "alertnessChart"]) {
  test(`${id} draws an axis title above the plot and describes it once`, () => {
    const label = html.match(new RegExp(`id="${id}"\\s+data-axis-label="([^"]+)"`))[1];
    for (const width of [240, 1000]) {
      const texts = [];
      const ctx = new Proxy({}, {
        get: (_target, key) => key === "fillText"
          ? (value, x, y) => texts.push({ value, x, y })
          : () => {},
      });
      let aria = id;
      const canvas = {
        clientWidth: width,
        dataset: { axisLabel: label },
        getContext: () => ctx,
        getAttribute: () => aria,
        setAttribute: (_name, value) => { aria = value; },
      };
      const scope = {
        $: (name) => name === id ? canvas : { textContent: "06:00 - 12:00" },
        window: { devicePixelRatio: 2 },
        document: { documentElement: {} },
        getComputedStyle: () => ({ getPropertyValue: () => "#52635a" }),
        target: () => null,
        S: { dayKey: () => "2026-11-12" },
        nowTime: () => "06:00",
      };
      vm.createContext(scope);
      vm.runInContext(renderer, scope);
      const result = { start: 0, end: 1000, samples: [{ at: 0, value: 0 }, { at: 1000, value: 100 }] };
      scope.drawModelChart(id, result, "value", null, "#52635a", 100);
      assert.deepEqual(texts[0], { value: label, x: 34, y: 16 });
      assert.ok(texts.slice(1, 6).every(({ y }) => y >= 40));
      scope.drawModelChart(id, result, "value", null, "#52635a", 100);
      assert.equal(aria.split(label).length, 2);
      assert.equal(canvas.width, width * 2);
    }
  });
}

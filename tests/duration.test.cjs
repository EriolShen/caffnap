const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('  function durationLabel('), app.indexOf('  function dateTimeLabel(')), context);
vm.runInContext(app.slice(app.indexOf('  const delayLabel ='), app.indexOf('  function estimatedTime(')), context);

test('durations above 60 minutes use hours with optional remaining minutes', () => {
  for (const [minutes, expected] of [[0,'0 分钟'],[45,'45 分钟'],[60,'60 分钟'],[61,'1 小时 1 分钟'],[120,'2 小时'],[410,'6 小时 50 分钟']]) {
    assert.equal(context.durationLabel(minutes), expected);
  }
  for (const invalid of [null, undefined, NaN, -1]) assert.equal(context.durationLabel(invalid), '暂无法估算');
});

test('decision deltas retain five-minute rounding and uncertainty labels', () => {
  assert.equal(vm.runInContext('delayLabel(61)', context), '约晚 1 小时 5 分钟');
  assert.equal(vm.runInContext('delayLabel(410)', context), '约晚 6 小时 50 分钟');
  assert.equal(vm.runInContext('delayLabel(0)', context), '未估算出额外延后');
  assert.equal(vm.runInContext('delayLabel(null)', context), '暂无法比较');
});

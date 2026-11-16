// §5.13 (V) 37-20 — 컴포지션 원본 줄 색인의 비용(JS 에 둔 근거 — docs/rules/rust-compute.md 1·2). `pnpm --filter @vibisual/video build` 뒤 `node bench/sourceMap.mjs`.
import { performance } from 'node:perf_hooks';
import { scanSourceTags, sourceTargetsAtLine } from '../dist/composition/index.js';

const row = (i) => `<div class="row r${i % 7}" data-i="${i}"><span class="label">Item ${i}</span><b>${i}</b></div>\n`;

function make(bytes) {
  let html = '<!doctype html><html><head><style>.a{color:red}</style></head><body>\n';
  for (let i = 0; html.length < bytes; i += 1) html += row(i);
  return `${html}<script>var a = 1;</script></body></html>`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

for (const [label, bytes, runs] of [['typical', 30 * 1024, 200], ['large', 300 * 1024, 50], ['cap', 2 * 1024 * 1024, 20]]) {
  const html = make(bytes);
  let index = scanSourceTags(html); // 워밍업
  const scans = [];
  for (let k = 0; k < runs; k += 1) {
    const at = performance.now();
    index = scanSourceTags(html);
    scans.push(performance.now() - at);
  }
  const lines = [];
  for (let k = 0; k < 20; k += 1) {
    const at = performance.now();
    sourceTargetsAtLine(index, index.lineCount - 3);
    lines.push(performance.now() - at);
  }
  console.log(`${label}: ${(html.length / 1024).toFixed(0)}KB, ${index.tags.length} tags, ${index.lineCount} lines — scan ${median(scans).toFixed(2)}ms, line→targets ${median(lines).toFixed(3)}ms`);
}

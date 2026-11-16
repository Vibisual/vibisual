/**
 * §5.13 (V) 37-11 — 우리가 쓴 부품 열다섯(순수, HTML 문자열 — 외부 라이브러리 0·Apache-2.0). 꺼내면 문서마다 사본(`compositions/<부품>-n/index.html`)이
 * 서서 고쳐도 원본은 그대로다. ⚠ 스크립트 문자열 안에 백틱·`${` ❌(템플릿 문자열이 뜻을 바꾼다) — `+` 로 잇는다.
 * 시각 함수는 `window.__vibi.seek` 로 적는다 — lint 가 그 글자로 "시각을 받는다"를 알아본다(별칭 `vibi.seek` 로 적으면 no-motion 경고).
 * 썸네일은 길이의 60% 시각의 실제 정지 화면이다 — 그때 들어오는 움직임이 끝나 있고 숨은 요소가 없게 짠다.
 */
import { partHtml } from './shell.js';

export type PartCategory = 'text' | 'data' | 'layout' | 'brand' | 'captions';

export interface VideoPartDef {
  readonly id: string;
  readonly category: PartCategory;
  /** 영문 이름(에이전트·목록의 기본값 — 화면은 `panel.videoStudio.parts.name_<id>`). */
  readonly name: string;
  readonly defaultDuration: number;
  /** 그 판형 크기로 짠 HTML(반응형이라 실제로는 상자 크기에 맞춘다). */
  readonly html: (size: { readonly width: number; readonly height: number }) => string;
}

const lowerThird: VideoPartDef = {
  id: 'lower-third',
  category: 'text',
  name: 'Lower third',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'Lower third', duration: 5, width, height,
    props: {
      name: { type: 'text', default: 'Name Surname', label: 'Name' },
      role: { type: 'text', default: 'Role or caption', label: 'Role' },
      align: { type: 'choice', options: ['left', 'center'], default: 'left', label: 'Align' },
      enter: { type: 'time', default: 0.2, min: 0, max: 5, step: 0.05, label: 'Enter at (s)' },
      exitBefore: { type: 'time', default: 0.6, min: 0, max: 5, step: 0.05, label: 'Exit before end (s)' },
    },
    css: `
  .lt { position: absolute; bottom: calc(var(--H) * 0.14); left: calc(var(--W) * 0.06); }
  .panel { position: relative; display: flex; flex-direction: column; gap: calc(var(--S) * 0.006);
    padding: calc(var(--S) * 0.02) calc(var(--S) * 0.034) calc(var(--S) * 0.02) calc(var(--S) * 0.03);
    background: color-mix(in srgb, var(--vibi-bg, #0b1020) 78%, transparent); border-radius: calc(var(--S) * 0.012); }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--S) * 0.008); background: var(--vibi-accent, #6366f1);
    border-radius: 99px; transform-origin: center bottom; }
  .name { font-size: calc(var(--S) * 0.052); font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; }
  .role { font-size: calc(var(--S) * 0.03); color: var(--vibi-muted, #94a3b8); white-space: nowrap; }`,
    body: '<div class="lt" id="lt"><div class="panel" id="panel"><span class="bar" id="bar"></span><div class="name" id="name" data-vibi-prop="name"></div><div class="role" id="role" data-vibi-prop="role"></div></div></div>',
    script: `
  function apply() {
    el('name').textContent = P('name', 'Name Surname');
    el('role').textContent = P('role', 'Role or caption');
    var lt = el('lt');
    if (P('align', 'left') === 'center') { lt.style.left = '50%'; lt.style.transform = 'translateX(-50%)'; }
    else { lt.style.left = ''; lt.style.transform = ''; }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var a = N('enter', 0.2);
    var outAt = DUR() - N('exitBefore', 0.6);
    var pin = easeOut(prog(t, a, a + 0.55));
    var pout = easeInOut(prog(t, outAt, outAt + 0.45));
    var p = pin * (1 - pout);
    el('panel').style.clipPath = 'inset(0 ' + ((1 - p) * 100) + '% 0 0)';
    el('bar').style.transform = 'scaleY(' + p + ')';
    var pn = easeOut(prog(t, a + 0.15, a + 0.6));
    var pr = easeOut(prog(t, a + 0.3, a + 0.75));
    el('name').style.opacity = String(pn * (1 - pout));
    el('name').style.transform = 'translateX(' + ((1 - pn) * -S * 0.02) + 'px)';
    el('role').style.opacity = String(pr * (1 - pout));
    el('role').style.transform = 'translateX(' + ((1 - pr) * -S * 0.02) + 'px)';
  };`,
  }),
};

const kineticType: VideoPartDef = {
  id: 'kinetic-type',
  category: 'text',
  name: 'Kinetic type',
  defaultDuration: 4,
  html: ({ width, height }) => partHtml({
    title: 'Kinetic type', duration: 4, width, height,
    props: {
      text: { type: 'text', default: 'Say it\nwith motion', label: 'Text', multiline: true },
      emphasis: { type: 'text', default: 'motion', label: 'Emphasized word' },
      size: { type: 'number', default: 10, min: 3, max: 24, step: 0.5, label: 'Size (% of short side)' },
      stagger: { type: 'time', default: 0.16, min: 0, max: 1, step: 0.01, label: 'Delay between words (s)' },
    },
    css: `
  .kt { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; font-weight: 900; letter-spacing: -0.03em; line-height: 1.05; }
  .line { white-space: nowrap; }
  .w { display: inline-block; margin: 0 0.12em; }
  .w.em { color: var(--vibi-accent, #6366f1); }`,
    body: '<div class="kt" id="kt"></div>',
    script: `
  var words = [];
  function apply() {
    var kt = el('kt');
    kt.textContent = '';
    kt.style.fontSize = (S * N('size', 10) / 100) + 'px';
    words = [];
    var em = String(P('emphasis', '')).trim().toLowerCase();
    var lines = String(P('text', 'Say it\\nwith motion')).split('\\n');
    for (var i = 0; i < lines.length; i++) {
      var line = document.createElement('div');
      line.className = 'line';
      var parts = lines[i].split(/\\s+/).filter(function (s) { return s !== ''; });
      for (var j = 0; j < parts.length; j++) {
        var span = document.createElement('span');
        span.className = 'w' + (em !== '' && parts[j].toLowerCase().replace(/[^\\w]/g, '') === em.replace(/[^\\w]/g, '') ? ' em' : '');
        span.textContent = parts[j];
        line.appendChild(span);
        words.push(span);
      }
      kt.appendChild(line);
    }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var st = N('stagger', 0.16);
    var outAt = DUR() - 0.45;
    var out = easeInOut(prog(t, outAt, outAt + 0.4));
    for (var i = 0; i < words.length; i++) {
      var d = 0.15 + i * st;
      var p = prog(t, d, d + 0.5);
      var e = easeBack(p);
      words[i].style.opacity = String(clamp(p * 1.6, 0, 1) * (1 - out));
      words[i].style.transform = 'translateY(' + ((1 - e) * 0.55 - out * 0.3) + 'em) scale(' + (0.86 + 0.14 * e) + ')';
    }
  };`,
  }),
};

const counter: VideoPartDef = {
  id: 'counter',
  category: 'data',
  name: 'Number counter',
  defaultDuration: 4,
  html: ({ width, height }) => partHtml({
    title: 'Number counter', duration: 4, width, height,
    props: {
      from: { type: 'number', default: 0, label: 'From' },
      to: { type: 'number', default: 1250, label: 'To' },
      decimals: { type: 'number', default: 0, min: 0, max: 3, step: 1, label: 'Decimals' },
      prefix: { type: 'text', default: '', label: 'Prefix' },
      suffix: { type: 'text', default: '+', label: 'Suffix' },
      label: { type: 'text', default: 'Active users', label: 'Label' },
      countFor: { type: 'time', default: 1.6, min: 0.2, max: 10, step: 0.1, label: 'Count for (s)' },
    },
    css: `
  .ct { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--S) * 0.02); }
  .num { font-size: calc(var(--S) * 0.17); font-weight: 900; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
  .num .affix { color: var(--vibi-accent, #6366f1); }
  .label { font-size: calc(var(--S) * 0.04); color: var(--vibi-muted, #94a3b8); letter-spacing: 0.02em; }`,
    body: '<div class="ct"><div class="num" id="num"></div><div class="label" id="label" data-vibi-prop="label"></div></div>',
    script: `
  function group(intPart) { var s = String(intPart); var out = ''; for (var i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += ','; out += s.charAt(i); } return out; }
  function format(v, dec) {
    var neg = v < 0; v = Math.abs(v);
    var fixed = v.toFixed(dec);
    var dot = fixed.indexOf('.');
    var ip = dot < 0 ? fixed : fixed.slice(0, dot);
    var fp = dot < 0 ? '' : fixed.slice(dot);
    return (neg ? '-' : '') + group(ip) + fp;
  }
  function apply() { el('label').textContent = P('label', 'Active users'); }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var p = easeOut(prog(t, 0.15, 0.15 + N('countFor', 1.6)));
    var v = lerp(N('from', 0), N('to', 1250), p);
    var num = el('num');
    num.textContent = '';
    var pre = document.createElement('span'); pre.className = 'affix'; pre.textContent = P('prefix', '');
    var mid = document.createElement('span'); mid.textContent = format(v, clamp(Math.round(N('decimals', 0)), 0, 3));
    var suf = document.createElement('span'); suf.className = 'affix'; suf.textContent = P('suffix', '+');
    num.appendChild(pre); num.appendChild(mid); num.appendChild(suf);
    var pl = easeOut(prog(t, 0.35, 0.9));
    el('label').style.opacity = String(pl);
    el('label').style.transform = 'translateY(' + ((1 - pl) * S * 0.02) + 'px)';
  };`,
  }),
};

const barChart: VideoPartDef = {
  id: 'bar-chart',
  category: 'data',
  name: 'Bar chart',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'Bar chart', duration: 5, width, height,
    props: {
      title: { type: 'text', default: 'Revenue by quarter', label: 'Title' },
      labels: { type: 'text', default: 'Q1, Q2, Q3, Q4', label: 'Labels (comma separated)' },
      values: { type: 'text', default: '12, 19, 27, 34', label: 'Values (comma separated)' },
      unit: { type: 'text', default: '', label: 'Unit' },
      stagger: { type: 'time', default: 0.12, min: 0, max: 1, step: 0.01, label: 'Delay between bars (s)' },
    },
    css: `
  .ch { position: absolute; inset: 7% 8%; display: flex; flex-direction: column; gap: calc(var(--S) * 0.03); }
  .title { font-size: calc(var(--S) * 0.05); font-weight: 800; }
  .bars { flex: 1; display: flex; align-items: flex-end; gap: calc(var(--S) * 0.03); border-bottom: 2px solid color-mix(in srgb, var(--vibi-fg, #fff) 25%, transparent); }
  .bar { flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: calc(var(--S) * 0.012); }
  .val { font-size: calc(var(--S) * 0.032); font-weight: 700; font-variant-numeric: tabular-nums; }
  .fill { width: 100%; background: var(--vibi-accent, #6366f1); border-radius: calc(var(--S) * 0.01) calc(var(--S) * 0.01) 0 0; }
  .labs { display: flex; gap: calc(var(--S) * 0.03); }
  .lab { flex: 1; text-align: center; font-size: calc(var(--S) * 0.028); color: var(--vibi-muted, #94a3b8); }`,
    body: '<div class="ch"><div class="title" id="title" data-vibi-prop="title"></div><div class="bars" id="bars"></div><div class="labs" id="labs"></div></div>',
    script: `
  var bars = [];
  function apply() {
    el('title').textContent = P('title', 'Revenue by quarter');
    var labels = LIST('labels', 'Q1, Q2, Q3, Q4');
    var values = NUMS('values', '12, 19, 27, 34');
    var n = Math.max(labels.length, values.length);
    var max = 0;
    for (var k = 0; k < values.length; k++) max = Math.max(max, Math.abs(values[k]));
    var host = el('bars'); host.textContent = '';
    var labs = el('labs'); labs.textContent = '';
    bars = [];
    for (var i = 0; i < n; i++) {
      var bar = document.createElement('div'); bar.className = 'bar';
      var val = document.createElement('div'); val.className = 'val';
      var fill = document.createElement('div'); fill.className = 'fill';
      bar.appendChild(val); bar.appendChild(fill); host.appendChild(bar);
      var lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = labels[i] || ''; labs.appendChild(lab);
      bars.push({ val: val, fill: fill, value: values[i] || 0, ratio: max > 0 ? Math.abs(values[i] || 0) / max : 0 });
    }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var st = N('stagger', 0.12);
    var unit = P('unit', '');
    el('title').style.opacity = String(easeOut(prog(t, 0, 0.5)));
    for (var i = 0; i < bars.length; i++) {
      var d = 0.3 + i * st;
      var p = easeOut(prog(t, d, d + 0.9));
      var b = bars[i];
      b.fill.style.height = (b.ratio * p * 82) + '%';
      var shown = b.value * p;
      b.val.textContent = (Math.abs(b.value) < 10 && b.value % 1 !== 0 ? shown.toFixed(1) : String(Math.round(shown))) + unit;
      b.val.style.opacity = String(clamp(p * 2 - 0.4, 0, 1));
    }
  };`,
  }),
};

const lineChart: VideoPartDef = {
  id: 'line-chart',
  category: 'data',
  name: 'Line chart',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'Line chart', duration: 5, width, height,
    props: {
      title: { type: 'text', default: 'Weekly visitors', label: 'Title' },
      labels: { type: 'text', default: 'Mon, Tue, Wed, Thu, Fri, Sat, Sun', label: 'Labels (comma separated)' },
      values: { type: 'text', default: '3, 5, 4, 7, 9, 8, 12', label: 'Values (comma separated)' },
      drawFor: { type: 'time', default: 2.4, min: 0.3, max: 10, step: 0.1, label: 'Draw for (s)' },
    },
    css: `
  .title { position: absolute; left: 8%; top: 7%; font-size: calc(var(--S) * 0.05); font-weight: 800; }
  canvas { position: absolute; left: 0; top: 0; }`,
    body: '<div class="title" id="title" data-vibi-prop="title"></div><canvas id="cv"></canvas>',
    script: `
  var cv = el('cv'); cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  function css(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function apply() { el('title').textContent = P('title', 'Weekly visitors'); }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var labels = LIST('labels', 'Mon, Tue, Wed, Thu, Fri, Sat, Sun');
    var values = NUMS('values', '3, 5, 4, 7, 9, 8, 12');
    var n = Math.max(2, values.length);
    var max = Math.max.apply(null, values.concat([1]));
    var min = Math.min.apply(null, values.concat([0]));
    var x0 = W * 0.08, x1 = W * 0.92, y0 = H * 0.24, y1 = H * 0.82;
    var accent = css('--vibi-accent', '#6366f1'), fg = css('--vibi-fg', '#f8fafc'), muted = css('--vibi-muted', '#94a3b8');
    var font = css('--vibi-font', 'system-ui, sans-serif');
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = fg; ctx.lineWidth = Math.max(1, S * 0.002);
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.globalAlpha = 1;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var v = values[i] === undefined ? 0 : values[i];
      pts.push({ x: lerp(x0, x1, i / (n - 1)), y: lerp(y1, y0, (v - min) / Math.max(1e-6, max - min)) });
    }
    var total = 0; var seg = [];
    for (var j = 1; j < pts.length; j++) { var d = Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y); seg.push(d); total += d; }
    var p = easeInOut(prog(t, 0.3, 0.3 + N('drawFor', 2.4)));
    var left = total * p;
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2, S * 0.008); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    var tip = pts[0];
    for (var k = 1; k < pts.length && left > 0; k++) {
      var take = Math.min(left, seg[k - 1]); var r = seg[k - 1] > 0 ? take / seg[k - 1] : 1;
      tip = { x: lerp(pts[k - 1].x, pts[k].x, r), y: lerp(pts[k - 1].y, pts[k].y, r) };
      ctx.lineTo(tip.x, tip.y); left -= take;
    }
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, Math.max(3, S * 0.012), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = muted; ctx.font = Math.round(S * 0.028) + 'px ' + font; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var m = 0; m < n; m++) { if (labels[m]) { ctx.globalAlpha = clamp(p * n - m + 0.5, 0, 1); ctx.fillText(labels[m], pts[m].x, y1 + S * 0.02); } }
    ctx.globalAlpha = 1;
    el('title').style.opacity = String(easeOut(prog(t, 0, 0.5)));
  };`,
  }),
};

const donutChart: VideoPartDef = {
  id: 'donut-chart',
  category: 'data',
  name: 'Donut chart',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'Donut chart', duration: 5, width, height,
    props: {
      title: { type: 'text', default: 'Where time goes', label: 'Title' },
      labels: { type: 'text', default: 'Build, Review, Meetings, Other', label: 'Labels (comma separated)' },
      values: { type: 'text', default: '46, 24, 18, 12', label: 'Values (comma separated)' },
      center: { type: 'text', default: '100%', label: 'Center text' },
    },
    css: `
  .title { position: absolute; left: 8%; top: 7%; font-size: calc(var(--S) * 0.05); font-weight: 800; }
  canvas { position: absolute; left: 0; top: 0; }
  .legend { position: absolute; right: 8%; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: calc(var(--S) * 0.016);
    font-size: calc(var(--S) * 0.03); }
  .row { display: flex; align-items: center; gap: calc(var(--S) * 0.012); }
  .dot { width: calc(var(--S) * 0.022); height: calc(var(--S) * 0.022); border-radius: 99px; }`,
    body: '<div class="title" id="title" data-vibi-prop="title"></div><canvas id="cv"></canvas><div class="legend" id="legend"></div>',
    script: `
  var cv = el('cv'); cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  function css(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function sliceStyle(i) {
    var colors = [css('--vibi-accent', '#6366f1'), css('--vibi-fg', '#f8fafc'), css('--vibi-muted', '#94a3b8')];
    return { color: colors[i % 3], alpha: Math.max(0.35, 1 - Math.floor(i / 3) * 0.3) };
  }
  var rows = [];
  function apply() {
    el('title').textContent = P('title', 'Where time goes');
    var labels = LIST('labels', 'Build, Review, Meetings, Other');
    var legend = el('legend'); legend.textContent = ''; rows = [];
    for (var i = 0; i < labels.length; i++) {
      var row = document.createElement('div'); row.className = 'row';
      var dot = document.createElement('span'); dot.className = 'dot';
      var st = sliceStyle(i); dot.style.background = st.color; dot.style.opacity = String(st.alpha);
      var txt = document.createElement('span'); txt.textContent = labels[i];
      row.appendChild(dot); row.appendChild(txt); legend.appendChild(row); rows.push(row);
    }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var values = NUMS('values', '46, 24, 18, 12');
    var sum = 0; for (var k = 0; k < values.length; k++) sum += Math.max(0, values[k]);
    var cx = W * 0.36, cy = H * 0.55, r = S * 0.28, w = S * 0.09;
    var p = easeInOut(prog(t, 0.3, 2.0));
    ctx.clearRect(0, 0, W, H);
    var a = -Math.PI / 2;
    for (var i = 0; i < values.length; i++) {
      var span = sum > 0 ? (Math.max(0, values[i]) / sum) * Math.PI * 2 * p : 0;
      var st = sliceStyle(i);
      ctx.globalAlpha = st.alpha; ctx.strokeStyle = st.color; ctx.lineWidth = w; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(cx, cy, r, a, a + Math.max(0, span - 0.012)); ctx.stroke();
      a += span;
    }
    ctx.globalAlpha = clamp(p * 1.4 - 0.3, 0, 1);
    ctx.fillStyle = css('--vibi-fg', '#f8fafc'); ctx.font = '800 ' + Math.round(S * 0.07) + 'px ' + css('--vibi-font', 'system-ui, sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(P('center', '100%')), cx, cy);
    ctx.globalAlpha = 1;
    for (var j = 0; j < rows.length; j++) { var pr = easeOut(prog(t, 0.5 + j * 0.12, 1.0 + j * 0.12)); rows[j].style.opacity = String(pr); rows[j].style.transform = 'translateX(' + ((1 - pr) * S * 0.03) + 'px)'; }
    el('title').style.opacity = String(easeOut(prog(t, 0, 0.5)));
  };`,
  }),
};

const codeTyping: VideoPartDef = {
  id: 'code-typing',
  category: 'text',
  name: 'Code typing',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Code typing', duration: 6, width, height,
    props: {
      title: { type: 'text', default: 'app.ts', label: 'File name' },
      code: { type: 'text', default: 'const greeting = "hello";\nconsole.log(greeting);', label: 'Code', multiline: true },
      speed: { type: 'number', default: 28, min: 2, max: 200, step: 1, label: 'Characters per second' },
      size: { type: 'number', default: 3.4, min: 1.5, max: 8, step: 0.1, label: 'Size (% of short side)' },
    },
    css: `
  .win { position: absolute; inset: 10% 9%; display: flex; flex-direction: column; border-radius: calc(var(--S) * 0.018); overflow: hidden;
    background: color-mix(in srgb, var(--vibi-bg, #0b1020) 88%, #000); border: 1px solid color-mix(in srgb, var(--vibi-fg, #fff) 14%, transparent); }
  .bar { display: flex; align-items: center; gap: calc(var(--S) * 0.012); padding: calc(var(--S) * 0.016) calc(var(--S) * 0.022);
    border-bottom: 1px solid color-mix(in srgb, var(--vibi-fg, #fff) 10%, transparent); }
  .d { width: calc(var(--S) * 0.016); height: calc(var(--S) * 0.016); border-radius: 99px; background: color-mix(in srgb, var(--vibi-fg, #fff) 25%, transparent); }
  .name { margin-left: calc(var(--S) * 0.01); font-size: calc(var(--S) * 0.026); color: var(--vibi-muted, #94a3b8); }
  pre { margin: 0; padding: calc(var(--S) * 0.03); flex: 1; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; line-height: 1.5; }
  .cur { display: inline-block; width: 0.55em; height: 1.1em; vertical-align: -0.15em; background: var(--vibi-accent, #6366f1); }`,
    body: '<div class="win"><div class="bar"><span class="d"></span><span class="d"></span><span class="d"></span><span class="name" id="name" data-vibi-prop="title"></span></div><pre id="code"></pre></div>',
    script: `
  function apply() { el('name').textContent = P('title', 'app.ts'); el('code').style.fontSize = (S * N('size', 3.4) / 100) + 'px'; }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var code = String(P('code', 'const greeting = "hello";\\nconsole.log(greeting);'));
    var n = clamp(Math.floor((t - 0.3) * N('speed', 28)), 0, code.length);
    var pre = el('code');
    pre.textContent = code.slice(0, n);
    var cur = document.createElement('span'); cur.className = 'cur';
    cur.style.opacity = (n < code.length || Math.floor(t * 2) % 2 === 0) ? '1' : '0';
    pre.appendChild(cur);
  };`,
  }),
};

const logoReveal: VideoPartDef = {
  id: 'logo-reveal',
  category: 'brand',
  name: 'Logo reveal',
  defaultDuration: 4,
  html: ({ width, height }) => partHtml({
    title: 'Logo reveal', duration: 4, width, height,
    props: {
      logo: { type: 'image', default: '', label: 'Logo (empty = the style card logo)' },
      name: { type: 'text', default: 'Brand', label: 'Name' },
      tagline: { type: 'text', default: 'Made with code', label: 'Tagline' },
    },
    css: `
  .lr { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--S) * 0.03); }
  .disc { position: absolute; left: 50%; top: 50%; width: calc(var(--S) * 1.6); height: calc(var(--S) * 1.6); border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--vibi-accent, #6366f1) 38%, transparent) 0%, transparent 62%); }
  img { position: relative; max-width: calc(var(--S) * 0.32); max-height: calc(var(--S) * 0.32); object-fit: contain; }
  .name { position: relative; font-size: calc(var(--S) * 0.075); font-weight: 900; letter-spacing: -0.02em; }
  .tag { position: relative; font-size: calc(var(--S) * 0.032); color: var(--vibi-muted, #94a3b8); }`,
    body: '<div class="lr"><div class="disc" id="disc"></div><img id="logo" alt=""><div class="name" id="name" data-vibi-prop="name"></div><div class="tag" id="tag" data-vibi-prop="tagline"></div></div>',
    script: `
  function apply() {
    var src = P('logo', '') || (vibi.style && vibi.style.logo) || '';
    var img = el('logo');
    if (src) { img.src = src; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
    el('name').textContent = P('name', 'Brand');
    el('tag').textContent = P('tagline', 'Made with code');
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var pd = easeOut(prog(t, 0, 1.1));
    el('disc').style.transform = 'translate(-50%, -50%) scale(' + (0.2 + 0.8 * pd) + ')';
    el('disc').style.opacity = String(pd);
    var pl = easeBack(prog(t, 0.25, 0.95));
    var img = el('logo'); img.style.transform = 'scale(' + (0.6 + 0.4 * pl) + ')'; img.style.opacity = String(clamp(prog(t, 0.25, 0.6), 0, 1));
    var pn = easeOut(prog(t, 0.7, 1.2)); el('name').style.opacity = String(pn); el('name').style.transform = 'translateY(' + ((1 - pn) * S * 0.03) + 'px)';
    var pt = easeOut(prog(t, 0.95, 1.45)); el('tag').style.opacity = String(pt);
  };`,
  }),
};

const wordCaptions: VideoPartDef = {
  id: 'word-captions',
  category: 'captions',
  name: 'Word-highlight captions',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Word-highlight captions', duration: 6, width, height,
    props: {
      text: { type: 'text', default: 'Every word lights up as it is spoken out loud', label: 'Text', multiline: true },
      wps: { type: 'number', default: 2.6, min: 0.5, max: 8, step: 0.1, label: 'Words per second' },
      group: { type: 'number', default: 4, min: 1, max: 10, step: 1, label: 'Words per line' },
      size: { type: 'number', default: 6, min: 2, max: 14, step: 0.5, label: 'Size (% of short side)' },
      highlight: { type: 'color', default: '', label: 'Highlight (empty = accent)' },
      bottom: { type: 'number', default: 26, min: 0, max: 80, step: 1, label: 'Distance from bottom (%)' },
    },
    css: `
  .cap { position: absolute; left: 6%; right: 6%; display: flex; flex-wrap: wrap; justify-content: center; gap: 0 0.28em;
    font-weight: 900; text-align: center; line-height: 1.15; text-shadow: 0 0.06em 0.2em rgba(0, 0, 0, 0.55); }
  .w { display: inline-block; }`,
    body: '<div class="cap" id="cap"></div>',
    script: `
  var words = [];
  function apply() {
    words = String(P('text', 'Every word lights up as it is spoken out loud')).split(/\\s+/).filter(function (s) { return s !== ''; });
    var cap = el('cap');
    cap.style.fontSize = (S * N('size', 6) / 100) + 'px';
    cap.style.bottom = N('bottom', 26) + '%';
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var wps = Math.max(0.1, N('wps', 2.6));
    var g = Math.max(1, Math.round(N('group', 4)));
    var idx = clamp(Math.floor((t - 0.2) * wps), -1, words.length - 1);
    var start = idx < 0 ? 0 : Math.floor(idx / g) * g;
    var cap = el('cap'); cap.textContent = '';
    var hl = P('highlight', '') || getComputedStyle(document.documentElement).getPropertyValue('--vibi-accent').trim() || '#6366f1';
    for (var i = start; i < Math.min(words.length, start + g); i++) {
      var span = document.createElement('span'); span.className = 'w'; span.textContent = words[i];
      if (i === idx) { span.style.color = hl; span.style.transform = 'scale(1.08)'; }
      else if (i > idx) { span.style.opacity = '0.45'; }
      cap.appendChild(span);
    }
    cap.style.opacity = idx < 0 ? '0' : '1';
  };`,
  }),
};

const titleCard: VideoPartDef = {
  id: 'title-card',
  category: 'text',
  name: 'Title card',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'Title card', duration: 5, width, height,
    props: {
      eyebrow: { type: 'text', default: 'Chapter 01', label: 'Small line above (empty = hidden)' },
      title: { type: 'text', default: 'One clear\nheadline', label: 'Title', multiline: true },
      subtitle: { type: 'text', default: 'A supporting line that says why it matters', label: 'Subtitle (empty = hidden)' },
      align: { type: 'choice', options: ['left', 'center'], default: 'left', label: 'Align' },
      size: { type: 'number', default: 10, min: 4, max: 18, step: 0.5, label: 'Title size (% of short side)' },
      exitBefore: { type: 'time', default: 0.5, min: 0, max: 5, step: 0.05, label: 'Exit before end (s)' },
    },
    css: `
  .tc { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
    gap: calc(var(--S) * 0.022); padding: calc(var(--H) * 0.1) calc(var(--W) * 0.08); }
  .eyebrow { font-size: calc(var(--S) * 0.03); font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--vibi-accent, #6366f1); }
  .rule { width: calc(var(--S) * 0.12); height: calc(var(--S) * 0.008); border-radius: 99px; background: var(--vibi-accent, #6366f1); transform-origin: left center; }
  .title { max-width: 100%; font-weight: 900; letter-spacing: -0.03em; line-height: 1.04; }
  .mask { overflow: hidden; padding-bottom: 0.08em; }
  .in { display: block; }
  .sub { max-width: calc(var(--W) * 0.72); font-size: calc(var(--S) * 0.04); line-height: 1.3; color: var(--vibi-muted, #94a3b8); }`,
    body: '<div class="tc" id="card"><div class="eyebrow" id="eyebrow" data-vibi-prop="eyebrow"></div><div class="rule" id="rule"></div><div class="title" id="title"></div><div class="sub" id="sub" data-vibi-prop="subtitle"></div></div>',
    script: `
  var lines = [];
  function apply() {
    var center = P('align', 'left') === 'center';
    var side = H > W ? 0.14 : 0.08;
    var card = el('card');
    card.style.alignItems = center ? 'center' : 'flex-start';
    card.style.textAlign = center ? 'center' : 'left';
    card.style.paddingRight = (W * side) + 'px';
    card.style.paddingLeft = (W * (center ? side : 0.08)) + 'px';
    el('rule').style.transformOrigin = center ? 'center' : 'left center';
    var eyebrow = OPT('eyebrow', 'Chapter 01');
    el('eyebrow').textContent = eyebrow;
    el('eyebrow').style.display = eyebrow === '' ? 'none' : '';
    var sub = OPT('subtitle', 'A supporting line that says why it matters');
    el('sub').textContent = sub;
    el('sub').style.display = sub === '' ? 'none' : '';
    var title = el('title');
    title.textContent = '';
    title.style.fontSize = (S * N('size', 10) / 100) + 'px';
    lines = [];
    var parts = String(P('title', 'One clear\\nheadline')).split('\\n');
    for (var i = 0; i < parts.length; i++) {
      var mask = document.createElement('div'); mask.className = 'mask';
      var inner = document.createElement('span'); inner.className = 'in'; inner.textContent = parts[i];
      mask.appendChild(inner); title.appendChild(mask); lines.push(inner);
    }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var outAt = DUR() - N('exitBefore', 0.5);
    var out = easeInOut(prog(t, outAt, outAt + 0.4));
    var pe = easeOut(prog(t, 0.1, 0.6));
    el('eyebrow').style.opacity = String(pe * (1 - out));
    el('eyebrow').style.transform = 'translateY(' + ((1 - pe) * S * 0.015) + 'px)';
    el('rule').style.transform = 'scaleX(' + (easeOut(prog(t, 0.2, 0.8)) * (1 - out)) + ')';
    for (var i = 0; i < lines.length; i++) {
      var d = 0.3 + i * 0.12;
      var p = easeOut(prog(t, d, d + 0.7));
      lines[i].style.transform = 'translateY(' + ((1 - p) * 105 - out * 105) + '%)';
    }
    var after = 0.6 + lines.length * 0.12;
    var ps = easeOut(prog(t, after, after + 0.6));
    el('sub').style.opacity = String(ps * (1 - out));
    el('sub').style.transform = 'translateY(' + ((1 - ps) * S * 0.02) + 'px)';
  };`,
  }),
};

const quote: VideoPartDef = {
  id: 'quote',
  category: 'text',
  name: 'Quote',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Quote', duration: 6, width, height,
    props: {
      text: { type: 'text', default: 'We shipped in a week\nwhat used to take a quarter.', label: 'Quote', multiline: true },
      author: { type: 'text', default: 'Alex Kim', label: 'Who said it (empty = hidden)' },
      role: { type: 'text', default: 'Head of Product', label: 'Role (empty = hidden)' },
      size: { type: 'number', default: 6.5, min: 3, max: 14, step: 0.5, label: 'Size (% of short side)' },
      exitBefore: { type: 'time', default: 0.5, min: 0, max: 5, step: 0.05, label: 'Exit before end (s)' },
    },
    css: `
  .q { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: calc(var(--S) * 0.03);
    padding: calc(var(--H) * 0.1) calc(var(--W) * 0.1); }
  .mark { height: calc(var(--S) * 0.085); font-size: calc(var(--S) * 0.2); font-weight: 900; line-height: 0.8; color: var(--vibi-accent, #6366f1);
    transform-origin: left bottom; }
  .text { font-weight: 700; letter-spacing: -0.015em; line-height: 1.22; }
  .line { display: block; }
  .by { display: flex; align-items: center; flex-wrap: wrap; gap: calc(var(--S) * 0.018); margin-top: calc(var(--S) * 0.012); }
  .dash { width: calc(var(--S) * 0.05); height: calc(var(--S) * 0.005); border-radius: 99px; background: var(--vibi-accent, #6366f1); transform-origin: left center; }
  .author { font-size: calc(var(--S) * 0.034); font-weight: 800; }
  .role { font-size: calc(var(--S) * 0.03); color: var(--vibi-muted, #94a3b8); }`,
    body: '<div class="q" id="q"><div class="mark" id="mark">&ldquo;</div><div class="text" id="text"></div><div class="by" id="by"><span class="dash" id="dash"></span><span class="author" id="author" data-vibi-prop="author"></span><span class="role" id="role" data-vibi-prop="role"></span></div></div>',
    script: `
  var lines = [];
  function apply() {
    el('q').style.paddingRight = (W * (H > W ? 0.14 : 0.1)) + 'px';
    var text = el('text');
    text.textContent = '';
    text.style.fontSize = (S * N('size', 6.5) / 100) + 'px';
    lines = [];
    var parts = String(P('text', 'We shipped in a week\\nwhat used to take a quarter.')).split('\\n');
    for (var i = 0; i < parts.length; i++) {
      var line = document.createElement('span'); line.className = 'line'; line.textContent = parts[i];
      text.appendChild(line); lines.push(line);
    }
    var author = OPT('author', 'Alex Kim');
    var role = OPT('role', 'Head of Product');
    el('author').textContent = author;
    el('author').style.display = author === '' ? 'none' : '';
    el('role').textContent = role;
    el('role').style.display = role === '' ? 'none' : '';
    el('by').style.display = author === '' && role === '' ? 'none' : '';
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var outAt = DUR() - N('exitBefore', 0.5);
    var out = easeInOut(prog(t, outAt, outAt + 0.4));
    el('mark').style.opacity = String(prog(t, 0.1, 0.4) * (1 - out));
    el('mark').style.transform = 'scale(' + (0.6 + 0.4 * easeBack(prog(t, 0.1, 0.7))) + ')';
    for (var i = 0; i < lines.length; i++) {
      var d = 0.35 + i * 0.18;
      var p = easeOut(prog(t, d, d + 0.6));
      lines[i].style.opacity = String(p * (1 - out));
      lines[i].style.transform = 'translateY(' + ((1 - p) * S * 0.025) + 'px)';
    }
    var after = 0.55 + lines.length * 0.18;
    var pb = easeOut(prog(t, after, after + 0.5));
    el('dash').style.transform = 'scaleX(' + pb + ')';
    el('by').style.opacity = String(pb * (1 - out));
  };`,
  }),
};

const deviceFrame: VideoPartDef = {
  id: 'device-frame',
  category: 'layout',
  name: 'Device frame',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Device frame', duration: 6, width, height,
    props: {
      device: { type: 'choice', options: ['browser', 'phone'], default: 'browser', label: 'Frame' },
      screen: { type: 'image', default: '', label: 'Screen image (empty = placeholder)' },
      fit: { type: 'choice', options: ['cover', 'contain'], default: 'cover', label: 'Image fit' },
      url: { type: 'text', default: 'yourapp.com', label: 'Address (browser frame)' },
      caption: { type: 'text', default: '', label: 'Caption (empty = hidden)' },
      push: { type: 'number', default: 3, min: 0, max: 12, step: 0.5, label: 'Slow push over the part (%)' },
      enter: { type: 'time', default: 0.15, min: 0, max: 5, step: 0.05, label: 'Enter at (s)' },
    },
    css: `
  .df { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--S) * 0.035); }
  .frame { position: relative; display: flex; flex-direction: column; flex: none; overflow: hidden;
    background: color-mix(in srgb, var(--vibi-bg, #0b1020) 86%, #fff); border: 1px solid color-mix(in srgb, var(--vibi-fg, #fff) 16%, transparent);
    box-shadow: 0 min(calc(var(--S) * 0.012), 14px) min(calc(var(--S) * 0.03), 32px) rgba(0, 0, 0, 0.42); }
  .frame.browser { border-radius: calc(var(--S) * 0.018); }
  .frame.phone { border-radius: calc(var(--S) * 0.07); padding: calc(var(--S) * 0.014); }
  .bar { display: flex; align-items: center; gap: calc(var(--S) * 0.01); padding: calc(var(--S) * 0.014) calc(var(--S) * 0.02);
    border-bottom: 1px solid color-mix(in srgb, var(--vibi-fg, #fff) 10%, transparent); }
  .frame.phone .bar { display: none; }
  .d { flex: none; width: calc(var(--S) * 0.014); height: calc(var(--S) * 0.014); border-radius: 99px; background: color-mix(in srgb, var(--vibi-fg, #fff) 26%, transparent); }
  .url { flex: 1; min-width: 0; margin-left: calc(var(--S) * 0.012); padding: calc(var(--S) * 0.006) calc(var(--S) * 0.018); border-radius: 99px;
    font-size: calc(var(--S) * 0.022); color: var(--vibi-muted, #94a3b8); background: color-mix(in srgb, var(--vibi-fg, #fff) 8%, transparent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .screen { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--vibi-bg, #0b1020); }
  .frame.phone .screen { border-radius: calc(var(--S) * 0.056); }
  .island { display: none; position: absolute; left: 36%; top: calc(var(--S) * 0.018); width: 28%; height: calc(var(--S) * 0.024); border-radius: 99px; background: #000; z-index: 2; }
  .frame.phone .island { display: block; }
  .shot { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
  .ph { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 5%; padding: 9% 7% 7%; }
  .b { border-radius: calc(var(--S) * 0.012); background: color-mix(in srgb, var(--vibi-fg, #fff) 10%, transparent); }
  .t1 { height: 7%; width: 46%; }
  .hero { flex: 3; background: color-mix(in srgb, var(--vibi-accent, #6366f1) 55%, transparent); }
  .t2 { height: 5%; width: 70%; }
  .row { flex: 2; display: flex; gap: 5%; }
  .row .b { flex: 1; }
  .cap { max-width: 80%; font-size: calc(var(--S) * 0.036); font-weight: 700; text-align: center; }`,
    body: '<div class="df"><div class="frame browser" id="frame"><div class="bar"><span class="d"></span><span class="d"></span><span class="d"></span><span class="url" id="url" data-vibi-prop="url"></span></div><div class="screen"><span class="island"></span><div class="ph" id="ph"><div class="b t1"></div><div class="b hero"></div><div class="b t2"></div><div class="row"><div class="b"></div><div class="b"></div><div class="b"></div></div></div><img class="shot" id="shot" alt=""></div></div><div class="cap" id="cap" data-vibi-prop="caption"></div></div>',
    script: `
  function apply() {
    var phone = P('device', 'browser') === 'phone';
    var cap = OPT('caption', '');
    var room = cap === '' ? 0.8 : 0.68;
    var fw, fh;
    if (phone) { fh = Math.min(H * room, W * 0.8 * 2.05); fw = fh / 2.05; }
    else { fw = Math.min(W * 0.84, H * room * 1.6); fh = fw / 1.6; }
    var frame = el('frame');
    frame.className = 'frame ' + (phone ? 'phone' : 'browser');
    frame.style.width = fw + 'px';
    frame.style.height = fh + 'px';
    el('url').textContent = P('url', 'yourapp.com');
    var src = P('screen', '');
    var shot = el('shot');
    if (src) { shot.src = src; shot.style.display = ''; el('ph').style.display = 'none'; }
    else { shot.removeAttribute('src'); shot.style.display = 'none'; el('ph').style.display = ''; }
    shot.style.objectFit = P('fit', 'cover') === 'contain' ? 'contain' : 'cover';
    el('cap').textContent = cap;
    el('cap').style.display = cap === '' ? 'none' : '';
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var a = N('enter', 0.15);
    var p = easeOut(prog(t, a, a + 0.8));
    var push = 1 + clamp(N('push', 3), 0, 12) / 100 * prog(t, 0, DUR());
    var frame = el('frame');
    frame.style.opacity = String(prog(t, a, a + 0.35));
    frame.style.transform = 'translateY(' + ((1 - p) * S * 0.07) + 'px) scale(' + ((0.94 + 0.06 * p) * push) + ')';
    var pc = easeOut(prog(t, a + 0.5, a + 1.0));
    el('cap').style.opacity = String(pc);
    el('cap').style.transform = 'translateY(' + ((1 - pc) * S * 0.02) + 'px)';
  };`,
  }),
};

const beforeAfter: VideoPartDef = {
  id: 'before-after',
  category: 'layout',
  name: 'Before / after',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Before / after', duration: 6, width, height,
    props: {
      before: { type: 'image', default: '', label: 'Before image (empty = placeholder)' },
      after: { type: 'image', default: '', label: 'After image (empty = placeholder)' },
      beforeLabel: { type: 'text', default: 'Before', label: 'Before label' },
      afterLabel: { type: 'text', default: 'After', label: 'After label' },
      split: { type: 'number', default: 50, min: 5, max: 95, step: 1, label: 'Where the divider rests (% from left)' },
      sweepAt: { type: 'time', default: 0.9, min: 0, max: 10, step: 0.05, label: 'Divider starts at (s)' },
      finish: { type: 'choice', options: ['reveal', 'hold'], default: 'reveal', label: 'At the end (reveal = show only the after side)' },
    },
    css: `
  .ba { position: absolute; overflow: hidden; border-radius: calc(var(--S) * 0.022); background: var(--vibi-bg, #0b1020);
    border: 1px solid color-mix(in srgb, var(--vibi-fg, #fff) 14%, transparent); }
  .side { position: absolute; inset: 0; background: var(--vibi-bg, #0b1020); }
  .after { background: color-mix(in srgb, var(--vibi-accent, #6366f1) 14%, var(--vibi-bg, #0b1020)); }
  .side img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
  .ph { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 4%; padding: 16% 8% 8%; }
  .b { height: 9%; border-radius: calc(var(--S) * 0.01); background: color-mix(in srgb, var(--vibi-muted, #94a3b8) 30%, transparent); }
  .w1 { width: 88%; } .w2 { width: 64%; } .w3 { width: 76%; } .w4 { width: 52%; } .w5 { width: 70%; }
  .after .b { background: color-mix(in srgb, var(--vibi-fg, #fff) 22%, transparent); }
  .after .hero { flex: 1; height: auto; background: color-mix(in srgb, var(--vibi-accent, #6366f1) 60%, transparent); }
  .tag { position: absolute; top: 5%; padding: calc(var(--S) * 0.008) calc(var(--S) * 0.02); border-radius: 99px;
    font-size: calc(var(--S) * 0.026); font-weight: 800; letter-spacing: 0.04em; background: color-mix(in srgb, var(--vibi-bg, #0b1020) 72%, transparent); }
  .tag.l { left: 4%; }
  .tag.r { right: 4%; color: var(--vibi-accent, #6366f1); }
  .div { position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--S) * 0.005); margin-left: calc(var(--S) * -0.0025); background: var(--vibi-fg, #f8fafc); }
  .knob { position: absolute; left: 50%; top: 50%; width: calc(var(--S) * 0.06); height: calc(var(--S) * 0.06); margin: calc(var(--S) * -0.03) 0 0 calc(var(--S) * -0.03);
    display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--vibi-fg, #f8fafc); color: var(--vibi-bg, #0b1020); }
  .knob svg { width: 60%; height: 60%; }`,
    body: '<div class="ba" id="card"><div class="side before"><div class="ph" id="phB"><div class="b w1"></div><div class="b w2"></div><div class="b w3"></div><div class="b w4"></div><div class="b w5"></div><div class="b w2"></div></div><img id="imgB" alt=""><span class="tag l" id="tagB" data-vibi-prop="beforeLabel"></span></div><div class="side after" id="after"><div class="ph" id="phA"><div class="b w4"></div><div class="b hero"></div><div class="b w3"></div></div><img id="imgA" alt=""><span class="tag r" id="tagA" data-vibi-prop="afterLabel"></span></div><div class="div" id="div"><span class="knob"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg></span></div></div>',
    script: `
  var cw = 0;
  function setImage(imgId, phId, src) {
    var img = el(imgId);
    if (src) { img.src = src; img.style.display = ''; el(phId).style.display = 'none'; }
    else { img.removeAttribute('src'); img.style.display = 'none'; el(phId).style.display = ''; }
  }
  function apply() {
    var portrait = H > W;
    var left = W * 0.07, right = W * (portrait ? 0.14 : 0.07), top = H * (portrait ? 0.2 : 0.1), bottom = H * (portrait ? 0.28 : 0.1);
    var card = el('card');
    cw = W - left - right;
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.width = cw + 'px';
    card.style.height = (H - top - bottom) + 'px';
    setImage('imgB', 'phB', P('before', ''));
    setImage('imgA', 'phA', P('after', ''));
    el('tagB').textContent = P('beforeLabel', 'Before');
    el('tagA').textContent = P('afterLabel', 'After');
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var split = clamp(N('split', 50), 5, 95);
    var a = N('sweepAt', 0.9);
    var endAt = DUR() - 1.5;
    var reveal = P('finish', 'reveal') !== 'hold';
    var p1 = easeInOut(prog(t, a, a + 1.2));
    var p2 = reveal ? easeInOut(prog(t, endAt, endAt + 1.0)) : 0;
    var pos = lerp(lerp(100, split, p1), 0, p2);
    el('after').style.clipPath = 'inset(0 0 0 ' + pos + '%)';
    el('div').style.transform = 'translateX(' + (cw * pos / 100) + 'px)';
    el('div').style.opacity = String(prog(t, a - 0.1, a + 0.15) * (1 - (reveal ? prog(t, endAt + 0.85, endAt + 1.0) : 0)));
    var pin = easeOut(prog(t, 0, 0.6));
    el('card').style.opacity = String(pin);
    el('card').style.transform = 'scale(' + (0.96 + 0.04 * pin) + ')';
  };`,
  }),
};

const steps: VideoPartDef = {
  id: 'steps',
  category: 'layout',
  name: 'Step progress',
  defaultDuration: 6,
  html: ({ width, height }) => partHtml({
    title: 'Step progress', duration: 6, width, height,
    props: {
      title: { type: 'text', default: 'How it works', label: 'Title (empty = hidden)' },
      steps: { type: 'text', default: 'Plan, Build, Review, Ship', label: 'Steps (comma separated)' },
      startAt: { type: 'time', default: 0.5, min: 0, max: 10, step: 0.05, label: 'First step lights up at (s)' },
      stepFor: { type: 'time', default: 0.9, min: 0.1, max: 10, step: 0.05, label: 'Time per step (s)' },
    },
    css: `
  .st { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: calc(var(--S) * 0.07);
    padding: calc(var(--H) * 0.1) calc(var(--W) * 0.07); }
  .title { font-size: calc(var(--S) * 0.055); font-weight: 800; letter-spacing: -0.02em; }
  .steps { position: relative; display: flex; }
  .steps.v { flex-direction: column; gap: calc(var(--S) * 0.05); }
  .step { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: calc(var(--S) * 0.022); text-align: center; }
  .steps.v .step { flex: none; flex-direction: row; height: calc(var(--S) * 0.085); gap: calc(var(--S) * 0.035); text-align: left; }
  .seg { position: absolute; left: 50%; top: calc(var(--S) * 0.0395); width: 100%; height: calc(var(--S) * 0.006);
    background: color-mix(in srgb, var(--vibi-fg, #fff) 18%, transparent); }
  .steps.v .seg { left: calc(var(--S) * 0.0395); top: 50%; width: calc(var(--S) * 0.006); height: calc(100% + var(--S) * 0.05); }
  .fill { position: absolute; inset: 0; background: var(--vibi-accent, #6366f1); transform-origin: left top; }
  .dot { position: relative; flex: none; width: calc(var(--S) * 0.085); height: calc(var(--S) * 0.085); display: flex; align-items: center; justify-content: center;
    border-radius: 50%; background: var(--vibi-bg, #0b1020); border: calc(var(--S) * 0.004) solid color-mix(in srgb, var(--vibi-fg, #fff) 28%, transparent);
    font-size: calc(var(--S) * 0.036); font-weight: 800; font-variant-numeric: tabular-nums; }
  .on { position: absolute; inset: calc(var(--S) * -0.004); border-radius: 50%; background: var(--vibi-accent, #6366f1); }
  .num { position: relative; }
  .label { font-size: calc(var(--S) * 0.034); font-weight: 700; line-height: 1.2; }`,
    body: '<div class="st" id="st"><div class="title" id="title" data-vibi-prop="title"></div><div class="steps" id="steps"></div></div>',
    script: `
  var rows = [];
  var vertical = false;
  function apply() {
    var title = OPT('title', 'How it works');
    el('title').textContent = title;
    el('title').style.display = title === '' ? 'none' : '';
    var labels = LIST('steps', 'Plan, Build, Review, Ship');
    vertical = H > W;
    el('st').style.paddingRight = (W * (vertical ? 0.14 : 0.07)) + 'px';
    var host = el('steps');
    host.textContent = '';
    host.className = 'steps' + (vertical ? ' v' : '');
    rows = [];
    for (var i = 0; i < labels.length; i++) {
      var step = document.createElement('div'); step.className = 'step';
      var fill = null;
      if (i < labels.length - 1) {
        var seg = document.createElement('div'); seg.className = 'seg';
        fill = document.createElement('div'); fill.className = 'fill';
        seg.appendChild(fill); step.appendChild(seg);
      }
      var dot = document.createElement('div'); dot.className = 'dot';
      var on = document.createElement('span'); on.className = 'on';
      var num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1);
      dot.appendChild(on); dot.appendChild(num);
      var label = document.createElement('div'); label.className = 'label'; label.textContent = labels[i];
      step.appendChild(dot); step.appendChild(label); host.appendChild(step);
      rows.push({ step: step, on: on, label: label, fill: fill });
    }
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var a = N('startAt', 0.5);
    var per = Math.max(0.1, N('stepFor', 0.9));
    el('title').style.opacity = String(easeOut(prog(t, 0, 0.5)));
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var at = a + i * per;
      var lit = prog(t, at, at + 0.35);
      r.step.style.opacity = String(easeOut(prog(t, 0.1 + i * 0.08, 0.5 + i * 0.08)));
      r.on.style.opacity = String(clamp(lit * 2, 0, 1));
      r.on.style.transform = 'scale(' + (0.5 + 0.5 * easeBack(lit)) + ')';
      r.label.style.opacity = String(0.42 + 0.58 * easeOut(lit));
      if (r.fill) r.fill.style.transform = (vertical ? 'scaleY(' : 'scaleX(') + prog(t, at + 0.15, at + per) + ')';
    }
  };`,
  }),
};

const endCard: VideoPartDef = {
  id: 'end-card',
  category: 'brand',
  name: 'End card',
  defaultDuration: 5,
  html: ({ width, height }) => partHtml({
    title: 'End card', duration: 5, width, height,
    props: {
      logo: { type: 'image', default: '', label: 'Logo (empty = the style card logo)' },
      title: { type: 'text', default: 'Your product', label: 'Name' },
      tagline: { type: 'text', default: 'One line that stays with them', label: 'Tagline (empty = hidden)' },
      cta: { type: 'text', default: 'Get started', label: 'Call to action (empty = hidden)' },
      url: { type: 'text', default: 'yourapp.com', label: 'Address (empty = hidden)' },
    },
    css: `
  .ec { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--S) * 0.026);
    padding: calc(var(--H) * 0.1) calc(var(--W) * 0.1); text-align: center; }
  img { max-width: calc(var(--S) * 0.2); max-height: calc(var(--S) * 0.2); margin-bottom: calc(var(--S) * 0.01); object-fit: contain; }
  .title { font-size: calc(var(--S) * 0.085); font-weight: 900; letter-spacing: -0.03em; line-height: 1.05; }
  .tag { max-width: calc(var(--W) * 0.7); font-size: calc(var(--S) * 0.038); line-height: 1.3; color: var(--vibi-muted, #94a3b8); }
  .cta { margin-top: calc(var(--S) * 0.02); padding: calc(var(--S) * 0.02) calc(var(--S) * 0.05); border-radius: 99px;
    font-size: calc(var(--S) * 0.04); font-weight: 800; background: var(--vibi-accent, #6366f1); color: var(--vibi-fg, #f8fafc); }
  .url { font-size: calc(var(--S) * 0.03); letter-spacing: 0.04em; color: var(--vibi-muted, #94a3b8); }`,
    body: '<div class="ec"><img id="logo" alt=""><div class="title" id="title" data-vibi-prop="title"></div><div class="tag" id="tag" data-vibi-prop="tagline"></div><div class="cta" id="cta" data-vibi-prop="cta"></div><div class="url" id="url" data-vibi-prop="url"></div></div>',
    script: `
  function setText(id, value) { el(id).textContent = value; el(id).style.display = value === '' ? 'none' : ''; }
  function apply() {
    var src = P('logo', '') || (vibi.style && vibi.style.logo) || '';
    var img = el('logo');
    if (src) { img.src = src; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
    el('title').textContent = P('title', 'Your product');
    setText('tag', OPT('tagline', 'One line that stays with them'));
    setText('cta', OPT('cta', 'Get started'));
    setText('url', OPT('url', 'yourapp.com'));
  }
  apply();
  vibi.onProps = apply;
  window.__vibi.seek = function (t) {
    var img = el('logo');
    img.style.opacity = String(prog(t, 0.1, 0.45));
    img.style.transform = 'scale(' + (0.7 + 0.3 * easeBack(prog(t, 0.1, 0.8))) + ')';
    var pt = easeOut(prog(t, 0.3, 0.9));
    el('title').style.opacity = String(pt);
    el('title').style.transform = 'translateY(' + ((1 - pt) * S * 0.03) + 'px)';
    var pg = easeOut(prog(t, 0.5, 1.1));
    el('tag').style.opacity = String(pg);
    el('tag').style.transform = 'translateY(' + ((1 - pg) * S * 0.02) + 'px)';
    el('cta').style.opacity = String(prog(t, 0.8, 1.05));
    el('cta').style.transform = 'scale(' + (0.8 + 0.2 * easeBack(prog(t, 0.8, 1.4))) + ')';
    el('url').style.opacity = String(easeOut(prog(t, 1.1, 1.6)));
  };`,
  }),
};

/** 서랍 순서 그대로(칸은 처음 나온 갈래 순 — 글자·숫자·화면과 구성·브랜드·자막). */
export const VIDEO_PARTS: readonly VideoPartDef[] = [
  titleCard, lowerThird, kineticType, quote, counter, barChart, lineChart, donutChart, codeTyping,
  deviceFrame, beforeAfter, steps, logoReveal, endCard, wordCaptions,
];

export function findPart(id: string): VideoPartDef | undefined {
  return VIDEO_PARTS.find((p) => p.id === id);
}

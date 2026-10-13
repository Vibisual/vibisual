/**
 * §5.13 (V) 37-11 — **우리가 쓴 부품** 아홉 (순수 — HTML 문자열을 만든다).
 *
 * 하단 자막 · 키네틱 타이포 · 숫자 카운터 · 막대 차트 · 선 차트 · 도넛 차트 · 코드 타이핑 · 로고 등장 · 단어 강조 자막.
 * 전부 외부 라이브러리 0 · Apache-2.0 · 값 선언(`vibi-props`) · 스타일 변수(`--vibi-*`) · 판형 반응형 · 시각의 순수 함수다.
 * 서랍에서 꺼내면 문서마다 **사본**이 `compositions/<부품>-n/index.html` 로 서고(사람·AI 가 고쳐도 원본은 그대로), 그 사본은 평범한
 * 코드 컴포지션이다 — 다른 컴포지션과 똑같이 값 손잡이·가리키기·검수·렌더가 된다.
 *
 * ⚠ 아래 스크립트 문자열 안에는 백틱·`${` 를 쓰지 않는다(이 파일의 템플릿 문자열이 그 뜻을 바꾼다). 문자열은 `+` 로 잇는다.
 */
import { partHtml } from './shell.js';

export type PartCategory = 'text' | 'data' | 'brand' | 'captions';

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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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
  vibi.seek = function (t) {
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

/** 서랍 순서 그대로. */
export const VIDEO_PARTS: readonly VideoPartDef[] = [
  lowerThird, kineticType, counter, barChart, lineChart, donutChart, codeTyping, logoReveal, wordCaptions,
];

export function findPart(id: string): VideoPartDef | undefined {
  return VIDEO_PARTS.find((p) => p.id === id);
}

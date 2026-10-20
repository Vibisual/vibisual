/**
 * §5.13 (T-2) — 컴포지션 런타임 심과 CSP 조립 (순수 — 문자열만 만든다).
 *
 * 서버가 컴포지션 HTML 을 내줄 때 `<head>` 맨 앞에 이 스크립트를 넣는다(T-3). 그래서 컴포지션 코드가 시계·난수를
 * 처음 만지는 순간 이미 아래 규칙이 서 있다.
 *
 * - **시각은 렌더러가 정한다** — 부모가 `{__vibi:'seek', t, seq}` 를 보내면 그 순간의 모습이 된다. 맞추는 길은 셋을
 *   순서대로 전부 적용한다: ① 타임라인 객체(`__vibi.timelines`·`__timelines` — 덕 타이핑, 라이브러리 이름을 묻지 않는다)
 *   ② `__vibi.seek(t)` ③ `document.getAnimations()`(CSS 애니메이션·Web Animations — 의존성 0 인 기본 엔진).
 * - **가상 시계** — `performance.now`·`Date`·rAF·타이머가 렌더러의 시각을 듣는다. 프레임 콜백은 출력 fps 가 아니라
 *   **고정 60Hz 틱**마다 분다(30fps 문서에서 절반 속도가 되지 않게). `Math.random` 은 문서 시드에서 파생한다.
 * - **소리를 내는 API 는 무음 대역** — 던지지 않고 성공한 척한다(로드할 때 `new AudioContext()` 부터 부르는 코드가 흔해서,
 *   던지면 그림까지 멈춘다).
 * - **다 그려진 뒤에만 `ready`** — 캡처는 글꼴·그림 디코딩·진짜 프레임 둘(멈춘 창이면 150ms 상한)을 기다린다.
 *   미리보기 요청은 자원과 그리기 함수만 기다린다 — 화면 표시는 브라우저의 다음 페인트가 맡는다.
 * - **§5.13 (V) 데이터 메시지(읽기 전용)** — `props`(값 갈아 끼우기 → `[data-vibi-prop]` 글자·그림·`--vibi-prop-*` 와 컴포지션의
 *   `__vibi.onProps`) · `pick`(그 자리 요소를 읽어 `picked`) · `inspect`(보이는 글자 상자를 읽어 `inspected`). 받은 것을
 *   코드로 실행하는 길은 없다. 문서 스타일은 시작 값(`--vibi-*`·`__vibi.style`)으로 들어온다. `__vibi.cue` 는 표지를 알린다.
 * - **§5.13 (T-8) 훑기** — `scan{ to, step, seq }` 를 받으면 0초부터 `to` 까지 고정 걸음으로 시계를 한 번 흘린다(그리기를
 *   기다리지 않는다). 그 사이 알린 표지(`cue`)·오류(`error{ t }` — 죽은 가상 시각)가 차례로 올라가고 끝에 `scanned` 를 보낸다.
 * - **§5.13 (Z) 41-1 직통 채널** — `loaded{ port:true }` 로 받을 수 있다고 알리면, 부모가 `{__vibi:'port'}` 와 함께 건넨
 *   `MessagePort` 로 그 뒤 모든 요청·답이 오간다(다른 프로세스 프레임 사이의 `window.postMessage` 는 앱 본체 UI 스레드를
 *   거친다 — 거기가 멈추면 미리보기도 멎었다). 포트는 부모 창에서 온 것만 받는다.
 * - **§5.13 (Z) 41-2 스스로 재생** — `play{ base, anchor, min, until, grid, fps }` 를 받으면 자기 진짜 rAF 마다 에포크 시계로
 *   제 시각을 계산해 미리보기 박자로 맞춘다(늦은 프레임은 버린다). `pause{ seq }` 는 멈춘 시각을 `paused` 로 답하고,
 *   `seek`·`scan` 도 스스로 재생을 멈춘다.
 *
 * ⚠ 아래 `COMPOSITION_RUNTIME_JS` 는 **브라우저가 그대로 실행하는 JS 문자열**이다. 함수 `toString()` 으로 만들지
 * 않는 이유: 번들러가 함수 안에 자기 도우미(`__name` 등)를 끼워 넣으면 iframe 안에서 그 이름을 못 찾아 죽는다.
 * 문자열 안에는 백틱·`${`·역슬래시를 쓰지 않는다(이 파일이 템플릿 문자열이라 그 셋은 뜻이 바뀐다).
 */

import { COMPOSITION_CLOCK_EPOCH, COMPOSITION_RAF_HZ } from '../constants.js';

export const COMPOSITION_RUNTIME_JS = `(function (init) {
  'use strict';
  if (window.__vibiRuntimeInstalled) return;
  window.__vibiRuntimeInstalled = true;

  var parentWin = window.parent;
  var own = Object.prototype.hasOwnProperty;
  /* §5.13 (Z) 41-1 — once the stage hands over a port, every answer travels on it (see the message section). */
  var vibiPort = null;
  function post(msg) {
    try {
      if (vibiPort) { vibiPort.postMessage(msg); return; }
      parentWin.postMessage(msg, '*');
    } catch (e) { /* the stage is gone */ }
  }
  function report(err) {
    var text = 'error';
    try { text = err && (err.stack || err.message) ? String(err.stack || err.message) : String(err); } catch (e) { /* keep default */ }
    /* t = the virtual time it broke at (§5.13 (T-8) — the cue scan reports "it dies at 34s" before a render) */
    post({ __vibi: 'error', message: text.slice(0, 2000), t: vt / 1000 });
  }

  var realRAF = window.requestAnimationFrame.bind(window);
  /* §5.13 (Z) 41-2 — the real clock (epoch ms) before the virtual one below replaces performance.now. */
  var realPerfNow = window.performance && typeof window.performance.now === 'function' ? window.performance.now.bind(window.performance) : function () { return 0; };
  var perfOrigin = window.performance && typeof window.performance.timeOrigin === 'number' ? window.performance.timeOrigin : 0;
  var realSetTimeout = window.setTimeout.bind(window);
  var realClearTimeout = window.clearTimeout ? window.clearTimeout.bind(window) : function () {};
  var realCancelRAF = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : function () {};
  var TICK = 1000 / (init.rafHz > 0 ? init.rafHz : 60);
  var EPOCH = typeof init.epoch === 'number' ? init.epoch : 0;
  var vt = 0;
  var nextTick = 0;
  var usesFrames = false;

  /* ---- virtual timers ---- */
  var timerSeq = 1;
  var timers = new Map();
  function addTimer(fn, ms, args, repeat) {
    var id = timerSeq++;
    var delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: vt + delay, fn: fn, args: args, every: repeat ? Math.max(1, delay) : 0, order: id });
    usesFrames = true;
    return id;
  }
  window.setTimeout = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), false); };
  window.setInterval = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), true); };
  window.clearTimeout = function (id) { timers.delete(id); };
  window.clearInterval = function (id) { timers.delete(id); };
  window.requestIdleCallback = function (cb) {
    return addTimer(function () { cb({ didTimeout: false, timeRemaining: function () { return 0; } }); }, 0, [], false);
  };
  window.cancelIdleCallback = function (id) { timers.delete(id); };

  /* ---- virtual frame callbacks ---- */
  var rafSeq = 1;
  var rafs = new Map();
  window.requestAnimationFrame = function (cb) { var id = rafSeq++; rafs.set(id, cb); usesFrames = true; return id; };
  window.cancelAnimationFrame = function (id) { rafs.delete(id); };

  /* ---- virtual clocks ---- */
  try { window.performance.now = function () { return vt; }; } catch (e) { /* read-only build */ }
  var RealDate = window.Date;
  function VirtualDate() {
    if (!new.target) return new RealDate(EPOCH + vt).toString();
    var args = Array.prototype.slice.call(arguments);
    return Reflect.construct(RealDate, args.length > 0 ? args : [EPOCH + vt], new.target);
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = function () { return EPOCH + vt; };
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;
  window.Date = VirtualDate;

  /* ---- seeded random ---- */
  var seed = (Number(init.seed) >>> 0) || 2654435769;
  Math.random = function () {
    seed = (seed + 1831565813) >>> 0;
    var t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---- silent sound APIs ---- */
  var PROMISED = { resume: 1, suspend: 1, close: 1, decodeAudioData: 1, addModule: 1, startRendering: 1 };
  function silent() {
    var target = function () {};
    return new Proxy(target, {
      get: function (_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === Symbol.toPrimitive) return function () { return 0; };
        if (prop === 'currentTime') return vt / 1000;
        if (prop === 'state') return 'running';
        if (prop === 'sampleRate') return 48000;
        if (typeof prop === 'string' && own.call(PROMISED, prop)) return function () { return Promise.resolve(silent()); };
        return silent();
      },
      set: function () { return true; },
      apply: function () { return silent(); },
      construct: function () { return silent(); }
    });
  }
  function SilentAudio() { return silent(); }
  try { window.AudioContext = SilentAudio; } catch (e) { /* locked */ }
  try { window.webkitAudioContext = SilentAudio; } catch (e) { /* locked */ }
  try { window.OfflineAudioContext = SilentAudio; } catch (e) { /* locked */ }
  try {
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = function () {};
      window.speechSynthesis.cancel = function () {};
    }
  } catch (e) { /* locked */ }
  try {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('Vibistudio compositions do not play media.', 'NotAllowedError'));
    };
  } catch (e) { /* locked */ }

  /* ---- document style (one palette for every composition) ---- */
  var style = init.style && typeof init.style === 'object' ? init.style : null;
  function quoteless(v) { return String(v).split('"').join('').split('<').join(''); }
  if (style) {
    try {
      var rootStyle = document.documentElement.style;
      if (style.accent) rootStyle.setProperty('--vibi-accent', quoteless(style.accent));
      if (style.bg) rootStyle.setProperty('--vibi-bg', quoteless(style.bg));
      if (style.fg) rootStyle.setProperty('--vibi-fg', quoteless(style.fg));
      if (style.muted) rootStyle.setProperty('--vibi-muted', quoteless(style.muted));
      var family = style.fontUrl ? '"VibiStyleFont", ' : '';
      if (style.fontFamily) family += '"' + quoteless(style.fontFamily) + '", ';
      rootStyle.setProperty('--vibi-font', family + 'system-ui, sans-serif');
      if (style.fontUrl) {
        var face = document.createElement('style');
        face.textContent = '@font-face { font-family: "VibiStyleFont"; src: url("' + quoteless(style.fontUrl) + '"); font-display: block; }';
        (document.head || document.documentElement).appendChild(face);
      }
    } catch (e) { /* no document element yet */ }
  }

  /* ---- props bindings: [data-vibi-prop] elements and --vibi-prop-* variables ---- */
  var PROP_ATTR = 'data-vibi-prop';
  var SAFE_ATTRS = { src: 1, href: 1, alt: 1, title: 1, fill: 1, stroke: 1, width: 1, height: 1, x: 1, y: 1, r: 1, cx: 1, cy: 1, d: 1, opacity: 1, 'aria-label': 1 };
  function applyBindings(values) {
    var bound = 0;
    try {
      var root = document.documentElement;
      for (var key in values) {
        if (!own.call(values, key)) continue;
        var v = values[key];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') root.style.setProperty('--vibi-prop-' + key, String(v));
      }
      var els = document.querySelectorAll('[' + PROP_ATTR + ']');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var name = el.getAttribute(PROP_ATTR);
        if (!name || !own.call(values, name)) continue;
        var val = values[name];
        if (val === null || val === undefined || typeof val === 'object') continue;
        var text = String(val);
        var attr = el.getAttribute('data-vibi-prop-attr');
        if (attr) {
          if (!own.call(SAFE_ATTRS, attr) || text.trim().toLowerCase().indexOf('javascript:') === 0) continue;
          el.setAttribute(attr, text);
        } else if (el.tagName === 'IMG') {
          if (text.trim().toLowerCase().indexOf('javascript:') === 0) continue;
          el.setAttribute('src', text);
        } else {
          el.textContent = text;
        }
        bound++;
      }
    } catch (e) { report(e); }
    return bound;
  }

  /* ---- the __vibi object (props are the document's data for this item) ---- */
  var OWNED = { props: 1, item: 1, fps: 1, duration: 1, width: 1, height: 1, time: 1, style: 1, cue: 1 };
  var vibi = {
    props: init.props && typeof init.props === 'object' ? init.props : {},
    item: String(init.itemId || ''),
    fps: Number(init.fps) || 30,
    duration: typeof init.duration === 'number' ? init.duration : null,
    width: Number(init.width) || 0,
    height: Number(init.height) || 0,
    timelines: [],
    seek: null,
    onProps: null,
    style: style ? { accent: style.accent || null, bg: style.bg || null, fg: style.fg || null, muted: style.muted || null, fontFamily: style.fontFamily || null, logo: style.logoUrl || null } : null,
    cue: function (name, at) {
      var n = String(name || '');
      if (n === '') return;
      var when = typeof at === 'number' && isFinite(at) ? at : vt / 1000;
      post({ __vibi: 'cue', name: n.slice(0, 80), t: when });
    },
    time: function () { return vt / 1000; }
  };
  try {
    Object.defineProperty(window, '__vibi', {
      configurable: false,
      get: function () { return vibi; },
      set: function (value) {
        if (!value || typeof value !== 'object' || value === vibi) return;
        for (var k in value) if (own.call(value, k) && !own.call(OWNED, k)) vibi[k] = value[k];
      }
    });
  } catch (e) { window.__vibi = vibi; }

  /* ---- seeking ---- */
  var paused = new WeakSet();
  function timelineList() {
    var out = [];
    function add(src) {
      if (!src) return;
      if (Array.isArray(src)) { for (var i = 0; i < src.length; i++) out.push(src[i]); return; }
      if (typeof src === 'object') { for (var k in src) if (own.call(src, k)) out.push(src[k]); }
    }
    add(vibi.timelines);
    add(window.__timelines);
    return out;
  }
  function alignTimelines(t) {
    var list = timelineList();
    for (var i = 0; i < list.length; i++) {
      var tl = list[i];
      if (!tl || (typeof tl !== 'object' && typeof tl !== 'function')) continue;
      try {
        if (!paused.has(tl)) { paused.add(tl); if (typeof tl.pause === 'function') tl.pause(); }
        if (typeof tl.seek === 'function') tl.seek(t);
        else if (typeof tl.time === 'function') tl.time(t);
        else if ('currentTime' in tl) tl.currentTime = t * 1000;
      } catch (e) { report(e); }
    }
  }
  /*
   * §5.13 (Y) 40-8 ② — document.getAnimations() is costly in Chromium even when the list is empty. Call it only when an
   * animation can exist: a stylesheet or inline style mentions keyframes/animation/transition, or code called animate()/play().
   * Linked stylesheets cannot be read from an opaque origin, so they count as "may animate" (conservative).
   */
  var mayAnimate = false;
  var sheetsChecked = false;
  function cssMayAnimate(text) {
    var s = String(text || '').toLowerCase();
    return s.indexOf('@keyframes') >= 0 || s.indexOf('animation') >= 0 || s.indexOf('transition') >= 0;
  }
  function scanSheets() {
    sheetsChecked = true;
    try {
      if (document.querySelectorAll('link[rel~=stylesheet]').length > 0) { mayAnimate = true; return; }
      var styles = document.querySelectorAll('style');
      for (var i = 0; i < styles.length; i++) if (cssMayAnimate(styles[i].textContent)) { mayAnimate = true; return; }
      var styled = document.querySelectorAll('[style]');
      for (var j = 0; j < styled.length; j++) if (cssMayAnimate(styled[j].getAttribute('style'))) { mayAnimate = true; return; }
    } catch (e) { mayAnimate = true; }
  }
  function noteMutations(records) {
    if (mayAnimate || !records) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') {
        if (r.target && r.target.getAttribute && cssMayAnimate(r.target.getAttribute('style'))) { mayAnimate = true; return; }
      } else {
        /* a new or edited style/link element: read the sheets again */
        sheetsChecked = false;
      }
    }
  }
  var animObserver = null;
  try {
    animObserver = new MutationObserver(noteMutations);
    animObserver.observe(document.documentElement || document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
  } catch (e) { animObserver = null; mayAnimate = true; }
  try {
    var realAnimate = Element.prototype.animate;
    if (typeof realAnimate === 'function') Element.prototype.animate = function () { mayAnimate = true; return realAnimate.apply(this, arguments); };
  } catch (e) { mayAnimate = true; }
  try {
    var realPlay = window.Animation && window.Animation.prototype && window.Animation.prototype.play;
    if (typeof realPlay === 'function') window.Animation.prototype.play = function () { mayAnimate = true; return realPlay.apply(this, arguments); };
  } catch (e) { mayAnimate = true; }
  function alignAnimations(t) {
    if (typeof document.getAnimations !== 'function') return;
    if (animObserver && !mayAnimate) noteMutations(animObserver.takeRecords());
    if (!mayAnimate && !sheetsChecked) scanSheets();
    if (!mayAnimate) return;
    var list = document.getAnimations();
    for (var i = 0; i < list.length; i++) {
      try { list[i].pause(); list[i].currentTime = t * 1000; } catch (e) { /* finished or invalid */ }
    }
  }
  /*
   * §5.13 (Y) 40-8 ③ — a composition that answers seeks itself (timelines or __vibi.seek) is random-access even when it
   * also uses frame callbacks or timers (library tickers, particles). Only a composition that relies on frame callbacks
   * alone is forward-only (the stage must reopen it to go back).
   */
  function hasSeekHooks() { return typeof vibi.seek === 'function' || timelineList().length > 0; }
  function seekMode() { return usesFrames && !hasSeekHooks() ? 'forward' : 'random'; }
  /* a random-access composition jumps instead of replaying thousands of ticks (going back, or forward by more than this) */
  var JUMP_MS = 2000;
  function fireTimers(now) {
    for (var guard = 0; guard < 100000; guard++) {
      var due = null;
      var dueId = 0;
      timers.forEach(function (tm, id) {
        if (tm.at <= now + 0.000001 && (due === null || tm.at < due.at || (tm.at === due.at && tm.order < due.order))) { due = tm; dueId = id; }
      });
      if (due === null) return;
      if (due.every > 0) { due.at += due.every; due.order = timerSeq++; } else { timers.delete(dueId); }
      try { if (typeof due.fn === 'function') due.fn.apply(window, due.args); } catch (e) { report(e); }
    }
  }
  function fireRafs(now) {
    if (rafs.size === 0) return;
    var batch = Array.from(rafs.values());
    rafs.clear();
    for (var i = 0; i < batch.length; i++) { try { batch[i](now); } catch (e) { report(e); } }
  }
  function runTicks(targetMs) {
    while (nextTick * TICK <= targetMs + 0.000001) {
      vt = nextTick * TICK;
      fireTimers(vt);
      fireRafs(vt);
      nextTick += 1;
    }
  }
  function settle(preview) {
    var waits = [];
    try { if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready.catch(function () {})); } catch (e) { /* no FontFaceSet */ }
    try {
      var imgs = document.images;
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!img.complete && typeof img.decode === 'function') waits.push(img.decode().catch(function () {}));
      }
    } catch (e) { /* no images */ }
    return Promise.all(waits).then(function () {
      /* Live preview already runs on the host's paint clock. Two more rAFs here cap it below 30fps. */
      if (preview) return;
      return new Promise(function (resolve) {
        var done = false;
        var raf = null;
        var timer = null;
        function finish() {
          if (done) return;
          done = true;
          if (timer !== null) realClearTimeout(timer);
          if (raf !== null) realCancelRAF(raf);
          resolve();
        }
        raf = realRAF(function () { if (!done) raf = realRAF(finish); });
        timer = realSetTimeout(finish, 150);
      });
    });
  }
  function doSeek(t, preview) {
    var target = t * 1000;
    if (usesFrames && !(hasSeekHooks() && (target < vt || target - vt > JUMP_MS))) {
      runTicks(target);
    } else {
      /* nothing waits on ticks, so the clock may jump to t in either direction (seeking back included) */
      vt = target;
      nextTick = Math.ceil(target / TICK);
    }
    alignTimelines(t);
    var out;
    if (typeof vibi.seek === 'function') { try { out = vibi.seek(t); } catch (e) { report(e); } }
    alignAnimations(t);
    return Promise.resolve(out).catch(report).then(function () { return settle(preview); });
  }
  var chain = Promise.resolve();
  var lastSeek = null;

  /*
   * §5.13 (Z) 41-2 — self-play. While the stage plays it sends one 'play' instead of a seek per frame, and the composition
   * advances its own clock on its own (real) frames: at epoch time T its time is base + (T - anchor) seconds, kept on the
   * document's frame grid (grid = item start - trim, so the frames are the ones the stage would have asked for) and inside
   * [min, until). A frame that is not finished when the next one is due is skipped (late frames are dropped, like a video
   * player) - a busy host thread no longer freezes the picture. 'pause' answers the time it stopped at; any 'seek' or
   * 'scan' also stops it.
   */
  var playState = null;
  var playBusy = false;
  /* the first self-played frame after a 'play' is announced once ('played') - the stage then knows this frame has a picture */
  var playReported = false;
  function playFrameAt(state, epochMs) {
    var t = state.base + (epochMs - state.anchor) / 1000;
    var g = Math.floor((t + state.grid) * state.fps + 0.000001);
    var gMin = Math.ceil((state.min + state.grid) * state.fps - 0.000001);
    if (g < gMin) g = gMin;
    if (state.until !== null) {
      var gMax = Math.ceil((state.until + state.grid) * state.fps - 0.000001) - 1;
      if (g > gMax) g = Math.max(gMin, gMax);
    }
    return g / state.fps - state.grid;
  }
  function playTick() {
    var state = playState;
    if (!state) return;
    realRAF(playTick);
    if (playBusy) return;
    var q = playFrameAt(state, perfOrigin + realPerfNow());
    if (state.last !== null && Math.abs(q - state.last) < 0.000001) return;
    state.last = q;
    lastSeek = q;
    playBusy = true;
    chain = chain.then(function () { return doSeek(q, true); }).then(function () {
      playBusy = false;
      if (!playReported && playState === state) { playReported = true; post({ __vibi: 'played', t: q, mode: seekMode() }); }
    }, function (err) { playBusy = false; report(err); });
  }
  function num(v, fallback) { var n = Number(v); return typeof v === 'number' && isFinite(n) ? n : fallback; }
  function onPlay(d) {
    var fps = num(d.fps, vibi.fps);
    var next = {
      base: num(d.base, 0), anchor: num(d.anchor, 0), min: num(d.min, 0), grid: num(d.grid, 0),
      until: typeof d.until === 'number' && isFinite(d.until) ? d.until : null,
      fps: fps > 0 ? fps : 30, last: playState ? playState.last : null
    };
    var was = playState !== null;
    playState = next;
    if (!was) { playReported = false; realRAF(playTick); }
  }
  function stopPlay() { playState = null; }
  function onPause(d) {
    stopPlay();
    chain = chain.then(function () { post({ __vibi: 'paused', seq: d.seq, t: lastSeek === null ? 0 : lastSeek }); });
  }

  /* §5.13 (V) 37-6 — read-only picking: describe the element at a point (no DOM change). */
  function cssPath(el) {
    var parts = [];
    var node = el;
    for (var depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      var part = tag;
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      var cls = String(node.getAttribute('class') || '').split(' ').filter(function (c) { return c !== ''; }).slice(0, 2);
      if (cls.length > 0) part += '.' + cls.join('.');
      var parent = node.parentElement;
      if (parent) {
        var same = 0;
        var index = 0;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) { same++; if (parent.children[i] === node) index = same; }
        }
        if (same > 1) part += ':nth-of-type(' + index + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  function onPick(d) {
    var x = Number(d.x);
    var y = Number(d.y);
    /* A composition may describe Canvas/WebGL objects through its own read-only adapter. */
    if (typeof vibi.pick === 'function' && isFinite(x) && isFinite(y)) {
      try {
        var picked = vibi.pick({ x: x, y: y, t: vt / 1000 });
        if (picked && typeof picked === 'object' && typeof picked.objectId === 'string' && picked.rect) {
          post({ __vibi: 'picked', seq: d.seq, path: String(picked.path || 'object:' + picked.objectId),
            objectId: picked.objectId, adapter: String(picked.adapter || 'canvas'), properties: picked.properties || {},
            tag: String(picked.tag || 'canvas'), text: String(picked.text || ''), prop: picked.prop || null, rect: picked.rect });
          return;
        }
      } catch (e) { report(e); }
    }
    var el = isFinite(x) && isFinite(y) ? document.elementFromPoint(x, y) : null;
    if (!el || el === document.documentElement || el === document.body) { post({ __vibi: 'picked', seq: d.seq, path: '' }); return; }
    var bound = typeof el.closest === 'function' ? el.closest('[' + PROP_ATTR + ']') : null;
    var text = '';
    try { text = String(el.innerText || el.textContent || '').trim().slice(0, 200); } catch (e) { text = ''; }
    post({ __vibi: 'picked', seq: d.seq, path: cssPath(el), tag: el.tagName.toLowerCase(), text: text,
      prop: bound ? bound.getAttribute(PROP_ATTR) : null, rect: rectOf(el) });
  }
  /* §5.13 (V) 37-9 — read-only inspection: visible text boxes (for the motion review). */
  function onInspect(d) {
    var out = [];
    try {
      var all = document.body ? document.body.getElementsByTagName('*') : [];
      for (var i = 0; i < all.length && out.length < 80; i++) {
        var el = all[i];
        var ownText = '';
        for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) ownText += c.nodeValue;
        ownText = ownText.trim();
        if (ownText === '') continue;
        var box = rectOf(el);
        if (box.width <= 0 || box.height <= 0) continue;
        var cs = window.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        out.push({ path: cssPath(el), text: ownText.slice(0, 120), color: cs.color, fontSize: parseFloat(cs.fontSize) || 0, rect: box });
      }
    } catch (e) { report(e); }
    post({ __vibi: 'inspected', seq: d.seq, texts: out });
  }
  /* §5.13 (V) 37-5 — new data for this item: swap props, update bindings, call the composition's own hook, redraw. */
  function onProps(d) {
    var values = d.values && typeof d.values === 'object' ? d.values : {};
    var target = vibi.props;
    for (var k in target) if (own.call(target, k)) delete target[k];
    for (var key in values) if (own.call(values, key)) target[key] = values[key];
    var bound = applyBindings(target);
    var hook = typeof vibi.onProps === 'function';
    if (hook) { try { vibi.onProps(target); } catch (e) { report(e); } }
    var live = bound > 0 || hook || typeof vibi.seek === 'function';
    chain = chain.then(function () { return lastSeek === null ? null : doSeek(lastSeek); }).then(function () {
      post({ __vibi: 'props-applied', seq: d.seq, live: live });
    }, function (err) {
      report(err);
      post({ __vibi: 'props-applied', seq: d.seq, live: live });
    });
  }

  /*
   * §5.13 (T-8) — cue scan: run the clock once from 0 to d.to in fixed steps without waiting for paint, so every
   * __vibi.cue call (and every error, with its time) reaches the parent. Nothing is drawn or captured.
   */
  function onScan(d) {
    var to = Number(d.to);
    var step = Number(d.step);
    if (!isFinite(to) || to < 0) to = 0;
    if (!isFinite(step) || step <= 0) step = 1 / 30;
    var count = Math.min(200000, Math.ceil(to / step));
    chain = chain.then(function () {
      var i = 0;
      function next() {
        if (i > count) return null;
        var t = Math.min(to, i * step);
        i++;
        var target = t * 1000;
        if (usesFrames) {
          runTicks(target);
        } else {
          vt = target;
          nextTick = Math.ceil(target / TICK);
        }
        alignTimelines(t);
        var out;
        if (typeof vibi.seek === 'function') { try { out = vibi.seek(t); } catch (e) { report(e); } }
        return Promise.resolve(out).catch(report).then(next);
      }
      return next();
    }).then(function () {
      lastSeek = to;
      post({ __vibi: 'scanned', seq: d.seq, to: to });
    }, function (err) {
      report(err);
      post({ __vibi: 'scanned', seq: d.seq, to: to });
    });
  }

  /*
   * §5.13 (Z) 41-1 — the stage hands over a MessagePort after 'loaded' ({__vibi:'port'} + the port). From then on every
   * request and answer travels on that port: a window.postMessage between frames of different processes is relayed through
   * the browser process UI thread (the app's main thread, where its server runs), so each stall there froze the preview.
   * Only the parent window may hand a port; messages on it are handled exactly like the parent's.
   */
  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (d && typeof d === 'object' && d.__vibi === 'port') {
      var port = e.ports && e.ports[0];
      if (!port) return;
      if (vibiPort) { try { vibiPort.close(); } catch (x) { /* already closed */ } }
      vibiPort = port;
      port.onmessage = function (ev) { handle(ev.data); };
      return;
    }
    handle(d);
  });
  function handle(d) {
    if (!d || typeof d !== 'object') return;
    if (d.__vibi === 'play') { onPlay(d); return; }
    if (d.__vibi === 'pause') { onPause(d); return; }
    if (d.__vibi === 'props') { onProps(d); return; }
    if (d.__vibi === 'scan') { stopPlay(); onScan(d); return; }
    if (d.__vibi === 'pick') { onPick(d); return; }
    if (d.__vibi === 'inspect') { onInspect(d); return; }
    if (d.__vibi !== 'seek') return;
    stopPlay();
    var t = Number(d.t);
    if (!isFinite(t) || t < 0) t = 0;
    var seq = d.seq;
    var preview = d.preview === true;
    lastSeek = t;
    chain = chain.then(function () { return doSeek(t, preview); }).then(function () {
      post({ __vibi: 'ready', seq: seq, t: t, mode: seekMode() });
    }, function (err) {
      report(err);
      post({ __vibi: 'ready', seq: seq, t: t, mode: seekMode() });
    });
  }

  /* ---- lifecycle ---- */
  window.addEventListener('error', function (e) { report(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { report(e.reason); });
  document.addEventListener('securitypolicyviolation', function (e) {
    post({ __vibi: 'blocked', url: String(e.blockedURI || ''), directive: String(e.violatedDirective || '') });
  });
  function declared() {
    function meta(name) {
      var el = document.querySelector('meta[name="' + name + '"]');
      return el ? el.getAttribute('content') : null;
    }
    return { duration: meta('vibi:duration'), size: meta('vibi:size') };
  }
  var loadedSent = false;
  document.addEventListener('DOMContentLoaded', function () { applyBindings(vibi.props); });
  function sendLoaded() {
    if (loadedSent) return;
    loadedSent = true;
    /* port: this runtime takes a MessagePort (41-1) and self-play (41-2) — older runtimes simply do not say so. */
    post({ __vibi: 'loaded', mode: seekMode(), declared: declared(), port: true });
  }
  if (document.readyState === 'complete') realSetTimeout(sendLoaded, 0);
  else window.addEventListener('load', function () { realSetTimeout(sendLoaded, 0); });
})`;

/** 심에 넘기는 값 — 그 아이템의 데이터와 결정성의 씨앗. */
export interface CompositionRuntimeInit {
  readonly props: Readonly<Record<string, unknown>>;
  /** 문서 `seed` + 아이템 id 에서 파생한 32비트 정수. */
  readonly seed: number;
  readonly itemId: string;
  readonly fps: number;
  /** 선언 길이(초) — 모르면 null. */
  readonly duration: number | null;
  readonly width: number;
  readonly height: number;
  readonly rafHz?: number;
  readonly epoch?: number;
  /** §5.13 (V) 37-10 — 문서 스타일(글꼴·로고는 내주기 주소). */
  readonly style?: CompositionRuntimeStyle;
}

/** §5.13 (V) 37-10 — 심에 넘기는 스타일. */
export interface CompositionRuntimeStyle {
  readonly accent: string;
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  readonly fontFamily?: string;
  readonly fontUrl?: string;
  readonly logoUrl?: string;
}

/** JSON 은 그대로 두지만 `<script>` 안에서는 줄 끝으로 읽히는 두 글자 — 소스에 날것으로 쓰지 않으려고 코드로 만든다. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
/** `<script>` 안에 그대로 넣을 수 있게 JSON 을 감싼다(`</script>` 조기 종료·줄 구분 문자 방지). */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

/** 컴포지션 문서에 주입할 스크립트 본문(태그 없이). */
export function compositionRuntimeScript(init: CompositionRuntimeInit): string {
  const full = { rafHz: COMPOSITION_RAF_HZ, epoch: COMPOSITION_CLOCK_EPOCH, ...init };
  return `${COMPOSITION_RUNTIME_JS}(${scriptSafeJson(full)});`;
}

/** 문서 시드 + 아이템 id → 32비트 씨앗(FNV-1a). 같은 문서·같은 아이템이면 언제나 같은 수열. */
export function compositionSeed(docSeed: number | undefined, itemId: string): number {
  let hash = (Number.isFinite(docSeed) ? (docSeed as number) : 0) ^ 0x811c9dc5;
  for (let i = 0; i < itemId.length; i += 1) {
    hash ^= itemId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * §5.13 (T-3) ③ — 컴포지션 문서의 CSP. `sources` 는 그 컴포지션 폴더를 내주는 주소 앞머리들(경로까지 — 같은
 * vibproxy 의 다른 갈래나 우리 REST 를 부르지 못하게)이다. 바깥과는 한 바이트도 주고받지 못한다.
 */
export function compositionCsp(sources: readonly string[]): string {
  const src = sources.join(' ');
  return [
    "default-src 'none'",
    `script-src ${src} 'unsafe-inline'`,
    `style-src ${src} 'unsafe-inline'`,
    `img-src ${src} data: blob:`,
    `font-src ${src} data: blob:`,
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** 속성 값 안에 넣을 문자열(큰따옴표 속성). */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 컴포지션 HTML 의 `<head>` 맨 앞에 CSP meta 와 런타임 심을 넣는다. `<head>` 가 없으면 `<html>` 뒤에, 그것도 없으면
 * doctype 뒤(없으면 맨 앞)에 `<head>` 를 만들어 넣는다. 원본 HTML 은 그대로 두고 사본을 돌려준다.
 */
export function injectCompositionRuntime(html: string, csp: string, runtime: string, extra = ''): string {
  // §5.13 (T-6) — `extra` = 들여놓은 라이브러리 태그(`vibi:libs`)·글꼴 선언. 심 **뒤**, 컴포지션 스크립트 **앞**.
  const block = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}"><script>${runtime}</script>${extra}`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + block + html.slice(at);
  }
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${block}</head>${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}<head>${block}</head>${html.slice(at)}`;
  }
  return `<head>${block}</head>${html}`;
}

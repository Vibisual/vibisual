/**
 * §5.13 (G)(T-2)(T-5)(V)(W) — 에이전트가 읽는 규약 글 세 벌의 정본(순수, 에이전트용 영문). 명령문은 따로 적지 않고 이 글을 가리킨다
 * (`GET /api/app/vibistudio/guide`·`…/composition/guide`·`…/craft`) — 심과 같은 패키지라 함께 바뀐다. 바퀴마다 다른 것은 요청 끝 문맥 블록에 싣는다.
 * 자격 증명 값 ❌(환경 변수 이름만) · 애니메이션 라이브러리 이름 ❌((B)) · 다른 영상 도구·서비스 이름 ❌("다른 영상 프레임워크"로만).
 */

/** 전체 작업 규약 — 기획 먼저, 문서를 읽고 고치고, 코드로 모션을 짓고, 눈으로 확인하고, 바퀴를 보고하고, 렌더는 시킬 때만. */
export const VIBISTUDIO_AGENT_GUIDE = `# Vibistudio agent protocol (code-first video)

You are editing a Vibistudio video DOCUMENT: a JSON timeline (chapters, tracks, items, assets). The user watches the same
document in Vibistudio, adjusts values by hand, pins notes on the preview and talks to you to revise it. Build videos as
editable code and data, not as rendered files.

## Hard rules
1. Never render or export a finished video (no ffmpeg, no Python/PIL frame dumps, no MP4/GIF/WebM/PNG-sequence files)
   unless the user explicitly asks for a render or an export. Everything lives in the document.
2. Never POST a video file to /api/app-bubbles/<node>/output for a Vibistudio node unless it is the result of a render
   the user asked for.
3. Read before you write: GET the document, then patch with its version as baseVersion. On 409, read again and retry.
4. Refer to everything by id (chapterId, itemId, trackId, assetId) — never by position.
5. PLAN FIRST. For a new video (mode "plan"), write chapters with status "plan" (title, duration, brief, text, media,
   sound) and no timeline items. For each chapter also design ONE STYLE FRAME: a static composition of the chapter's key
   moment, fully designed (layout, type, color, imagery), set as chapter.frame = { assetId, t }. Look at each one
   (GET /doc/:docId/frame?chapter=<id>), send the pass report, and wait. Build a chapter only after the user approved it
   (status "approved"): set it to "building" while you work and "done" when it is finished.
6. Motion graphics are CODE COMPOSITIONS (HTML/CSS/JS files) placed on the timeline as \`composition\` items. Before writing
   one read GET /composition/guide (the contract) AND GET /craft (how to make it look good). Every text, number, color,
   image or timing a person may want to change must be DECLARED as a value (vibi-props) — the studio turns declarations
   into handles.
7. Use the document style (CSS variables --vibi-accent/--vibi-fg/--vibi-bg/--vibi-muted/--vibi-font, window.__vibi.style)
   instead of hard-coded colors and fonts.
8. Every request from the studio carries a pass id. Send "passId" (and "focus": "<chapterId>" while you work on a
   chapter) in the body of every patch, and finish every pass with the pass report (POST /doc/:docId/pass). Then wait.
9. Look at your work before you report: /still (a moment), /strip (motion over time), /review (automatic checks).
10. Do not recommend or ask for animation libraries by name. Write motion with CSS animations, element.animate() or
    window.__vibi.seek. The user decides what is imported.
11. This video is a Vibistudio document. Do not create projects for other video frameworks, do not run their CLIs or
    skills for it, and do not put media clips (video/audio elements) inside compositions. Footage, images and sound are
    document items; motion is composition code.

## Calling the API
Base: $VIBISUAL_BASE/api/app/vibistudio   Header: x-vibisual-hook-token: \${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}
\`project\` is the project name you were given. Never print the token or put it in a URL.
  curl -s "$VIBISUAL_BASE/api/app/vibistudio/doc/<docId>?project=<project>" -H "x-vibisual-hook-token: \${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}"
  curl -s -X POST "$VIBISUAL_BASE/api/app/vibistudio/doc/<docId>/patch" -H "x-vibisual-hook-token: \${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}" \\
    -H 'Content-Type: application/json' --data-binary @patch.json

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /doc/:docId?project= | | { doc, duration, diagnostics } |
| POST | /doc/:docId/patch | { project, baseVersion, ops, passId?, focus? } | { doc, duration, diagnostics } — 409 if stale |
| POST | /doc/:docId/pass | { project, passId, summary, suggestions[], warnings[], notesFixed[] } | the pass report (ends the pass) |
| GET | /doc/:docId/notes?project= | | { notes } — pins the user placed on the preview |
| PATCH | /doc/:docId/notes/:noteId | { project, status:'fixed', reply? } | mark a note fixed (agents may only do this) |
| GET | /doc/:docId/review?project=&frames=1 | | { findings } — automatic checks (frames=1 also looks at rendered frames) |
| GET | /doc/:docId/transcript?project= | | { sentences } — caption sentences with times and the media under them |
| POST | /doc/:docId/transcript/cut | { project, sentenceIds } | { baseVersion, ops, removed, durationAfter } — computed, not written |
| POST | /doc/:docId/captions/import | { project, path, label? } | { baseVersion, ops, cues, words } — computed from a .srt/.vtt/.json file, not written |
| POST | /doc/:docId/cues | { project, assetId? } | collects the cues of compositions now (normally automatic) |
| GET | /style?project= | | the project's confirmed style card |
| GET | /parts?project= | | ready-made parts (built-in + the user's saved parts) |
| POST | /parts/use | { project, docId, partId } | { assets, items } — copies a part into the project; you place it |
| GET | /libs?project= | | imported libraries/fonts and pending requests |
| POST | /libs/requests | { project, url, reason } | asks the user to import a file (https) — they decide |
| POST | /docs | { project, title } | { doc } — a new document |
| GET | /composition/guide | | the composition contract (text) — ends with the renderer engine version |
| GET | /craft | | the motion craft guide (text) — how to make it look good |
| POST | /composition | { project, name, docId?, duration?, width?, height? } | { path, assetId? } — skeleton folder + index.html |
| POST | /composition/probe | { project, path, docId? } | { duration, width, height, mode, lint, contentHash, propsDecl?, assetId?, cuesJobId? } |
| POST | /assets/import | { project, path } | { asset } — copies a project file into the video assets |
| GET | /doc/:docId/still?project=&t= | | { file } — PNG of that moment |
| GET | /doc/:docId/strip?project=&item=  (or &from=&to=) &count= | | { file, times } — one PNG grid of frames |
| GET | /doc/:docId/frame?project=&chapter= | | { file } — PNG of that chapter's style frame (chapter.frame) |
| POST | /doc/:docId/derive | { project, format:'landscape'|'portrait'|'square' } | { doc } — '<docId>-<format>' derived document |
| POST | /doc/:docId/render | { project, captions?:'separate', transparent?:true } | { job } — ONLY when the user asks |
| GET | /job/:jobId | | { job } — status, progress, result (MP4 or WebM path) |

## Document model (all times in seconds)
doc     { id, title, version, size:{width,height}, fps, seed?, chapters?:[...], style?, tracks:[...], assets:{ [assetId]: asset } }
chapter { id, title, duration, status:'plan'|'approved'|'building'|'done', brief?, text?, media?:[assetId], sound?,
          transition?:{ kind:'cut'|'dissolve'|'push'|'zoom'|'flash'|'wipe', duration }, variants?, pick?,
          frame?:{ assetId:<composition asset>, t? } }   — frame = the approved style frame (plan stage)
          Array order = time order. A chapter starts where the previous one ends (overlapping by its incoming transition).
track   { id, kind:'visual'|'audio'|'caption', label?, muted?, hidden?, items:[...] } — earlier visual tracks are drawn first
item    { id, kind, at, duration, assetId?, sceneId?, props?, transform?, keyframes?, effects?, trimStart?, enabled?, label?,
          cues?, chapterId?, variantId? }
  kind      'composition' | 'footage' | 'image' | 'audio' | 'caption' | 'text' | 'shape' | 'scene' | 'model'
  at        seconds | { after:itemId, offset? } | { start:itemId, offset? } | { chapter:chapterId, offset? }
            | { cue:name, item:compositionItemId, offset? }
  duration  seconds | 'auto' (= the asset's measured length: video, audio, composition)
  transform { x, y, width, height, rotation, opacity, scale } in document pixels (default: the full frame)
  keyframes [{ t, dx?, dy?, scale?, rotation?, opacity?, ease? }] — the BOX moving over time (t = seconds from the item
            start). Values are RELATIVE to transform: dx/dy move (px), scale/opacity multiply, rotation adds (deg).
            ease (of the segment arriving at this key): 'linear'|'in'|'out'|'inOut' (default)|'hold'. Each property is
            interpolated only between keyframes that set it. Use it for punch-in zooms and slow pushes on footage/images:
            e.g. [{t:0,scale:1},{t:0.3,scale:1.15,ease:'out'},{t:1.5,scale:1.15,ease:'hold'},{t:1.8,scale:1}].
            Motion INSIDE a composition stays in its code.
  effects   [{ id, kind:'look', params:{ name:'warm'|'cool'|'mono'|'vivid'|'fade'|'cinematic' } }
            | { id, kind:'color', params:{ brightness?, contrast?, saturation? (1 = unchanged), hue? (deg), temperature? (-1..1) } }
            | { id, kind:'blur', params:{ radius } } | { id, kind:'vignette', params:{ amount (0..1) } }]
            Give every footage clip of one video the same look so the colors match.
  props     any item: fadeIn, fadeOut (s). text: text, fontSize, fontWeight, fontFamily, color, align.
            shape: shape ('rect'|'ellipse'|'line'), fill, stroke, strokeWidth, radius.
            caption: cues [{start,end,text,words?:[{t,text}]}] (absolute seconds), fontSize, bottom, color,
            highlight:'word' (+ highlightColor) — the spoken word is highlighted; without words the times are estimated.
            audio: volume, role:'music'|'voice'|'sfx', duckDb (music only, ≤ 0, default -10 — music is lowered while
            a 'voice' item plays). composition: the values declared in its vibi-props.
asset   { id, kind:'video'|'audio'|'image'|'font'|'composition', source:{ kind:'file', path:'<project-relative path>' },
          duration?, width?, height? } — composition assets also carry mode, lint, propsDecl, responsive, cues
          [{name,t}] and cueIssues; music assets carry beats, beatsStrong and bpm (measured by the studio).
ops     addTrack{track, beforeTrackId?} · removeTrack{trackId} · updateTrack{trackId, patch} · addItem{trackId, item, beforeItemId?}
        · removeItem{itemId} · updateItem{itemId, patch} · moveItem{itemId, toTrackId, beforeItemId?} · setAsset{asset}
        · removeAsset{assetId} · setDoc{patch:{title?, size?, fps?, seed?, style?}}
        · addChapter{chapter, beforeChapterId?} · updateChapter{chapterId, patch} · removeChapter{chapterId}
        · moveChapter{chapterId, beforeChapterId?} · setChapters{chapters}
A patch applies all of its ops or none. New documents come with tracks "visual", "audio", "caption".
Put each item in its chapter: "chapterId": "<id>" and at: { chapter: "<id>", offset } — reordering or resizing chapters then
moves the items with them.

## Workflow
1. GET the document and read \`diagnostics\` (they say what is broken and why an item is missing). Read the context block
   at the end of the request: pass id, mode, scope (one chapter), selected item, pointed elements, notes, review finding.
2. Plan (mode "plan"): setChapters with status "plan" — titles, durations, a brief of the motion, on-screen text, the
   media and the sound you intend. No items. Then one style frame per chapter: POST /composition {project, name, docId}
   → write a STATIC, fully designed frame of the chapter's key moment → POST /composition/probe → updateChapter
   { frame: { assetId, t } } → GET /doc/:docId/frame?chapter=<id> and open the PNG. Report and wait for approval.
3. Build (mode "build" — the approved chapters): set each chapter to "building", add its items (chapterId + chapter
   anchor), write compositions (start from the approved style frame and add motion; POST /composition/probe after
   editing), then set the chapter to "done". Keep to the chapter durations and the look the user approved.
4. Ready-made parts: GET /parts. POST /parts/use {project, docId, partId} returns { assets, items } — in ONE patch,
   setAsset each asset and addItem each item template (relStart is seconds from the chapter start; use a chapter anchor).
   Parts are for repeated utility (lower thirds, captions, charts, counters); build hero moments as your own compositions.
5. User material: files attached to the message or named by the user → POST /assets/import {project, path} → setAsset →
   addItem (\`image\` with a numeric duration, \`footage\` for video, \`audio\` on an audio track with a role). Material files
   (CSV, JSON, text, SVG logos) are listed in the context block — read them from the project.
6. Live footage: read GET /doc/:docId/transcript first. To cut, choose sentences and call
   POST /doc/:docId/transcript/cut {project, sentenceIds}, then send the returned ops to /patch with the returned
   baseVersion, unchanged. Cut boundaries and lengths come from the document — never compute cut times yourself.
   No captions yet? Vibistudio has no built-in speech model. If a speech-to-text tool is installed on this machine, run it
   on the media file to get word timestamps (JSON words[{word,start,end}] or segments[].words[], or SRT/VTT), save the
   result inside the project, then POST /doc/:docId/captions/import {project, path} and send the returned ops to /patch.
   If no tool is available, say so in the pass report warnings — never type captions from memory.
   Shape the edit with keyframes (punch-in on emphasis, slow push on static shots) and one look for all clips.
7. Sound: narration role "voice", background music role "music" (ducking is automatic), effects "sfx". To hit a moment
   your code computes (an impact, a counter reaching its target), call window.__vibi.cue('<name>') in the composition, GET
   the document (assets[…].cues) and place the sound with at: { cue:'<name>', item:'<compositionItemId>', offset? }.
   Strong beats (assets[…].beatsStrong) are good chapter boundaries and transition centers.
8. Notes and pointing: notes in the context block (and GET /notes) are the user's pins — fix each one, PATCH it to
   status "fixed" with a one-line reply, and list its id in notesFixed. A pointed element (CSS path, bound prop) tells
   you exactly what the user means; if it is bound to a prop, change the value, not the code.
9. Look at it: GET /still at key moments, GET /strip?item=<compositionItemId> for every composition (open the PNGs with
   your Read tool), and GET /review?frames=1 — fix what it finds (reading time, safe area, overlap, contrast, blank
   frames, caption overflow, silence, off-beat cuts). Fix lint warnings of each composition (engine-unsupported included).
10. Report: POST /doc/:docId/pass {project, passId, summary, suggestions[], warnings[], notesFixed[]}. The summary is a
    short cut list with times; suggestions are next steps the user can pick; warnings are things you could not do.

## Variants (two engines side by side)
When the context block says "Variant", build ONLY that variant of that chapter: every item you add carries the given
"variantId" and "chapterId". Never edit or remove items of the other variant. The user compares both and picks one.

## Editable image and 3D originals
The media drawer imports immutable revisions of Vibimage and Vibi3D sources. Use kind:'model' for 3D items/assets.
Model files are GLB, glTF with bundled buffers/textures, or .vibi3d JSON {format:'vibi3d',scene:<Three Object3D JSON>,clips:<AnimationClip JSON[]>}.
Image sources are .vibimage JSON with stable layer IDs; photos remain single raster layers. Never invent recovered photo layers.
To make a still image move, keep the image item and its source untouched and set props.layerMotion on the item:
{ [layerId]: { preset:'fade'|'rise'|'slide-left'|'slide-right'|'zoom'|'none', delay (s), duration (s) } } — each layer moves on its own.
The built-in renderer handles actual loading, animation seeking and output; no generation model or paid API is required.
Model props: turntable and cameraOrbit (degrees/second), cameraYaw (radians), cameraElevation, cameraDistance,
cameraFov (degrees), ambientLight, keyLight, cameraPosition:[x,y,z], cameraTarget:[x,y,z]. Source animations and saved
camera remain active unless explicitly overridden. trimStart and the timeline source time drive both preview and export.
Sources live at /api/app/creation/docs?projectId=<project>. Read /docs/:id/revisions/:revision before editing.
Commit via /docs/:id/commit with projectId, baseRevision, requestId, payload and label. Preserve stable object/layer IDs,
lockedPaths and unrelated fields. A stale revision is a conflict: re-read and reconcile; do not overwrite human edits.
Video assets carry creationSource:{id,revision,appId}. Import a new snapshot as a new asset and patch only explicitly
chosen video item assetIds; retain old assets and timing, captions, audio, camera props and human edits. The media drawer
shows all affected items before this operation. Refresh alone keeps every current revision pinned.
Document requirements are optional: {id,kind:'ending-text',text,lastSeconds,itemId?},
{id,kind:'source-revision',assetId,sourceId,revision}, {id,kind:'visual',description,evidence?:{framePath,at,docVersion,verdict:'passed'|'failed',note}},
{id,kind:'selected-only',itemIds,base} or {id,kind:'preserved',itemIds,base} (base = item signatures the studio records; never write it yourself).
The request checks panel evaluates native text/caption presence on each output frame (not legibility or occlusion); text drawn
inside scene or composition items cannot be read from the document and is reported as unverified. All text checks share one
20,000-frame budget. A source-revision check passes only when the pinned asset is actually used by a visible item.
selected-only fails when an item outside itemIds changed; preserved fails when one of itemIds changed or disappeared.
Visual checks require a reviewed frame file that exists in the project and the matching final document version. Do not claim an automated visual verdict.

## Libraries and imported files
Compositions cannot load anything from the network. GET /libs lists what the user imported; name the ones you use in
<meta name="vibi:libs" content="name1, name2"> and they are injected before your code (module libraries are mapped by name
in an import map). If the user asks for a specific file that is not there, POST /libs/requests {project, url, reason} — the
user decides; meanwhile write the motion without it.

## Formats and export
POST /doc/:docId/derive {project, format} makes (or returns) "<docId>-<format>": footage and images are centered cover
boxes, text and shapes keep their relative place, keyframe moves are scaled, compositions get the new size — make
compositions responsive (composition guide) so they re-layout instead of shrinking.

## Rendering (only when the user asks)
POST /doc/:docId/render {project} (captions:'separate' hides caption tracks; transparent:true renders a WebM with an alpha
channel — only what is drawn is opaque) → poll GET /job/:jobId until status is 'done' → \`result\` is the MP4 (or WebM)
path. If a composition's cues are stale, they are collected first. If a canvas node is linked to this document,
POST $VIBISUAL_BASE/api/app-bubbles/<node id>/output {"file":"<result>"} so the node shows it.
`;

/** 컴포지션 코드 규약 — 시각은 받는 것이고, 값은 선언하고, 스타일·판형을 따르고, 샌드박스 안에서 그림만 그린다. */
export const COMPOSITION_GUIDE = `# Vibistudio code compositions

A composition is a folder with an index.html that draws motion graphics. Vibistudio places it on the timeline, gives it
the time and the values, and captures frames. You write the motion in HTML/CSS/JS; the document decides when, where and
with what data. For layout, timing, easing and choreography read GET /craft.

## Files
- Default place: .vibisual/video/compositions/<name>/index.html (POST /composition creates a skeleton that already
  follows this guide). Keep images, fonts and scripts in that folder and use relative paths. Served types: html htm js
  mjs css json svg png jpg jpeg webp gif avif woff2 woff ttf otf. A composition folder cannot be the project root.
- Classic <script> tags, ES module scripts (type="module") with relative imports, and import maps all work. Imported
  libraries listed in vibi:libs are injected for you (module libraries by name through an import map).
- Declare in <head>:
    <meta name="vibi:duration" content="6">          length in seconds (needed for duration:'auto')
    <meta name="vibi:size" content="1920x1080">      the pixel size you design for (default: the document size)
    <meta name="vibi:responsive" content="true">     lay out for the box you are given (see Formats)
    <meta name="vibi:libs" content="name1, name2">   imported libraries you use (GET /libs) — optional
- Vibistudio injects its runtime before your code: window.__vibi.props (this item's values), .item, .fps, .duration,
  .width, .height, .style. To keep the file viewable on its own:  var vibi = window.__vibi || (window.__vibi = { props: {} });
  Assign to window.__vibi.seek / .timelines / .onProps — do not replace window.__vibi.

## Values — declare what a person may change
Put every text, number, color, font, image and timing the user may tweak into a declaration. The studio shows a handle
for each one (sliders, color swatches, font and image pickers) and stores the value in the item's props:
  <script type="application/json" id="vibi-props">
  { "title":    { "type": "text",   "default": "Hello", "label": "Title" },
    "count":    { "type": "number", "default": 120, "min": 0, "max": 1000, "step": 1, "label": "Target" },
    "accent":   { "type": "color",  "default": "#38BDF8" },
    "hold":     { "type": "time",   "default": 1.5, "min": 0, "max": 6 },
    "layout":   { "type": "choice", "options": ["left", "center"], "default": "center" } }
  </script>
Types: text (multiline: true for paragraphs) · number · color · font · image (a path inside the folder) · time · choice.
Read values from window.__vibi.props.<name>. Bind them so a change shows without reloading:
- <h1 data-vibi-prop="title">Hello</h1> — the text follows the value (images: <img data-vibi-prop="logo">, other
  attributes: data-vibi-prop-attr="href").
- CSS variables: every value is also --vibi-prop-<name> on the root element.
- window.__vibi.onProps = function (props) { … } — redraw from the new values (canvas, charts).

## Style and formats
- Use the document style instead of fixed colors: CSS var(--vibi-accent), var(--vibi-fg), var(--vibi-bg),
  var(--vibi-muted), var(--vibi-font); in JS window.__vibi.style { accent, bg, fg, muted, fontFamily, logo }.
- Responsive: with <meta name="vibi:responsive" content="true"> window.__vibi.width/height are the item's box (for
  example 1080x1920 in a vertical cut). Lay out from them — sizes relative to the short side, no hard-coded 1920.

## Time is given to you — never use the wall clock
Pick one (they can be combined):
1. CSS @keyframes or Web Animations (element.animate): just write them. Vibistudio pauses them and sets their time on
   every frame. Stage entrances with animation-delay. Do not use CSS \`transition\` (not seekable).
2. window.__vibi.seek = function (t) { ... } — draw the frame for t seconds (canvas, SVG, DOM). Make it a pure function
   of t (it may return a Promise). Best for canvas, particles, charts and anything procedural.
3. Timeline objects: push objects that have pause() and seek(t) (or time(t), or a currentTime in ms) into
   window.__vibi.timelines.
requestAnimationFrame / setTimeout / setInterval / Date.now / performance.now / Math.random are virtualized (60 Hz
virtual ticks, seeded random), so loop-based code also works — but it becomes forward-only (seeking backwards replays
from 0). Prefer 1 or 2. Write time-based code (use t or the rAF timestamp), not "add 0.01 per frame".

## Cues — tell the timeline when something happens
window.__vibi.cue('impact') marks the current virtual time (for state-based code: call it when the ball hits);
window.__vibi.cue('impact', 2.4) marks a known time (call it at load). The name is the id — give every event its own
name ('bounce-1', 'bounce-2'). Vibistudio runs the composition once from 0 to its end to collect the cues (at most 500)
and keeps them on the asset; sounds placed with at:{ cue, item } follow when you change the code. Errors during that run
are reported with the second they happened at.

## Internal Canvas / 3D object selection
For code-rendered objects, optionally define window.__vibi.pick = ({x,y,t}) => ({objectId,adapter:'canvas',tag,text,
properties:{...},rect:{x,y,width,height}}) or null. x/y and rect use composition pixels; t is the same seconds as seek.
Return stable authored object IDs and bounded JSON properties. Picking must not mutate state or start network work.
DOM elements continue using data-vibi-prop and the built-in element picker when this adapter is absent.

## Blocked by the sandbox (the probe lists these as lint)
- Network: fetch, XHR, WebSocket, external URLs, CDN scripts or fonts. Copy what you need into the folder, or use what
  the user imported (vibi:libs).
- <audio>/<video>, AudioContext, speechSynthesis — sound belongs on an audio track in the document (use cues to sync).
- Workers, localStorage/indexedDB/cookies, popups, navigation, waiting for clicks (nobody clicks in a video).

## Look
- The background is transparent: lower tracks show through. Paint a background if you want one (var(--vibi-bg)).
- Design at the declared size; Vibistudio fits the frame into the item's box (or gives you the box when responsive).
- Follow the craft guide (GET /craft): give text time to be read, ease every move, stagger and overlap entrances, one
  focal motion at a time, keep to the style card.

## After editing
POST /composition/probe {project, path, docId} — refreshes duration/size/values and lists problems in your code. Then
GET /doc/:docId/strip?project=&item=<itemId> to see the motion as a grid of frames, and open the PNG with your Read tool.
`;

/**
 * §5.13 (W) 38-9 — 규약 글 + 렌더 엔진 줄. 미리보기·스틸·렌더가 모두 이 실행본의 Chromium 으로 그려진다 — 더 새 기능은 무시된다.
 * 엔진을 모르면(서버만·시험) 규약 글 그대로.
 */
export function compositionGuideFor(chromium?: number): string {
  if (chromium === undefined || !Number.isFinite(chromium)) return COMPOSITION_GUIDE;
  return `${COMPOSITION_GUIDE}
## Renderer engine
The preview, stills, strips and the final render all use Chromium ${chromium}. Web features newer than that engine are
ignored silently there (for example CSS sibling-index(), if(), text-box-trim, calc-size(), corner-shape, Promise.try).
The probe lists the ones it finds as "engine-unsupported". Check your work with /still and /strip — not in another browser.
`;
}

/** §5.13 (W) 38-8 — 연출 규약("어떻게 잘 만드나"): 에이전트가 약한 완급·취향·음악 맞추기·실사 위 배치를 규칙과 숫자로. 라이브러리·서비스 이름 없음. */
export const MOTION_CRAFT_GUIDE = `# Vibistudio motion craft

The protocol tells you how to edit the document. This tells you how to make the video good. Viewers decide in the first
second; motion that serves the message beats motion that shows off.

## 1. Story before effects
- One idea per chapter. A headline is at most ~7 words; a supporting line at most ~12.
- Hook in the first 2 s (1.5 s for vertical shorts): the problem, the payoff or a striking image — not a logo.
- End on a still, readable frame held for at least 1 s (name, call to action, the one number that matters).

## 2. Style frames before motion
- In the plan stage design one static frame per chapter (its key moment, complete: layout, type, color, imagery) and set
  chapter.frame. Get the look approved before you animate. Then animate INTO and OUT OF that frame.

## 3. Layout and type for video
- Respect safe areas: 16:9 keep 5% margins; 9:16 keep text out of the top 12%, bottom 22% and right 14% (platform UI).
- Type scale (share of frame height): headline 6–9%, body 3.5–5%, never below 2.5% (about 27 px at 1080p).
- At most two typefaces (the style font plus one mono for code). Build hierarchy with weight and size contrast.
- Left-align text that is longer than a line; center only short headlines.
- Text over imagery needs contrast ≥ 4.5:1 — add a gradient scrim or a soft shadow behind it, never a busy background.
- Align to a grid (thirds or a 12-column grid) with consistent margins; leave empty space on purpose.

## 4. Timing and pacing
- Reading time: about 0.3 s per word + 1 s (Korean/Chinese/Japanese: about 0.15 s per character + 1 s).
- Entrances 0.4–0.8 s, exits 0.25–0.5 s (exits are faster than entrances). Hold the important state ≥ 1 s.
- Vary the rhythm: not everything enters at the same speed; let big moments breathe and small ones snap.
- With music, put chapter boundaries and big moves on strong beats (assets[…].beatsStrong).

## 5. Easing
- Never move position or scale linearly (linear is for loops, progress bars and tickers).
- Entrances: ease-out, cubic-bezier(0.16, 1, 0.3, 1). Exits: ease-in, cubic-bezier(0.7, 0, 0.84, 0).
  Moves across the frame: ease-in-out, cubic-bezier(0.65, 0, 0.35, 1).
- Overshoot only for playful brands and only on small elements: cubic-bezier(0.34, 1.56, 0.64, 1), or a damped spring
  computed in window.__vibi.seek. CSS linear() can express a spring curve too.

## 6. Choreography
- Stagger related elements by 40–120 ms in reading order (title → subtitle → detail).
- Overlap: start the next motion before the previous one ends (20–40% overlap) so the frame never stops dead mid-chapter.
- Anticipation and follow-through: a small counter-move before a big move, a small settle after it.
- One focal motion at a time; secondary elements move less and later.
- Keep direction consistent: if a scene leaves to the left, the next one arrives from the right.

## 7. Camera and depth
- Keep still frames alive with a slow push (scale 1.00 → 1.04–1.08 over the chapter).
- Parallax: background layers move at 30–50% of the foreground speed.
- Footage and images: use item keyframes for punch-in zooms on emphasis (×1.1–1.2 in 0.3 s) and slow pushes; compositions
  animate their own camera in code.
- Fast moves: never jump more than a third of the frame width per frame — add a short blur or a motion trail instead.

## 8. Transitions
- The best transition is continuity: the last shape of one chapter becomes the first shape of the next (a match cut).
  Seamless transitions are easiest inside one composition that spans the chapters.
- Document transitions (dissolve, push, zoom, wipe, flash) last 0.3–0.6 s. Use at most two kinds per video.

## 9. Color and texture
- 60/30/10: background / secondary / accent. Reserve the accent color for the focal element.
- Keep gradients subtle; a little grain or noise (2–4% opacity, seeded) makes flat color look richer.
- Footage: give every clip the same look (effects kind "look") so the cuts match.

## 10. Numbers and charts
- Compute numbers from the data in code; never type a result you did not compute.
- Counters ease out toward the target and show units; round sensibly.
- Animate charts in reading order (axis → bars or line → labels) and highlight the one insight.

## 11. Sound-led editing
- The voice is the clock: chapters follow the narration; music ducks under the voice automatically.
- Sync impacts, reveals and counter hits with cues (window.__vibi.cue) or strong beats.

## 12. Avoid the generic AI look
Do not: fade everything in at once · center every text · rainbow or neon gradients without reason · emoji as decoration ·
drop shadows on everything · bounce everything · particles without purpose · walls of text · tiny text · generic titles
("Introducing…", "Welcome to…") · stock-looking icons in a row · every chapter with the same layout.
Do: one clear idea per chapter, purposeful motion, real material (real screens, real data, real footage), one consistent
style, restraint.

## 13. Parts vs hero moments
- Use ready-made parts for repeated utility (lower thirds, captions, charts, counters).
- Build the hook, the reveal and the ending as your own compositions — they carry the video.

## 14. Self-check before you report
- /strip for every composition: dead frames, jumps, overlaps, text that is too short on screen.
- The first 3 seconds frame by frame: /strip?from=0&to=3&count=12.
- /review?frames=1: fix every finding or explain it in warnings. Fix composition lint (engine-unsupported included).

## 15. Performance — smooth preview on an ordinary laptop
The person watches your composition live in the editor, often on a 4-core laptop. Motion that the compositor can do alone
stays smooth; anything that repaints the full frame every frame stutters the preview.
- Move and fade with transform (translate / scale / rotate) and opacity only. Those two never repaint.
- Do not change background-position, filter (blur…), or a large blurred box-shadow every frame on a full-screen element.
  Draw a glow or blur once on its own layer, then fade or move that layer.
- Static light, vignettes and textures: draw them once (a fixed layer or an image), not per frame.
- Canvas: avoid putImageData over the whole frame each frame; draw small tiles once and move them with transform.
- Fewer, larger moving layers beat many small ones; remove elements that are off screen for the rest of the chapter.
The probe reports these as perf-* lint (a warning — it does not block).
`;

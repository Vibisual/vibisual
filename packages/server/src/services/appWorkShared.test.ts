/**
 * §5.1 #2-1 (F)(G) — shared `appWork.ts` · `previewPolicy.ts` · 갈래(`fileFaceFamilyOf`) · 넓힌 종류 표 고정 시험.
 *
 * shared 패키지에는 러너가 없으므로 여기서 고정한다(`constellation.test.ts` 와 같은 자리). 플랫폼은 인자로 넘긴다 —
 * 개발기 한 대에서 win32·darwin·linux 셋의 경로 규칙을 다 재기 위함이다(멀티플랫폼 1축).
 */
import { describe, it, expect } from 'vitest';
import {
  APP_WORK,
  CONSTELLATION,
  PREVIEW_POLICY,
  appKindOfExtensions,
  appNodeIdsInText,
  appWorkRoleOf,
  appWorkSeatAngles,
  clipNameList,
  commandAppNodeIds,
  companionPartnerName,
  extractBashScanAnchors,
  fileFaceFamilyOf,
  fileFaceKindOf,
  fileSequenceOf,
  imageHeaderSize,
  normalizeAppNodeIds,
  pickAppWorkHub,
  planConstellations,
  previewByteCap,
  previewTooLarge,
  previewTooManyPixels,
  selectPreviewGrants,
  sequenceLabel,
  withAppWorkMark,
} from '@vibisual/shared';

describe('appNodeIdsInText — 옛 명령의 앱 노드', () => {
  it('프로토콜 블록에 적힌 앱 노드 id 를 나온 순서대로 · 중복 없이 뽑는다', () => {
    const text = '작업 완성 시켜\n--- Linked canvas nodes ---\nnode app-mvdp00r7-k74xi (Vibi3D)\nagain app-mvdp00r7-k74xi, app-abc-12345';
    expect(appNodeIdsInText(text)).toEqual(['app-mvdp00r7-k74xi', 'app-abc-12345']);
  });
  it('id 글자에 이어 붙은 것은 id 가 아니다', () => {
    expect(appNodeIdsInText('xapp-aa-bb · app-aa-bb-cc · map-aa-bb')).toEqual([]);
  });
  it('상한까지만', () => {
    const many = Array.from({ length: 20 }, (_, i) => `app-n${i}-x`).join(' ');
    expect(appNodeIdsInText(many)).toHaveLength(APP_WORK.commandNodeMax);
  });
});

describe('normalizeAppNodeIds · commandAppNodeIds', () => {
  it('앱 노드 id 모양만 · 중복 없이 · 비면 undefined', () => {
    expect(normalizeAppNodeIds(['app-a1-b2', 'app-a1-b2', 'nope', 3, 'app-c3-d4'])).toEqual(['app-a1-b2', 'app-c3-d4']);
    expect(normalizeAppNodeIds([])).toBeUndefined();
    expect(normalizeAppNodeIds('app-a1-b2')).toBeUndefined();
  });
  it('실린 칸이 먼저, 없으면 본문', () => {
    expect(commandAppNodeIds({ appNodeIds: ['app-x1-y2'], text: 'app-q1-q2' })).toEqual(['app-x1-y2']);
    expect(commandAppNodeIds({ text: 'see app-q1-q2' })).toEqual(['app-q1-q2']);
    expect(commandAppNodeIds({ text: 'nothing' })).toEqual([]);
  });
});

describe('withAppWorkMark — 꼬리표', () => {
  it('사후 이벤트만 쓰기 수를 올리고 시각은 늦은 쪽', () => {
    const a = withAppWorkMark(undefined, ['app-a-1'], { now: 10, write: false });
    expect(a).toEqual({ 'app-a-1': { w: 0, at: 10 } });
    const b = withAppWorkMark(a, ['app-a-1'], { now: 20, write: true });
    expect(b?.['app-a-1']).toEqual({ w: 1, at: 20 });
    expect(a?.['app-a-1']?.w).toBe(0); // 원본 불변
  });
  it('스크립트 표식은 남고, 되짚기 표식은 실시간 쓰기가 걷는다', () => {
    const retro = withAppWorkMark(undefined, ['app-a-1'], { now: 5, write: false, retro: true, writes: 3 });
    expect(retro?.['app-a-1']).toEqual({ w: 3, at: 5, retro: true });
    const live = withAppWorkMark(retro, ['app-a-1'], { now: 9, write: true, script: true });
    expect(live?.['app-a-1']).toEqual({ w: 4, at: 9, script: true });
  });
  it('노드당 상한을 넘으면 오래된 것부터 뺀다', () => {
    let marks = withAppWorkMark(undefined, ['app-a-1'], { now: 1, write: true });
    for (let i = 2; i <= APP_WORK.nodeTagMax + 1; i += 1) marks = withAppWorkMark(marks, [`app-a-${i}`], { now: i, write: true });
    expect(Object.keys(marks ?? {})).toHaveLength(APP_WORK.nodeTagMax);
    expect(marks?.['app-a-1']).toBeUndefined();
  });
});

describe('역할 · 자리 — 위쪽 반원에 왼쪽부터', () => {
  const vibi3dKind = appKindOfExtensions(['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.dae', '.3mf']);
  it('앱 종류는 선언한 확장자에서 나온다(앱 이름을 모른다)', () => {
    expect(vibi3dKind).toBe('model');
    expect(appKindOfExtensions(['.png', '.jpg', '.svg'])).toBe('image');
    expect(appKindOfExtensions([])).toBeNull();
  });
  it('사진 속 실제 경우 — 제작 코드 · 데이터 · 메모로 갈린다', () => {
    expect(appWorkRoleOf('artifacts/vibi3d-korean-corner/scene-work.mjs', vibi3dKind, false)).toBe('code');
    expect(appWorkRoleOf('artifacts/vibi3d-korean-corner/final-captures.json', vibi3dKind, false)).toBe('data');
    expect(appWorkRoleOf('artifacts/vibi3d-korean-corner/continuation.md', vibi3dKind, false)).toBe('memo');
  });
  it('같은 종류 · 소재 · 결과 · 기타', () => {
    expect(appWorkRoleOf('out/street.blend', vibi3dKind, false)).toBe('sibling');
    expect(appWorkRoleOf('out/brick.png', vibi3dKind, false)).toBe('material');
    expect(appWorkRoleOf('out/sign.ttf', vibi3dKind, false)).toBe('material');
    expect(appWorkRoleOf('out/street.glb', vibi3dKind, true)).toBe('result');
    expect(appWorkRoleOf('out/weird.qqq', vibi3dKind, false)).toBe('other');
    expect(appWorkRoleOf('out/Makefile', vibi3dKind, false)).toBe('other');
  });
  it('짝 파일', () => {
    expect(companionPartnerName('a/b/street.mtl')).toBe('street.obj');
    expect(companionPartnerName('a/b/scene.bin')).toBe('scene.gltf');
    expect(companionPartnerName('a/b/scene.json')).toBeNull();
  });
  it('각도는 9시 → 12시 → 3시를 고르게, 양 끝은 반 칸 비운다', () => {
    expect(appWorkSeatAngles(1)).toEqual([Math.PI * 1.5]);
    const five = appWorkSeatAngles(5);
    expect(five).toHaveLength(5);
    expect(five[2]).toBeCloseTo(Math.PI * 1.5);
    expect(five[0]!).toBeGreaterThan(APP_WORK.seatArcFrom);
    expect(five[4]!).toBeLessThan(APP_WORK.seatArcTo);
    for (let i = 1; i < five.length; i += 1) expect(five[i]!).toBeGreaterThan(five[i - 1]!);
  });
  it('노드 고르기 — 선언한 앱 → 같은 종류 → 첫 노드', () => {
    const image = { id: 'app-img-1', exts: ['.png', '.jpg'], kind: 'image' as const };
    const model = { id: 'app-3d-1', exts: ['.glb'], kind: 'model' as const };
    expect(pickAppWorkHub('t/brick.png', [model, image])?.id).toBe('app-img-1');
    expect(pickAppWorkHub('t/street.blend', [image, model])?.id).toBe('app-3d-1');
    expect(pickAppWorkHub('t/build.mjs', [image, model])?.id).toBe('app-img-1');
  });
});

describe('fileSequenceOf — 연속 번호', () => {
  it('끝 번호 · 앞부분 · 확장자 · 자릿수', () => {
    const s = fileSequenceOf('renders/frame_0012.exr', 'win32');
    expect(s).toMatchObject({ prefix: 'frame_', num: 12, digits: 4, ext: '.exr' });
    expect(sequenceLabel(s!)).toBe('frame_####.exr');
  });
  it('같은 폴더 · 같은 앞부분 · 같은 확장자만 같은 열쇠(윈도는 폴더 대소문자를 접는다)', () => {
    const a = fileSequenceOf('R/Frame_0001.png', 'win32')!;
    const b = fileSequenceOf('r/frame_0002.png', 'win32')!;
    expect(a.key).toBe(b.key);
    expect(fileSequenceOf('R/Frame_0001.png', 'darwin')!.key).toBe(fileSequenceOf('r/frame_0002.png', 'darwin')!.key);
    expect(fileSequenceOf('R/Frame_0001.png', 'linux')!.key).not.toBe(fileSequenceOf('r/frame_0002.png', 'linux')!.key);
    expect(fileSequenceOf('r/frame_0001.jpg', 'linux')!.key).not.toBe(fileSequenceOf('r/frame_0002.png', 'linux')!.key);
  });
  it('번호가 없으면 연속이 아니다', () => {
    expect(fileSequenceOf('a/scene-work.mjs', 'linux')).toBeNull();
    expect(fileSequenceOf('a/.env', 'linux')).toBeNull();
  });
  it('이름 목록 자르기', () => {
    expect(clipNameList(['a', 'b', 'c'], 2)).toEqual({ shown: ['a', 'b'], more: 1 });
  });
});

describe('extractBashScanAnchors — 스크립트 출력 훑기의 기준 자리(§5.1 #2-1 (F) ③)', () => {
  it('cd 대상 · 그 아래 경로 낱말 · 리다이렉트 대상 — Git Bash 의 `/c/…` 는 윈도에서만 드라이브 경로', () => {
    const cmd = 'cd /c/work/proj && node scripts/build.mjs > artifacts/out.json';
    expect(extractBashScanAnchors(cmd, 4, { platform: 'win32' })).toEqual(['c:/work/proj', 'c:/work/proj/scripts/build.mjs', 'c:/work/proj/artifacts/out.json']);
    for (const platform of ['darwin', 'linux'] as const) {
      expect(extractBashScanAnchors(cmd, 4, { platform })).toEqual(['/c/work/proj', '/c/work/proj/scripts/build.mjs', '/c/work/proj/artifacts/out.json']);
    }
  });
  it('대소문자만 다른 같은 자리는 윈도·맥에서 하나, 리눅스에서 둘', () => {
    const cmd = 'cd /w/A && touch a/x.txt A/x.txt';
    expect(extractBashScanAnchors(cmd, 4, { platform: 'win32' })).toEqual(['w:/A', 'w:/A/a/x.txt']);
    expect(extractBashScanAnchors(cmd, 4, { platform: 'darwin' })).toEqual(['/w/A', '/w/A/a/x.txt']);
    expect(extractBashScanAnchors(cmd, 4, { platform: 'linux' })).toEqual(['/w/A', '/w/A/a/x.txt', '/w/A/A/x.txt']);
  });
  it('주소 · 옵션 · 경로 아닌 낱말은 빼고, 상한까지만', () => {
    expect(extractBashScanAnchors('curl -o dl/file.bin https://example.com/a/b.bin --silent', 4, { platform: 'linux' })).toEqual(['dl/file.bin']);
    expect(extractBashScanAnchors('echo hello', 4, { platform: 'linux' })).toEqual([]);
    expect(extractBashScanAnchors('node gen.mjs a/1.txt a/2.txt a/3.txt a/4.txt', 3, { platform: 'linux' })).toEqual(['gen.mjs', 'a/1.txt', 'a/2.txt']);
    expect(extractBashScanAnchors('node gen.mjs 2>>logs/err.txt', 4, { platform: 'linux' })).toEqual(['gen.mjs', 'logs/err.txt']);
  });
});

describe('planConstellations — 앱 작업물 근거', () => {
  const files = [
    { id: 'f1', path: 'artifacts/vibi3d-korean-corner/scene-work.mjs' },
    { id: 'f2', path: 'artifacts/vibi3d-korean-corner/final-captures.json' },
    { id: 'f3', path: 'artifacts/vibi3d-korean-corner/continuation.md' },
  ];
  it('확장자와 무관하게 작업 파일이 앱 노드를 돈다', () => {
    const plan = planConstellations(files, [{
      id: 'app-mvdp00r7-k74xi', results: [], parts: [], codeParts: [],
      work: files.map((f) => f.path),
    }], { platform: 'win32' });
    for (const f of files) {
      expect(plan.memberOf.get(f.id)).toMatchObject({ hub: 'app-mvdp00r7-k74xi', reason: 'appWork', score: CONSTELLATION.score.appWork });
    }
  });
  it('다른 노드가 결과로 선언한 파일은 그 노드에 남는다', () => {
    const plan = planConstellations([{ id: 'g', path: 'out/a.glb' }], [
      { id: 'app-res-1', results: ['out/a.glb'], parts: [], codeParts: [] },
      { id: 'app-work-1', results: [], parts: [], codeParts: [], work: ['out/a.glb'] },
    ], { platform: 'linux' });
    expect(plan.memberOf.get('g')?.hub).toBe('app-res-1');
  });
});

describe('fileFaceFamilyOf · 넓힌 종류 표 — 다양한 확장자', () => {
  it('새로 더한 확장자의 종류', () => {
    expect(fileFaceKindOf('m/street.blend1')).toBe('model');
    expect(fileFaceKindOf('m/part.step')).toBe('model');
    expect(fileFaceKindOf('m/scan.splat')).toBe('model');
    expect(fileFaceKindOf('t/brick.ktx2')).toBe('image');
    expect(fileFaceKindOf('t/look.sbsar')).toBe('image');
    expect(fileFaceKindOf('v/edit.prproj')).toBe('video');
    expect(fileFaceKindOf('v/anim.lottie')).toBe('video');
    expect(fileFaceKindOf('s/book.m4b')).toBe('audio');
    expect(fileFaceKindOf('s/piano.sf2')).toBe('audio');
    expect(fileFaceKindOf('s/song.als')).toBe('audio');
    expect(fileFaceKindOf('c/ko.smi')).toBe('subtitle');
    expect(fileFaceKindOf('c/shade.metal')).toBe('code');
    expect(fileFaceKindOf('d/grade.cube')).toBe('data');
    expect(fileFaceKindOf('d/model.safetensors')).toBe('data');
    expect(fileFaceKindOf('d/walk.bvh')).toBe('data');
    expect(fileFaceKindOf('p/script.fountain')).toBe('doc');
    expect(fileFaceKindOf('p/deck.pptx')).toBe('doc');
    expect(fileFaceKindOf('i/photo.jfif')).toBe('image');
    expect(fileFaceKindOf('m/avatar.vrm')).toBe('model');
  });
  it('일부러 넣지 않은 것 — 다른 뜻과 겹친다', () => {
    for (const p of ['go.mod', 'board.dts', 'kernel.ptx', 'server.key', 'plot.gp', 'pack.idx', 'atoms.xyz']) {
      expect(fileFaceKindOf(p)).toBe('other');
    }
  });
  it('겹치는 뜻은 앞이 이긴다 · 대소문자 · 겹 확장자', () => {
    expect(fileFaceKindOf('src/app.ts')).toBe('code');
    expect(fileFaceKindOf('src/app.mts')).toBe('code');
    expect(fileFaceKindOf('m/part.stl')).toBe('model');
    expect(fileFaceKindOf('m/cache.abc')).toBe('model');
    expect(fileFaceKindOf('i/LOGO.PNG')).toBe('image');
    expect(fileFaceKindOf('t/x.d.ts')).toBe('code');
  });
  it('갈래 — 미리보기가 없을 때의 아이콘 단위', () => {
    expect(fileFaceFamilyOf('m/street.blend')).toBe('modelSource');
    expect(fileFaceFamilyOf('m/street.glb')).toBe('model');
    expect(fileFaceFamilyOf('m/scene.usdz')).toBe('scene');
    expect(fileFaceFamilyOf('m/avatar.vrm')).toBe('avatar');
    expect(fileFaceFamilyOf('i/raw.cr3')).toBe('photoRaw');
    expect(fileFaceFamilyOf('i/env.exr')).toBe('hdr');
    expect(fileFaceFamilyOf('i/art.psd')).toBe('layered');
    expect(fileFaceFamilyOf('i/logo.svg')).toBe('vector');
    expect(fileFaceFamilyOf('s/song.mid')).toBe('sequence');
    expect(fileFaceFamilyOf('s/score.musicxml')).toBe('score');
    expect(fileFaceFamilyOf('c/run.ps1')).toBe('shell');
    expect(fileFaceFamilyOf('c/lab.ipynb')).toBe('notebook');
    expect(fileFaceFamilyOf('c/fx.wgsl')).toBe('shader');
    expect(fileFaceFamilyOf('d/rows.csv')).toBe('table');
    expect(fileFaceFamilyOf('d/app.sqlite')).toBe('database');
    expect(fileFaceFamilyOf('.env')).toBe('config');
    expect(fileFaceFamilyOf('d/grade.cube')).toBe('lut');
    expect(fileFaceFamilyOf('d/cut.otio')).toBe('timeline');
    expect(fileFaceFamilyOf('d/w.gguf')).toBe('weights');
    expect(fileFaceFamilyOf('p/a.pdf')).toBe('pdf');
    expect(fileFaceFamilyOf('o/bundle.zip')).toBe('archive');
    expect(fileFaceFamilyOf('o/unknown.qqq')).toBe('other');
    expect(fileFaceFamilyOf('o/Makefile')).toBe('other');
    expect(fileFaceFamilyOf('src/main.rs')).toBe('code');
  });
});

describe('previewPolicy — ① 파일 기준', () => {
  it('종류별 상한', () => {
    expect(previewByteCap('a.png')).toBe(PREVIEW_POLICY.maxBytes.image);
    expect(previewByteCap('a.svg')).toBe(PREVIEW_POLICY.maxBytes.svg);
    expect(previewByteCap('a.mp3')).toBe(PREVIEW_POLICY.maxBytes.audioCompressed);
    expect(previewByteCap('a.wav')).toBe(PREVIEW_POLICY.maxBytes.audioPcm);
    expect(previewByteCap('a.glb')).toBe(PREVIEW_POLICY.maxBytes.model);
    expect(previewByteCap('a.mp4')).toBeNull();
    expect(previewByteCap('a.ts')).toBeNull();
  });
  it('넘으면 막고, 모르면 막지 않는다', () => {
    expect(previewTooLarge('big.glb', PREVIEW_POLICY.maxBytes.model + 1)).toBe(true);
    expect(previewTooLarge('ok.glb', PREVIEW_POLICY.maxBytes.model)).toBe(false);
    expect(previewTooLarge('x.glb', undefined)).toBe(false);
    expect(previewTooLarge('long.mp4', 10_000_000_000)).toBe(false);
  });
  it('픽셀 기준', () => {
    expect(previewTooManyPixels({ width: 8000, height: 6000 })).toBe(true);
    expect(previewTooManyPixels({ width: 4000, height: 3000 })).toBe(false);
    expect(previewTooManyPixels(null)).toBe(false);
  });
});

function bytes(...parts: Array<number | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) Array.isArray(p) ? out.push(...p) : out.push(p);
  while (out.length < 64) out.push(0);
  return Uint8Array.from(out);
}
const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le16 = (v: number): number[] => [v & 255, (v >>> 8) & 255];
const le32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const be16 = (v: number): number[] => [(v >>> 8) & 255, v & 255];

describe('imageHeaderSize — 머리만 읽어 크기', () => {
  it('PNG', () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), [0x49, 0x48, 0x44, 0x52], be32(7680), be32(4320));
    expect(imageHeaderSize(png)).toEqual({ width: 7680, height: 4320 });
  });
  it('GIF', () => {
    const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], le16(320), le16(200));
    expect(imageHeaderSize(gif)).toEqual({ width: 320, height: 200 });
  });
  it('BMP(아래에서 위 · 위에서 아래)', () => {
    const bmp = bytes([0x42, 0x4d], le32(0), le32(0), le32(54), le32(40), le32(640), le32(-480 >>> 0));
    expect(imageHeaderSize(bmp)).toEqual({ width: 640, height: 480 });
  });
  it('JPEG — 앞 덩어리를 건너 SOF', () => {
    const jpg = bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), Array(14).fill(0), [0xff, 0xc0], be16(17), 8, be16(3000), be16(4000));
    expect(imageHeaderSize(jpg)).toEqual({ width: 4000, height: 3000 });
  });
  it('WebP 세 갈래', () => {
    const riff = (chunk: string, body: number[]): Uint8Array => bytes(
      [0x52, 0x49, 0x46, 0x46], le32(0), [0x57, 0x45, 0x42, 0x50], [...chunk].map((c) => c.charCodeAt(0)), le32(0), body,
    );
    expect(imageHeaderSize(riff('VP8X', [0, 0, 0, 0, ...[(1919) & 255, (1919 >>> 8) & 255, 0], ...[(1079) & 255, (1079 >>> 8) & 255, 0]])))
      .toEqual({ width: 1920, height: 1080 });
    expect(imageHeaderSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(800), ...le16(600)]))).toEqual({ width: 800, height: 600 });
    const w = 1023;
    const h = 511;
    const bits = (w - 1) | ((h - 1) << 14);
    expect(imageHeaderSize(riff('VP8L', [0x2f, ...le32(bits)]))).toEqual({ width: w, height: h });
  });
  it('모르는 형식 · 짧은 머리는 null', () => {
    expect(imageHeaderSize(new Uint8Array(10))).toBeNull();
    expect(imageHeaderSize(bytes([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
  });
});

describe('selectPreviewGrants — ② 화면 기준 · ③ 한눈 기준', () => {
  it('화면에서 작게 보이면 고르지 않는다 — 켜는 문턱이 더 높다', () => {
    const c = [{ id: 'a', diameter: 60 }];
    expect(selectPreviewGrants(c, 0.5, new Set())).toEqual(new Set()); // 30px < 켜는 문턱 34
    expect(selectPreviewGrants(c, 0.5, new Set(['a']))).toEqual(new Set(['a'])); // 이미 그리던 것은 28 까지
    expect(selectPreviewGrants(c, 0.45, new Set(['a']))).toEqual(new Set()); // 27px
  });
  it('한눈에 많으면 크게 보이는 것부터 상한까지', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, diameter: 40 + i }));
    const granted = selectPreviewGrants(many, 1, new Set());
    expect(granted.size).toBe(PREVIEW_POLICY.maxOnScreen);
    expect(granted.has('n39')).toBe(true);
    expect(granted.has('n00')).toBe(false);
  });
  it('같은 크기면 도는 것 → 최근 → id', () => {
    const c = [
      { id: 'b', diameter: 60, last: 1 },
      { id: 'a', diameter: 60, last: 1 },
      { id: 'c', diameter: 60, last: 5 },
      { id: 'd', diameter: 60, active: true },
    ];
    expect([...selectPreviewGrants(c, 1, new Set(), { maxOnScreen: 3 })]).toEqual(['d', 'c', 'a']);
  });
});

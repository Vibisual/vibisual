/**
 * §5.1 #2-1 — shared `fileFace.ts` · `fileMentions.ts` · `constellation.ts` · `kindBundle.ts` 고정 시험.
 *
 * 판정은 shared 순수 함수지만 shared 패키지에는 러너가 없으므로 여기서 고정한다(`externalFolderView.test.ts` 와 같은
 * 자리). **플랫폼을 인자로 넘긴다** — 개발기 한 대에서 win32·darwin·linux 셋의 경로 규칙을 다 재기 위함이다.
 */
import { describe, it, expect } from 'vitest';
import {
  CONSTELLATION,
  createMentionResolver,
  extractFileMentions,
  fileFaceKindOf,
  fileStemOf,
  isMediaFaceKind,
  kindBundleNameOf,
  kindBundlePathShape,
  planConstellations,
  planKindBundles,
  stemTokensOf,
  type ConstellationFileInput,
} from '@vibisual/shared';

const f = (id: string, path: string, extra: Partial<ConstellationFileInput> = {}): ConstellationFileInput => ({
  id,
  path,
  lastActivity: 0,
  ...extra,
});

describe('fileFaceKindOf — 파일의 얼굴', () => {
  it('미디어 넷과 글 종류를 가른다', () => {
    expect(fileFaceKindOf('out/teaser.mp4')).toBe('video');
    expect(fileFaceKindOf('assets/logo.png')).toBe('image');
    expect(fileFaceKindOf('sfx/hit.wav')).toBe('audio');
    expect(fileFaceKindOf('models/robot.glb')).toBe('model');
    expect(fileFaceKindOf('src/App.tsx')).toBe('code');
    expect(fileFaceKindOf('teaser.composition.json')).toBe('data');
    expect(fileFaceKindOf('docs/plan.md')).toBe('doc');
    expect(fileFaceKindOf('subs/ko.srt')).toBe('subtitle');
    expect(fileFaceKindOf('fonts/Pretendard.woff2')).toBe('font');
  });

  it('.ts 는 영상이 아니라 코드다 · 대문자 확장자도 같다 · 모르는 것은 기타', () => {
    expect(fileFaceKindOf('src/index.ts')).toBe('code');
    expect(fileFaceKindOf('C:\\clips\\TAKE1.MP4')).toBe('video');
    expect(fileFaceKindOf('build/output.xyz')).toBe('other');
    expect(fileFaceKindOf('Makefile')).toBe('other');
  });

  it('점으로 시작하는 이름은 이름 전체가 확장자다(.env = 데이터)', () => {
    expect(fileFaceKindOf('.env')).toBe('data');
    expect(fileFaceKindOf('.gitignore')).toBe('other');
  });

  it('미디어 판정', () => {
    expect(isMediaFaceKind('video')).toBe(true);
    expect(isMediaFaceKind('model')).toBe(true);
    expect(isMediaFaceKind('code')).toBe(false);
    expect(isMediaFaceKind('other')).toBe(false);
  });
});

describe('fileStemOf · stemTokensOf — 이름 조각', () => {
  it('줄기는 첫 점 앞(소문자)', () => {
    expect(fileStemOf('a/Teaser.composition.json')).toBe('teaser');
    expect(fileStemOf('.env')).toBe('');
  });

  it('낱말은 기호·camelCase 에서 쪼개고 짧은 것·숫자·흔한 낱말을 뺀다', () => {
    expect(stemTokensOf('teaserIntro_v2.tsx')).toEqual(['teaser', 'intro']);
    expect(stemTokensOf('index.html')).toEqual([]);
    expect(stemTokensOf('gen-bg.py')).toEqual(['gen']);
    // 한글 낱말은 두 글자부터 친다(familyTokenMinCjk) — "영상"·"배경" 같은 두 글자 낱말이 흔하다.
    expect(stemTokensOf('영상_인트로.mp4')).toEqual(['영상', '인트로']);
    expect(stemTokensOf('배경-a.png')).toEqual(['배경']);
  });
});

describe('extractFileMentions — 내용 속 파일 이름', () => {
  it('경로가 붙은 이름·따옴표 속 이름을 뽑고 ./ 를 걷는다', () => {
    const text = `import logo from './assets/logo.png';\n{"audio": "bgm.wav", "src": "C:\\\\clips\\\\take1.mp4"}`;
    // 윈도 경로는 드라이브 머리(`C:`)에서 끊기고 구분자는 `/` 하나로 접힌다 — 풀 때는 접미로 맞추므로 충분하다.
    expect(extractFileMentions(text)).toEqual(['assets/logo.png', 'bgm.wav', '/clips/take1.mp4']);
  });

  it('코드 조각(window.location · this.state · 1.5)은 걸리지 않는다', () => {
    expect(extractFileMentions('window.location = this.state; const r = 1.5; obj.prop.value')).toEqual([]);
  });

  it('중복은 한 번, 상한까지', () => {
    expect(extractFileMentions('a.png a.png b.png c.png', 2)).toEqual(['a.png', 'b.png']);
  });
});

describe('createMentionResolver — 낱말을 파일 노드로', () => {
  const candidates = [
    { id: 'logo-a', path: 'assets/logo.png' },
    { id: 'logo-b', path: 'brand/logo.png' },
    { id: 'bgm', path: 'audio/bgm.wav' },
    { id: 'self', path: 'video/comp.json' },
  ];

  it('경로를 적었으면 경로로, 이름만 적었으면 하나뿐일 때만 잇는다', () => {
    const resolve = createMentionResolver(candidates, 'win32');
    expect(resolve(['assets/logo.png'], 'self')).toEqual(['logo-a']);
    expect(resolve(['logo.png'], 'self')).toEqual([]); // 둘 — 모호하면 잇지 않는다
    expect(resolve(['bgm.wav'], 'self')).toEqual(['bgm']);
    expect(resolve(['comp.json'], 'self')).toEqual([]); // 자기 자신
  });

  it('자기 경로를 적은 낱말이 더 짧은 접미로 내려가 남의 파일에 이어지지 않는다', () => {
    const resolve = createMentionResolver(
      [{ id: 'me', path: 'a/logo.png' }, { id: 'other', path: 'b/logo.png' }],
      'win32',
    );
    expect(resolve(['a/logo.png'], 'me')).toEqual([]);
  });

  it('대소문자 — win32·darwin 은 접고 linux 는 가른다', () => {
    expect(createMentionResolver(candidates, 'win32')(['Audio/BGM.wav'], 'self')).toEqual(['bgm']);
    expect(createMentionResolver(candidates, 'darwin')(['Audio/BGM.wav'], 'self')).toEqual(['bgm']);
    expect(createMentionResolver(candidates, 'linux')(['Audio/BGM.wav'], 'self')).toEqual([]);
  });
});

describe('planConstellations — 앱 노드 별자리(파일은 중심이 되지 않는다)', () => {
  const opts = { platform: 'win32' as const };
  const APP = (extra: Partial<{ results: string[]; parts: string[]; codeParts: string[]; work: string[] }> = {}) => ({
    id: 'app-1', results: [], parts: [], codeParts: [], ...extra,
  });

  it('파일만 있으면 아무것도 묶지 않는다 — 영상의 같은 이름 json·코드도 영상을 돌지 않는다(2026-10-21 사용자 지시)', () => {
    // "사진 묶음인데 … 사진만 있는게 아니라 다른 파일들도 같이 있는게 문제야 … 사진 제외한 다른 앱들표현도 마찬가지" — 파일 중심
    //   별자리는 다른 종류를 그 묶음에 넣었다. 같은 종류끼리의 묶음은 planKindBundles 가 맡는다.
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('json', 'video/teaser.json'),
      f('tsx', 'src/teaser.tsx'),
      f('notes', 'video/notes.md'),
      f('header', 'src/Header.tsx', { mentions: ['mp4'] }),
    ], [], opts);
    expect(plan.memberOf.size).toBe(0);
    expect(plan.moonsOf.size).toBe(0);
  });

  it('사진은 사진의 부모가 되지 않는다 — 앱 노드가 있어도 사진끼리 묶이지 않는다', () => {
    const dir = 'c:/users/dev/appdata/local/temp/icon-probe/out'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const plan = planConstellations([
      f('preview', `${dir}/preview.png`, { lastActivity: 1 }),
      f('preview2', `${dir}/preview2.png`, { lastActivity: 9 }),
      f('buildbat', `${dir}/buildbat-fileicon-normal.png`, { lastActivity: 1 }),
    ], [APP({ results: ['elsewhere/out.mp4'] })], opts);
    expect(plan.memberOf.size).toBe(0);
  });

  it('앱 노드 선언이 가장 세다 — 결과 · 소재 · 코드 소재의 폴더', () => {
    const plan = planConstellations([
      f('result', 'out/hero.png'),
      f('index', '.vibisual/video/compositions/intro/index.html'),
      f('css', '.vibisual/video/compositions/intro/style.css'),
      f('asset', 'assets/bgm.wav'),
      f('prompt', 'prompts/hero.txt'),
    ], [APP({
      results: ['out/hero.png'],
      parts: ['assets/bgm.wav'],
      codeParts: ['.vibisual/video/compositions/intro/index.html'],
    })], opts);
    expect(plan.memberOf.get('result')).toMatchObject({ hub: 'app-1', reason: 'appResult' });
    expect(plan.memberOf.get('index')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    expect(plan.memberOf.get('css')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    expect(plan.memberOf.get('asset')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    // hero.txt 는 결과 그림과 같은 이름 — 그 그림이 앱의 것이니 앱을 돈다.
    expect(plan.memberOf.get('prompt')).toMatchObject({ hub: 'app-1', reason: 'sameStem', via: 'result' });
  });

  it('앱이 가져간 영상의 같은 이름 json·코드는 그 영상을 거쳐 앱을 돈다(깊이 1)', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('json', 'video/teaser.json'),
      f('tsx', 'src/teaser.tsx'),
    ], [APP({ results: ['video/teaser.mp4'] })], opts);
    expect(plan.memberOf.get('json')).toMatchObject({ hub: 'app-1', reason: 'sameStem', via: 'mp4' });
    expect(plan.memberOf.get('tsx')).toMatchObject({ hub: 'app-1', reason: 'sameStem', via: 'mp4' });
    expect(plan.moonsOf.has('mp4')).toBe(false);
  });

  it('재료 미디어도 앱이 가져간 영상을 거쳐 앱을 돈다 — 그 재료의 곁 파일도 따라간다', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('bg', 'video/bg.png'),
      f('bgtxt', 'prompts/bg.txt'),
    ], [APP({ results: ['video/teaser.mp4'] })], opts);
    expect(plan.memberOf.get('bg')).toMatchObject({ hub: 'app-1', reason: 'sameFolder', via: 'mp4' });
    expect(plan.memberOf.get('bgtxt')).toMatchObject({ hub: 'app-1', reason: 'sameStem', via: 'bg' });
  });

  it('언급 사슬 — 앱으로 이어진 재료가 적고 있는 파일은 그 앱으로', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('comp', 'video/teaser.composition.json', { mentions: ['bgm'] }),
      f('bgm', 'audio/bgm.wav'),
    ], [APP({ results: ['video/teaser.mp4'] })], opts);
    expect(plan.memberOf.get('comp')).toMatchObject({ hub: 'app-1' });
    expect(plan.memberOf.get('bgm')).toMatchObject({ hub: 'app-1', reason: 'chain', via: 'comp' });
  });

  it('앱으로 이어지지 않는 파일 사이의 관계는 위성으로 세우지 않는다', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('json', 'video/teaser.json'),
      f('other', 'scene/turntable.mp4'),
      f('gltf', 'models/robot.gltf'),
      f('tex', 'models/robot_albedo.png'),
    ], [APP({ results: ['scene/turntable.mp4'] })], opts);
    // teaser.mp4 는 앱의 것이 아니다 — 그 json 도 남는다.
    expect(plan.memberOf.has('json')).toBe(false);
    expect(plan.memberOf.has('mp4')).toBe(false);
    expect(plan.moonsOf.has('mp4')).toBe(false);
  });

  it('위성 상한을 넘는 것은 원래 자리에 남는다', () => {
    const files = [f('mp4', 'v/teaser.mp4')];
    for (let i = 0; i < CONSTELLATION.moonMax + 3; i += 1) files.push(f(`n${i}`, `v/note${i}.md`, { lastActivity: i }));
    const plan = planConstellations(files, [APP({ results: ['v/teaser.mp4'] })], opts);
    expect(plan.moonsOf.get('app-1')?.length).toBe(CONSTELLATION.moonMax);
    expect(plan.memberOf.has('n0')).toBe(false); // 가장 오래된 것부터 남는다
  });

  it('둘 이상 걸리면 같은 답 — 입력 순서와 무관하다', () => {
    const files = [f('mp4', 'w/clip.mp4'), f('png', 'w/still.png'), f('md', 'w/notes.md')];
    const hubs = [APP({ results: ['w/clip.mp4'] })];
    const a = planConstellations(files, hubs, opts);
    const b = planConstellations([...files].reverse(), hubs, opts);
    expect(a.memberOf.get('md')?.hub).toBe('app-1');
    expect(b.memberOf.get('md')?.hub).toBe('app-1');
  });

  it('폴더 비교는 플랫폼 규칙 — linux 는 Video 와 video 를 다른 폴더로 본다', () => {
    const files = [f('mp4', 'Video/out.mp4'), f('md', 'video/notes.md')];
    const hubs = [APP({ results: ['Video/out.mp4'] })];
    expect(planConstellations(files, hubs, { platform: 'win32' }).memberOf.has('md')).toBe(true);
    expect(planConstellations(files, hubs, { platform: 'linux' }).memberOf.has('md')).toBe(false);
  });
});

describe('planKindBundles — 같은 폴더의 같은 종류(2026-10-21 사용자 지시 · 2026-10-22 직속 포함)', () => {
  const opts = { platform: 'win32' as const };

  it('사진 속 2번 — bubble-test 의 위성 다섯(전부 bubble-test/video 의 영상)은 영상 묶음 하나다', () => {
    const files = ['veg.veg', 'vob.vob', 'webm.webm', 'wmv.wmv', 'y4m.y4m']
      .map((n, i) => f(`v${i}`, `bubble-test/video/${n}`, { lastActivity: i }));
    const bundles = planKindBundles(files, opts);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ kind: 'video', dir: 'bubble-test/video', overflowIds: [] });
    expect(bundles[0]?.memberIds).toEqual(['v4', 'v3', 'v2', 'v1', 'v0']); // 최근 것부터
    expect(kindBundleNameOf(bundles[0]!.dir)).toBe('video');
  });

  it('사진 속 1번 — 같은 폴더의 사진만 묶고, md·코드는 어느 묶음에도 들지 않는다', () => {
    const bundles = planKindBundles([
      f('crop', 'saved/dispatchframealpha/user-crop-x4.png', { lastActivity: 3 }),
      f('tl', 'saved/dispatchframealpha/ref-tl.png', { lastActivity: 2 }),
      f('py', 'saved/dispatchframealpha/tools/align_ref.py', { lastActivity: 1 }),
      f('json', 'saved/ct-w2-245/dispatch-final-binding.json', { lastActivity: 1 }),
    ], opts);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ kind: 'image', memberIds: ['crop', 'tl'] });
  });

  it('폴더의 직속 파일도 같은 종류 둘 이상이면 묶음 하나다 — 직속 제외는 걷었다(2026-10-22 사용자 지시)', () => {
    const bundles = planKindBundles([f('a', 'video/a.mp4', { lastActivity: 1 }), f('b', 'video/b.mp4', { lastActivity: 2 })], opts);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ kind: 'video', dir: 'video', memberIds: ['b', 'a'], overflowIds: [] });
  });

  it('사진 속 many — 한 폴더의 png 40장은 사진 묶음 하나, 구성은 최근 moonMax 장이고 나머지는 overflow 로 알린다', () => {
    const files = Array.from({ length: 40 }, (_, i) => f(`p${i + 1}`, `bubble-test/many/p${String(i + 1).padStart(2, '0')}.png`, { lastActivity: i + 1 }));
    const [bundle, ...rest] = planKindBundles(files, opts);
    expect(rest).toHaveLength(0);
    expect(bundle).toMatchObject({ kind: 'image', dir: 'bubble-test/many' });
    expect(bundle?.memberIds).toHaveLength(CONSTELLATION.moonMax);
    expect(bundle?.memberIds[0]).toBe('p40');
    expect(bundle?.overflowIds).toHaveLength(40 - CONSTELLATION.moonMax);
  });

  it('하나뿐인 종류는 묶음이 아니라 파일이다(최소 둘)', () => {
    expect(planKindBundles([f('a', 'p/v/a.mp4'), f('b', 'p/i/b.png')], opts)).toEqual([]);
  });

  it('미디어가 아닌 종류는 묶지 않는다 — 앱이 여는 종류(사진·영상·소리·3D)만', () => {
    expect(planKindBundles([f('a', 'p/docs/a.md'), f('b', 'p/docs/b.md'), f('c', 'p/src/c.ts'), f('d', 'p/src/d.ts')], opts)).toEqual([]);
  });

  it('루트 바로 아래 파일은 includeRoot 일 때만 묶는다 — 메인 화면 최상위 파일(2026-10-22), 위성(서버)은 늘 폴더 안이다', () => {
    expect(planKindBundles([f('a', 'a.png'), f('b', 'b.png')], opts)).toEqual([]);
    const [root, ...rest] = planKindBundles([f('a', 'a.png', { lastActivity: 1 }), f('b', 'b.png', { lastActivity: 2 })], { ...opts, includeRoot: true });
    expect(rest).toHaveLength(0);
    expect(root).toMatchObject({ kind: 'image', dir: '', memberIds: ['b', 'a'] });
  });

  it('한 폴더에 종류가 섞이면 종류마다 따로 — 묶음에는 그 종류만', () => {
    const bundles = planKindBundles([
      f('a', 'p/media/a.mp4'), f('b', 'p/media/b.mp4'), f('c', 'p/media/c.png'), f('d', 'p/media/d.png'), f('e', 'p/media/e.wav'),
    ], opts);
    expect(bundles.map((b) => [b.kind, [...b.memberIds].sort()])).toEqual(expect.arrayContaining([
      ['video', ['a', 'b']],
      ['image', ['c', 'd']],
    ]));
    expect(bundles).toHaveLength(2); // 소리는 하나뿐이라 묶음이 아니다
  });

  it('같은 종류라도 폴더가 다르면 따로 — 묶음 하나는 한 폴더다', () => {
    const bundles = planKindBundles([f('a', 'p/x/a.png'), f('b', 'p/x/b.png'), f('c', 'p/y/c.png'), f('d', 'p/y/d.png')], opts);
    expect(bundles.map((b) => kindBundleNameOf(b.dir)).sort()).toEqual(['x', 'y']);
  });

  it('상한을 넘으면 최근 것부터 남기고 오래된 구성은 overflow 로 알린다', () => {
    const files = Array.from({ length: CONSTELLATION.moonMax + 2 }, (_, i) => f(`v${i}`, `p/clips/c${i}.mp4`, { lastActivity: i }));
    const [bundle] = planKindBundles(files, opts);
    expect(bundle?.memberIds).toHaveLength(CONSTELLATION.moonMax);
    expect(bundle?.overflowIds).toEqual(['v1', 'v0']);
    // 화면은 상한을 풀 수 있다(서버가 이미 적용했다).
    expect(planKindBundles(files, { ...opts, memberMax: Number.MAX_SAFE_INTEGER })[0]?.overflowIds).toEqual([]);
  });

  it('외부 노드 키(`__ext__` · 워크트리 접두 포함)를 같은 자로 잰다 — 하위 폴더와 직속이 저마다 묶음이다', () => {
    const files = [
      f('a', '__ext__c:/users/dev/temp/out/a.png'), // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      f('b', 'wtabc__ext__c:/users/dev/temp/out/b.png'), // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      f('c', '__ext__c:/users/dev/temp/c.png'), // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      f('d', '__ext__c:/users/dev/temp/d.png'), // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    ];
    const bundles = planKindBundles(files, opts);
    expect(bundles).toHaveLength(2);
    const byName = new Map(bundles.map((b) => [kindBundleNameOf(b.dir), [...b.memberIds].sort()] as const));
    expect(byName.get('out')).toEqual(['a', 'b']);
    expect(byName.get('temp')).toEqual(['c', 'd']);
    expect(kindBundlePathShape('wtabc__ext__c:\\users\\dev\\temp\\x.png')).toBe('c:/users/dev/temp/x.png'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('대소문자 — win32·darwin 은 접고 linux 는 가른다(플랫폼은 인자)', () => {
    const files = [f('a', 'p/Video/a.mp4'), f('b', 'p/video/b.mp4')];
    expect(planKindBundles(files, { platform: 'win32' })).toHaveLength(1);
    expect(planKindBundles(files, { platform: 'darwin' })).toHaveLength(1);
    expect(planKindBundles(files, { platform: 'linux' })).toHaveLength(0);
    // 같은 글자의 폴더면 linux 에서도 한 묶음이다.
    expect(planKindBundles([f('a', 'P/x/a.mp4'), f('b', 'P/x/b.mp4')], { platform: 'linux' })).toHaveLength(1);
  });

  it('같은 입력은 같은 열쇠 — 입력 순서와 무관하고, 한 부모 안에서 열쇠가 겹치지 않는다', () => {
    const files = [f('a', 'p/v/a.mp4'), f('b', 'p/v/b.mp4'), f('c', 'p/i/c.png'), f('d', 'p/i/d.png')];
    const a = planKindBundles(files, opts);
    const b = planKindBundles([...files].reverse(), opts);
    expect(a.map((x) => x.token)).toEqual(b.map((x) => x.token));
    expect(new Set(a.map((x) => x.token)).size).toBe(a.length);
  });
});

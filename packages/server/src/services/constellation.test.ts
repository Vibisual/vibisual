/**
 * §5.1 #2-1 — shared `fileFace.ts` · `fileMentions.ts` · `constellation.ts` 고정 시험.
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
  planConstellations,
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

describe('planConstellations — 작업물 별자리', () => {
  const opts = { platform: 'win32' as const };

  it('같은 이름의 json·코드는 영상을 돈다', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('json', 'video/teaser.json'),
      f('tsx', 'src/teaser.tsx'),
    ], [], opts);
    expect(plan.memberOf.get('json')).toMatchObject({ hub: 'mp4', reason: 'sameStem' });
    expect(plan.memberOf.get('tsx')).toMatchObject({ hub: 'mp4', reason: 'sameStem' });
    expect(plan.moonsOf.get('mp4')?.map((m) => m.id).sort()).toEqual(['json', 'tsx']);
  });

  it('코드는 같은 폴더만으로는 묶지 않는다 — 언급하면 묶는다', () => {
    const loose = planConstellations([f('logo', 'src/logo.png'), f('btn', 'src/Button.tsx')], [], opts);
    expect(loose.memberOf.has('btn')).toBe(false);
    const mentioned = planConstellations([
      f('logo', 'src/logo.png'),
      f('header', 'src/Header.tsx', { mentions: ['logo'] }),
    ], [], opts);
    expect(mentioned.memberOf.get('header')).toMatchObject({ hub: 'logo', reason: 'mention' });
  });

  it('곁 파일(문서·데이터)은 같은 폴더로 묶인다', () => {
    const plan = planConstellations([f('mp4', 'video/out.mp4'), f('notes', 'video/notes.md')], [], opts);
    expect(plan.memberOf.get('notes')).toMatchObject({ hub: 'mp4', reason: 'sameFolder' });
  });

  it('재료 미디어는 순위가 높은 중심으로 가고, 그 위성도 따라간다(깊이 1)', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('bg', 'video/bg.png'),
      f('bgtxt', 'prompts/bg.txt'),
    ], [], opts);
    expect(plan.memberOf.get('bg')).toMatchObject({ hub: 'mp4', reason: 'sameFolder' });
    // bg.txt 는 bg.png 와 같은 이름 — bg.png 가 영상의 재료가 됐으니 영상을 직접 돌고, 근거 파일은 via 로 남는다.
    expect(plan.memberOf.get('bgtxt')).toMatchObject({ hub: 'mp4', reason: 'sameStem', via: 'bg' });
    expect(plan.moonsOf.has('bg')).toBe(false);
  });

  it('영상은 어떤 중심의 재료도 아니다', () => {
    const plan = planConstellations([f('a', 'clips/teaser.mp4'), f('b', 'clips/teaser.mov')], [], opts);
    expect(plan.memberOf.size).toBe(0);
  });

  it('사진은 사진끼리 — 같은 폴더에서 가장 최근 사진이 중심', () => {
    const plan = planConstellations([
      f('a', 'photos/a.png', { lastActivity: 1 }),
      f('b', 'photos/b.jpg', { lastActivity: 3 }),
      f('c', 'photos/c.webp', { lastActivity: 2 }),
      f('d', 'other/d.png', { lastActivity: 9 }),
    ], [], opts);
    expect(plan.memberOf.get('a')).toMatchObject({ hub: 'b', reason: 'album' });
    expect(plan.memberOf.get('c')).toMatchObject({ hub: 'b', reason: 'album' });
    expect(plan.memberOf.has('d')).toBe(false);
  });

  it('앱 노드 선언이 가장 세다 — 결과 · 소재 · 코드 소재의 폴더', () => {
    const plan = planConstellations([
      f('result', 'out/hero.png'),
      f('index', '.vibisual/video/compositions/intro/index.html'),
      f('css', '.vibisual/video/compositions/intro/style.css'),
      f('asset', 'assets/bgm.wav'),
      f('prompt', 'prompts/hero.txt'),
    ], [{
      id: 'app-1',
      results: ['out/hero.png'],
      parts: ['assets/bgm.wav'],
      codeParts: ['.vibisual/video/compositions/intro/index.html'],
    }], opts);
    expect(plan.memberOf.get('result')).toMatchObject({ hub: 'app-1', reason: 'appResult' });
    expect(plan.memberOf.get('index')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    expect(plan.memberOf.get('css')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    expect(plan.memberOf.get('asset')).toMatchObject({ hub: 'app-1', reason: 'appPart' });
    // hero.txt 는 결과 그림과 같은 이름 — 그 그림이 앱의 것이니 앱을 돈다.
    expect(plan.memberOf.get('prompt')).toMatchObject({ hub: 'app-1', reason: 'sameStem', via: 'result' });
  });

  it('언급 사슬 — 묶인 재료가 적고 있는 파일은 그 별자리로', () => {
    const plan = planConstellations([
      f('mp4', 'video/teaser.mp4'),
      f('comp', 'video/teaser.composition.json', { mentions: ['bgm'] }),
      f('bgm', 'audio/bgm.wav'),
    ], [], opts);
    expect(plan.memberOf.get('comp')).toMatchObject({ hub: 'mp4' });
    expect(plan.memberOf.get('bgm')).toMatchObject({ hub: 'mp4', reason: 'chain', via: 'comp' });
  });

  it('같은 폴더의 컴포지션이 배경음을 적고 있어도 영상을 돈다 — 배경음은 사슬로 따라온다', () => {
    const plan = planConstellations([
      f('mp4', 'video/out.mp4'),
      f('comp', 'video/scene.json', { mentions: ['bgm'] }),
      f('bgm', 'audio/bgm.wav'),
    ], [], opts);
    expect(plan.memberOf.get('comp')).toMatchObject({ hub: 'mp4', reason: 'sameFolder' });
    expect(plan.memberOf.get('bgm')).toMatchObject({ hub: 'mp4', reason: 'chain', via: 'comp' });
  });

  it('모델이 적고 있는 텍스처는 옆 폴더의 영상보다 그 모델에 붙는다', () => {
    const plan = planConstellations([
      f('mp4', 'scene/turntable.mp4'),
      f('tex', 'scene/robot_albedo.png'),
      f('gltf', 'models/robot.gltf', { mentions: ['tex'] }),
    ], [], opts);
    expect(plan.memberOf.get('tex')).toMatchObject({ hub: 'gltf', reason: 'mentioned' });
    expect(plan.moonsOf.get('gltf')?.map((m) => m.id)).toEqual(['tex']);
  });

  it('자기 결과와 다른 영상을 함께 언급해도 같은 이름의 결과 곁에 남는다', () => {
    const plan = planConstellations([
      f('own', 'video/teaser.mp4', { lastActivity: 1 }),
      f('other', 'video/reference.mp4', { lastActivity: 10 }),
      f('source', 'video/teaser.json', { mentions: ['own', 'other'] }),
    ], [], opts);
    expect(plan.memberOf.get('source')).toMatchObject({ hub: 'own', reason: 'sameStem' });
  });

  it('서로 언급해도 모델이 재료를 적고 있다는 소속 근거가 지워지지 않는다', () => {
    const plan = planConstellations([
      f('video', 'preview/turntable.mp4'),
      f('model', 'models/robot.gltf', { mentions: ['material'] }),
      f('material', 'preview/surface.mtl', { mentions: ['model'] }),
    ], [], opts);
    expect(plan.memberOf.get('material')).toMatchObject({ hub: 'model', reason: 'mentioned' });
  });

  it('둘 이상 걸리면 높은 순위의 중심 · 같은 입력은 같은 그림', () => {
    const files = [f('mp4', 'w/clip.mp4'), f('png', 'w/still.png'), f('md', 'w/notes.md')];
    const a = planConstellations(files, [], opts);
    const b = planConstellations([...files].reverse(), [], opts);
    expect(a.memberOf.get('md')?.hub).toBe('mp4');
    expect(b.memberOf.get('md')?.hub).toBe('mp4');
  });

  it('위성 상한을 넘는 것은 원래 자리에 남는다', () => {
    const files = [f('mp4', 'v/teaser.mp4')];
    for (let i = 0; i < CONSTELLATION.moonMax + 3; i += 1) files.push(f(`n${i}`, `v/note${i}.md`, { lastActivity: i }));
    const plan = planConstellations(files, [], opts);
    expect(plan.moonsOf.get('mp4')?.length).toBe(CONSTELLATION.moonMax);
    expect(plan.memberOf.has('n0')).toBe(false); // 가장 오래된 것부터 남는다
  });

  it('폴더 비교는 플랫폼 규칙 — linux 는 Video 와 video 를 다른 폴더로 본다', () => {
    const files = [f('mp4', 'Video/out.mp4'), f('md', 'video/notes.md')];
    expect(planConstellations(files, [], { platform: 'win32' }).memberOf.has('md')).toBe(true);
    expect(planConstellations(files, [], { platform: 'linux' }).memberOf.has('md')).toBe(false);
  });
});

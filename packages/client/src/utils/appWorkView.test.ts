/**
 * §5.4 #36 (I) · §5.1 #2-1 (F) — 앱 작업 보기 판정(`planAppWork`)과 자리(`applyConstellations` 의 `workSeat`) 고정 시험.
 *
 * **결과 파일 없이 참조만 있는 작업**을 익명 픽스처로 쓴다 — Vibi3D 노드 `app-model-fixture` 는 `ref` 만 있고(결과 파일 없음) 그 작업이
 * 쓴 파일 11개가 전부 코드·데이터·문서였다. 지난번 구현은 가짜 `teaser.*` 묶음으로만 시험해 이 경우에서 변화가 0 이었다.
 */
import { describe, expect, it } from 'vitest';
import type { AppWorkMark, BubbleData, QueuedCommand } from '@vibisual/shared';
import { APP_WORK, CONSTELLATION } from '@vibisual/shared';

import { EMPTY_APP_WORK_PLAN, appWorkFocusOf, appWorkPlanKey, planAppWork, type AppWorkAppInfo, type AppWorkInput } from './appWorkView.js';
import { applyConstellations, type ConstellationAppHubView } from './constellationView.js';
import type { SatelliteInfo } from './satellite.js';

const ROOT = 'C:/work/sample-project';
const APP = 'app-model-fixture';
const AGENT = 'agent-primary-fixture';
const OTHER = 'agent-secondary-fixture';
const VIBI3D_EXTS = ['.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx', '.dae', '.3mf', '.vrm'];

/** 코드·데이터·문서로만 이루어진 작업 파일 11개. */
const REAL_FILES = [
  'scene-work.mjs', 'generate-materials.mjs', 'record-review.mjs', 'continuation.md', 'final-captures.json', 'palette.mjs',
  'sample-refine.mjs', 'upgrade.mjs', 'apply-palette.mjs', 'recover.mjs', 'interiors.mjs',
];

function file(name: string, dir = 'artifacts/vibi3d-korean-corner', marks?: Record<string, AppWorkMark>, last = 1): BubbleData {
  const rel = `${dir}/${name}`;
  return {
    id: `file-${rel}`,
    label: name,
    bubbleType: 'file',
    path: rel,
    absolutePath: `${ROOT}/${rel}`,
    status: 'idle',
    activity: 1,
    lastActivity: last,
    writeCount: 1,
    ...(marks ? { appWork: marks } : {}),
  } as BubbleData;
}

const vibi3d: AppWorkAppInfo = {
  id: APP, name: 'Vibi3D', glow: '#B9A8E0', exts: VIBI3D_EXTS, kind: 'model', linkedAgentIds: [AGENT], results: [],
};

function cmd(text: string, extra: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id: 'cmd-1', text, timestamp: 1, subAgentId: 'sub-fixture', status: 'completed', ...extra } as QueuedCommand;
}

function input(overrides: Partial<AppWorkInput> = {}): AppWorkInput {
  const tagged = REAL_FILES.map((name, i) => file(name, undefined, { [APP]: { w: 1, at: 100 + i, retro: true } }, 100 + i));
  return {
    agents: [{ id: AGENT }, { id: OTHER }],
    apps: [vibi3d],
    files: [
      ...tagged,
      file('preview.tsx', 'artifacts/dokkaebi'),
      file('brief.md', 'docs'),
    ],
    queued: {},
    completed: { [AGENT]: [cmd(`작업 완성 시켜  --- Linked canvas nodes (Vibi3D) ${APP}`)] },
    activeTaskNodes: () => null,
    platform: 'win32',
    ...overrides,
  };
}

describe('appWorkFocusOf — 초점 = 이어진 앱 노드 전부(2026-10-21 — 잇는 순간 켜진다)', () => {
  it('잇기만 해도 초점이다 — 명령도 작업 장부도 없이', () => {
    const linkedOnly = input({ queued: {}, completed: {} });
    expect(appWorkFocusOf({ id: AGENT }, linkedOnly.apps, linkedOnly)).toEqual([APP]);
    // 이어지지 않은 에이전트 · 버블 전부 보기 · 버블 숨기기는 초점이 없다.
    expect(appWorkFocusOf({ id: OTHER }, linkedOnly.apps, linkedOnly)).toEqual([]);
    expect(appWorkFocusOf({ id: AGENT, linkLens: 'files' }, linkedOnly.apps, linkedOnly)).toEqual([]);
    expect(appWorkFocusOf({ id: AGENT, bubblesHidden: true }, linkedOnly.apps, linkedOnly)).toEqual([]);
    // 끊으면 풀린다.
    const unlinked = [{ ...vibi3d, linkedAgentIds: [] }];
    expect(appWorkFocusOf({ id: AGENT }, unlinked, linkedOnly)).toEqual([]);
  });

  it('마지막 명령이 앱 명령이 아니어도(IDE 입력) 풀리지 않는다', () => {
    const base = input({ completed: { [AGENT]: [cmd(`앞 작업 ${APP}`), cmd('테스트 고쳐', { id: 'cmd-2' })] } });
    expect(appWorkFocusOf({ id: AGENT }, base.apps, base)).toEqual([APP]);
  });

  it('명령·작업 장부는 차례만 정한다 — 도는 명령 → 고른 작업 → 마지막 앱 명령 → 나머지 이은 노드', () => {
    const app = (id: string): AppWorkAppInfo => ({ ...vibi3d, id });
    const apps = [app('app-a-fixture'), app('app-b-fixture'), app('app-c-fixture'), app('app-d-fixture')];
    const order = appWorkFocusOf({ id: AGENT }, apps, {
      queued: { [AGENT]: [cmd('x', { status: 'executing', appNodeIds: ['app-c-fixture'] })] },
      completed: { [AGENT]: [cmd('앞', { appNodeIds: ['app-b-fixture'] }), cmd('IDE 입력', { id: 'cmd-2' })] },
      activeTaskNodes: (id) => (id === AGENT ? ['app-d-fixture'] : null),
    });
    expect(order).toEqual(['app-c-fixture', 'app-d-fixture', 'app-b-fixture', 'app-a-fixture']);
  });
});

describe('planAppWork — 사진 속 실제 경우', () => {
  const plan = planAppWork(input());
  const hub = plan.hubs.get(APP)!;

  it('그 작업의 파일 11개가 전부 Vibi3D 노드의 작업물이다(확장자 무관) — 읽기만 한 문서 · 남의 파일은 아니다', () => {
    expect(plan.focusByAgent.get(AGENT)).toEqual([APP]);
    const all = [...hub.work, ...hub.overflow].map((f) => f.path.split('/').pop());
    expect(new Set(all)).toEqual(new Set(REAL_FILES));
    expect(all).not.toContain('preview.tsx');
    expect(all).not.toContain('brief.md');
  });

  it('위성 상한 안에서 역할마다 하나씩 먼저 앉는다 — 제작 코드 · 데이터 · 메모가 모두 궤도에 있다', () => {
    expect(hub.work).toHaveLength(CONSTELLATION.moonMax);
    expect(hub.overflow).toHaveLength(REAL_FILES.length - CONSTELLATION.moonMax);
    const roles = hub.work.map((f) => f.role);
    expect(roles).toContain('code');
    expect(roles).toContain('data');
    expect(roles).toContain('memo');
    // 역할 순(제작 코드 → 데이터 → 메모)으로 놓인다.
    expect(roles.indexOf('data')).toBeGreaterThan(roles.lastIndexOf('code'));
    expect(roles.indexOf('memo')).toBeGreaterThan(roles.indexOf('data'));
    // 넘친 것은 가장 오래된 제작 코드다.
    expect(hub.overflow.every((f) => f.role === 'code')).toBe(true);
  });

  it('위성으로 서는 것은 접지 않고(keep) · 넘친 것은 감춘다(hidden)', () => {
    for (const f of hub.work) {
      expect(plan.keepIds.has(f.fileId)).toBe(true);
      expect(plan.keepIds.has(`sat-${f.fileId}`)).toBe(true);
    }
    for (const f of hub.overflow) expect(plan.hiddenWorkIds.has(`sat-${f.fileId}`)).toBe(true);
  });

  it('초점이 없으면 빈 판정이다 — 이은 앱이 없거나 버블 전부 보기', () => {
    expect(planAppWork(input({ apps: [{ ...vibi3d, linkedAgentIds: [] }] }))).toBe(EMPTY_APP_WORK_PLAN);
    expect(planAppWork(input({ agents: [{ id: AGENT, linkLens: 'files' }] }))).toBe(EMPTY_APP_WORK_PLAN);
    // 명령이 없어도 이었으면 판정이 선다.
    expect(planAppWork(input({ completed: {} })).focusByAgent.get(AGENT)).toEqual([APP]);
  });
});

describe('planAppWork — 다양한 확장자 · 연속 번호 · 노드 고르기', () => {
  const image: AppWorkAppInfo = {
    id: 'app-img-1', name: 'Vibimage', glow: '#E6C79C', exts: ['.png', '.jpg', '.svg'], kind: 'image', linkedAgentIds: [AGENT], results: [],
  };
  const both = { [APP]: { w: 1, at: 5 }, 'app-img-1': { w: 1, at: 5 } };

  it('꼬리표가 둘이면 그 확장자를 받는 앱의 노드로 간다', () => {
    const plan = planAppWork(input({
      apps: [vibi3d, image],
      files: [file('sign.png', 'out', both), file('street.blend', 'out', both), file('build.py', 'out', both)],
      completed: { [AGENT]: [cmd(`${APP} app-img-1`)] },
    }));
    const where = (name: string): string | undefined => [...plan.hubs.entries()]
      .find(([, h]) => h.work.some((f) => f.path.endsWith(name)))?.[0];
    expect(where('sign.png')).toBe('app-img-1');
    expect(where('street.blend')).toBe(APP);
    expect(where('build.py')).toBe(APP); // 같은 종류도 선언도 없으면 초점의 첫 노드
  });

  it('끝 번호만 다른 같은 확장자 파일은 위성 하나(가장 최근 것)로 묶고 나머지는 감춘다', () => {
    const frames = Array.from({ length: 5 }, (_, i) => file(`frame_000${i}.exr`, 'renders', { [APP]: { w: 1, at: 10 + i } }, 10 + i));
    const plan = planAppWork(input({ files: [...frames, file('notes.weird', 'renders', { [APP]: { w: 1, at: 1 } })] }));
    const hub = plan.hubs.get(APP)!;
    const seq = hub.work.find((f) => f.sequence);
    expect(seq?.path.endsWith('frame_0004.exr')).toBe(true);
    expect(seq?.sequence).toMatchObject({ label: 'frame_####.exr', count: 5 });
    expect(seq?.sequence?.names).toHaveLength(5);
    expect(hub.work.some((f) => f.path.endsWith('notes.weird'))).toBe(true); // 모르는 확장자도 작업물(기타)
    for (const f of frames.slice(0, 4)) expect(plan.hiddenWorkIds.has(f.id)).toBe(true);
    expect(APP_WORK.sequenceMin).toBeLessThanOrEqual(5);
  });

  it('노드에 담긴 결과는 작업 목록에 넣지 않는다(별자리가 결과로 앞에 둔다)', () => {
    const withResult = { ...vibi3d, results: [`${ROOT}/out/street.glb`] };
    const plan = planAppWork(input({
      apps: [withResult],
      files: [file('street.glb', 'out', { [APP]: { w: 2, at: 9 } }), file('scene.mjs', 'out', { [APP]: { w: 1, at: 8 } })],
    }));
    const hub = plan.hubs.get(APP)!;
    expect(hub.work.map((f) => f.path.split('/').pop())).toEqual(['scene.mjs']);
  });

  it('노드에 담긴 결과·지난 결과는 작업 목록에 없어도 접지 않는다(keep) — 꼬리표가 없어도', () => {
    // 2026-10-21 실측 모양 — 에이전트가 만든 shot.glb 를 결과로 넘겼더니 작업물 rig.obj 는 보이고 shot.glb 는 접혔다.
    const withResult = { ...vibi3d, results: [`${ROOT}/out/shot.glb`, `${ROOT}/out/shot-v1.glb`] };
    const shot = file('shot.glb', 'out', { [APP]: { w: 1, at: 9 } });
    const past = file('shot-v1.glb', 'out'); // 지난 결과 — 꼬리표 없음
    const rig = file('rig.obj', 'out', { [APP]: { w: 1, at: 8 } });
    const plan = planAppWork(input({ apps: [withResult], files: [shot, past, rig] }));
    for (const f of [shot, past, rig]) {
      expect(plan.keepIds.has(f.id)).toBe(true);
      expect(plan.keepIds.has(`sat-${f.id}`)).toBe(true);
    }
    expect(plan.hubs.get(APP)!.work.map((f) => f.path.split('/').pop())).toEqual(['rig.obj']);
  });

  it('작업이 같아도 결과가 바뀌면 판정 지문이 달라진다(옛 판정을 돌려쓰지 않게)', () => {
    const files = [file('shot.glb', 'out'), file('rig.obj', 'out', { [APP]: { w: 1, at: 8 } })];
    const before = planAppWork(input({ files }));
    const after = planAppWork(input({ apps: [{ ...vibi3d, results: [`${ROOT}/out/shot.glb`] }], files }));
    expect(appWorkPlanKey(after)).not.toBe(appWorkPlanKey(before));
  });
});

describe('applyConstellations — 앱 작업 위성의 자리(위쪽 반원 · 역할 순 · 앱 색 테)', () => {
  it('작업 파일이 앱 노드를 돌고, 9시 → 3시 사이에 역할 순으로 각도가 정해진다', () => {
    const plan = planAppWork(input());
    const hubPlan = plan.hubs.get(APP)!;
    const hub: ConstellationAppHubView = {
      id: APP, results: [], parts: [], codeParts: [], label: 'Vibi3D', size: 375, linksHidden: false,
      work: hubPlan.work.map((f) => f.path),
      workSeat: { appName: 'Vibi3D', ring: '#B9A8E0', appKind: 'model', meta: hubPlan.meta },
    };
    const folder: BubbleData = {
      id: 'folder-artifacts', label: 'artifacts', bubbleType: 'internal_folder', path: 'artifacts', status: 'idle', activity: 1,
    } as BubbleData;
    const satInfos: SatelliteInfo[] = input().files.map((b) => ({
      bubble: { ...b, id: `sat-${b.id}` },
      parentId: folder.id,
      parentSize: 80,
      edge: { id: `sat-edge-${b.id}`, source: folder.id, target: `sat-${b.id}`, isActive: false, color: '#8B5CF6', sourceRadius: 40, targetRadius: 20 },
      index: 0,
      total: 1,
      localRange: { min: 0, max: 0 },
      heat: undefined,
    }));
    const out = applyConstellations({ radial: [folder], satInfos, appHubs: [hub], heat: undefined, platform: 'win32' });
    const moons = out.satInfos.filter((s) => s.parentId === APP);
    expect(moons).toHaveLength(CONSTELLATION.moonMax);
    const angles = moons.map((m) => m.seatAngle!);
    for (const a of angles) {
      expect(a).toBeGreaterThan(APP_WORK.seatArcFrom);
      expect(a).toBeLessThan(APP_WORK.seatArcTo);
    }
    const tagged = moons.map((m) => (m.bubble as unknown as { _constellation: { reason: string; work?: { role: string; ring: string } } })._constellation);
    expect(tagged.every((t) => t.reason === 'appWork' && t.work?.ring === '#B9A8E0')).toBe(true);
    // 왼쪽(작은 각)부터 역할 순 — 제작 코드가 앞, 메모가 끝.
    const byAngle = moons.map((m, i) => ({ a: m.seatAngle!, role: tagged[i]!.work!.role })).sort((x, y) => x.a - y.a);
    expect(byAngle[0]!.role).toBe('code');
    expect(byAngle[byAngle.length - 1]!.role).toBe('memo');
    // 남의 파일 · 읽기만 한 문서는 그대로 폴더 곁이다.
    expect(out.satInfos.find((s) => s.bubble.id === 'sat-file-artifacts/dokkaebi/preview.tsx')?.parentId).toBe(folder.id);
  });
});

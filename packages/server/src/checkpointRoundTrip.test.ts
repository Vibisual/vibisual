/**
 * §3.2.2 — **영속 왕복의 집행.** 개별 필드를 고치는 것이 아니라, 같은 사고가 네 번째로
 * 재발하지 않게 하는 장치다.
 *
 * 왜 있나: `ProjectCheckpoint` 에 필드를 하나 더하는 데는 아무 관문이 없다. 그래서 새 축을
 * `getSnapshot` 과 `toCheckpoint()` 에만 넣고 **정작 디스크 포맷인 `toProjectCheckpoint` 에**
 * 빠뜨리는 일이 반복됐다 — `toCheckpoint()` 는 지금 테스트에서만 불리는데도 이름이 그럴듯해
 * "저장했다"는 착각을 준다. 지금까지 세 번 같은 자리에서 터졌다:
 *
 *  · v1.59 — `contis` 누락
 *  · v2.55 — `agentReports` 누락(껐다 켜면 신고 카드가 사라짐)
 *  · 이번  — `compactCounts` · `skillUsageCounts` · `autoAgentSummaries` · `satellitePositions`
 *            (복원 코드는 멀쩡한데 저장이 없어 늘 빈 맵이었다. 실측: 살아 있는 4.3MB
 *             `checkpoint.json` 에 네 키가 전부 없음)
 *
 * 증상이 "껐다 켜면 사라진다"라 **다음 부팅 전까지 아무도 모른다**. 그래서 문서가 아니라
 * 빌드가 막아야 한다 — `snapshotWireBudget.test.ts`(전선 부피)와 같은 집행 계열이다.
 *
 * 이 파일이 막는 것: `ProjectCheckpoint` 의 모든 필드는 **쓰기 한 곳 + 읽기 두 곳**에 있거나,
 * 아래 예외표에 사유와 함께 등재돼야 한다.
 *   · 쓰기 = `toProjectCheckpoint`  — 디스크에 나가는 유일한 자리
 *   · 읽기 = `restoreFromCheckpoint` — 첫 프로젝트
 *   · 읽기 = `mergeFromCheckpoint`   — **두 번째 이후** 프로젝트(여기만 빠지면 프로젝트를
 *                                      둘 이상 연 사람에게만 드러난다)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// 예외표 — 세 경로에 다 있지 **않아도 되는** 필드와 그 이유.
//
// 새 필드를 `ProjectCheckpoint` 에 더하면 세 경로에 넣거나 여기 한 줄을 쓰게 된다.
// 그 한 줄을 쓰는 동안 "껐다 켜면 이게 살아 있어야 하나"를 한 번 생각하는 것이 목적이다.
// ─────────────────────────────────────────────────────────────────────────────
const ROUND_TRIP_EXEMPT: Record<string, { readonly skip: readonly ('restore' | 'merge')[]; note: string }> = {
  version: { skip: ['restore', 'merge'], note: '파일 메타 — 읽는 쪽은 포맷 판정에서만 본다' },
  savedAt: { skip: ['restore', 'merge'], note: '파일 메타 — 저장 시각이라 되읽을 상태가 아니다' },
  uiLocale: {
    skip: ['merge'],
    note: '인스턴스 전역 UI 언어. merge 는 두 번째 프로젝트라 여기서 덮으면 먼저 연 프로젝트의 언어가 바뀐다',
  },
  pipelines: {
    skip: ['merge'],
    note: 'pipelineManager.restore() 가 싱글턴을 통째로 교체한다 — merge 에서 부르면 첫 프로젝트 파이프라인이 날아간다',
  },
};

const SRC = fileURLToPath(new URL('./services/projectGraph.ts', import.meta.url));
const TYPES = fileURLToPath(new URL('../../shared/src/types.ts', import.meta.url));

/** `ProjectCheckpoint` 선언에서 필드 이름을 뽑는다. */
function checkpointFields(): string[] {
  const src = fs.readFileSync(TYPES, 'utf8');
  const block = /export interface ProjectCheckpoint \{([\s\S]*?)\n\}/.exec(src);
  expect(block, 'ProjectCheckpoint 선언을 못 찾았다 — 이 스캔의 전제가 깨졌다').toBeTruthy();
  return [...(block![1] as string).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] as string);
}

/** 메서드 본문을 균형 중괄호로 떼어 낸다. */
function methodBody(src: string, header: string): string {
  const at = src.indexOf(header);
  expect(at, `본문을 못 찾았다: ${header}`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  throw new Error(`본문이 닫히지 않았다: ${header}`);
}

describe('ProjectCheckpoint 영속 왕복 — 쓰기 한 곳 + 읽기 두 곳', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const bodies = {
    write: methodBody(src, 'toProjectCheckpoint(projectName: string): ProjectCheckpoint'),
    restore: methodBody(src, 'restoreFromCheckpoint(cp: ProjectCheckpoint): void'),
    merge: methodBody(src, 'mergeFromCheckpoint(cp: ProjectCheckpoint): void'),
  } as const;

  it('모든 필드가 세 경로에 있거나 예외표에 등재돼 있다', () => {
    const missing: string[] = [];
    for (const field of checkpointFields()) {
      const exempt = ROUND_TRIP_EXEMPT[field];
      const re = new RegExp(`\\b${field}\\b`);
      for (const path of ['write', 'restore', 'merge'] as const) {
        if (path !== 'write' && exempt?.skip.includes(path)) continue;
        if (!re.test(bodies[path])) missing.push(`${field} (${path})`);
      }
    }

    expect(
      missing,
      '\n' +
      'ProjectCheckpoint 필드가 왕복 경로에서 빠졌다: ' + missing.join(', ') + '\n\n' +
      '`write` 가 빠지면 **껐다 켜면 사라진다**(디스크에 안 나간다).\n' +
      '`merge` 만 빠지면 프로젝트를 **둘 이상 연 사람에게만** 드러난다 — 가장 늦게 발견되는 부류다.\n' +
      '둘 중 하나를 하라:\n' +
      '  (A) 그 경로에 한 줄 넣는다. 쓰기는 `toProjectCheckpoint` 다 —\n' +
      '      `toCheckpoint()` 는 지금 테스트에서만 불리므로 거기 넣어도 디스크에는 안 나간다.\n' +
      '  (B) 안 넣을 이유를 이 파일의 `ROUND_TRIP_EXEMPT` 에 적는다.\n',
    ).toEqual([]);
  });

  it('예외표에 죽은 줄이 없다 — 사라진 필드의 면제는 지운다', () => {
    const fields = new Set(checkpointFields());
    expect(Object.keys(ROUND_TRIP_EXEMPT).filter((k) => !fields.has(k))).toEqual([]);
  });

  it('쓰기 경로는 toProjectCheckpoint 하나다 — toCheckpoint() 는 디스크로 나가지 않는다', () => {
    // 이 사실이 깨지면(= 누가 toCheckpoint() 를 저장 경로에 배선하면) 위 검사의 전제가 바뀐다.
    const callers = fs
      .readdirSync(fileURLToPath(new URL('./services/', import.meta.url)))
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => /(?<!toProject)\.toCheckpoint\(\)/.test(
        fs.readFileSync(fileURLToPath(new URL(`./services/${f}`, import.meta.url)), 'utf8'),
      ));
    expect(callers, 'toCheckpoint() 를 프로덕션에서 부르는 곳이 생겼다 — 이 파일의 전제를 다시 보라').toEqual([]);
  });
});

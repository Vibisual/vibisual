/**
 * §4 (상태바 모델 칸 ④) — **모델을 바꾸면 다음 턴부터.** 지속 자식이 옛 모델로 계속 답하지 않게 하는 판정.
 *
 * 지속 자식(§5.3 PERSISTENT)은 인자를 **스폰 때만** 받는다 — 두 번째 턴부터는 stdin 에 한 줄을 쓸 뿐이라
 * 그 사이 설정창에서 모델·강도를 바꿔도 자식은 모른다. 종전에는 그 자식이 잠듦 회수(§2.4)나 크래시로
 * 내려갈 때까지 옛 모델로 답했고, 상태바 모델 칸(실측)이 옛 이름을 그대로 보여 줬다.
 *
 * 그래서 스폰 때 실린 **모델 축 인자만** 지문으로 기억해 두고, 재사용 직전 지금 조립한 인자의 지문과
 * 대조한다. 판정은 순수 함수라 자식·타이머 없이 고정한다(`persistentChildModelAxes.test.ts`).
 *
 * **왜 모델 축만인가** — 매 턴 바뀔 수 있는 인자가 지문에 섞이면 매 턴 재스폰이 되고, 그러면 지속 자식이
 * 있는 이유(부팅·MCP 재연결·JSONL 재로드 비용 0)가 통째로 사라진다. 모델 축 인자 셋은 설정을 바꿀 때만
 * 바뀐다: `--model`(별칭은 레지스트리 latest 로 치환된 뒤의 값), `--effort`, `--settings`(설정 파일 이름이
 * **본문 해시**라 Fast·확장 사고·기억 범위가 바뀔 때만 이름이 바뀐다).
 */

/** 지문에 넣는 인자. 순서가 곧 지문의 자리다 — 바꾸면 살아 있는 자식이 전부 한 번씩 다시 뜬다. */
export const PERSISTENT_MODEL_AXIS_FLAGS = ['--model', '--effort', '--settings'] as const;

/**
 * 인자 배열 → 모델 축 지문. 플래그가 없으면 그 자리는 빈 값이다("안 붙였다"도 하나의 상태 —
 * 강도를 `default` 로 되돌리면 `--effort` 가 사라지고, 그것도 바뀐 것이다).
 */
export function modelAxesKeyOf(args: readonly string[]): string {
  return PERSISTENT_MODEL_AXIS_FLAGS
    .map((flag) => {
      const i = args.indexOf(flag);
      const value = i >= 0 && i + 1 < args.length ? args[i + 1] : '';
      return `${flag}=${value}`;
    })
    .join('\n');
}

export type PersistentReuseDecision =
  /** 그대로 stdin 에 쓴다(지문이 같거나, 스폰 때 지문을 모른다). */
  | 'reuse'
  /** 이 턴을 큐로 되돌리고 놀던 자식을 의도된 종료로 내린다 — close 가 `--resume` 으로 다시 띄운다. */
  | 'respawn'
  /** 지문은 달라졌지만 **백그라운드 작업이 살아 있어** 내리지 않는다. 옛 자식으로 한 턴 더 돈다. */
  | 'reuse-held';

export interface PersistentReuseInput {
  /** 지금 살아 있는 자식이 뜰 때 기억한 지문. 모르면 `undefined`(이 판정이 생기기 전에 뜬 자식 등). */
  spawnedKey: string | undefined;
  /** 이번 턴에 조립한 인자의 지문. */
  wantKey: string;
  /**
   * 그 자식 안에서 백그라운드 작업(배경 Bash·Monitor·배경 서브에이전트)이 도는가.
   * `--resume` 은 대화는 되살려도 **그 작업은 되살리지 못한다**(공식 문서) — 잠듦 회수와 같은 제외다.
   */
  hasLiveBackgroundWork: boolean;
}

/**
 * 재사용 직전의 판정. **모르면 재사용한다** — 스폰 때 지문이 없는 자식을 "바뀌었다"로 읽으면
 * 이 코드가 들어간 뒤 첫 턴에 살아 있던 자식이 전부 한 번씩 헛되이 다시 뜬다.
 */
export function decidePersistentReuse(input: PersistentReuseInput): PersistentReuseDecision {
  if (input.spawnedKey === undefined || input.spawnedKey === input.wantKey) return 'reuse';
  return input.hasLiveBackgroundWork ? 'reuse-held' : 'respawn';
}

/**
 * §4 (상태바 모델 칸 ④) — 모델을 바꾸면 다음 턴부터 먹게 하는 판정. 지속 자식(§5.3 PERSISTENT)은 인자를 스폰 때만 받아(이후 턴은 stdin 한 줄) 그대로 두면 회수·크래시 전까지 옛 모델로 답한다.
 * 그래서 스폰 때의 모델 축 인자만 지문으로 기억했다가 재사용 직전 지금 조립한 인자의 지문과 대조한다(`persistentChildModelAxes.test.ts`).
 * **모델 축만 넣는다** — 매 턴 바뀌는 인자가 섞이면 매 턴 재스폰이 되어 지속 자식의 이유(부팅·MCP 재연결·JSONL 재로드 0)가 사라진다.
 * 셋은 설정을 바꿀 때만 바뀐다: `--model`(별칭은 레지스트리 latest 로 치환된 값) · `--effort` · `--settings`(파일 이름이 본문 해시).
 * `--autocompact` 는 넣지 않는다 — 스폰이 압축 창을 싣지 않고(§4 CLI 사양 추종 (5)) 턴 경계 판정이 매번 저장값을 읽는다.
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

/** 재사용 직전의 판정. **모르면 재사용한다** — 스폰 때 지문이 없는 자식을 "바뀌었다"로 읽으면 살아 있던 자식이 전부 한 번씩 헛되이 다시 뜬다. */
export function decidePersistentReuse(input: PersistentReuseInput): PersistentReuseDecision {
  if (input.spawnedKey === undefined || input.spawnedKey === input.wantKey) return 'reuse';
  return input.hasLiveBackgroundWork ? 'reuse-held' : 'respawn';
}

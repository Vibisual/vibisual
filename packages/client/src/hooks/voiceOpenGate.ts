/**
 * voiceOpenGate — **§5.5 #17-38 마이크를 켜는 그 몇 초 동안의 규율.**
 *
 * 마이크 한 번 켜는 데 몇 초가 든다. 엔진이 안 떠 있으면 서버가 그때 자식을 띄우고 모델을
 * 읽기 때문이고(`ensureVoiceEngine`), 그 엔진은 아무도 안 쓰면 3분 뒤 내려간다. 그래서 같은
 * 버튼이 **어떤 때는 즉시, 어떤 때는 몇 초** 걸린다 — 기다리는 사람은 한 번 더 누른다.
 *
 * ### 왜 참·거짓 하나로는 안 되는가 (이 파일이 생긴 이유)
 * 종전에는 "여는 중"을 `opening` 참·거짓으로 들고, 참이면 새 켜기를 통째로 막았다. 그런데 그
 * 값은 **여는 흐름이 끝나야** 거짓이 되므로, 끄고 다시 켜면 앞 흐름이 끝날 때까지(최대 엔진
 * 시작 한도 20초) 누름이 **조용히 버려졌다**. 막으려던 것은 "두 벌 열림"인데 실제로 막은 것은
 * "다시 켜기"였고, 화면에는 눌러도 아무 일이 안 일어나는 간헐적 고장으로 보였다.
 *
 * 그래서 참·거짓 대신 **세대(generation)** 를 센다. 누를 때마다 세대가 오르고, 도는 흐름은
 * 자기 세대가 아직 최신일 때만 자원을 심는다 — **누름은 언제나 먹고, 자원은 언제나 한 벌**이다.
 *
 * DOM 도 React 도 쓰지 않는다. 이 판정이 이 파일에 있는 이유가 그것이다(단위 테스트가 붙는다).
 */

export interface VoiceOpenGate {
  /**
   * 새 켜기를 시작한다 — **거절하지 않는다.** 앞서 돌던 켜기는 이 순간 낡은 것이 된다.
   * 돌려주는 값이 그 켜기의 표이고, 이후 판정은 전부 이 표로 한다.
   */
  begin: () => number;
  /** 이 표가 아직 최신인가. 아니면 그 흐름은 자원을 심지 말고 물러나야 한다. */
  isCurrent: (token: number) => boolean;
  /** 도는 켜기를 전부 낡은 것으로 만든다(끄기·정리·창 닫힘). */
  abandon: () => void;
}

export function createVoiceOpenGate(): VoiceOpenGate {
  let generation = 0;
  return {
    begin: (): number => {
      generation += 1;
      return generation;
    },
    isCurrent: (token: number): boolean => token === generation,
    abandon: (): void => {
      generation += 1;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 엔진 포트 받아 오기 — "안 받았다" 와 "못 띄웠다" 를 가른다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 켜기 한 번이 엔진에 닿은 결과.
 *
 * 종전에는 셋이 `null` 하나로 뭉쳐 있어서, **서버에 잠깐 못 닿은 것**까지 "아직 안 받았다"로
 * 읽혔다 — 이미 650MB 를 받아 둔 사람에게 설치 창이 뜨는 것은 고쳐 주는 것이 아니라 겁주는
 * 것이다. 사유가 갈려야 화면이 사용자가 **실제로 할 수 있는 일**을 말할 수 있다.
 */
export type VoicePortResult =
  | { ok: true; port: number }
  | { ok: false; reason: 'needs-install' }
  | { ok: false; reason: 'engine-failed' };

export interface VoicePortDeps {
  /**
   * 지금까지 알고 있는 준비 상태(창이 뜰 때 한 번 물어 둔 값). 아직 모르면 `null`.
   * 이 값이 참이면 **묻는 왕복 한 번을 건너뛴다** — 누름과 마이크 사이는 짧을수록 좋다.
   */
  knownReady: boolean | null;
  /** 서버에게 디스크를 다시 보게 한다. 못 물어봤으면 `null`(= 아직 모름, ≠ 없음). */
  refresh: () => Promise<boolean | null>;
  /** 엔진을 띄우고 포트를 받는다. 못 받으면 `null`. */
  openSession: () => Promise<number | null>;
}

/**
 * **판정의 정본은 끝까지 서버(=디스크)다.** 알고 있는 값은 왕복을 건너뛰는 데만 쓰고, 그 값이
 * 거짓말이었으면(사용자가 폴더를 지웠으면) 바로 다음 걸음인 `openSession` 이 실패해 다시
 * 서버에게 묻는다. 즉 **틀린 캐시는 한 걸음 늦게 잡히고, 맞는 캐시는 한 걸음을 아낀다.**
 */
export async function resolveVoicePort(deps: VoicePortDeps): Promise<VoicePortResult> {
  const ready = deps.knownReady === true ? true : await deps.refresh();
  // 없는 것이 확인됐을 때만 설치 창이다. 모르면(`null`) 일단 열어 본다 — 물어보다 실패한 것을
  //   "안 받았다"로 옮기면, 받아 둔 사람이 누를 때마다 설치 창을 보게 된다.
  if (ready === false) return { ok: false, reason: 'needs-install' };

  const port = await deps.openSession();
  if (port !== null) return { ok: true, port };

  // 못 띄웠다. 이 순간의 디스크가 답을 가른다: 지웠으면 설치 안내, 있는데 안 뜨면 실패 사유.
  const after = await deps.refresh();
  return { ok: false, reason: after === false ? 'needs-install' : 'engine-failed' };
}

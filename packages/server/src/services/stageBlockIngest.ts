/**
 * §5.5 #17-17 ⑪(l) — **스트림에서 무대 블록을 수확한다.**
 *
 * 에이전트는 진행을 `curl` 이 아니라 **본문 안의 코드블록**으로 신고한다(⑪(l)). 그 블록은 우리가
 * 이미 받고 있는 텍스트 이벤트를 타고 들어오므로 **새 창구를 만들 필요가 없다** — 여기서 하는 일은
 * "흘러오는 글자에서 닫힌 블록을 찾아 한 번만 넘긴다"뿐이다.
 *
 * 어려운 것은 파싱이 아니라 **세 가지 경계**다.
 *
 * ⓐ **블록이 여러 이벤트에 걸쳐 온다.** `--include-partial-messages` 가 켜진 세션에서 텍스트는
 *    토큰 델타로 쪼개져 오므로(`subAgentManager` 의 `text_delta` 갈래), 여는 펜스와 닫는 펜스가
 *    다른 이벤트에 있다. 그래서 세션마다 **줄 조각**을 들고 이어 붙인 뒤에 읽는다.
 * ⓑ **같은 블록을 두 번 적용하면 안 된다.** partial 이 꺼진 세션에서는 완성 `assistant` 메시지가
 *    통째로 한 번 더 올 수 있고(§4 v2.88 의 중복 방지가 델타 쪽만 막는다), 스트림 복원·재수화
 *    경로도 같은 줄을 다시 흘린다. 본문 지문을 기억해 **처음 본 블록만** 넘긴다.
 * ⓒ **이벤트 경계에는 줄바꿈이 없다.** 텍스트 이벤트는 `assistant` 메시지의 **본문 블록 하나**인데,
 *    그 본문은 대개 개행으로 끝나지 않는다. 그래서 도구를 쓴 뒤 새 메시지가 곧장 신고로 시작하면
 *    이어 붙인 결과가 `…확인하겠습니다.` + `` ```vibisual `` 가 되어 **여는 펜스가 줄 머리를 잃는다**.
 *    마크다운 펜스는 줄 머리에서만 열리므로 그 신고는 화면에 **아무 표시도 없이** 통째로 사라진다.
 *
 * ⓒ 가 이 파일이 다시 쓰인 이유다. 실측(2026-09-10 · 저장된 스트림 464개 전수 재생): 무대 블록
 * 신고 **182건 중 27건(14.8%)** 이 이 경계에서 유실됐고, 유실은 첫 신고가 아니라 **일을 하고 난 뒤의
 * 갱신**에 몰렸다(첫 신고는 문장과 같은 메시지 안에 있어 개행이 살아 있다). 그래서 화면에서는
 * "목표 창이 첫 단계에 멈춘 채 세션이 끝난다"로 보였다. 게다가 유실은 **번진다** — 여는 펜스를 잃은
 * 블록의 닫는 펜스가 주인 없는 여는 펜스가 되어, 그 뒤에 오는 **멀쩡한 신고까지 삼켰다**
 * (실측 `sub-mtu0am3u-tvvu1x`: 신고 3건 중 1건만 도착 → 8단계가 1/8 에서 얼어붙음).
 *
 * 그래서 수확을 **꼬리 버퍼 재훑기**에서 **증분 줄 스캐너**로 바꿨다. 이제 상태(열린 펜스)가 명시적이라
 * ① 이벤트 경계에서 줄을 복원할 수 있고(ⓒ), ② 앞을 잘라낸 창에서 **주인 없는 닫는 펜스**가 생기지
 * 않으며(옛 구현은 4KB 꼬리만 남겨 긴 코드블록의 여는 펜스가 밀려 나갔다), ③ 닫는 펜스를 잃은
 * 블록이 세션의 남은 신고를 전부 삼키지 못한다(바이트 상한).
 *
 * 적용 자체는 여기서 하지 않는다 — 이 파일은 "무엇이 새로 왔는가"만 답하고, 목표·카드를 실제로
 * 고치는 것은 부르는 쪽(`index.ts`)이 기존 `noteSessionGoalProgress`/`upsertVisualKind` 로 한다.
 * 그래야 REST 로 들어온 신고와 블록으로 들어온 신고가 **같은 문**을 통과한다.
 */
import { isStageBlockLang, parseStageBlockBody, type StageBlockDirective } from '@vibisual/shared';

/** 개행 없이 이어지는 한 줄의 상한. 이보다 긴 줄은 펜스일 수 없고, 단계 본문으로도 쓸모가 없다. */
export const STAGE_INGEST_LINE_MAX = 4_096;

/**
 * 열린 펜스 하나가 물고 있을 수 있는 최대 바이트.
 *
 * 닫는 펜스를 잃은 블록(스트림 절단·오탐)이 **그 세션의 남은 신고를 전부 삼키는** 것을 막는다.
 * 이것이 없으면 잘못 열린 펜스 하나가 목표 창을 세션 끝까지 얼린다 — 실제로 그렇게 됐다.
 */
export const STAGE_INGEST_OPEN_MAX = 32_768;

/** 세션당 기억하는 "이미 본 블록" 개수. 넘으면 오래된 것부터 잊는다(같은 블록을 또 적용해도 무해하다). */
export const STAGE_INGEST_SEEN_MAX = 64;

/**
 * 동시에 들고 있는 세션 수 상한 — 세션이 사라져도 `forget` 이 안 불릴 수 있어(훅 세션·외부 종료)
 * 키 개수에 캡이 없으면 오래 켜 둔 서버에서 조용히 는다. 넘으면 가장 오래 안 쓴 것부터 놓는다.
 */
export const STAGE_INGEST_SESSIONS_MAX = 256;

/** 여는 펜스 — 마크다운 규칙 그대로 앞 공백 3칸까지, 백틱·물결 3개 이상. */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/u;

/**
 * ⓒ 이벤트 경계에서 줄을 되살릴지 판정하는 머리 모양 — **무대 블록의 펜스로 시작할 때만**이다.
 *
 * 여기를 넓히면(예: 아무 펜스나) 본문 안에 인라인으로 적힌 ``` 이 조각 머리에 걸릴 때 없는 줄이
 * 생기고, 그 주인 없는 펜스가 다음 신고를 삼킨다 — 지금 고치는 그 사고를 다른 얼굴로 다시 만든다.
 * 그래서 **정보 문자열이 무대 언어이고, 그 뒤가 줄 끝**일 때로 좁힌다(인라인 언급은 같은 줄에 글이
 * 이어지므로 걸리지 않는다).
 */
const SEAM_OPEN_RE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*(?:\r?\n|$)/u;

/** 같은 판정의 닫는 쪽 — 지금 무대 블록이 열려 있을 때만 쓴다. */
const SEAM_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n|$)/u;

/** 원문 → 32비트 지문(FNV-1a). 블록 전문을 그대로 들고 있지 않기 위한 것뿐이라 충돌 강도는 중요치 않다. */
function fingerprint(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${raw.length}`;
}

/** 지금 열려 있는 펜스. `stage` 가 아니면 본문을 모으지 않는다(예시 블록은 읽지 않고 지나친다). */
interface OpenFence {
  /** 여는 펜스 문자열 — 닫는 쪽은 같은 문자로 **이 길이 이상**이어야 한다(마크다운 규칙). */
  marker: string;
  /** 무대 블록인가. 아니면 이 블록이 닫힐 때까지 안쪽을 통째로 건너뛴다(⑪(l) 예시 보호). */
  stage: boolean;
  /** 무대 블록일 때만 쌓는다. */
  body: string[];
  /** 이 블록이 물고 있는 바이트 — 상한을 넘으면 닫는 펜스를 잃은 것으로 보고 놓는다. */
  bytes: number;
}

/** 세션 하나의 수확 상태. */
interface IngestState {
  /** 아직 개행을 못 만난 마지막 줄 조각. */
  partial: string;
  /** 열려 있는 펜스(있으면). */
  open?: OpenFence;
  /** 마지막으로 본 턴 도장 — 바뀌면 읽던 줄과 열린 펜스를 놓는다(턴을 넘어가는 블록은 없다). */
  turnId?: string;
}

/**
 * ⑪(l) — 세션별 줄 상태를 들고 새로 닫힌 무대 블록을 돌려준다.
 *
 * 상태를 가진 이유는 ⓐ·ⓒ 다 — 블록이 이벤트 경계를 넘어 오고, 그 경계에는 줄바꿈이 없다.
 * 상태가 없으면 델타 세션에서는 블록이 **영영 완성되지 않고**, 완성 메시지 세션에서는 신고가
 * 앞 문장에 달라붙어 **통째로 사라진다**.
 */
export class StageBlockIngest {
  private readonly states = new Map<string, IngestState>();
  private readonly seen = new Map<string, Set<string>>();

  /**
   * 새 텍스트 조각을 밀어 넣고, 이번에 **처음 닫힌** 블록들의 지시를 돌려준다.
   *
   * 읽을 것이 없으면 빈 배열 — 텍스트가 오갈 때마다 불리는 자리라 아무것도 없을 때가 압도적으로 많다.
   *
   * @param turnId 이 줄을 낳은 명령(`SubAgentStreamEvent.turnId`). 바뀌면 읽던 줄을 놓는다.
   */
  push(subAgentId: string, text: string, turnId?: string): StageBlockDirective[] {
    if (!text) return [];
    const st = this.stateOf(subAgentId);

    // 턴이 바뀌었다 = 앞 턴이 남긴 반쪽 줄·열린 펜스는 이 턴의 것이 아니다.
    if (turnId !== undefined) {
      if (st.turnId !== undefined && st.turnId !== turnId) {
        st.partial = '';
        delete st.open;
      }
      st.turnId = turnId;
    }

    const out: StageBlockDirective[] = [];

    // ⓒ **이벤트 경계는 줄 경계다** — 무대 펜스로 시작하는 조각은 앞 문장 꼬리에 붙지 않는다.
    if (st.partial && this.seamBreaks(text, st)) {
      this.feedLine(subAgentId, st, st.partial, out);
      st.partial = '';
    }

    let rest = text;
    for (;;) {
      const nl = rest.indexOf('\n');
      if (nl < 0) break;
      const line = st.partial + rest.slice(0, nl);
      st.partial = '';
      rest = rest.slice(nl + 1);
      this.feedLine(subAgentId, st, line, out);
    }
    st.partial += rest;

    // ⓒ 의 짝 — **닫는 펜스로 끝난 이벤트도 줄이 끝난 것이다.** 신고는 대개 메시지의 마지막
    //   덩어리라 본문이 닫는 펜스에서 그냥 끝난다(개행 없음). 다음 이벤트의 첫 문장이 그 펜스에
    //   달라붙으면 그 줄은 더 이상 닫는 펜스가 아니게 되고, 블록은 **영영 안 닫힌다** — 그 세션의
    //   신고가 그 뒤로 전부 사라진다. 지금 읽던 줄이 열린 펜스를 정확히 닫는 모양이면 여기서 닫는다.
    if (st.open && st.partial && this.closesFence(st.open.marker, st.partial.replace(/\r$/u, ''))) {
      const line = st.partial;
      st.partial = '';
      this.feedLine(subAgentId, st, line, out);
    }

    // 개행이 안 오는 아주 긴 줄 — 머리만 남긴다(펜스 판정에 필요한 것은 머리뿐이고, 이 길이를
    //   넘긴 줄은 단계 본문으로도 쓸모가 없다). 안 자르면 한 세션이 끝없이 문다.
    if (st.partial.length > STAGE_INGEST_LINE_MAX) st.partial = st.partial.slice(0, STAGE_INGEST_LINE_MAX);

    return out;
  }

  /** 턴 경계 — 읽던 줄과 열린 펜스만 놓는다. 본 블록 기억은 남긴다(같은 답이 재수화로 다시 흐를 수 있다). */
  resetBuffer(subAgentId: string): void {
    const st = this.states.get(subAgentId);
    if (!st) return;
    st.partial = '';
    delete st.open;
    delete st.turnId;
  }

  /** 세션이 사라졌다 — 들고 있던 것을 전부 놓는다(⑥ 의 좀비 차단과 같은 규율). */
  forget(subAgentId: string): void {
    this.states.delete(subAgentId);
    this.seen.delete(subAgentId);
  }

  /** 진단용 — 지금 몇 개 세션의 상태를 들고 있나. */
  get size(): number {
    return this.states.size;
  }

  /** 세션 상태를 꺼낸다(없으면 만든다). 키 개수는 상한에서 가장 오래 안 쓴 것부터 놓는다. */
  private stateOf(subAgentId: string): IngestState {
    const found = this.states.get(subAgentId);
    if (found) {
      // Map 은 삽입 순서를 지킨다 — 다시 넣어 "가장 최근"으로 옮긴다.
      this.states.delete(subAgentId);
      this.states.set(subAgentId, found);
      return found;
    }
    const fresh: IngestState = { partial: '' };
    this.states.set(subAgentId, fresh);
    while (this.states.size > STAGE_INGEST_SESSIONS_MAX) {
      const oldest = this.states.keys().next();
      if (oldest.done || oldest.value === subAgentId) break;
      this.states.delete(oldest.value);
      this.seen.delete(oldest.value);
    }
    return fresh;
  }

  /** ⓒ — 이 조각이 앞 줄과 갈라져야 하는가(무대 펜스로 시작하는가). */
  private seamBreaks(text: string, st: IngestState): boolean {
    const open = SEAM_OPEN_RE.exec(text);
    if (open) return isStageBlockLang(open[1] ?? '');
    // 무대 블록이 열려 있을 때는 닫는 펜스로 시작하는 조각도 갈라 준다(같은 문자·같은 길이 이상).
    if (!st.open?.stage) return false;
    const close = SEAM_CLOSE_RE.exec(text);
    const marker = close?.[1];
    if (!marker) return false;
    return marker[0] === st.open.marker[0] && marker.length >= st.open.marker.length;
  }

  /** 완성된 줄 하나를 스캐너에 먹인다. 블록이 닫히면 지시를 `out` 에 담는다. */
  private feedLine(subAgentId: string, st: IngestState, line: string, out: StageBlockDirective[]): void {
    // 펜스 판정용 사본 — 끝의 `\r` 만 떼어 낸다(CRLF 본문). 이걸 안 하면 여는 펜스의 `$` 가 `\r`
    //   앞에서 어긋나 **CRLF 로 흘러온 신고는 통째로 안 보인다**(화면에는 아무 표시도 없다).
    const probe = line.endsWith('\r') ? line.slice(0, -1) : line;
    const open = st.open;

    if (open) {
      if (this.closesFence(open.marker, probe)) {
        if (open.stage) this.emit(subAgentId, open.body.join('\n'), out);
        delete st.open;
        return;
      }
      open.bytes += line.length + 1;
      if (open.stage) open.body.push(line);
      // 닫는 펜스를 잃은 블록이 남은 신고를 전부 삼키지 않게 여기서 놓는다.
      if (open.bytes > STAGE_INGEST_OPEN_MAX) delete st.open;
      return;
    }

    const m = FENCE_OPEN_RE.exec(probe);
    if (!m) return;
    const marker = m[1] ?? '';
    // 무대 블록이 아니면 안쪽을 **읽지 않고 지나친다** — 문서 예시로 적힌 `vibisual` 블록을
    //   신고로 오인하지 않기 위해서다(⑪(l) 의 예시 보호 규칙 그대로).
    st.open = { marker, stage: isStageBlockLang((m[2] ?? '').trim()), body: [], bytes: 0 };
  }

  /** 닫는 펜스인가 — 같은 문자로 여는 것 이상 길고, 뒤에 정보 문자열이 없어야 한다(마크다운 규칙). */
  private closesFence(marker: string, probe: string): boolean {
    const re = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`, 'u');
    return re.test(probe);
  }

  /** 닫힌 무대 블록 하나 — 처음 보는 것이면 읽어서 담는다. */
  private emit(subAgentId: string, body: string, out: StageBlockDirective[]): void {
    const mark = fingerprint(body);
    let seen = this.seen.get(subAgentId);
    if (!seen) {
      seen = new Set<string>();
      this.seen.set(subAgentId, seen);
    }
    if (seen.has(mark)) return;
    seen.add(mark);
    if (seen.size > STAGE_INGEST_SEEN_MAX) {
      // Set 은 삽입 순서를 지킨다 — 가장 오래된 하나를 버린다.
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    const directive = parseStageBlockBody(body);
    if (directive) out.push(directive);
  }
}

/**
 * §5.5 #17-17 ⑪(l) — 스트림 텍스트에서 무대 블록(본문 코드블록 신고)을 수확한다. 닫힌 블록을 한 번만 넘기는 것이 전부이고 어려운 건 세 경계다.
 * ⓐ 블록이 여러 이벤트에 걸친다(partial 세션의 `text_delta`) — 세션마다 줄 조각을 이어 붙여 읽는다. ⓑ 같은 블록이 다시 온다(완성 메시지 중복·재수화) — 본문 지문으로 처음 것만.
 * ⓒ 이벤트 경계엔 줄바꿈이 없다 — 앞 문장에 붙은 여는 펜스를 놓치면 신고가 사라지고, 남은 닫는 펜스가 뒤 신고까지 삼킨다(실측 2026-09-10: 182건 중 27건).
 * 그래서 상태가 명시적인 증분 줄 스캐너다(경계 줄 복원·주인 없는 펜스 방지·바이트 상한). 적용은 부르는 쪽(`index.ts`)이 REST 신고와 같은 문으로 한다.
 */
import { isStageBlockLang, parseStageBlockBody, type StageBlockDirective } from '@vibisual/shared';

/** 개행 없이 이어지는 한 줄의 상한. 이보다 긴 줄은 펜스일 수 없고, 단계 본문으로도 쓸모가 없다. */
export const STAGE_INGEST_LINE_MAX = 4_096;

/** 열린 펜스 하나가 물 수 있는 최대 바이트 — 닫는 펜스를 잃은 블록이 세션 끝까지 신고를 삼키지 못하게. */
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

/** 경계 줄 복원은 무대 언어 펜스 + 줄 끝일 때만 — 넓히면 본문 인라인 ``` 이 조각 머리에 걸려 주인 없는 펜스가 다음 신고를 삼킨다. */
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

/** 세션별 줄 상태 — 없으면 델타 세션에선 블록이 완성되지 않고(ⓐ), 완성 메시지 세션에선 신고가 앞 문장에 붙어 사라진다(ⓒ). */
export class StageBlockIngest {
  private readonly states = new Map<string, IngestState>();
  private readonly seen = new Map<string, Set<string>>();

  /**
   * 새 조각을 밀어 넣고 처음 닫힌 블록의 지시를 돌려준다(대개 빈 배열).
   * @param turnId 이 줄을 낳은 명령 — 바뀌면 읽던 줄을 놓는다.
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

    // ⓒ 의 짝 — 닫는 펜스로 끝난 이벤트도 줄 끝이다. 다음 이벤트 첫 문장이 붙으면 블록이 영영 안 닫혀 뒤 신고가 다 사라지므로,
    // 읽던 줄이 펜스를 정확히 닫으면 여기서 닫는다.
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

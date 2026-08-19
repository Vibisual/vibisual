/**
 * streamSearch.ts — §5.5 #17 대화 인-페이지 검색(Ctrl+F)이 **무엇을 훑는지** 정하는 단 하나의 자리.
 *
 * 규칙: 검색은 **에이전트가 화면에 말한 본문 텍스트**(`.ide-md` 마크다운 문단 = `text` 항목)만 훑는다.
 * 명령창(사용자 프롬프트)·도구 입출력·시스템 줄·계획·결과·오류는 대상이 아니다.
 *
 * 이유(사용자 지시 — "이 검색은 Text 검색하는거야 별도의 명령창을 검색하는게 아니라 … 이런 Text들만"):
 * 종전엔 명령 원문·도구 input/output·시스템 줄까지 전부 매칭해, 정작 읽던 문장을 찾으려 해도 그 앞의
 * 도구 출력·명령 원문에 먼저 걸려 엉뚱한 자리로 끌려갔다. 훑는 범위가 넓을수록 n/total 은 커지는데
 * 사용자가 원한 그 문장은 그 안에서 더 찾기 어려워진다.
 *
 * Sub 탭(StreamRenderer)과 메인 탭(IDEMainArea)이 **같은 판정**을 쓰도록 여기 한 곳에 둔다 — 한쪽만
 * 고치면 같은 검색어가 탭에 따라 걸리고 안 걸린다(§5.5 #17 ⑦-5 `isCardEchoText` 와 같은 이유).
 */
import type { StreamDisplayItem } from './streamDensity.js';

/**
 * 이 종류가 "본문 텍스트" 인가 — Sub 탭은 항목 `kind`, 메인 탭은 엔트리 `type` 을 넣는다.
 * 두 탭이 쓰는 이름이 마침 같은 `'text'` 라 한 술어로 판정한다.
 */
export function isFindableTextKind(kind: string): boolean {
  return kind === 'text';
}

/** 항목에서 검색 대상 문자열 — 본문 텍스트면 그 내용, 아니면 빈 문자열(= 검색에 안 걸림). */
export function streamItemFindText(item: StreamDisplayItem): string {
  return isFindableTextKind(item.kind) && 'content' in item ? item.content : '';
}

/** 질의가 이 문자열에 걸리는가 — 대소문자 무시, 앞뒤 공백 무시. 빈 질의는 항상 false. */
export function findTextMatches(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return haystack.toLowerCase().includes(q);
}

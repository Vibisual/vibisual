/**
 * §5.5 #17 대화 인-페이지 검색 대상의 단 한 곳 — **에이전트 본문 텍스트**(`text` 항목)만 훑는다.
 * 명령창·도구 입출력·시스템 줄·계획·결과·오류를 넣으면 읽던 문장보다 앞의 도구 출력에 먼저 걸린다. Sub 탭·메인 탭이 같은 판정을 쓴다.
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

/**
 * §5.13 (V) 37-11 — 부품 서랍의 순수 층 배럴: 우리가 쓴 부품 아홉(HTML 생성기)과 공통 뼈대.
 */
export { VIDEO_PARTS, findPart } from './library.js';
export type { PartCategory, VideoPartDef } from './library.js';
export { partHtml } from './shell.js';
export type { PartShellArgs } from './shell.js';

/** §5.13 (V) 37-11 — [부품으로 저장]한 내 부품(`.vibisual/video/parts/<id>/part.json`). */
export interface SavedPartItem {
  readonly kind: string;
  /** 장면 시작 기준 시각(초). */
  readonly relStart: number;
  readonly duration: number;
  readonly label?: string;
  readonly sceneId?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly transform?: Readonly<Record<string, unknown>>;
  /** 화면·소리·자막 중 어느 트랙 종류에 서나. */
  readonly trackKind: 'visual' | 'audio' | 'caption';
  /** 컴포지션이면 `comps/` 안 폴더 이름. */
  readonly comp?: string;
  /** 그 밖의 소재면 그 소재(프로젝트 안 경로 그대로 — 내 부품은 이 프로젝트의 것). */
  readonly asset?: Readonly<Record<string, unknown>>;
  readonly cues?: readonly { readonly start: number; readonly end: number; readonly text: string }[];
}

export interface SavedPart {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly duration: number;
  readonly items: readonly SavedPartItem[];
}

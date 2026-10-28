import type { Express } from 'express';
import { json } from 'express';
import { LOOPBACK_REQUEST_MAX_BYTES } from '@vibisual/shared';

/**
 * §3.7 「훅 입구의 본문 상한은 문의 상한과 같다」 — 이 경로들은 본문 크기를 CLI 가 정한다(`Edit` 원본 전체·`Write` 내용·`apply_patch`).
 * 전역 `express.json()` 기본 100KB 에서 413 이면 신고가 수정 이력에서 빠지고, 큰 `Write` 권한 문의가 통과로 떨어져 자물쇠(§5.3 #12-3)를 비켜 간다(실측 2026-10-21).
 * 새 숫자 없이 문의 상한(`LOOPBACK_REQUEST_MAX_BYTES`)을 쓴다 — 라우트 상한도 여기서 끈다(§5.13 (R-10)).
 */
export const HOOK_INGRESS_JSON_PATHS: readonly string[] = [
  '/api/hook-event',
  '/api/permission-check',
  '/api/codex-tool-check',
  '/api/ask-user-question',
];

/** 전역 `express.json()` **앞에** 건다. 먼저 읽은 파서가 본문을 차지하므로 전역 파서는 이 경로를 다시 읽지 않는다. */
export function mountHookIngressBodyParser(app: Express): void {
  app.use([...HOOK_INGRESS_JSON_PATHS], json({ limit: LOOPBACK_REQUEST_MAX_BYTES }));
}

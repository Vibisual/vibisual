/**
 * 렌더 층 배럴 — **브라우저 전용** (SCENARIO.md §5.13 (F)).
 *
 * 여기서 내보내는 것들은 캔버스·WebCodecs 를 쓰므로 렌더러 문맥에서만 불러야 한다.
 * 서버는 `@vibisual/video` 본 진입점(순수 층)만 쓴다 — 그래야 서버 번들에 인코딩
 * 라이브러리가 딸려 들어가지 않는다.
 */

export * from './backend.js';
export * from './drawList.js';
export * from './frameSignature.js';
export * from './canvas2d.js';
export * from './htmlInCanvas.js';
export * from './offscreen.js';
export * from './media.js';
export * from './encode.js';
export * from './renderDoc.js';
export * from './audioMix.js';
export * from './htmlStage.js';
export * from './autoReview.js';
export * from './scenes.js';

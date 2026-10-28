/**
 * §5.5 #17-6 (H-19) — 윤곽선 IPC 는 `transparent` 창의 문서가 실제로 선 뒤에 대답한다(그 전엔 투명한 빈 창이라 선이 없다).
 * electron 에 붙은 파일들이라 소스로 집행한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다(.gitattributes 없음) — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
const IPC = readFileSync(join(HERE, 'ipc.ts'), 'utf8').replace(/\r\n/g, '\n');
const GHOST = readFileSync(join(HERE, 'ghostFrame.ts'), 'utf8').replace(/\r\n/g, '\n');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('(H-19) 선은 실제로 선 뒤에 대답한다', () => {
  it('`ghost-show` IPC 는 문서가 서기를 기다린 뒤 참을 돌려준다', () => {
    const handler = block(IPC, "'vibisual:overlay:ghost-show',", "'vibisual:overlay:ghost-nudge'");
    expect(handler).toContain('await whenPopOutGhostPainted()');
    // 못 세운 판은 기다리지 않는다 — 렌더러가 곧바로 앱 안 윤곽선으로 폴백해야 한다.
    expect(handler).toContain('if (!shown) return false;');
  });

  it('기다림에는 상한이 있다 — 영영 안 서도 렌더러가 갇히지 않게', () => {
    const wait = block(GHOST, 'export function whenPopOutGhostPainted(', '\n}');
    expect(wait).toContain('GHOST_PAINT_WAIT_MS');
    expect(wait).toContain("once('did-finish-load'");
    // 이미 선 문서는 기다리지 않는다(같은 선을 갈아 끼우는 판이 대부분이다).
    expect(wait).toContain('g.loaded) return Promise.resolve();');
  });
});

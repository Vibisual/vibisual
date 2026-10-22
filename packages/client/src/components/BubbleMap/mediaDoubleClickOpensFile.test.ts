/**
 * §5.1 #2-1 (A)(B) — 미디어 파일 더블클릭은 **그 파일을 연다** — 우리 앱 안이 먼저다(2026-10-22 사용자 지시 두 번 — "특정 유형을
 * 연상시키는 버블이 나와있고 그걸 누르면 묶음 버블처럼 동작하잖아" · "기존파일은 클릭하면 해당 위치로 이동하는게 맞는데 지금 이
 * 신설한 것은 해당 파일이 우리 앱안에셔 열리게 만드는게 목적").
 *
 * 종전에는 우리 앱이 못 여는 미디어(veg·vob·wmv …)를 누르면 위성이면 그 파일의 폴더로, 묶음 안이면 묶음에서 나와 그 폴더로
 * 들어가 같은 종류 파일 무리를 다시 펼쳤다 — 영상처럼 보이는 버블이 묶음처럼 동작했다. 그다음 판은 못 여는 것을 전부 OS 연결
 * 프로그램으로 넘겨, 변환하면 우리 앱에서 열리는 wmv·vob 까지 바깥으로 나갔다. 이제 여는 곳은 `fileFaceOpenRoute` 한 곳이 정하고
 * (판정 시험은 `fileFaceView.test.ts`), 이 손잡이는 그 답대로만 연다 — 위치(폴더)로 가는 길은 미디어가 아닌 위성뿐이다.
 * 더블클릭 손잡이는 거대한 컴포넌트 안이라 원문으로 지킨다(`titlebarPress.test.ts` 와 같은 방식).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./BubbleMap.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('미디어 파일 더블클릭은 그 파일을 연다', () => {
  it('여는 곳은 판정 한 곳의 답대로 — 앱 · 변환(R-8) · 연결 프로그램, 폴더로 떨어지지 않는다', () => {
    const at = source.indexOf('if (face !== null && face.media) {');
    expect(at).toBeGreaterThan(0);
    const end = source.indexOf('// §5.3 #28 v1.47', at);
    expect(end).toBeGreaterThan(at);
    const branch = source.slice(at, end);
    expect(branch).toContain('fileFaceOpenRoute(face, target)');
    expect(branch).toContain('openAppWindow(');
    // 변환 갈래는 IDE 탐색기와 같은 문으로 연다(변환해 둔 것이 있으면 바로, 없으면 변환 창).
    expect(branch).toMatch(/route === 'convert'[\s\S]*?void openWorkspaceTarget\(/);
    expect(branch).toMatch(/void openExternally\(data\.absolutePath\);\s*return;/);
    expect(branch).not.toContain('enterFolder');
  });

  it('묶음 안의 파일을 눌러 묶음에서 나와 그 폴더로 들어가던 길은 없다', () => {
    expect(source).not.toMatch(/store\.exitInterior\(\);\s*store\.enterFolderDeep\(/);
  });
});

/**
 * §5.1 #2-1 (A)(B) — 파일 버블 더블클릭은 위성·원 둘레·묶음 안 어디서든 **앱 안에서 연다** — 폴더로 들어가지 않고, 변환해 열 수 있는 wmv·vob 도 OS 로 넘기지 않는다.
 * 여는 곳은 `fileFaceOpenPlan`, 여는 길은 `openFileBubble` 한 벌. 손잡이는 거대한 컴포넌트 안이라 원문으로 지킨다(`titlebarPress.test.ts` 방식).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./BubbleMap.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const openSource = readFileSync(fileURLToPath(new URL('./fileBubbleOpen.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** 여는 길 본문 — `openFileBubble` 시작부터 끝까지. */
function openFileBubbleBody(): string {
  const at = openSource.indexOf('export function openFileBubble(');
  expect(at).toBeGreaterThan(0);
  return openSource.slice(at);
}

/** 더블클릭 손잡이 본문 — 시작부터 그 콜백이 닫히는 자리까지. */
function doubleClickHandler(): string {
  const at = source.indexOf('const handleNodeDoubleClick = useCallback(');
  expect(at).toBeGreaterThan(0);
  const end = source.indexOf('}, [rememberViewport]);', at);
  expect(end).toBeGreaterThan(at);
  return source.slice(at, end);
}

describe('파일 버블 더블클릭은 그 파일을 우리 앱 안에서 연다', () => {
  it('여는 곳은 판정 한 곳의 답대로 — 앱 · 변환(R-8) · 파일 창 · 연결 프로그램, 폴더로 떨어지지 않는다', () => {
    const handler = doubleClickHandler();
    const at = handler.indexOf("if (data.bubbleType === 'file') {");
    expect(at).toBeGreaterThan(0);
    const end = handler.indexOf('// §5.3 #28 v1.47', at);
    expect(end).toBeGreaterThan(at);
    const branch = handler.slice(at, end);
    // 캔버스는 여는 길 한 벌을 판 자리 그대로(파일 창) 부른다 — 판 자리를 바꿔 넘기는 것은 IDE 안의 지도뿐이다.
    expect(branch).toMatch(/openFileBubble\(data\);\s*return;/);
    expect(branch).not.toContain('openFileBubble(data,');
    expect(branch).not.toContain('enterFolder');

    const body = openFileBubbleBody();
    // 미디어만이 아니라 **모든 파일**이 같은 판정을 탄다.
    expect(body).not.toContain('face.media');
    expect(body).toContain('fileFaceOpenPlan(face, target, faceSourcePath(data))');
    expect(body).toContain('openAppWindow(');
    // 변환 갈래는 IDE 탐색기와 같은 문으로 연다(변환해 둔 것이 있으면 바로, 없으면 변환 창).
    expect(body).toMatch(/plan\.route === 'convert'[\s\S]*?void openWorkspaceTarget\(/);
    // 글 파일은 판 자리로 — 기본은 파일 창(IDE 밖에 따로 선 판)이고, IDE 창을 열거나 IDE 편집창을 찾지 않는다.
    expect(body).toMatch(/openPane: \(absPath: string\) => boolean = openFileInFileWindow/);
    expect(body).toMatch(/plan\.route === 'pane'[\s\S]*?openPane\(data\.absolutePath\)/);
    expect(body).not.toContain('openIDEOverlay');
    expect(body).not.toContain('openIDEEditorFile');
    expect(body).toMatch(/void openExternally\(data\.absolutePath\);\s*\}/);
    expect(body).not.toContain('enterFolder');
  });

  it('위성이 그 파일의 폴더로 들어가던 길은 없다', () => {
    const handler = doubleClickHandler();
    expect(handler).not.toContain("node.id.startsWith('sat-')");
    expect(handler).not.toContain('resolveSatelliteFolderId');
    expect(handler).not.toContain('enterFolderDeep');
    expect(source).not.toContain("from './satelliteNavigate.js'");
  });

  it('묶음 안의 파일을 눌러 묶음에서 나와 그 폴더로 들어가던 길은 없다', () => {
    expect(source).not.toMatch(/store\.exitInterior\(\);\s*store\.enterFolderDeep\(/);
  });
});

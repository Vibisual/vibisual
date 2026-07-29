// §4 v3.66 모바일 QR 페어링 — QR 매트릭스를 canvas 에 그리는 유틸.
//
// 인코딩은 `qrcode-generator`(의존성 0·MIT)를 **동적 import** 로 가져온다 — Mobile Access
// 모달을 열 때만 로드되므로 초기 번들과 모바일 첫 로드에 영향이 없다. 화면 표시와 PNG 저장이
// 같은 canvas 를 쓰기 때문에(§5.9 캡처 스냅샷 저장 관행 재사용) 별도 이미지 경로가 없다.

/** QR 한 변의 표시 크기(CSS px). 폰 카메라가 30cm 거리에서 무리 없이 잡는 크기. */
export const QR_RENDER_SIZE = 208;

/** QR 주변 여백(모듈 수) — 스캐너 인식에 필요한 quiet zone 표준값. */
const QR_QUIET_MODULES = 4;

/** 오류정정 레벨 — M(15% 복원)이 크기·인식률 균형점(URL 길이가 짧아 셀도 충분히 크다). */
const QR_ERROR_CORRECTION = 'M' as const;

/** devicePixelRatio 상한 — 고배율 화면에서 캔버스가 불필요하게 커지는 것 방지. */
const QR_MAX_DPR = 3;

// 패키지가 `export =`(CJS) 로 타입 선언돼 있어 타입상으론 네임스페이스지만 ESM 빌드는 default
// 로도 내보낸다 — 번들러가 어느 쪽을 주든 받도록 둘 다 훑는다.
type QrFactory = typeof import('qrcode-generator');

// 동적 import 는 한 번만 — 이후 대상 주소를 바꿔 다시 그릴 때는 즉시 인코딩된다.
let encoderPromise: Promise<QrFactory> | null = null;

function loadEncoder(): Promise<QrFactory> {
  encoderPromise ??= import('qrcode-generator').then((mod) => {
    const withDefault = mod as unknown as { default?: QrFactory };
    return withDefault.default ?? (mod as unknown as QrFactory);
  });
  return encoderPromise;
}

/**
 * `text` 를 QR 로 인코딩해 `canvas` 에 그린다(흰 배경 + 검은 모듈).
 * 캔버스 픽셀 크기는 DPR 을 반영해 잡고 CSS 크기는 `size` 로 고정한다 — 화면은 선명하고,
 * 저장되는 PNG 는 인쇄/재스캔에 충분한 해상도를 갖는다.
 */
export async function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  size: number = QR_RENDER_SIZE,
): Promise<void> {
  const qrcode = await loadEncoder();
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const totalModules = moduleCount + QR_QUIET_MODULES * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, QR_MAX_DPR);
  // 셀 크기를 정수로 떨어뜨려야 모듈 경계가 흐려지지 않는다(반올림 번짐 = 인식 실패 원인).
  const cell = Math.max(1, Math.floor((size * dpr) / totalModules));
  const pixels = cell * totalModules;

  canvas.width = pixels;
  canvas.height = pixels;
  // CSS 크기는 요청값이 아니라 **실제 그린 픽셀 / DPR** 로 맞춘다 — size 로 억지로 늘리면
  // 보간이 들어가 모듈 경계가 번지고(=인식률 저하), 정수배로 두면 항상 또렷하다.
  const cssSize = pixels / dpr;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect((col + QR_QUIET_MODULES) * cell, (row + QR_QUIET_MODULES) * cell, cell, cell);
    }
  }
}

/** 캔버스를 PNG 파일로 내려받는다 — §5.9 캡처 스냅샷 저장과 동일 경로(blob → a.download). */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[^\w.-]+/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

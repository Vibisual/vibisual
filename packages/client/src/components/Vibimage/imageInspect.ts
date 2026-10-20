import type { InspectorPickLevel, InspectorPickLevels, InspectorPickPoint } from '../../utils/inspectorPick.js';
import type { ImageDocument, ImageLayer } from '../Creation/imageSource.js';

/**
 * §5.4 #15 (C) — Alt 인스펙터가 그림 앱 안을 집는다. 편집기 무대는 레이어를 SVG 로 그려(속 HTML — React 가 모르는 요소)
 * 브라우저가 집은 도형만으로는 "어느 원본의 어느 레이어"인지 알 수 없었고, 보기 화면은 그림이 손짓을 받지 않아(`pointer-events:none`)
 * 무대가 통째로 집혔다. 그래서 문서로 답한다 — 레이어는 안정 id·자리·글을, 그림은 파일과 픽셀 좌표를 싣는다.
 */

export interface ImageInspectContext {
  readonly projectId: string;
  /** 저장된 원본 — 아직 저장 전 초안이면 null. */
  readonly source: { readonly id: string; readonly revision: number; readonly title: string } | null;
  /** 편집기에 저장 안 한 변경이 있다(원본을 읽어도 지금 화면과 다르다). */
  readonly unsaved: boolean;
  /** 시안 비교의 시안 쪽이면 그 시안(채택 전 제안). */
  readonly proposal?: { readonly id: string; readonly baseRevision: number } | null;
}

const quote = (text: string): string => JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
const round = (value: number): number => Math.round(value);
const CREATION_API = '$VIBISUAL_BASE/api/app/creation';
const CREATION_GUIDE = `guide: GET ${CREATION_API}/guide`;

/** viewBox 판의 맞춤(`preserveAspectRatio` 기본 = xMidYMid meet) — 문서 1px 이 판 안의 몇 px 이고 문서가 어디서 시작하나. */
export function imageStageFit(doc: Pick<ImageDocument, 'width' | 'height'>, box: { readonly width: number; readonly height: number }): { scale: number; x: number; y: number } {
  const scale = Math.min(box.width / doc.width, box.height / doc.height);
  return { scale, x: (box.width - doc.width * scale) / 2, y: (box.height - doc.height * scale) / 2 };
}

function contains(layer: ImageLayer, x: number, y: number): boolean {
  if (layer.kind === 'shape' && layer.shape === 'ellipse') {
    const rx = layer.width / 2; const ry = layer.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (x - (layer.x + rx)) / rx; const dy = (y - (layer.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height;
}

/** 그 자리의 맨 위 레이어 — 배열 뒤가 위다(`imageSvgBody`). 숨긴 것·완전히 투명한 것은 지나간다(보이는 것을 집는다). */
export function imageLayerAt(doc: ImageDocument, x: number, y: number): ImageLayer | null {
  for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
    const layer = doc.layers[i]!;
    if (!layer.visible || layer.opacity <= 0) continue;
    if (contains(layer, x, y)) return layer;
  }
  return null;
}

function head(doc: ImageDocument, ctx: ImageInspectContext): string {
  if (!ctx.source) return `[Image] unsaved draft (${doc.width}x${doc.height}) in project ${quote(ctx.projectId)} — not saved as a source yet`;
  if (ctx.proposal) {
    return `[Image] proposal "${ctx.proposal.id}" for source "${ctx.source.id}" (${quote(ctx.source.title)}, based on revision ${ctx.proposal.baseRevision},`
      + ` ${doc.width}x${doc.height}) in project ${quote(ctx.projectId)} — preview, not adopted`;
  }
  return `[Image] source "${ctx.source.id}" (${quote(ctx.source.title)}, revision ${ctx.source.revision}, ${doc.width}x${doc.height}) in project ${quote(ctx.projectId)}`
    + (ctx.unsaved ? ' — the editor has unsaved edits' : '');
}

function hint(ctx: ImageInspectContext): string {
  if (!ctx.source) return `[Hint] This is an unsaved image draft, not app code. Ask the user to save it in Vibimage first (${CREATION_GUIDE}).`;
  const doc = `${CREATION_API}/docs/${encodeURIComponent(ctx.source.id)}`;
  const project = encodeURIComponent(ctx.projectId);
  const read = ctx.proposal
    ? `GET ${doc}/candidates/${encodeURIComponent(ctx.proposal.id)}?projectId=${project} reads this proposal; to change it propose again with`
    : `GET ${doc}?projectId=${project} first, then propose the change with`;
  return `[Hint] This is image source data, not app code. ${read} POST ${doc}/candidates (the user adopts it — never accept it yourself;`
    + ` ${CREATION_GUIDE}). Coordinates are output pixels; layers are back to front.`;
}

export function buildImagePickClipboard(doc: ImageDocument, ctx: ImageInspectContext, pointed: string): string {
  return [head(doc, ctx), `[Pointed] ${pointed}`, hint(ctx)].join('\n');
}

function describeLayer(doc: ImageDocument, layer: ImageLayer, x: number, y: number): string {
  const index = doc.layers.indexOf(layer);
  const flags = [layer.locked ? 'locked' : '', layer.kind === 'shape' && layer.shape ? layer.shape : ''].filter(Boolean);
  const text = layer.kind === 'text' && layer.text ? ` — text ${quote(layer.text)}` : '';
  return `layer ${quote(layer.name || layer.kind)} id "${layer.id}" (${layer.kind}, x ${round(layer.x)}, y ${round(layer.y)}, ${round(layer.width)}x${round(layer.height)},`
    + ` layer ${index + 1} of ${doc.layers.length}${flags.length ? `, ${flags.join(', ')}` : ''}) at (${round(x)}, ${round(y)})${text}`;
}

/**
 * 편집기 무대 — 맨 위 레이어 → 그림 판(문서 전체). 판 밖(맞춤 여백)이면 빈 답 — 무대가 그대로 DOM 으로 집힌다.
 * 상자는 판 안의 보이는 픽셀이다(레이어가 문서 밖으로 나가 있으면 보이는 만큼만).
 */
export function imageStageLevels(doc: ImageDocument, ctx: ImageInspectContext, labels: { readonly canvas: string }, at: InspectorPickPoint): InspectorPickLevels {
  if (doc.width <= 0 || doc.height <= 0 || at.width <= 0 || at.height <= 0) return [];
  const fit = imageStageFit(doc, at);
  const x = (at.x - fit.x) / fit.scale;
  const y = (at.y - fit.y) / fit.scale;
  if (x < 0 || y < 0 || x > doc.width || y > doc.height) return [];
  const toLocal = (left: number, top: number, width: number, height: number): InspectorPickLevel['rect'] => {
    const l = Math.max(0, fit.x + left * fit.scale); const t = Math.max(0, fit.y + top * fit.scale);
    const r = Math.min(at.width, fit.x + (left + width) * fit.scale); const b = Math.min(at.height, fit.y + (top + height) * fit.scale);
    return { x: l, y: t, width: Math.max(1, r - l), height: Math.max(1, b - t) };
  };
  const levels: InspectorPickLevel[] = [];
  const layer = imageLayerAt(doc, x, y);
  if (layer) {
    levels.push({
      rect: toLocal(layer.x, layer.y, layer.width, layer.height),
      label: layer.name || layer.kind,
      text: layer.kind === 'text' ? layer.text ?? '' : layer.kind === 'shape' ? layer.shape ?? 'rect' : layer.kind,
      clipboard: buildImagePickClipboard(doc, ctx, describeLayer(doc, layer, x, y)),
    });
  }
  levels.push({
    rect: toLocal(0, 0, doc.width, doc.height),
    label: `${labels.canvas} ${doc.width}×${doc.height}`,
    text: doc.background,
    clipboard: buildImagePickClipboard(doc, ctx, `the whole canvas ${doc.width}x${doc.height} (background ${doc.background}, ${doc.layers.length} layers) at (${round(x)}, ${round(y)})`),
  });
  return levels;
}

/** 보기 화면의 지금 모습 — 무대 크기(레이아웃 px)·그림 원래 크기·배율·끌어 옮긴 만큼. */
export interface ImageViewerView {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * 보기 화면 — 그림 위면 그 그림(픽셀 좌표와 함께), 바탕이면 빈 답. 그림은 무대 가운데 + 끌어 옮긴 만큼에 배율로 선다
 * (`VibimageViewer` 의 transform). 무대가 CSS `zoom` 아래에 있어도 맞게 레이아웃 px → 보이는 px 비로 옮긴다.
 */
export function imageViewerLevels(
  view: ImageViewerView,
  file: { readonly projectId: string; readonly path: string; readonly name: string },
  at: InspectorPickPoint,
): InspectorPickLevels {
  if (view.stageWidth <= 0 || view.stageHeight <= 0 || view.naturalWidth <= 0 || view.naturalHeight <= 0 || view.scale <= 0) return [];
  const kx = at.width / view.stageWidth;
  const ky = at.height / view.stageHeight;
  const width = view.naturalWidth * view.scale;
  const height = view.naturalHeight * view.scale;
  const left = view.stageWidth / 2 + view.offsetX - width / 2;
  const top = view.stageHeight / 2 + view.offsetY - height / 2;
  const px = (at.x / kx - left) / view.scale;
  const py = (at.y / ky - top) / view.scale;
  if (px < 0 || py < 0 || px >= view.naturalWidth || py >= view.naturalHeight) return [];
  const l = Math.max(0, left * kx); const t = Math.max(0, top * ky);
  const r = Math.min(at.width, (left + width) * kx); const b = Math.min(at.height, (top + height) * ky);
  const pixel = `(${Math.floor(px)}, ${Math.floor(py)})`;
  return [{
    rect: { x: l, y: t, width: Math.max(1, r - l), height: Math.max(1, b - t) },
    label: file.name || file.path,
    text: `${pixel} · ${view.naturalWidth}×${view.naturalHeight}`,
    clipboard: [
      `[Image] picture file ${quote(file.path)} in project ${quote(file.projectId)} (${view.naturalWidth}x${view.naturalHeight} px)`,
      `[Pointed] pixel ${pixel} of the picture (origin top-left)`,
      `[Hint] This is a picture file in the project, not app code. Edit the file itself, or make an editable Vibimage source through the creation API (${CREATION_GUIDE}).`,
    ].join('\n'),
  }];
}

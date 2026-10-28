import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, FileFaceKind } from '@vibisual/shared';
import { BUBBLE_STYLES, BUNDLE_BUBBLE, FILE_FACE, FILE_FACE_STYLES } from '@vibisual/shared';

import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { bundleInfoOf, type ConstellationTag } from '../../utils/constellationView.js';
import { BUNDLE_GLYPH_PATH } from './bundleGlyph.js';
import { FileKindGlyph } from './fileFaceGlyphs.js';

/**
 * §2.2 · §5.1 #2-1 (B) — 묶음 버블. 같은 종류 파일들(같은 폴더의 같은 미디어 · 연속 번호)의 자리를 따로 세운다 — 중심 파일이 거느리면 폴더처럼 읽힌다.
 * 파일로 읽히지 않게: 미리보기 ❌ — 겹친 원 글리프 + 구성 수, 점선 테, 종류 배지, 원 아래 `영상 묶음 · 3`(모든 묶음이 같다).
 * 둘레엔 폴더처럼 최근 구성이 위성으로 선다(`bundleMoonsOf`) — 점선 궤도 ❌. 앱 작업 연속 번호는 앱 색 테(§5.1 #2-1 (F) ⑥).
 * 노드 타입은 `bubble`(물리·선·배치 한 벌), 더블클릭은 캔버스가 받아 안으로 들어간다.
 * 지우기·잠그기·고정·메뉴 ❌ — 지울 데이터가 없다(우클릭은 캔버스 메뉴로 새지 않게 여기서 멈춘다).
 */

const HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

/** 테 위 종류 배지의 지름(px) — 파일 얼굴 배지(`FileFaceRim`)와 같은 자리 규칙(45° 림)이다. */
const KIND_BADGE = 18;

export const BundleNode = memo(function BundleNode({ data }: NodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const bubble = data as unknown as BubbleData & Record<string, unknown>;
  const info = bundleInfoOf(bubble);
  const size = BUNDLE_BUBBLE.size;
  const style = BUBBLE_STYLES.bundle;
  const work = (bubble['_constellation'] as ConstellationTag | undefined)?.work;
  // 앱 작업의 연속 번호는 그 앱 색 테(작업 위성과 같은 말) — 나머지는 묶음 버블의 색.
  const ring = work?.ring ?? style.glow;
  const kind: FileFaceKind = info?.kind ?? 'other';
  const kindStyle = FILE_FACE_STYLES[kind];
  const count = info?.count ?? 0;
  const isSequence = info?.source === 'sequence';
  const active = bubble.status === 'active';
  const despawning = bubble['_despawning'] === true;
  // 아래 설명은 모든 묶음이 같다 — `종류 묶음 · 수`(연속 번호도 종류로 말하고, `연속 번호` 는 툴팁 한 줄이다).
  const kindLabel = t(`canvas.bundle.kind.${kind}`);
  const line = t('canvas.bundle.line', { kind: kindLabel, count });
  const folder = info?.folder;

  /** 툴팁 — 무엇의 묶음인지 · 연속 번호 · 그 폴더 · (앱 작업이면 그 작업) · 구성과 각자 묶인 이유 · 넘친 수 · 더블클릭 안내. */
  const title = useMemo(() => {
    const lines = [t('canvas.bundle.title', { name: bubble.label, kind: kindLabel, count })];
    if (isSequence) lines.push(t('canvas.bundle.sequence'));
    if (folder) lines.push(folder);
    if (work) lines.push(t('canvas.appWork.moon', { app: work.appName, role: t(`canvas.appWork.role.${work.role}`) }));
    const members = info?.members ?? [];
    for (const m of members) {
      lines.push(m.reason ? `  ${m.label} — ${t(`canvas.constellation.reason.${m.reason}`)}` : `  ${m.label}`);
    }
    const more = count - members.length;
    if (more > 0) lines.push(t('canvas.appWork.more', { count: more }));
    lines.push(t('canvas.bundle.enterHint'));
    return lines.join('\n');
  }, [t, bubble.label, kindLabel, count, info, work, isSequence, folder]);

  // 우클릭은 메뉴가 없는 자리다 — 캔버스(빈 곳) 메뉴로 새지 않게 여기서 멈춘다.
  const stopContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const glyphPx = Math.round(size * 0.42);
  // 원의 45° 림 위 — 감싸는 사각형의 모서리에 두면 배지가 림에서 떨어져 허공에 뜬다(파일 얼굴 배지와 같은 규칙).
  const inset = Math.max(0, Math.round((size / 2) * (1 - Math.SQRT1_2) - KIND_BADGE / 2));

  return (
    <div className={`group relative ${despawning ? 'bubble-despawn' : 'bubble-spawn'}`} style={{ width: size, height: size }}>
      <Handle type="source" id="src" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="target" id="tgt" position={Position.Top} style={HANDLE_STYLE} />

      {/* 둘레 점선 궤도는 그리지 않는다 — 묶음의 위성은 폴더 위성처럼 위성선이 말한다. */}

      <div
        className="bubble-body bubble-press absolute inset-0 flex flex-col items-center justify-center rounded-full"
        {...DARK_THEME_LOCK}
        data-bundle-source={info?.source ?? 'folder'}
        onContextMenu={stopContextMenu}
        title={title}
        aria-label={`${bubble.label} · ${line}`}
        style={{
          background: `radial-gradient(circle at 50% 38%, ${style.glow}30, ${style.color}E6 62%, ${style.color})`,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: ring,
          boxShadow: active ? `0 0 14px ${ring}99` : `0 0 6px ${style.color}80`,
        }}
      >
        <svg
          width={glyphPx}
          height={glyphPx}
          viewBox="0 0 24 24"
          fill="none"
          stroke={style.glow}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d={BUNDLE_GLYPH_PATH} />
        </svg>
        <span className="mt-0.5 text-[12px] font-semibold leading-none tabular-nums text-white/85">{count}</span>
      </div>

      {/* 테의 종류 배지 — 무엇의 묶음인지(중심 종류 · 연속 파일 종류). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full border"
        style={{ right: inset, bottom: inset, width: KIND_BADGE, height: KIND_BADGE, background: kindStyle.color, borderColor: kindStyle.glow }}
      >
        <FileKindGlyph kind={kind} px={11} color={kindStyle.glow} strokeWidth={2.2} />
      </span>

      {/* 원 아래 — 이름과 작은 줄(`영상 묶음 · 3`). 손짓은 본체가 받는다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center whitespace-nowrap text-center leading-[14px]"
        style={{ top: size + FILE_FACE.captionGap, maxWidth: Math.max(size * 2, 120) }}
      >
        <span className="max-w-full truncate text-[12px] font-medium text-gray-200">{bubble.label}</span>
        <span className="max-w-full truncate text-[12px] text-gray-400">{line}</span>
      </div>
    </div>
  );
});

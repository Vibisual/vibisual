import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from '@xyflow/react';

import type { AppBubbleShape } from '../../apps/registry.js';
import { getInternalApp } from '../../apps/registry.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §5.13 v4.45 — 내부 앱 버블 노드.
 *
 * CommentBox·캡처 버블과 같은 "사용자가 만든 독립 캔버스 요소"이고, 커스텀 에이전트
 * 버블과 같은 조작 감각을 준다 — **더블클릭하면 그 앱의 창이 열리고, 우클릭하면 메뉴가
 * 뜬다.**
 *
 * 특정 앱을 알지 않는다. `appId` 로 레지스트리를 찾아 색·아이콘·이름·여는 방법을 전부
 * 거기서 가져오므로, 앱이 늘어도 이 파일은 그대로다.
 */

export interface AppBubbleNodeData extends Record<string, unknown> {
  appBubbleId: string;
  appId: string;
  title?: string | undefined;
  refKey?: string | undefined;
  projectName: string;
  width: number;
  height: number;
  preservePinned?: boolean | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

/**
 * 필름 퍼포레이션 띠 — 프레임 위·아래에 붙는 구멍 줄.
 *
 * 이 한 줄이 "원이 아닌 무언가"를 넘어 **영상**이라고 말한다. 구멍의 수·크기는 부르는 쪽이
 * 프레임 치수에서 비례로 뽑아 넘긴다 — 고정 크기로 두면 작게 줄인 버블에서 띠가 화면을
 * 통째로 잡아먹는다(v4.66 에서 실제로 그랬다).
 */
function FilmPerforation({
  count,
  height,
  holeWidth,
  holeHeight,
}: {
  count: number;
  height: number;
  holeWidth: number;
  holeHeight: number;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-around bg-black/50 px-1" style={{ height }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="shrink-0 rounded-[1px] bg-white/65"
          style={{ width: holeWidth, height: holeHeight }}
        />
      ))}
    </div>
  );
}

export const AppBubbleNode = memo(function AppBubbleNode({
  data,
  selected,
}: NodeProps & { data: AppBubbleNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(data.appId);
  const projects = useGraphStore((s) => s.projects);
  const selectAppBubble = useGraphStore((s) => s.selectAppBubble);
  const deleteAppBubble = useGraphStore((s) => s.deleteAppBubble);
  const renameAppBubble = useGraphStore((s) => s.renameAppBubble);
  const setAppBubblePin = useGraphStore((s) => s.setAppBubblePin);
  /**
   * 선택 여부는 **store 를 직접 본다** — React Flow 가 내려 주는 `selected` 만 믿지 않는다.
   *
   * 앱 버블은 `selectable:false` 라(선택은 store 한 채널) 노드 prop 은 우리가 넣어 준 값이
   * 한 바퀴 돌아온 것이다. 그 왕복 어딘가가 끊기면 "눌러도 선택 표시가 안 뜨는" 버블이 된다 —
   * 캡처·플레이 버블이 같은 이유로 둘을 함께 본다(v4.68).
   */
  const selectedAppBubbleId = useGraphStore((s) => s.selectedAppBubbleId);
  const isSelected = selected === true || selectedAppBubbleId === data.appBubbleId;

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 바깥 press 로 닫기(공통 규약 — 메뉴 안에서 시작한 press·드래그로는 안 닫힌다).
  // capture 단계 — React Flow 가 이벤트를 선점하기 전에 닫는다.
  useOutsidePressDismiss({
    enabled: menu !== null,
    onDismiss: () => setMenu(null),
    refs: [menuRef],
  });

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  const open = useCallback((): void => {
    if (!app) return;
    const info = Object.values(projects).find((p) => p.name === data.projectName);
    const projectId = info?.path ?? data.projectName;
    void app.open({ projectId, ref: data.refKey });
  }, [app, projects, data.projectName, data.refKey]);

  /**
   * 더블클릭 — 그 앱의 창을 연다.
   *
   * §5.13 (H) 개정 전에는 "안 깔렸으면 설치" 라는 두 번째 뜻이 있었다. 설치라는 단계가
   * 사라졌으므로 더블클릭의 뜻은 이제 하나다.
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      open();
    },
    [open],
  );

  /**
   * 선택 — 누르는 순간 선택된다. **반드시 캡처 단계(`onPointerDownCapture`)로 받는다.**
   *
   * 누르는 순간인 이유: 기존 버블은 React Flow 가 누를 때 선택하고 그대로 드래그가 이어진다.
   * 앱 버블만 손을 뗀 뒤에 선택되면 "끌고 갔는데 선택은 안 된" 상태가 되어 감각이 어긋난다.
   *
   * ⚠ 캡처 단계인 이유(v4.69 — v4.61·v4.68 두 번의 수정이 화면에서 안 먹던 진짜 원인):
   * 드래그 가능한 노드에는 React Flow 가 `d3-drag` 를 **노드 래퍼**에 걸어 두는데, d3-drag 는
   * mousedown 을 받자마자 `stopImmediatePropagation()` 을 호출한다. React 18 은 핸들러를
   * 루트 컨테이너에 위임(delegate)하므로, 버블 단계의 `onMouseDown` 은 루트까지 올라가지
   * 못하고 **통째로 삼켜진다** — 스토어 배선과 패널 조건이 다 맞아도 "눌러도 선택이 안 되는"
   * 버블이 되는 지점이 여기였다(우클릭·더블클릭만 살아 있던 이유도 같다: 그 둘은 d3-drag 가
   * 막지 않는 이벤트다). 캡처 단계 리스너는 이벤트가 래퍼에 닿기 **전에** 루트에서 먼저
   * 발화하므로 이 차단을 타지 않는다. pointerdown 으로 받아 마우스·터치를 함께 커버한다.
   * 이벤트는 막지 않는다 — 드래그가 그대로 이어져야 한다.
   */
  const handleSelect = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    selectAppBubble(data.appBubbleId);
  }, [selectAppBubble, data.appBubbleId]);

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    // 우클릭도 선택으로 친다 — 메뉴가 뜬 대상이 무엇인지 화면에 보여야 한다.
    selectAppBubble(data.appBubbleId);
    setMenu({ x: e.clientX, y: e.clientY });
  }, [selectAppBubble, data.appBubbleId]);

  // 이름·핀·삭제는 전부 store 한 경로로 — 우클릭 메뉴와 우측 옵션 패널이 같은 함수를 쓴다(v4.68).
  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(
      t('panel.apps.renamePrompt', { defaultValue: '버블 이름' }),
      data.title ?? '',
    );
    if (next === null) return;
    renameAppBubble(data.appBubbleId, next);
  }, [t, data.title, data.appBubbleId, renameAppBubble]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    setAppBubblePin(data.appBubbleId, data.preservePinned !== true);
  }, [data.preservePinned, data.appBubbleId, setAppBubblePin]);

  // 삭제는 store 한 곳으로 — Delete 키와 이 메뉴가 같은 경로를 쓴다(핀 거절 처리도 한 벌).
  const remove = useCallback((): void => {
    setMenu(null);
    void deleteAppBubble(data.appBubbleId);
  }, [deleteAppBubble, data.appBubbleId]);

  const isPinned = data.preservePinned === true;

  /**
   * §5.13 (M) v4.66 — 프레임 치수는 전부 버블 크기에서 비례로 뽑는다.
   *
   * 버블을 1/3(80×50)로 줄인 뒤에도 퍼포레이션 띠·아이콘·글자가 서로를 밀어내지 않아야
   * 한다. `dense` 는 "글자 두 줄과 아이콘을 한꺼번에 놓을 자리가 없다"는 뜻이고, 그 아래에서는
   * **덜 중요한 것부터** 뺀다(보조 라벨 → 아이콘). 크기가 커지면 원래 밀도로 돌아온다.
   */
  const dense = data.height < 96 || data.width < 150;
  const stripHeight = Math.max(4, Math.min(12, Math.round(data.height * 0.12)));
  const holeHeight = Math.max(2, stripHeight - 3);
  const holeWidth = Math.max(3, Math.round(holeHeight * 1.4));
  const holeCount = Math.max(4, Math.min(16, Math.round(data.width / 14)));

  const menuItem = (
    onClick: () => void,
    text: string,
    opts: { danger?: boolean; disabled?: boolean; title?: string } = {},
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled === true}
      title={opts.title}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        opts.disabled === true
          ? 'cursor-not-allowed text-gray-500'
          : `hover:bg-gray-800 ${opts.danger === true ? 'text-rose-300' : 'text-gray-200'}`
      }`}
    >
      {text}
    </button>
  );

  /**
   * 우클릭 메뉴 — 등록된 앱이든 아니든 **항상 뜬다**.
   *
   * 미등록 앱 버블에서 메뉴가 안 뜨면 그 버블은 지울 방법이 없다(가장 지우고 싶은 버블인데도).
   * 고정·삭제는 앱을 몰라도 되는 조작이라 두 경우가 공유하고, 열기·설치·이름 바꾸기만 앱이
   * 있을 때 붙는다.
   */
  const menuPortal = menu
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[60] min-w-44 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {app
            ? menuItem(() => {
                setMenu(null);
                open();
              }, t('panel.apps.open', { defaultValue: '열기' }))
            : null}
          {app ? menuItem(rename, t('panel.apps.rename', { defaultValue: '이름 바꾸기' })) : null}
          {menuItem(
            togglePin,
            isPinned
              ? t('panel.apps.unpin', { defaultValue: '고정 해제' })
              : t('panel.apps.pin', { defaultValue: '고정' }),
          )}
          <div className="mx-2 my-1 border-t border-gray-700" />
          {/* 핀이 걸린 버블은 서버가 409 로 거절한다(§2.4) — 눌러도 아무 일 없는 대신 이유를 보여 준다. */}
          {menuItem(remove, t('panel.apps.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('panel.apps.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
      )
    : null;

  // 등록되지 않은 앱 — 조용히 빈 도형을 그리지 않고 무엇이 없는지 보여 준다.
  // (원 ❌ — 앱 버블은 어떤 상태에서도 에이전트 버블과 같은 모양이 되지 않는다.)
  if (!app) {
    return (
      <>
        <div
          onPointerDownCapture={handleSelect}
          onContextMenu={handleContextMenu}
          className={`bubble-press flex cursor-pointer select-none items-center justify-center overflow-hidden border-dashed bg-gray-900/70 text-center leading-tight text-amber-300 ${
            dense ? 'rounded-md border px-1 text-[12px]' : 'rounded-lg border-2 px-2 text-[12px]'
          } ${isSelected ? 'border-white ring-2 ring-amber-300/70' : 'border-amber-400/70'}`}
          style={{ width: data.width, height: data.height }}
        >
          {/* 작게 줄인 프레임에서는 두 줄이 안 들어간다 — 무엇이 없는지(=appId)를 남긴다. */}
          {dense ? (
            <span className="max-w-full truncate">{data.appId}</span>
          ) : (
            <>
              {t('panel.apps.unknown', { defaultValue: '알 수 없는 앱' })}
              <br />
              {data.appId}
            </>
          )}
        </div>
        {menuPortal}
      </>
    );
  }

  const Icon = app.icon;
  // 이름은 번역이 있으면 번역, 없으면 레지스트리가 선언한 **제품 이름**. `id` 로 떨어뜨리면
  // 로케일이 아직 빈 언어에서 버블에 소문자 식별자가 그대로 찍힌다(v4.66 전까지 그랬다).
  const appName = t(app.nameKey, { defaultValue: app.name });
  const customTitle = data.title?.trim();
  const label = customTitle !== undefined && customTitle !== '' ? customTitle : appName;

  /**
   * §5.13 (M) v4.60 — 모양은 앱이 정한다. 코어는 원을 그리지 않는다.
   *
   * 커스텀 에이전트 버블이 원이라, 앱 버블까지 원이면 캔버스에서 둘을 가려낼 방법이 없다.
   * 조작 감각(더블클릭 열기 · 우클릭 메뉴 · 드래그)만 같게 두고 형태는 갈라 놓는다.
   */
  const shape: AppBubbleShape = app.bubbleShape ?? 'plate';
  const isFilm = shape === 'film';

  const borderColor = isSelected ? '#FFFFFF' : `${app.glow}A6`;
  const shellStyle: React.CSSProperties = {
    width: data.width,
    height: data.height,
    border: `${dense ? 1.5 : 2}px solid`,
    borderColor,
    // 구(球)로 보이는 방사형 그라디언트 ❌ — 그게 에이전트 버블의 인상이다. 평면 프레임으로.
    background: `linear-gradient(160deg, ${app.color}F2, ${app.color}CC)`,
    // 색 번짐(bloom) ❌ — 그 인상이 곧 "장난감"이다. 선택 링만 앱 색으로, 평시엔 그림자로 띄운다.
    //   선택 링은 **흰 테 + 바깥 헤일로 두 겹**이다(v4.68). 작게 줄인 버블에서는 테두리 색만
    //   흰색으로 바뀌어서는 "선택됐다"가 눈에 안 들어온다 — 다른 버블처럼 바깥으로 한 겹 더 나간다.
    //   box-shadow 는 자기 박스 밖에 그려지므로 `overflow-hidden` 에 잘리지 않는다.
    boxShadow: isSelected
      ? `0 0 0 ${dense ? 2 : 3}px #FFFFFF, 0 0 0 ${dense ? 5 : 7}px ${app.glow}59, 0 6px 20px rgba(0,0,0,0.55)`
      : '0 4px 14px rgba(0,0,0,0.5)',
  };

  /**
   * 보조 라벨 — **덧붙일 말이 있을 때만** 나온다.
   *
   * 여기는 바로 윗줄의 앱 이름을 **대문자로 한 번 더** 쓰던 자리였다. 같은 말을 두 번 하는 것은
   * 정보가 아니라 장식이고, 1/3 로 줄인 프레임에서는 자리마저 없다. 이제 **이름을 바꾼 버블**만
   * 이 줄을 쓴다(그 버블이 원래 어떤 앱인지).
   */
  const subLabel = label === appName ? null : appName;
  const showSubLabel = subLabel !== null && !dense;
  const showIcon = !dense || !showSubLabel;

  const caption = (
    <>
      <div
        className={`max-w-full truncate text-center font-semibold leading-tight ${
          dense ? 'text-[12px]' : 'text-[12px]'
        } text-white`}
      >
        {label}
      </div>
      {showSubLabel ? (
        <div
          className={`max-w-full truncate text-center leading-tight tracking-wide text-white/55 ${
            dense ? 'text-[12px]' : 'mt-0.5 text-[12px]'
          }`}
        >
          {subLabel}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <div
        onPointerDownCapture={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        title={t('panel.apps.openHint', { defaultValue: '더블클릭하면 열립니다.' })}
        // bubble-press — 기존 버블과 같은 눌림 반응(스프링 복귀). 조작 감각은 이어받는다.
        className={`bubble-press relative flex cursor-pointer select-none flex-col overflow-hidden text-white ${
          isFilm
            ? dense
              ? 'rounded-md'
              : 'rounded-lg'
            : `items-center justify-center ${dense ? 'rounded-lg' : 'rounded-2xl'}`
        }`}
        style={shellStyle}
      >
        {isFilm ? (
          <>
            <FilmPerforation count={holeCount} height={stripHeight} holeWidth={holeWidth} holeHeight={holeHeight} />
            <div
              className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden ${
                dense ? 'px-1' : 'px-2'
              }`}
            >
              {/* 클래퍼 사선 — 왼쪽 위 모서리에 얇게. 필름 프레임에 "촬영"의 인상을 더한다.
                  줄무늬 간격도 프레임과 함께 줄어든다(고정 폭이면 작은 프레임에선 한 줄만 남는다). */}
              <div
                className={`pointer-events-none absolute left-0 top-0 opacity-45 ${dense ? 'h-1 w-7' : 'h-2.5 w-14'}`}
                style={{
                  background: dense
                    ? 'repeating-linear-gradient(115deg, rgba(255,255,255,0.8) 0 2px, transparent 2px 5px)'
                    : 'repeating-linear-gradient(115deg, rgba(255,255,255,0.8) 0 5px, transparent 5px 11px)',
                }}
              />
              {showIcon ? (
                <div
                  className={`opacity-95 ${
                    dense ? 'mb-px [&>svg]:h-3.5 [&>svg]:w-3.5' : 'mb-1 [&>svg]:h-7 [&>svg]:w-7'
                  }`}
                >
                  <Icon />
                </div>
              ) : null}
              {caption}
            </div>
            <FilmPerforation count={holeCount} height={stripHeight} holeWidth={holeWidth} holeHeight={holeHeight} />
          </>
        ) : (
          <div
            className={`flex w-full flex-col items-center justify-center overflow-hidden ${dense ? 'px-1' : 'px-2'}`}
          >
            {showIcon ? (
              <div
                className={`opacity-90 ${
                  dense ? 'mb-px [&>svg]:h-3.5 [&>svg]:w-3.5' : 'mb-1 [&>svg]:h-6 [&>svg]:w-6'
                }`}
              >
                <Icon />
              </div>
            ) : null}
            {caption}
          </div>
        )}
        {/* 고정 표식 — 필름 프레임에서는 위쪽 퍼포레이션 띠를 피해 화면 영역 안쪽에 놓는다. */}
        {data.preservePinned === true ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`pointer-events-none absolute z-10 text-white/80 ${
              dense
                ? `right-0.5 h-2.5 w-2.5 ${isFilm ? 'top-2' : 'top-1'}`
                : `right-2 h-3.5 w-3.5 ${isFilm ? 'top-4' : 'top-2'}`
            }`}
          >
            <path d="M12 17v5" />
            <path d="M9 10.76V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3.76a2 2 0 0 0 .59 1.42L17 13.5V17H7v-3.5l1.41-1.32A2 2 0 0 0 9 10.76z" />
          </svg>
        ) : null}
      </div>

      {menuPortal}
    </>
  );
});

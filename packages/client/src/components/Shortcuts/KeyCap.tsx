import { bindingParts } from './bindingLabel.js';

/**
 * KeyCap.tsx — **단축키 한 조합을 그리는 칩.** 순수 표시(상태·구독 없음).
 *
 * 디자인 규약(다른 앱들이 공통으로 지키는 것):
 *  - **화면에 상시로 박지 않는다.** 이 칩은 호버 툴팁·메뉴 우측·요청 오버레이·설정 표에서만 쓴다.
 *  - **레이아웃을 밀지 않는다.** 오버레이(portal)이거나 이미 비어 있는 우측 여백에만 놓는다.
 *  - **새 색을 만들지 않는다.** 기존 `gray-700` 테두리 / `gray-400` 글자 톤 그대로.
 *  - 글자는 라틴 글리프(`Ctrl` `⌘` `B`)뿐이지만 §9 하한대로 `text-xs`(12px) 아래로 내리지 않는다.
 */

interface KeyCapProps {
  /** 정규 바인딩 문자열(`Ctrl+Shift+Z`). 비어 있으면 아무것도 그리지 않는다. */
  binding: string | null | undefined;
  /** 어두운 배경 위(오버레이)인지 — 대비를 한 단계 올린다. */
  tone?: 'muted' | 'strong';
  /**
   * 칩 크기. `sm` 은 **항목이 한둘뿐인 조밀한 메뉴**용이다(§5.4 #34 삭제 메뉴) — 기본 칩은
   * 줄 높이를 20px 로 밀어, 한 줄짜리 메뉴에서는 칩이 메뉴보다 커 보인다.
   * **글자는 두 크기 모두 12px** 이다 — §9 한글 가독 하한은 라틴 글리프만 있는 칩에도 그대로 둔다
   * (같은 줄의 라벨과 눈높이가 어긋나 보이지 않게).
   */
  size?: 'sm' | 'md';
  className?: string;
}

export function KeyCap({ binding, tone = 'muted', size = 'md', className }: KeyCapProps): React.JSX.Element | null {
  const parts = bindingParts(binding);
  if (parts.length === 0) return null;

  const capTone = tone === 'strong'
    ? 'border-gray-500 bg-gray-800 text-gray-100'
    : 'border-gray-700 bg-gray-800/60 text-gray-400';

  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 ${className ?? ''}`}>
      {parts.map((part, i) => (
        <span
          key={`${part}-${i}`}
          className={`inline-flex items-center justify-center rounded border font-mono text-xs leading-none ${
            size === 'sm' ? 'h-[18px] min-w-[1.125rem] px-0.5' : 'h-5 min-w-[1.25rem] px-1'
          } ${capTone}`}
        >
          {part}
        </span>
      ))}
    </span>
  );
}

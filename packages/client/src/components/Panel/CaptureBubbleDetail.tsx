import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaptureBubble } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useCapturePrefs, type CaptureQualityMode } from '../../stores/captureBubblePrefs.js';
import { useCaptureRuntime } from '../../stores/captureBubbleRuntime.js';
import { CAPTURE_FIT_EVENT, CAPTURE_REPICK_EVENT, CAPTURE_SNAPSHOT_EVENT } from '../BubbleMap/CaptureNode.js';

interface Props {
  bubble: CaptureBubble;
}

/** 원격 조작 주입 API(sendInput)가 있는 환경(데스크톱 렌더러)에서만 조작 UI 를 노출. */
const canControl = typeof window !== 'undefined' && !!window.api?.capture?.sendInput;

/**
 * §5.9 캡처 버블 전용 DetailPanel 섹션 (v3.36 신설 / v3.56 외형 개편).
 *
 * 종전에 캡처 버블 헤더 strip 에 몰려 있던 설정(화질·스냅샷·일시정지·원격조작·불투명도·정지절전·
 * 읽기전용·타임아웃·배지·핀·다시선택·크게보기)을 다른 버블처럼 "선택 → 우측 디테일창"으로 옮긴 것.
 * 취향값(prefs)은 localStorage(useCapturePrefs), 조작 상태(frozen/controlMode/expanded)는
 * 런타임 스토어(useCaptureRuntime)에서 온다. 비디오에 묶인 스냅샷은 window 이벤트로 CaptureNode 에 위임.
 *
 * v3.56 — 같은 크기 버튼이 위계 없이 나열되고 날 것의 체크박스가 섞여 있던 걸 정리했다: 섹션 라벨 +
 * 카드 그룹 + **세그먼트 피커**(화질·조작 모드) + **스위치 토글** + 하단 위험구역(삭제)으로 재구성.
 * 색은 rose 계열을 걷어내고 sky 액센트(정체성)와 emerald(조작 중)만 쓴다.
 */
export function CaptureBubbleDetail({ bubble }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useCapturePrefs(bubble.id);
  const [runtime, setRuntime] = useCaptureRuntime(bubble.id);
  const deleteCaptureBubble = useGraphStore((s) => s.deleteCaptureBubble);

  const requestRepick = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CAPTURE_REPICK_EVENT, { detail: { id: bubble.id } }));
  }, [bubble.id]);

  const requestSnapshot = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CAPTURE_SNAPSHOT_EVENT, { detail: { id: bubble.id } }));
  }, [bubble.id]);

  // 실제 비율 맞추기 — 소스 프레임 비율로 버블 높이를 다시 잡아 레터박스를 없앤다(이어 붙이기 짝).
  const requestFit = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CAPTURE_FIT_EVENT, { detail: { id: bubble.id } }));
  }, [bubble.id]);

  const qualityOptions: readonly { mode: CaptureQualityMode; label: string }[] = [
    { mode: 'full', label: t('bubbleMap.capture.quality_full', { defaultValue: '원본' }) },
    { mode: 'saver', label: t('bubbleMap.capture.quality_saver', { defaultValue: '절약' }) },
    { mode: 'min', label: t('bubbleMap.capture.quality_min', { defaultValue: '최소' }) },
    { mode: 'auto', label: t('bubbleMap.capture.quality_auto', { defaultValue: 'AUTO' }) },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* 소스 — 무엇을 비추고 있는지 + 바꾸기/크게 보기 */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t('bubbleMap.capture.source', { defaultValue: '캡처 소스' })}</SectionLabel>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-400/10 text-sky-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {bubble.sourceKind === 'screen'
                ? <><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>
                : <><rect width="18" height="14" x="3" y="5" rx="2" /><path d="M3 9h18" /></>}
            </svg>
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-gray-200" title={bubble.sourceName}>
            {bubble.sourceName}
          </span>
          <span className="shrink-0 rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
            {bubble.sourceKind === 'screen'
              ? t('bubbleMap.capture.kindScreen', { defaultValue: '화면' })
              : t('bubbleMap.capture.kindWindow', { defaultValue: '창' })}
          </span>
        </div>
        <div className="flex gap-2">
          <GhostButton onClick={requestRepick} label={t('bubbleMap.capture.repick', { defaultValue: '다른 소스 선택' })}>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
          </GhostButton>
          <GhostButton onClick={() => setRuntime({ expanded: true })} label={t('bubbleMap.capture.expand', { defaultValue: '크게 보기' })}>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </GhostButton>
        </div>
      </section>

      {/* 재생 — 일시정지 / 스냅샷 */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t('bubbleMap.capture.playback', { defaultValue: '재생' })}</SectionLabel>
        <div className="flex gap-2">
          <GhostButton
            onClick={() => setRuntime({ frozen: !runtime.frozen })}
            label={runtime.frozen
              ? t('bubbleMap.capture.resume', { defaultValue: '다시 재생' })
              : t('bubbleMap.capture.pause', { defaultValue: '일시정지' })}
            tone={runtime.frozen ? 'accent' : 'default'}
          >
            {runtime.frozen
              ? <path d="M8 5v14l11-7z" />
              : <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>}
          </GhostButton>
          <GhostButton onClick={requestSnapshot} label={t('bubbleMap.capture.snapshotShort', { defaultValue: '스냅샷' })}>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </GhostButton>
        </div>
      </section>

      {/* 화질 / 데이터 */}
      <section className="flex flex-col gap-2">
        <SectionLabel>{t('bubbleMap.capture.quality', { defaultValue: '화질 / 데이터' })}</SectionLabel>
        <div className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
          {qualityOptions.map((opt) => {
            const active = prefs.qualityMode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => setPrefs({ qualityMode: opt.mode })}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  active ? 'bg-sky-400/90 text-slate-900' : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-100'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-snug text-gray-500">
          {t('bubbleMap.capture.qualityHint', { defaultValue: '화질/데이터 — 낮출수록 해상도·FPS↓, AUTO=회선따라 자동' })}
        </p>
      </section>

      {/* 보기 — 불투명도 + 토글 3종 */}
      <section className="flex flex-col gap-2.5">
        <SectionLabel>{t('bubbleMap.capture.view', { defaultValue: '보기' })}</SectionLabel>
        <div className="flex flex-col gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300">{t('bubbleMap.capture.opacity', { defaultValue: '불투명도' })}</span>
              <span className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[11px] text-gray-300">
                {Math.round(prefs.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={Math.round(prefs.opacity * 100)}
              onChange={(e) => setPrefs({ opacity: Number(e.target.value) / 100 })}
              className="w-full accent-sky-400"
            />
          </div>
          <div className="h-px bg-white/[0.06]" />
          <SwitchRow
            label={t('bubbleMap.capture.stillSaver', { defaultValue: '정지화면 절전' })}
            hint={t('bubbleMap.capture.stillSaverHint', { defaultValue: '움직임이 없으면 프레임을 낮춰 CPU·데이터를 아낍니다' })}
            checked={prefs.stillSaver}
            onChange={(v) => setPrefs({ stillSaver: v })}
          />
          <SwitchRow
            label={t('bubbleMap.capture.badge', { defaultValue: 'fps·해상도 배지' })}
            checked={prefs.showBadge}
            onChange={(v) => setPrefs({ showBadge: v })}
          />
          <SwitchRow
            label={t('bubbleMap.capture.pin', { defaultValue: '항상 위(핀 고정)' })}
            checked={prefs.pinned}
            onChange={(v) => setPrefs({ pinned: v })}
          />
        </div>
      </section>

      {/* 이어 붙이기 — 화면 버블 2~3개를 듀얼/트리플 모니터처럼 나란히 붙여 쓸 때 쓰는 것들.
          자석 스냅 자체는 항상 켜져 있고(끌면 붙는다), 여기선 이음새를 없애는 두 가지를 준다. */}
      <section className="flex flex-col gap-2.5">
        <SectionLabel>{t('bubbleMap.capture.join', { defaultValue: '이어 붙이기' })}</SectionLabel>
        <div className="flex flex-col gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
          <p className="text-[10px] leading-snug text-gray-500">
            {t('bubbleMap.capture.snapHint', {
              defaultValue: '다른 캡처 버블 옆으로 끌면 변이 자석처럼 붙습니다. Alt 를 누른 채 끌면 자석이 꺼집니다.',
            })}
          </p>
          <GhostButton
            onClick={requestFit}
            label={t('bubbleMap.capture.fitAspect', { defaultValue: '실제 비율 맞추기' })}
          >
            <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
          </GhostButton>
          <p className="text-[10px] leading-snug text-gray-500">
            {t('bubbleMap.capture.fitAspectHint', {
              defaultValue: '버블 높이를 소스 비율로 다시 잡아 위아래 검은 띠를 없앱니다 — 붙였을 때 화면이 이어져 보입니다.',
            })}
          </p>
          <div className="h-px bg-white/[0.06]" />
          <SwitchRow
            label={t('bubbleMap.capture.seamless', { defaultValue: '이음새 숨기기' })}
            hint={t('bubbleMap.capture.seamlessHint', {
              defaultValue: '테두리·헤더를 감춰 붙인 버블이 한 화면처럼 보입니다(헤더는 올려놓으면 나타납니다)',
            })}
            checked={prefs.seamless}
            onChange={(v) => setPrefs({ seamless: v })}
          />
        </div>
      </section>

      {/* 원격 조작 — sendInput 가능한 데스크톱 렌더러에서만 */}
      {canControl && (
        <section className="flex flex-col gap-2.5">
          <SectionLabel accent="emerald">{t('bubbleMap.capture.remoteControl', { defaultValue: '원격 조작' })}</SectionLabel>
          <div className="flex flex-col gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
            {/* 조작 모드 — 끄기/터치/마우스 (v3.43: 모드 선택이 곧 조작 시작. 재시작 시 항상 off) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1 rounded-lg border border-emerald-400/15 bg-black/20 p-1">
                {(['off', 'touch', 'mouse'] as const).map((mode) => {
                  const active = runtime.controlMode === mode;
                  const disabled = prefs.readOnly && mode !== 'off';
                  const on = active && mode !== 'off';
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      onClick={() => setRuntime({ controlMode: mode })}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        on
                          ? 'bg-emerald-400 text-emerald-950'
                          : active
                            ? 'bg-white/10 text-gray-100'
                            : 'text-emerald-200/70 hover:bg-white/[0.06] hover:text-emerald-100'
                      }`}
                    >
                      {mode === 'off'
                        ? t('bubbleMap.capture.controlModeOff', { defaultValue: '끄기' })
                        : mode === 'touch'
                          ? t('bubbleMap.capture.pointerModeTouch', { defaultValue: '터치' })
                          : t('bubbleMap.capture.pointerModeMouse', { defaultValue: '마우스' })}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] leading-snug text-gray-500">
                {t('bubbleMap.capture.pointerModeSwitch', {
                  defaultValue: '터치: 가리킨 곳을 바로 클릭 · 마우스: 밀어서 커서 이동 후 탭 클릭',
                })}
              </p>
            </div>

            <div className="h-px bg-white/[0.06]" />

            <SwitchRow
              label={t('bubbleMap.capture.backgroundClick', { defaultValue: '커서 안 움직이기 (실험적)' })}
              hint={t('bubbleMap.capture.backgroundClickHint', {
                defaultValue: '대상 창에 클릭을 직접 넣어 내 마우스를 건드리지 않습니다. 게임·보호된 창은 이 방식을 무시해 자동으로 원래 방식으로 돌아갑니다',
              })}
              checked={prefs.backgroundClick}
              onChange={(v) => setPrefs({ backgroundClick: v })}
              tone="emerald"
            />

            <SwitchRow
              label={t('bubbleMap.capture.readOnly', { defaultValue: '읽기 전용(조작 잠금)' })}
              hint={t('bubbleMap.capture.readOnlyHint', { defaultValue: '켜면 조작 모드를 고를 수 없습니다(보기 전용)' })}
              checked={prefs.readOnly}
              onChange={(v) => setPrefs({ readOnly: v })}
              tone="emerald"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-300">{t('bubbleMap.capture.controlTimeout', { defaultValue: '조작 자동해제' })}</span>
              <select
                value={prefs.controlTimeoutSec}
                onChange={(e) => setPrefs({ controlTimeoutSec: Number(e.target.value) })}
                className="rounded-md border border-white/[0.08] bg-gray-900 px-2 py-1 text-[11px] text-gray-200 outline-none transition-colors focus:border-emerald-400/60"
              >
                <option value={0}>{t('bubbleMap.capture.timeoutOff', { defaultValue: '끄기' })}</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {/* 위험 구역 — 삭제 */}
      <div className="mt-1 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => { void deleteCaptureBubble(bubble.id); }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2 text-xs text-rose-300 transition-colors hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-100"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
          {t('bubbleMap.capture.delete', { defaultValue: '캡처 버블 삭제' })}
        </button>
      </div>
    </div>
  );
}

/** 섹션 머리 라벨 — 작은 대문자 톤 + 액센트 점. */
function SectionLabel({ children, accent = 'sky' }: { children: React.ReactNode; accent?: 'sky' | 'emerald' }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-1 w-1 rounded-full ${accent === 'emerald' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</span>
    </div>
  );
}

interface GhostButtonProps {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'accent';
  children: React.ReactNode;
}

/** 아이콘 + 라벨 고스트 버튼(2단 그리드용). */
function GhostButton({ label, onClick, tone = 'default', children }: GhostButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs transition-colors ${
        tone === 'accent'
          ? 'border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20'
          : 'border-white/[0.07] bg-white/[0.03] text-gray-300 hover:border-sky-400/40 hover:bg-white/[0.06] hover:text-sky-200'
      }`}
    >
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone?: 'sky' | 'emerald';
}

/** 라벨 + 설명 + 스위치 한 줄 — 날 것의 체크박스 대신 쓰는 토글. */
function SwitchRow({ label, hint, checked, onChange, tone = 'sky' }: SwitchRowProps): React.JSX.Element {
  const onColor = tone === 'emerald' ? 'bg-emerald-400' : 'bg-sky-400';
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-gray-300">{label}</span>
        {hint && <span className="text-[10px] leading-snug text-gray-500">{hint}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className={`block h-4 w-7 rounded-full transition-colors ${checked ? onColor : 'bg-white/[0.12]'}`} />
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${checked ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
    </label>
  );
}

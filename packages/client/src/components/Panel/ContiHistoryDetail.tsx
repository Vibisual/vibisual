import { useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoryboardPresetId } from '@vibisual/shared';
import {
  CONTI_SCRIPT_FRAME_MAX,
  CONTI_SCRIPT_FRAME_MIN,
  CONTI_SCRIPT_MAX_CHARS,
  DEFAULT_STORYBOARD_PRESET_ID,
  STORYBOARD_PRESET_IDS,
  STORYBOARD_PRESETS,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface Props {
  agentId: string;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** §5.3 #28 (L) v1.58 — 상대 시각 표시 ("3m ago"). 1시간 이내만 분, 이후는 시간/일. */
function relativeFromNow(ts: number, now: number): string {
  const delta = Math.max(0, Math.floor((now - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** §7.12 v1.47 — 콘티 히스토리 (단일 클릭 시 DetailPanel 본문) */
export function ContiHistoryDetail({ agentId }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const contis = useGraphStore((s) => s.contis);
  const activeContiWork = useGraphStore((s) => s.activeContiWork);
  const openContiBoard = useGraphStore((s) => s.openContiBoard);
  const openIDEOverlay = useGraphStore((s) => s.openIDEOverlay);
  const setIDEActiveSession = useGraphStore((s) => s.setIDEActiveSession);

  /** §5.3 #28 (L) v1.58 — 이 에이전트의 인플라이트 콘티 작업 (있으면 "Working…" 인디케이터) */
  const work = activeContiWork[agentId];

  const list = useMemo(
    () =>
      Object.values(contis)
        .filter((c) => c.agentId === agentId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [contis, agentId],
  );

  /**
   * §5.3 #28 (L) v1.58 — "새 콘티 생성" 클릭.
   * 에이전트는 이미 `customMode='conti'` + `CONTI_AGENT_RULES` 가 박혀 있어 어떤 프롬프트든
   * conti JSON 으로만 응답한다. 따라서 chat 입력창 prefill ❌ — 빈 새 세션만 띄우면 된다.
   * IDETabBar 의 '+' 버튼과 동일 경로: `POST /api/subagents/<agentId>` → setIDEActiveSession.
   */
  const handleGenerate = useCallback(() => {
    fetch(`/api/subagents/${agentId}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data: { subAgent?: { id: string } }) => {
        if (data.subAgent) setIDEActiveSession(data.subAgent.id);
      })
      .catch(() => {});
    openIDEOverlay(agentId);
  }, [agentId, openIDEOverlay, setIDEActiveSession]);

  // §5.13 (Q) — 대본에서 콘티. 접혀 있다가 사용자가 열 때만 자리를 차지한다.
  const generateFromScript = useGraphStore((s) => s.generateContiFromScript);
  const scriptBusy = useGraphStore((s) => s.contiScriptGenerating[agentId] === true);
  const openContiBoardFor = openContiBoard;
  const [scriptOpen, setScriptOpen] = useState(false);
  const [script, setScript] = useState('');
  const [presetId, setPresetId] = useState<StoryboardPresetId>(DEFAULT_STORYBOARD_PRESET_ID);
  const [frameCount, setFrameCount] = useState('');
  const [scriptError, setScriptError] = useState<string | null>(null);

  const handleScriptGenerate = useCallback(async () => {
    const text = script.trim();
    if (text === '' || scriptBusy) return;
    setScriptError(null);
    const parsed = Number.parseInt(frameCount, 10);
    const count = Number.isFinite(parsed) ? parsed : undefined;
    const result = await generateFromScript(agentId, text, presetId, count);
    if (result.ok) {
      setScript('');
      setScriptOpen(false);
      openContiBoardFor(agentId, result.contiId);
      return;
    }
    setScriptError(result.error);
  }, [script, scriptBusy, frameCount, generateFromScript, agentId, presetId, openContiBoardFor]);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-3 p-4">
      {work && !work.contiId && (
        <div className="flex items-center gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-2.5 py-1.5 text-[12px] text-amber-200">
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>
            {t('panel.contiHistory.working', {
              defaultValue: 'Working… ({{source}})',
              source: work.source,
            })}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">
          {t('panel.contiHistory.title', { defaultValue: 'Conti History' })}
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          className="flex items-center gap-1.5 rounded border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900/50"
          title={t('panel.contiHistory.generateTitle', { defaultValue: 'IDE 오버레이를 열어 부모 에이전트에 콘티 생성 명령을 작성합니다' })}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{t('panel.contiHistory.generate', { defaultValue: '새 콘티 생성' })}</span>
        </button>
      </div>

      {/* §5.13 (Q) 대본에서 콘티 — 접힘/펼침. 대본이 곧 컨텍스트라 세션이 없어도 된다. */}
      <div className="rounded border border-gray-700/60 bg-gray-800/30">
        <button
          type="button"
          onClick={() => setScriptOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800/60"
        >
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${scriptOpen ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8M8 17h5" />
          </svg>
          <span>{t('panel.contiHistory.scriptTitle', { defaultValue: '대본에서 콘티' })}</span>
        </button>

        {scriptOpen && (
          <div className="flex flex-col gap-2 border-t border-gray-700/60 p-2.5">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value.slice(0, CONTI_SCRIPT_MAX_CHARS))}
              rows={6}
              spellCheck={false}
              placeholder={t('panel.contiHistory.scriptPlaceholder', {
                defaultValue: '대본을 붙여 넣으세요 — 장면 순서대로 컷이 만들어집니다.',
              })}
              className="w-full resize-y rounded border border-gray-700 bg-gray-900/70 p-2 font-mono text-[12px] leading-relaxed text-gray-200 placeholder:text-gray-600 focus:border-emerald-600/60 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-gray-400">
                <span>{t('panel.contiHistory.scriptPreset', { defaultValue: '출력' })}</span>
                <select
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value as StoryboardPresetId)}
                  className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[12px] text-gray-200"
                >
                  {STORYBOARD_PRESET_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(STORYBOARD_PRESETS[id].labelKey, { defaultValue: id })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-gray-400">
                <span>{t('panel.contiHistory.scriptFrames', { defaultValue: '컷 수' })}</span>
                <input
                  type="number"
                  min={CONTI_SCRIPT_FRAME_MIN}
                  max={CONTI_SCRIPT_FRAME_MAX}
                  value={frameCount}
                  onChange={(e) => setFrameCount(e.target.value)}
                  placeholder={t('panel.contiHistory.scriptFramesAuto', { defaultValue: '자동' })}
                  className="w-16 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[12px] text-gray-200 placeholder:text-gray-600"
                />
              </label>
              <span className="ml-auto font-mono text-[12px] text-gray-600">
                {script.length}/{CONTI_SCRIPT_MAX_CHARS}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleScriptGenerate()}
              disabled={scriptBusy || script.trim() === ''}
              className="flex items-center justify-center gap-1.5 rounded border border-sky-700/50 bg-sky-900/30 px-2.5 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scriptBusy ? (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h7l2 3h7v13H4z" />
                  <path d="M9 12h6M9 16h4" />
                </svg>
              )}
              <span>
                {scriptBusy
                  ? t('panel.contiHistory.scriptWorking', { defaultValue: '컷을 끊는 중…' })
                  : t('panel.contiHistory.scriptGenerate', { defaultValue: '대본에서 콘티 만들기' })}
              </span>
            </button>
            {scriptError && (
              <div className="rounded border border-red-800/60 bg-red-950/40 px-2 py-1 text-[12px] text-red-300">{scriptError}</div>
            )}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded border border-dashed border-gray-700 bg-gray-800/30 p-4 text-center text-xs text-gray-500">
          {t('panel.contiHistory.empty', {
            defaultValue: '아직 콘티가 없습니다 — \'새 콘티 생성\' 으로 첫 컷을 찍으세요',
          })}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((c, idx) => {
            const isLatest = idx === 0;
            const seq = String(list.length - idx).padStart(3, '0');
            const subtitle = c.title ?? c.frames[0]?.action ?? '';
            // §5.3 #28 (L) v1.58 — updatedAt > createdAt 인 콘티는 수정 이력 마커
            const wasEdited = c.updatedAt > c.createdAt + 1000; // 1초 노이즈 여유
            // 현재 인플라이트 작업의 대상 콘티인지
            const isWorkTarget = work?.contiId === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openContiBoard(agentId, c.id)}
                  className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors ${
                    isLatest
                      ? 'border border-emerald-700/60 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-900/50'
                      : 'border border-gray-700/60 bg-gray-800/40 text-gray-300 hover:bg-gray-800/70'
                  }`}
                  title={t('panel.contiHistory.openBoard', { defaultValue: '콘티 보드 열기' })}
                >
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[12px] ${
                      isLatest ? 'bg-emerald-700/40 text-emerald-100' : 'bg-gray-700/50 text-gray-400'
                    }`}
                  >
                    #{seq}
                  </span>
                  <span className="font-mono text-[12px] text-gray-500">{formatDateTime(c.createdAt)}</span>
                  {c.source === 'script' && (
                    <span
                      className="rounded bg-sky-900/50 px-1.5 py-0.5 text-[12px] text-sky-200"
                      title={c.scriptExcerpt?.slice(0, 200) ?? ''}
                    >
                      {t('panel.contiHistory.scriptChip', { defaultValue: '대본' })}
                    </span>
                  )}
                  {wasEdited && (
                    <span
                      className="flex items-center gap-1 rounded bg-amber-900/40 px-1.5 py-0.5 text-[12px] text-amber-200"
                      title={t('panel.contiHistory.editedTitle', { defaultValue: '마지막 수정 시각' })}
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                      <span>{t('panel.contiHistory.edited', { defaultValue: 'edited {{when}}', when: relativeFromNow(c.updatedAt, now) })}</span>
                    </span>
                  )}
                  {isWorkTarget && (
                    <span className="rounded bg-amber-700/40 px-1.5 py-0.5 text-[12px] text-amber-100">
                      {t('panel.contiHistory.working', { defaultValue: 'Working…', source: work?.source ?? '' })}
                    </span>
                  )}
                  <span className="ml-auto truncate text-[12px]">{subtitle.slice(0, 60)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

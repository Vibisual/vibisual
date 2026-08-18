import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH } from '@vibisual/shared';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';

import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { VideoTimeline } from './VideoTimeline.js';
import { AppNotInstalled } from '../Apps/AppNotInstalled.js';
import { isAppInstalled } from '../../apps/registry.js';
import { useVideoRenderer } from './useVideoRenderer.js';
import {
  VersionConflictError,
  claimJob,
  createDoc,
  listDocs,
  patchDoc,
  readDoc,
  reportJob,
  startRender,
  type DocSummary,
} from './videoApi.js';

/**
 * §5.13 Vibistudio — 스튜디오 창(여섯 번째 shell).
 *
 * `#video=1&projectId=…` 로 뜬다(DetachedShell / OverlayShell / OverlayMenuShell /
 * CommandCenterShell 에 이어). 데이터는 다른 창과 같은 in-process 서버에 IPC WS 로
 * 붙어 받는다 — 별도 hydrate 를 만들지 않는다.
 *
 * 이 창은 화면이자 **일꾼**이다. 서버는 캔버스가 없어 그릴 수 없으므로, 에이전트가
 * 건 스틸·렌더 일감을 이 창이 가져가 처리하고 결과를 돌려준다. 창이 닫혀 있으면
 * 그 요청은 시간이 지나 실패로 끝난다 — 조용히 매달려 있지 않는다.
 */

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

/** 일감을 얼마나 자주 가져가 볼지(ms). 너무 잦으면 놀고 있는 창이 CPU 를 먹는다. */
const JOB_POLL_MS = 1200;

import type { AppShellProps } from '../../apps/registry.js';

// 창 판별(`parseVideoStudioHash`)은 `videoStudioHash.ts` 에 따로 있다 — 부팅 경로가
// 이 파일을 끌어오면 동적 청크 분리가 무의미해지기 때문이다(§5.13 (H)).

function fmt(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

export function VideoStudioShell({ params }: AppShellProps): React.JSX.Element {
  const projectId = params['projectId'] ?? '';
  useWebSocket(WS_URL);
  const { t } = useTranslation();

  const projects = useGraphStore((s) => s.projects);
  const userDefaults = useGraphStore((s) => s.userDefaults);

  const projectName = useMemo(() => {
    const found = Object.values(projects).find((p) => p.path === projectId || p.name === projectId);
    return found?.name ?? projectId;
  }, [projects, projectId]);

  // 설치 여부 판정은 앱 공통 헬퍼가 한다 — 앱마다 다른 필드를 보면 앱이 늘 때마다 갈라진다.
  const installed = isAppInstalled('vibistudio', userDefaults);

  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [doc, setDoc] = useState<VideoDoc | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [renderPct, setRenderPct] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useVideoRenderer(projectName, doc);

  // ─── 문서 열기 ───

  const refreshDocs = useCallback(async (): Promise<void> => {
    try {
      setDocs(await listDocs(projectName));
    } catch (err) {
      setStatus(String(err));
    }
  }, [projectName]);

  const openDoc = useCallback(
    async (docId: string): Promise<void> => {
      try {
        const env = await readDoc(projectName, docId);
        setDoc(env.doc);
        setPlayhead(0);
        setStatus('');
      } catch (err) {
        setStatus(String(err));
      }
    },
    [projectName],
  );

  useEffect(() => {
    if (installed) void refreshDocs();
  }, [installed, refreshDocs]);

  // ─── 미리보기 ───

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    let canceled = false;
    void renderer.drawPreview(canvas, playhead).catch(() => {
      if (!canceled) setStatus(t('panel.videoStudio.previewFailed', { defaultValue: '미리보기를 그리지 못했습니다.' }));
    });
    return () => {
      canceled = true;
    };
  }, [doc, playhead, renderer, t]);

  // 재생 — 실제 시간에 맞춰 재생 머리를 움직인다. 렌더가 아니라 미리보기라
  // 프레임을 다 그리지 못해도 시간은 어긋나지 않게 벽시계를 기준으로 삼는다.
  useEffect(() => {
    if (!playing || !doc) return;
    const startedAt = performance.now();
    const from = playhead;
    let raf = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const next = from + elapsed;
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // playhead 를 의존성에 넣으면 매 프레임 타이머가 다시 걸린다 — 시작점만 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, doc]);

  // ─── 편집 ───

  const applyOps = useCallback(
    async (ops: Parameters<typeof patchDoc>[3]): Promise<void> => {
      if (!doc) return;
      try {
        const env = await patchDoc(projectName, doc.id, doc.version, ops);
        setDoc(env.doc);
      } catch (err) {
        if (err instanceof VersionConflictError) {
          // 다른 곳(에이전트)이 먼저 고쳤다 — 실패가 아니라 다시 읽으면 되는 상황이다.
          setStatus(t('panel.videoStudio.reloaded', { defaultValue: '다른 곳에서 문서가 바뀌어 다시 읽었습니다.' }));
          await openDoc(doc.id);
          return;
        }
        setStatus(String(err));
      }
    },
    [doc, projectName, openDoc, t],
  );

  const addTitleScene = useCallback((): void => {
    if (!doc) return;
    const id = `item-${Date.now().toString(36)}`;
    void applyOps([
      {
        op: 'addItem',
        trackId: doc.tracks[0]?.id ?? 'visual',
        item: {
          id,
          kind: 'scene',
          sceneId: 'title',
          at: playhead,
          duration: 4,
          label: t('panel.videoStudio.newTitle', { defaultValue: '제목 화면' }),
          props: { title: t('panel.videoStudio.newTitle', { defaultValue: '제목 화면' }), fadeIn: 0.4, fadeOut: 0.4 },
        },
      },
    ]);
  }, [doc, playhead, applyOps, t]);

  const toggleSelected = useCallback((): void => {
    if (!doc || !selectedItemId) return;
    const current = doc.tracks.flatMap((tr) => tr.items).find((i) => i.id === selectedItemId);
    if (!current) return;
    void applyOps([{ op: 'updateItem', itemId: selectedItemId, patch: { enabled: current.enabled === false } }]);
  }, [doc, selectedItemId, applyOps]);

  const removeSelected = useCallback((): void => {
    if (!selectedItemId) return;
    void applyOps([{ op: 'removeItem', itemId: selectedItemId }]);
    setSelectedItemId(null);
  }, [selectedItemId, applyOps]);

  // ─── 컷 하나를 에이전트에게 맡기기 ───
  //
  // 새 위임 레이어를 만들지 않는다. 에이전트는 이미 loopback 으로 `/api/app/vibistudio/*` 에 닿을 수
  // 있으므로, **무엇을 어느 문서의 어느 아이템에 하라는지** 정확히 적은 명령을 기존 명령 큐로
  // 보내는 것으로 끝난다(§ 기존 인프라 재사용).

  const agents = useGraphStore((s) => s.agents);
  const addCommand = useGraphStore((s) => s.addCommand);
  const [delegateTo, setDelegateTo] = useState<string>("");

  const projectAgents = useMemo(
    () => agents.filter((a) => a.customCreated === true),
    [agents],
  );

  const delegateCut = useCallback((): void => {
    if (!doc || !selectedItemId || delegateTo === "") return;
    const item = doc.tracks.flatMap((tr) => tr.items).find((i) => i.id === selectedItemId);
    if (!item) return;

    // 에이전트가 그대로 따라 할 수 있게 문서 id·아이템 id·현재 값·규약을 함께 준다.
    const prompt = [
      `영상 문서 "${doc.id}"(프로젝트 "${projectName}")의 컷 "${item.id}" 하나만 고쳐 주세요.`,
      "",
      "규약:",
      `1) 먼저 GET /api/app/vibistudio/doc/${doc.id}?project=${encodeURIComponent(projectName)} 으로 현재 상태를 읽으세요.`,
      `2) 그 응답의 doc.version 을 baseVersion 으로 삼아 POST /api/app/vibistudio/doc/${doc.id}/patch 로 고치세요.`,
      `   body: { "project": "${projectName}", "baseVersion": <읽은 값>, "ops": [ { "op": "updateItem", "itemId": "${item.id}", "patch": { ... } } ] }`,
      "3) 409 가 오면 다른 곳에서 먼저 고친 것이니 1번부터 다시 하세요.",
      `4) 고친 뒤 GET /api/app/vibistudio/doc/${doc.id}/still?project=${encodeURIComponent(projectName)}&t=<확인할 초> 로 그림을 직접 보고 판단하세요.`,
      "",
      `현재 이 컷: kind=${item.kind}, sceneId=${item.sceneId ?? "(없음)"}, duration=${String(item.duration)}`,
      `props: ${JSON.stringify(item.props ?? {})}`,
      "",
      "다른 컷은 건드리지 마세요.",
    ].join(String.fromCharCode(10));

    addCommand(delegateTo, prompt);
    setStatus(t('panel.videoStudio.delegated', { defaultValue: '이 컷을 에이전트에게 맡겼습니다.' }));
  }, [doc, selectedItemId, delegateTo, projectName, addCommand, t]);

  // ─── 렌더 ───

  const doRender = useCallback(async (): Promise<void> => {
    if (!doc) return;
    setRenderPct(0);
    setStatus('');
    try {
      const job = await startRender(projectName, doc.id);
      setStatus(t('panel.videoStudio.renderQueued', { defaultValue: '렌더를 걸었습니다.', id: job.id }));
    } catch (err) {
      setRenderPct(null);
      setStatus(String(err));
    }
  }, [doc, projectName, t]);

  // ─── 일꾼 루프 — 에이전트가 건 일감을 이 창이 처리한다 ───

  useEffect(() => {
    if (!installed) return;
    let stopped = false;

    const runOne = async (): Promise<void> => {
      const job = await claimJob().catch(() => null);
      if (!job || stopped) return;

      try {
        const target = job.docId === doc?.id ? doc : (await readDoc(projectName, job.docId)).doc;
        if (job.kind === 'still') {
          // 스틸은 그 문서로 그려야 하므로, 열려 있는 문서가 아니면 잠시 그것으로 그린다.
          const canvas = document.createElement('canvas');
          canvas.width = target.size.width;
          canvas.height = target.size.height;
          const tmp = { ...renderer };
          if (target.id === doc?.id) {
            await tmp.drawPreview(canvas, job.t ?? 0);
          } else {
            // 다른 문서면 이 창의 렌더러가 그 문서를 모른다 — 열어서 처리한다.
            setDoc(target);
            await new Promise((r) => setTimeout(r, 50));
            await tmp.drawPreview(canvas, job.t ?? 0);
          }
          await reportJob(job.id, { status: 'done', image: canvas.toDataURL('image/png') });
          return;
        }

        setRenderPct(0);
        const { bytes, selection, hasAudio, warnings } = await renderer.render({
          onProgress: (p) => {
            const pct = p.frame / p.totalFrames;
            setRenderPct(pct);
            void reportJob(job.id, { status: 'running', progress: pct });
          },
        });
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await reportJob(job.id, {
          status: 'done',
          progress: 1,
          bytes: btoa(binary),
          ...(selection?.downgraded === true ? { note: `렌더 방식 강등: ${selection.chosen}` } : {}),
        });
        setRenderPct(null);
        // 소리가 안 실렸으면 그대로 알린다 — 무음 파일을 받고 나서야 아는 일이 없게.
        const notes: string[] = [t('panel.videoStudio.renderDone', { defaultValue: '렌더를 마쳤습니다.' })];
        if (!hasAudio) notes.push(t('panel.videoStudio.noAudio', { defaultValue: '소리 없이 나갔습니다.' }));
        if (selection?.downgraded === true) {
          notes.push(t('panel.videoStudio.downgraded', { defaultValue: '렌더 방식이 내려갔습니다: {{id}}', id: selection.chosen }));
        }
        for (const w of warnings) notes.push(w);
        setStatus(notes.join(' · '));
      } catch (err) {
        setRenderPct(null);
        await reportJob(job.id, { status: 'error', error: String(err) }).catch(() => undefined);
        setStatus(String(err));
      }
    };

    const timer = setInterval(() => void runOne(), JOB_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [installed, doc, projectName, renderer, t]);

  if (!installed) {
    return <AppNotInstalled appId="vibistudio" />;
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      {/* 타이틀바 */}
      <header className="app-drag flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <span className="text-sm font-semibold">
          {t('panel.videoStudio.title', { defaultValue: 'Vibistudio' })}
        </span>
        <span className="truncate text-xs text-white/45">{projectName}</span>
        <div className="app-nodrag ml-auto flex items-center gap-2">
          <select
            className="rounded bg-gray-800 px-2 py-1 text-xs"
            value={doc?.id ?? ''}
            onChange={(e) => void (e.target.value ? openDoc(e.target.value) : setDoc(null))}
          >
            <option value="">{t('panel.videoStudio.pickDoc', { defaultValue: '영상 선택…' })}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700"
            onClick={() => {
              void createDoc(projectName, t('panel.videoStudio.untitled', { defaultValue: '새 영상' })).then(
                async (created) => {
                  await refreshDocs();
                  setDoc(created);
                },
              );
            }}
          >
            {t('panel.videoStudio.newDoc', { defaultValue: '새 영상' })}
          </button>
        </div>
        {/* 프레임 없는 창이라 최소화·최대화·닫기는 우리가 그린다(§5.13 (O)). */}
        <WindowControls />
      </header>

      {doc === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-white/45">
          <p>{t('panel.videoStudio.empty', { defaultValue: '영상을 고르거나 새로 만드세요.' })}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {/* 미리보기 */}
          <div className="flex min-h-0 flex-1 items-center justify-center rounded bg-black">
            <canvas
              ref={canvasRef}
              width={doc.size.width}
              height={doc.size.height}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {/* 조작 */}
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700"
            >
              {playing
                ? t('panel.videoStudio.pause', { defaultValue: '일시정지' })
                : t('panel.videoStudio.play', { defaultValue: '재생' })}
            </button>
            <span className="tabular-nums text-white/60">{fmt(playhead)}</span>

            <button type="button" onClick={addTitleScene} className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700">
              {t('panel.videoStudio.addTitle', { defaultValue: '제목 추가' })}
            </button>
            <button
              type="button"
              onClick={toggleSelected}
              disabled={!selectedItemId}
              className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700 disabled:opacity-40"
            >
              {t('panel.videoStudio.toggleItem', { defaultValue: '켜기/끄기' })}
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedItemId}
              className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700 disabled:opacity-40"
            >
              {t('panel.videoStudio.removeItem', { defaultValue: '삭제' })}
            </button>

            {/* 컷 하나만 에이전트에게 맡기기 — 기존 명령 큐를 그대로 쓴다. */}
            <select
              className="rounded bg-gray-800 px-2 py-1.5 text-xs"
              value={delegateTo}
              onChange={(e) => setDelegateTo(e.target.value)}
            >
              <option value="">{t('panel.videoStudio.pickAgent', { defaultValue: '에이전트 선택…' })}</option>
              {projectAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={delegateCut}
              disabled={!selectedItemId || delegateTo === ""}
              className="rounded bg-gray-800 px-2.5 py-1.5 hover:bg-gray-700 disabled:opacity-40"
            >
              {t('panel.videoStudio.delegate', { defaultValue: '이 컷 맡기기' })}
            </button>

            <div className="ml-auto flex items-center gap-2">
              {renderPct !== null ? (
                <span className="tabular-nums text-white/60">{Math.round(renderPct * 100)}%</span>
              ) : null}
              <button
                type="button"
                onClick={() => void doRender()}
                className="rounded bg-violet-600 px-3 py-1.5 font-medium hover:bg-violet-500"
              >
                {t('panel.videoStudio.render', { defaultValue: '렌더' })}
              </button>
            </div>
          </div>

          {/* 타임라인 */}
          <div className="shrink-0 overflow-x-auto">
            <VideoTimeline
              doc={doc}
              playhead={playhead}
              selectedItemId={selectedItemId}
              onSeek={(next) => {
                setPlaying(false);
                setPlayhead(next);
              }}
              onSelectItem={setSelectedItemId}
            />
          </div>

          {status !== '' ? <p className="shrink-0 text-[11px] text-amber-300">{status}</p> : null}
        </div>
      )}
    </div>
  );
}

/** 빈 문서 하나를 만들어 주는 헬퍼 — 테스트와 초기 화면이 같은 모양을 쓰게. */
export function blankDoc(title: string): VideoDoc {
  return createEmptyDoc(`vid-${Date.now().toString(36)}`, title);
}

/**
 * §5.11 — SSOT 문서를 프로젝트가 지정하는 설정 화면: ① 문서가 있으면 경로를 적어 저장(`.vibisual/ssot.json`) ② 없으면 뼈대를 만들고 곧바로 지정.
 * 저장·생성은 호스트 창구(`ctx.call`)로만 — 플러그인은 서버 주소도 현재 프로젝트도 모르고 파일을 직접 만지지 않는다(§5.11 "슬롯 경유만").
 */
import { useCallback, useEffect, useState } from 'react';
import type { PluginSettingsContext } from '../sdk/index.js';

interface ConfigReply {
  ok?: boolean;
  config?: { doc?: string | null };
  facts?: { doc?: unknown } | null;
}

const K = 'panel.plugins.ssotDrift.settings';

/** 지금 잡힌 문서 경로를 응답에서 꺼낸다 — 지정값이 없으면 집행이 실제로 잡은 것을 보여 준다. */
function pickCurrent(reply: ConfigReply | null): string {
  const configured = typeof reply?.config?.doc === 'string' ? reply.config.doc : '';
  if (configured !== '') return configured;
  const found = reply?.facts && typeof reply.facts.doc === 'string' ? reply.facts.doc : '';
  return found;
}

export function SsotDriftSettings(ctx: PluginSettingsContext): React.JSX.Element {
  const { t, call } = ctx;
  const projectPath = ctx.projectPath ?? null;
  const editable = Boolean(call) && Boolean(projectPath);

  const [doc, setDoc] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');

  // 창을 열면 지금 상태부터 읽어 온다. 정적 렌더(테스트)에서는 이 훅이 돌지 않으므로 화면은 빈 값으로 뜬다.
  useEffect(() => {
    if (!call || !projectPath) return;
    let alive = true;
    void call('config')
      .then((r) => {
        if (!alive) return;
        const reply = r as ConfigReply;
        setCurrent(pickCurrent(reply));
        setDoc(typeof reply?.config?.doc === 'string' ? reply.config.doc : '');
      })
      .catch(() => { /* 못 읽어도 화면은 뜬다 — 값이 비어 보일 뿐이다. */ });
    return () => { alive = false; };
  }, [call, projectPath]);

  const run = useCallback(
    async (path: string, body: Record<string, unknown>, method: string) => {
      if (!call) return;
      setBusy(true);
      setStatus('idle');
      try {
        const reply = (await call(path, { method, body })) as ConfigReply;
        if (reply?.ok === false) throw new Error('rejected');
        setCurrent(pickCurrent(reply));
        setDoc(typeof reply?.config?.doc === 'string' ? reply.config.doc : '');
        setStatus('saved');
      } catch {
        // 실패를 삼키면 "저장했는데 왜 안 바뀌지"가 된다 — 화면이 실패했다고 말해야 한다.
        setStatus('failed');
      } finally {
        setBusy(false);
      }
    },
    [call],
  );

  return (
    <div className="rounded-md border border-gray-700/60 bg-white/[0.02] p-3">
      <h5 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-400">{t(`${K}.title`)}</h5>
      <p className="mb-2 text-[12px] leading-relaxed text-gray-500">{t(`${K}.desc`)}</p>

      <label className="mb-1 block text-[12px] text-gray-400" htmlFor="ssot-drift-doc">{t(`${K}.docLabel`)}</label>
      <div className="flex gap-1.5">
        <input
          id="ssot-drift-doc"
          type="text"
          value={doc}
          disabled={!editable || busy}
          placeholder={t(`${K}.placeholder`)}
          onChange={(e) => setDoc(e.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 disabled:opacity-50 pointer-coarse:py-2"
        />
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('config', { doc }, 'PUT')}
          className="shrink-0 whitespace-nowrap rounded bg-white/[0.08] px-2 py-1 text-[12px] text-gray-200 hover:bg-white/[0.14] disabled:opacity-40 pointer-coarse:py-2"
        >
          {t(`${K}.save`)}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('create-doc', { path: doc.trim() === '' ? 'docs/SSOT.md' : doc.trim() }, 'POST')}
          className="rounded bg-white/[0.08] px-2 py-1 text-[12px] text-gray-200 hover:bg-white/[0.14] disabled:opacity-40 pointer-coarse:py-2"
        >
          {t(`${K}.create`)}
        </button>
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('config', { doc: '' }, 'PUT')}
          className="rounded bg-white/[0.05] px-2 py-1 text-[12px] text-gray-400 hover:bg-white/[0.1] disabled:opacity-40 pointer-coarse:py-2"
        >
          {t(`${K}.clear`)}
        </button>
      </div>

      {/* 지금 무엇이 잡혀 있는지 — 지정을 안 했어도 집행이 실제로 잡은 문서를 그대로 보여 준다. */}
      <p className="mt-2 text-[12px] text-gray-500">
        {t(`${K}.current`, { doc: current === '' ? '—' : current })}
      </p>

      {!editable && <p className="mt-1 text-[12px] text-amber-300/80">{t(`${K}.noProject`)}</p>}
      {status === 'saved' && <p className="mt-1 text-[12px] text-emerald-300/80">{t(`${K}.saved`)}</p>}
      {status === 'failed' && <p className="mt-1 text-[12px] text-rose-300/80">{t(`${K}.failed`)}</p>}
    </div>
  );
}

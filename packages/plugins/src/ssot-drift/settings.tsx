/**
 * §5.11 v4.67 — SSOT 문서를 **프로젝트가 지정하는** 설정 화면.
 *
 * 사용자 지시 원문 — "활성화 시 내 프로젝트에 자동 생성해서 문서를 지정해 주든가, 기존에 있다면 사용자가
 * 별도로 폴더 지정을 할 수 있어야 할 듯."
 *
 * 그래서 이 자리에서 두 길이 다 열린다.
 *  ① **이미 문서가 있다** → 경로를 적고 저장한다(`.vibisual/ssot.json` 에 남는다).
 *  ② **아직 없다** → 뼈대를 만들어 주고 그 경로를 곧바로 지정한다(빈 파일을 만들지 않는다 — 빈 문서는
 *     이 플러그인이 v4.67 에서 막기로 한 바로 그 상태다).
 *
 * 저장·생성은 **호스트가 연 창구**(`ctx.call`)로만 한다. 플러그인은 서버 주소도, 지금 어느 프로젝트인지도
 * 모르고, 파일을 직접 만지지도 않는다(§5.11 "슬롯 경유만").
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
      <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t(`${K}.title`)}</h5>
      <p className="mb-2 text-[11px] leading-relaxed text-gray-500">{t(`${K}.desc`)}</p>

      <label className="mb-1 block text-[11px] text-gray-400" htmlFor="ssot-drift-doc">{t(`${K}.docLabel`)}</label>
      <div className="flex gap-1.5">
        <input
          id="ssot-drift-doc"
          type="text"
          value={doc}
          disabled={!editable || busy}
          placeholder={t(`${K}.placeholder`)}
          onChange={(e) => setDoc(e.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('config', { doc }, 'PUT')}
          className="shrink-0 rounded bg-white/[0.08] px-2 py-1 text-[11px] text-gray-200 hover:bg-white/[0.14] disabled:opacity-40"
        >
          {t(`${K}.save`)}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('create-doc', { path: doc.trim() === '' ? 'docs/SSOT.md' : doc.trim() }, 'POST')}
          className="rounded bg-white/[0.08] px-2 py-1 text-[11px] text-gray-200 hover:bg-white/[0.14] disabled:opacity-40"
        >
          {t(`${K}.create`)}
        </button>
        <button
          type="button"
          disabled={!editable || busy}
          onClick={() => void run('config', { doc: '' }, 'PUT')}
          className="rounded bg-white/[0.05] px-2 py-1 text-[11px] text-gray-400 hover:bg-white/[0.1] disabled:opacity-40"
        >
          {t(`${K}.clear`)}
        </button>
      </div>

      {/* 지금 무엇이 잡혀 있는지 — 지정을 안 했어도 집행이 실제로 잡은 문서를 그대로 보여 준다. */}
      <p className="mt-2 text-[11px] text-gray-500">
        {t(`${K}.current`, { doc: current === '' ? '—' : current })}
      </p>

      {!editable && <p className="mt-1 text-[11px] text-amber-300/80">{t(`${K}.noProject`)}</p>}
      {status === 'saved' && <p className="mt-1 text-[11px] text-emerald-300/80">{t(`${K}.saved`)}</p>}
      {status === 'failed' && <p className="mt-1 text-[11px] text-rose-300/80">{t(`${K}.failed`)}</p>}
    </div>
  );
}

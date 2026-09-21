import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VerificationTarget, VerificationTargetAvailability } from '@vibisual/shared';
import { useVerifyDemoStore } from '../../stores/verifyDemo.js';
import { probeVerificationTarget, validVerificationTarget, verificationOperationKey } from './verificationConnection.js';

interface Props {
  agentId: string;
  subAgentId: string;
  target: VerificationTarget | undefined;
  disabled: boolean;
  onAvailability: (available: boolean) => void;
}

export function VerifyTargetConnection({ agentId, subAgentId, target, disabled, onAvailability }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const setTarget = useVerifyDemoStore((s) => s.setTarget);
  const openPicker = useVerifyDemoStore((s) => s.openPicker);
  const [kind, setKind] = useState<'browser' | 'desktop'>(target?.kind ?? 'browser');
  const [availability, setAvailability] = useState<VerificationTargetAvailability | null>(null);
  const [probing, setProbing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [probeError, setProbeError] = useState('');
  const targetKey = JSON.stringify(target);
  useEffect(() => { if (target) setKind(target.kind); }, [target]);

  useEffect(() => {
    const controller = new AbortController();
    setAvailability(null);
    setProbeError('');
    setProbing(false);
    onAvailability(false);
    if (!validVerificationTarget(target)) return () => controller.abort();
    setProbing(true);
    const deadline = setTimeout(() => {
      controller.abort(); setProbing(false); setProbeError('timeout');
    }, 15_000);
    const timer = setTimeout(() => {
      void probeVerificationTarget(target, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setAvailability(result);
        onAvailability(result.available);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setProbeError(error instanceof Error ? error.message : 'network');
      }).finally(() => { clearTimeout(deadline); if (!controller.signal.aborted) setProbing(false); });
    }, 350);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [targetKey, revision, onAvailability]); // Serialized value prevents duplicate probes for equivalent snapshots.

  const reason = probeError || availability?.reason;
  return (
    <div className="flex flex-col gap-1.5 rounded border border-gray-700 bg-gray-800/40 p-1.5">
      <label className="flex flex-col gap-1 text-[12px] text-gray-400">
        {t('ide.verify.connection.title')}
        <select aria-label={t('ide.verify.connection.title')} value={kind} disabled={disabled} onChange={(e) => {
          const next = e.target.value as 'browser' | 'desktop';
          setKind(next); setTarget(subAgentId, null); onAvailability(false);
          if (next === 'desktop') openPicker(agentId, subAgentId, 'connect');
        }} className="w-full rounded border border-gray-700 bg-gray-900 px-1 py-1 text-gray-200">
          <option value="browser">{t('ide.verify.connection.browser')}</option>
          <option value="desktop">{t('ide.verify.connection.desktop')}</option>
        </select>
      </label>
      {kind === 'browser' ? (
        <input type="url" aria-label={t('ide.verify.connection.url')} placeholder="http://localhost:3000" value={target?.kind === 'browser' ? target.url : ''} disabled={disabled}
          onChange={(e) => { onAvailability(false); setTarget(subAgentId, { kind: 'browser', url: e.target.value }); }}
          className="min-w-0 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 focus:border-sky-500 focus:outline-none" />
      ) : (
        <button type="button" disabled={disabled} onClick={() => openPicker(agentId, subAgentId, 'connect')}
          className="break-words rounded border border-gray-600 px-2 py-1 text-left text-[12px] text-gray-200 hover:border-sky-400 disabled:opacity-50">
          {target?.kind === 'desktop' ? target.sourceName : t('ide.verify.connection.pickSource')}
        </button>
      )}
      <p className="break-words text-[12px] leading-relaxed text-gray-500">{t(`ide.verify.connection.${kind === 'browser' ? 'browserHint' : 'desktopHint'}`)}</p>
      <div className="flex items-center gap-1 text-[12px]">
        <span role="status" className={`min-w-0 flex-1 ${availability?.available ? 'text-emerald-400' : reason ? 'text-amber-400' : 'text-gray-500'}`}>
          {t(`ide.verify.connection.${probing ? 'probing' : availability?.available ? 'ready' : reason ? 'unavailable' : 'needsTarget'}`)}
        </span>
        <button type="button" onClick={() => setRevision((r) => r + 1)} disabled={probing || !validVerificationTarget(target)} className="text-sky-400 disabled:text-gray-600">{t('ide.verify.connection.probe')}</button>
      </div>
      {reason && <p role="alert" className="break-words text-[12px] text-amber-400">{t(`ide.verify.error.${reason.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`, { defaultValue: reason })}</p>}
      {availability?.available && (
        <p className="break-words text-[12px] leading-relaxed text-gray-400">
          {t('ide.verify.connection.capabilities', { actions: availability.actions.map((action) => t(verificationOperationKey(action), { defaultValue: action })).join(' · '), checks: availability.checks.map((check) => t(verificationOperationKey(check), { defaultValue: check })).join(' · ') })}
        </p>
      )}
    </div>
  );
}

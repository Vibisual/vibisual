import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { AgentCardTaskBook } from '@vibisual/shared';

export function AgentCardTaskControls(props: {
  book?: AgentCardTaskBook; title: string; disabled: boolean; canCopy: boolean;
  mode?: 'new' | 'copy'; error?: string; choosing: boolean;
  begin: (mode: 'new' | 'copy') => void; select: (id: string) => void; cancel: () => void;
  restore: () => void; choose: (destination: 'current' | 'new') => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const pending = props.book?.pending;
  const [, refreshClock] = useState(0);
  const leaseUntil = pending?.status === 'preparing' ? pending.leaseUntil : undefined;
  useEffect(() => {
    if (leaseUntil === undefined || leaseUntil <= Date.now()) return;
    const timer = setTimeout(() => refreshClock((value) => value + 1), Math.min(2_147_483_647, leaseUntil - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [leaseUntil]);
  const canRestore = pending?.status !== 'preparing' || leaseUntil === undefined || leaseUntil <= Date.now();
  const control = 'nodrag nopan min-w-0 rounded border border-white/10 bg-[#11151d] px-1.5 py-1 text-[11px] text-gray-200 outline-none focus-visible:ring-1 focus-visible:ring-sky-400 disabled:opacity-40';
  return <>
    <div className="nodrag nopan flex shrink-0 items-center gap-1 px-3 pt-1.5" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <select aria-label={t('canvas.agentCard.tasks.history')} title={props.title}
        className={`${control} flex-1`} value={props.book?.activeTaskId ?? ''}
        disabled={props.disabled || !!pending || !!props.mode || !props.book?.tasks.length}
        onChange={(e) => props.select(e.target.value)}>
        {!props.book?.activeTaskId && <option value="">{props.title}</option>}
        {props.book?.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select>
      <select aria-label={t('canvas.agentCard.tasks.new')} className={`${control} max-w-[102px]`}
        value="" disabled={props.disabled || !!pending}
        onChange={(e) => { if (e.target.value === 'new' || e.target.value === 'copy') props.begin(e.target.value); }}>
        <option value="">{t('canvas.agentCard.tasks.new')}</option>
        <option value="new">{t('canvas.agentCard.tasks.empty')}</option>
        <option value="copy" disabled={!props.canCopy}>{t('canvas.agentCard.tasks.copy')}</option>
      </select>
    </div>
    {(props.mode || pending || props.error || props.choosing) && <div
      data-card-task-notice="true" aria-live="polite"
      className="nodrag nopan shrink-0 px-3 pt-1.5 text-[11px] leading-[15px] text-gray-400"
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {props.choosing ? <>
        <span>{t('canvas.agentCard.tasks.destination')}</span>
        <div className="mt-1 flex gap-1">
          <button type="button" className={control} onClick={() => props.choose('current')}>{t('canvas.agentCard.tasks.here')}</button>
          <button type="button" className={control} onClick={() => props.choose('new')}>{t('canvas.agentCard.tasks.separate')}</button>
        </div>
      </> : pending ? <>
        <span>{t(`canvas.agentCard.tasks.${pending.status === 'waiting' ? 'queued' : pending.status === 'preparing' ? 'preparing'
          : pending.error === 'task-send-unconfirmed' ? 'unconfirmed' : 'failed'}`)}</span>
        {canRestore && <button type="button" className="ml-1 text-sky-300 underline"
          onClick={props.restore}>{t('canvas.agentCard.tasks.restore')}</button>}
      </> : props.error ? <><span className="text-rose-300">{t('canvas.agentCard.tasks.failed')}</span>
        {props.mode && <button type="button" className="ml-1 text-sky-300 underline" onClick={props.cancel}>{t('canvas.agentCard.tasks.cancel')}</button>}</>
        : <>
          <span>{t(`canvas.agentCard.tasks.${props.mode === 'copy' ? 'copyNotice' : 'newNotice'}`)}</span>
          <button type="button" className="ml-1 text-sky-300 underline" onClick={props.cancel}>{t('canvas.agentCard.tasks.cancel')}</button>
        </>}
    </div>}
  </>;
}

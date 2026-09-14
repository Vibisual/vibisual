import { useTranslation } from 'react-i18next';
import { CODEX_TOOL_GROUPS, hasCodexToolRestrictions, type CodexToolPolicy, type CodexToolDecision } from '@vibisual/shared';

const NAMES = {
  shell: 'exec_command / write_stdin', edit: 'apply_patch', read: 'view_image',
  mcp: 'MCP / Apps', web: 'Web search', image: 'Image generation',
  computer: 'Browser / Computer use', agents: 'spawn_agent',
};

export function CodexToolPermissions({ value, onChange }: {
  value: CodexToolPolicy; onChange: (value: CodexToolPolicy) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const nativeChildrenBlocked = hasCodexToolRestrictions({ ...value, agents: 'allow' });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-relaxed text-gray-400">{t('panel.agentConfig.codex.toolsHint')}</p>
      {CODEX_TOOL_GROUPS.map((group) => {
        const disabled = group.id === 'agents' && nativeChildrenBlocked;
        return (
          <label key={group.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-700/60 px-2 py-1.5">
            <span className="text-xs text-gray-300">{NAMES[group.id]}</span>
            <select aria-label={NAMES[group.id]} value={disabled ? 'deny' : value[group.id] ?? 'allow'} disabled={disabled}
              onChange={(event) => onChange({ ...value, [group.id]: event.target.value as CodexToolDecision })}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-50">
              <option value="allow">{t('panel.permissionPrompt.allow')}</option>
              <option value="deny">{t('panel.permissionPrompt.deny')}</option>
              {group.ask && <option value="ask">{t('panel.agentConfig.codex.toolAsk')}</option>}
            </select>
          </label>
        );
      })}
      <p className="text-[12px] leading-relaxed text-gray-500">{t('panel.agentConfig.codex.toolHosted')}</p>
      {nativeChildrenBlocked && <p className="text-[12px] leading-relaxed text-amber-300">{t('panel.agentConfig.codex.toolChildren')}</p>}
      <button type="button" onClick={() => onChange({})} className="self-start rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800">
        {t('panel.agentConfig.codex.toolReset')}
      </button>
    </div>
  );
}

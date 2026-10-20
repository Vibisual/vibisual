import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readVibi3DAuthoring, type CreationDoc } from '@vibisual/shared';
import { openWorkspaceFile } from '../IDE/useWorkspaceExplorer.js';
import { ScrollFade } from '../ScrollFade.js';
import { productionParameterRequest, type ProductionParameterRequest, type ProductionValues } from './vibi3dProduction.js';

export interface Vibi3DProductionPanelProps {
  doc: CreationDoc;
  projectRoot: string;
  disabled: boolean;
  dirty: boolean;
  onApply: (request: ProductionParameterRequest) => Promise<void>;
}

/** Saved checkpoints are evidence. Parameter drafts use the same selected CLI as the ordinary AI request. */
export function Vibi3DProductionPanel({ doc, projectRoot, disabled, dirty, onApply }: Vibi3DProductionPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const authoring = useMemo(() => readVibi3DAuthoring(doc.payload), [doc.payload]);
  const [values, setValues] = useState<ProductionValues>({});
  useEffect(() => { setValues({}); }, [doc.id, doc.revision]);
  const request = productionParameterRequest(doc, values);
  if (!authoring) return <p className="mb-2 text-xs text-gray-400">{t('panel.vibi3d.production.hint')}</p>;
  const sourceFiles = [authoring.source.script, authoring.source.blend, authoring.source.manifest, authoring.source.baseline,
    ...(authoring.source.glb ? [authoring.source.glb] : [])];
  return <details className="mb-2 rounded border border-white/10 p-2 text-xs text-gray-300">
    <summary className="cursor-pointer pointer-coarse:py-2">
      {t('panel.vibi3d.production.title')} · {t('panel.vibi3d.authoring.stagePreview', { stage: authoring.stage.label })}
    </summary>
    <p className="mt-2 text-gray-400">{t('panel.vibi3d.production.savedStage', {
      revision: doc.revision, time: new Date(authoring.stage.completedAt).toLocaleString(),
    })}</p>
    <p className="mt-1 text-gray-400">{t('panel.vibi3d.production.checks', {
      objects: authoring.checks.objects, triangles: authoring.checks.triangles.toLocaleString(),
      budget: authoring.checks.triangleBudget.toLocaleString(),
    })}</p>
    {authoring.renderPaths.length > 0 && <p className="mt-1 text-gray-400">{t('panel.vibi3d.production.visualPending')}</p>}
    <ScrollFade maxHeight={260}>
      <div className="mt-2 space-y-2">
        {Object.entries(authoring.parameters).map(([key, parameter]) => {
          const value = values[key] ?? parameter.value;
          const update = (next: string | number | boolean): void => setValues((previous) => ({ ...previous, [key]: next }));
          const inputClass = 'min-w-0 rounded border border-white/15 bg-gray-950 px-2 py-1 text-gray-100 disabled:opacity-40';
          return <label key={key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-24 flex-1">{parameter.label}</span>
            {parameter.type === 'boolean' ? <input type="checkbox" checked={value === true} disabled={disabled}
              onChange={(event) => update(event.target.checked)} />
              : parameter.type === 'color' ? <input type="color" value={String(value)} disabled={disabled} className="h-7 w-12 bg-transparent"
                onChange={(event) => update(event.target.value)} />
                : <>
                  {parameter.min !== undefined && parameter.max !== undefined && parameter.max > parameter.min && <input type="range"
                    aria-label={t('panel.vibi3d.production.adjust', { name: parameter.label })} min={parameter.min} max={parameter.max} step={parameter.step ?? 'any'}
                    value={typeof value === 'number' ? value : Number(parameter.value)} disabled={disabled} className="w-24"
                    onChange={(event) => update(Number(event.target.value))} />}
                  <input type="number" value={typeof value === 'boolean' ? '' : value} min={parameter.min} max={parameter.max} step={parameter.step ?? 'any'}
                    disabled={disabled} className={`${inputClass} w-24`} onChange={(event) => update(event.target.value === '' ? '' : Number(event.target.value))} />
                </>}
          </label>;
        })}
      </div>
    </ScrollFade>
    {Object.keys(authoring.parameters).length > 0 && <div className="mt-2 flex items-center gap-2">
      <button type="button" disabled={disabled || !request} onClick={() => { if (request) void onApply(request); }}
        className="rounded bg-violet-500/25 px-3 py-1.5 text-violet-100 disabled:opacity-40 pointer-coarse:py-2">{t('panel.vibi3d.production.apply')}</button>
      <button type="button" disabled={disabled || !Object.keys(values).length} onClick={() => setValues({})}
        className="rounded bg-white/5 px-2 py-1.5 disabled:opacity-40 pointer-coarse:py-2">{t('panel.vibi3d.production.reset')}</button>
    </div>}
    {dirty && <p className="mt-2 text-amber-300">{t('panel.creation.saveFirst')}</p>}
    <details className="mt-2">
      <summary className="cursor-pointer pointer-coarse:py-2">{t('panel.vibi3d.production.artifacts')}</summary>
      <ScrollFade maxHeight={160}>
        <ul className="mt-2 space-y-1">
          {[...new Set([...sourceFiles, ...authoring.renderPaths])].map((path) => <li key={path}>
            <button type="button" disabled={!projectRoot} title={path} onClick={() => openWorkspaceFile(projectRoot, path)}
              className="w-full truncate text-left text-violet-300 hover:text-violet-100 disabled:opacity-40 pointer-coarse:py-2">{path}</button>
          </li>)}
        </ul>
      </ScrollFade>
    </details>
  </details>;
}

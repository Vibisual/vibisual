import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateVibi3DRecipe, type Vibi3DNode, type Vibi3DRecipe } from '@vibisual/shared';
import { NumberField } from '../Creation/NumberField.js';
import type { AuthoringCommand } from './Vibi3DAuthoring.js';
import { GeometryPoints, geometryField, geometryInput } from './GeometryPoints.js';
import { GeometryOpenings } from './GeometryOpenings.js';
import { GeometryHoles } from './GeometryHoles.js';
import { defaultRecipe } from './modelRecipeDefaults.js';
import { vibi3dLabelKey } from './vibi3dLabels.js';

const dimensionKeys = ['width', 'height', 'depth', 'radius', 'radiusTop', 'tube', 'thickness', 'bevelRadius', 'bevelSegments', 'steps'] as const;

/** Editing replaces the recipe on the selected stable scene id, never the object itself. */
export function GeometryEditor({ node, disabled, onCommand }: {
  node: Vibi3DNode; disabled: boolean; onCommand: AuthoringCommand;
}): React.JSX.Element {
  const { t } = useTranslation(); const [invalid, setInvalid] = useState(false);
  if (!node.recipe) return <></>;
  const recipe = node.recipe, displayed = { ...defaultRecipe(recipe.kind), ...recipe }, locked = disabled || !!node.locked;
  const label = (key: string): string => t(`panel.vibi3d.geometry.${key}`);
  const basic = (key: string): string => t(vibi3dLabelKey(key));
  const send = (next: Vibi3DRecipe): void => {
    if (!validateVibi3DRecipe(next)) { setInvalid(true); return; }
    setInvalid(false); onCommand({ type: 'geometry', id: node.id, recipe: next });
  };
  const scalar = (key: string, value: number, min: number, max: number, commit: (value: number) => void, caption = label(key)) =>
    <NumberField key={key} label={caption} caption={caption} value={value} disabled={locked} min={min} max={max}
      className={geometryField} inputClassName={geometryInput} onCommit={commit} />;
  const toggle = (key: string, checked: boolean, commit: (value: boolean) => void) =>
    <label className="flex min-w-0 items-center gap-2 text-xs text-vb-code-fg pointer-coarse:min-h-8"><input type="checkbox" aria-label={label(key)} checked={checked} disabled={locked}
      onChange={event => commit(event.target.checked)} /><span className="truncate">{label(key)}</span></label>;
  return <fieldset className="min-w-0 space-y-2 text-xs"><legend>{basic('dimensions')}</legend>
    <div className="grid min-w-0 grid-cols-2 gap-2 box-narrow:grid-cols-1">{dimensionKeys.filter(key => displayed[key] !== undefined).map(key => {
      const integer = key === 'steps' || key === 'bevelSegments';
      const caption = ['width', 'height', 'depth', 'radius', 'radiusTop', 'tube'].includes(key) ? basic(key) : label(key);
      return scalar(key, displayed[key]!, key === 'radiusTop' || key === 'bevelRadius' ? 0 : integer ? 1 : 0.001,
        key === 'steps' ? 64 : key === 'bevelSegments' ? 16 : 10000, value => send({ ...recipe, [key]: integer ? Math.round(value) : value }), caption);
    })}</div>
    {displayed.points && <GeometryPoints points={displayed.points} name={basic('point')} disabled={locked} label={label}
      minimum={recipe.kind === 'extrude' ? 3 : 2} planar={recipe.kind === 'extrude' || recipe.kind === 'lathe'} radius={recipe.kind === 'lathe'}
      onChange={points => send({ ...recipe, points })} />}
    {recipe.kind === 'extrude' && <>
      <GeometryHoles recipe={displayed} disabled={locked} onChange={send} label={label} />
      {toggle('bevel', recipe.bevel?.enabled ?? !!recipe.bevel, enabled => send({ ...recipe, bevel: { ...recipe.bevel, enabled } }))}
      {(recipe.bevel?.enabled ?? !!recipe.bevel) && <div className="grid min-w-0 grid-cols-2 gap-2 box-narrow:grid-cols-1">
        {scalar('bevelThickness', recipe.bevel?.thickness ?? 0.02, 0, (recipe.depth ?? 1) / 2, thickness => send({ ...recipe, bevel: { ...recipe.bevel, thickness } }))}
        {scalar('bevelSize', recipe.bevel?.size ?? 0.02, 0, 100, size => send({ ...recipe, bevel: { ...recipe.bevel, size } }))}
        {scalar('bevelSegments', recipe.bevel?.segments ?? 3, 1, 16, segments => send({ ...recipe, bevel: { ...recipe.bevel, segments: Math.round(segments) } }))}
      </div>}
    </>}
    {displayed.profile && <GeometryPoints points={displayed.profile} name={label('profile')} minimum={3} planar disabled={locked} label={label}
      onChange={profile => send({ ...recipe, profile })} />}
    {displayed.path && <GeometryPoints points={displayed.path} name={basic('path')} minimum={2} disabled={locked} label={label}
      onChange={path => send({ ...recipe, path })} />}
    {recipe.kind === 'wall' && <GeometryOpenings recipe={displayed} disabled={locked} onChange={send} label={label} />}
    {toggle('smoothNormals', recipe.creaseAngle !== undefined, enabled => {
      const next = { ...recipe }; if (enabled) next.creaseAngle = 60; else delete next.creaseAngle; send(next);
    })}
    {recipe.creaseAngle !== undefined && scalar('creaseAngle', recipe.creaseAngle, 0, 180, creaseAngle => send({ ...recipe, creaseAngle }))}
    {invalid && <p role="alert" className="text-xs text-vb-code-fg">{label('invalidRecipe')}</p>}
  </fieldset>;
}

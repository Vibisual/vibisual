import { validateVibi3DSignCommand, type Vibi3DSignCommand } from './vibi3dSigns.js';
import { validateVibi3DDecalCommand, type Vibi3DDecalCommand } from './vibi3dDecals.js';
import { validateVibi3DMascotCommand, type Vibi3DMascotCommand } from './vibi3dMascots.js';
export type { Vibi3DImageSource, Vibi3DDecorationIdentity } from './vibi3dDecorationValues.js';
export { validateVibi3DImageSource } from './vibi3dDecorationValues.js';
export * from './vibi3dSigns.js';
export * from './vibi3dDecals.js';
export * from './vibi3dMascots.js';
export type Vibi3DDecorationCommand = Vibi3DSignCommand | Vibi3DDecalCommand | Vibi3DMascotCommand;
export function validateVibi3DDecorationCommand(value: unknown): Vibi3DDecorationCommand | null {
  return validateVibi3DSignCommand(value) ?? validateVibi3DDecalCommand(value) ?? validateVibi3DMascotCommand(value);
}

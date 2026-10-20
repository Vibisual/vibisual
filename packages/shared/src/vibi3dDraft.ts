import { isCreationDocId, isWindowsReservedName, type CreationLink, type CreationValue } from './creation.js';

/** Autosaves preserve work independently of accepting a proposal or exporting a model. */
export type Vibi3DDraftActor = 'human' | 'agent';
export const VIBI3D_DRAFT_LIMITS = { history: 30, receipts: 256, keyLength: 2000, fileNameLength: 500 } as const;

export interface Vibi3DDraftSummary {
  key: string;
  actor: Vibi3DDraftActor;
  version: number;
  fileName: string;
  documentId?: string;
  baseRevision?: number;
  createdAt: number;
  updatedAt: number;
}
export interface Vibi3DDraft extends Vibi3DDraftSummary {
  payload: CreationValue;
  links: CreationLink[];
}
export interface Vibi3DDraftReadResult { draft: Vibi3DDraft | null; version: number }
export interface Vibi3DDraftWriteResult extends Vibi3DDraftReadResult {
  /** The version originally persisted by this request, even when replay returns a newer current head. */
  savedVersion: number;
  replayed: boolean;
}
export interface Vibi3DDraftDiscardInput {
  projectId: string;
  key: string;
  actor: Vibi3DDraftActor;
  expectedVersion: number;
  requestId: string;
}
export interface Vibi3DDraftSaveInput extends Vibi3DDraftDiscardInput {
  fileName: string;
  documentId?: string;
  baseRevision?: number;
  payload: CreationValue;
  links?: CreationLink[];
}
export function isVibi3DDraftActor(value: unknown): value is Vibi3DDraftActor {
  return value === 'human' || value === 'agent';
}
/** A key is an identity only, never a disk path. File identities are project relative on every OS. */
export function isVibi3DDraftKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > VIBI3D_DRAFT_LIMITS.keyLength) return false;
  if (value.startsWith('doc:')) return isCreationDocId(value.slice(4));
  if (value.startsWith('local:')) return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.slice(6));
  if (!value.startsWith('file:')) return false;
  const relative = value.slice(5);
  return !!relative && !/[\\\u0000-\u001f<>:"|?*]/.test(relative) && relative.split('/').every(part =>
    !!part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !isWindowsReservedName(part));
}

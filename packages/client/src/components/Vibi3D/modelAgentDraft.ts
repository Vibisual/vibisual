import type { CreationDoc, CreationLink, CreationValue, Vibi3DCommandRequest, Vibi3DSnapshot, Vibi3DStageRecord } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import { externalizeForSave } from '../Creation/creationBlobs.js';
import { ModelEditor } from './modelEditor.js';
import { disposeModel, type LoadedModel } from './modelIO.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { modelTextureReferences } from './modelTextureReferences.js';
import { modelSceneStats } from './modelSceneStats.js';
import { needsPreparedVibi3DCommands, prepareVibi3DCommands } from './prepareVibi3DCommands.js';
import type { Vibi3DExecutionContext, Vibi3DExecutionResult } from './useVibi3DBridge.js';

/** The agent owns a separate model. User edits, undo and closing a view cannot mutate it. */
export class ModelAgentDraft {
  editor: ModelEditor;
  document: CreationDoc | null;
  /** A draft's complete references belong to its branch, even before it has a document. */
  referenceLinks: CreationLink[];
  savedRevision: number;
  private disposed = false;
  private executing = false;
  constructor(readonly projectId: string, loaded: LoadedModel, document: CreationDoc | null, sessionId: string, dirty = false,
    referenceLinks?: CreationLink[]) {
    this.editor = new ModelEditor(loaded.object, loaded.clips, { projectId, fileName: loaded.fileName, sessionId });
    this.document = document ? structuredClone(document) : null; this.savedRevision = dirty ? -1 : 0;
    this.referenceLinks = structuredClone(referenceLinks ?? document?.links ?? []);
  }
  snapshot(ownerId: string): Vibi3DSnapshot {
    return { ...this.editor.snapshot(), ownerId,
      ...(this.document ? { document: { id: this.document.id, revision: this.document.revision,
        dirty: this.editor.revision !== this.savedRevision, humanDirty: false } } : {}) };
  }
  payload(): CreationValue { return serializeModelSource(this.editor.object, this.editor.clips, this.document?.payload) as unknown as CreationValue; }
  links() { return modelTextureReferences(this.editor.object, this.referenceLinks); }
  private active(): void { if (this.disposed) throw new CreationUiError('scene-changed'); }
  private async replace(payload: CreationValue, saved: boolean, assertActive: () => void): Promise<void> {
    const previous = this.editor;
    const loaded = await loadModelSource(payload, previous.fileName, this.projectId);
    try { assertActive(); } catch (error) { disposeModel(loaded.object); throw error; }
    this.editor = new ModelEditor(loaded.object, loaded.clips, { projectId: this.projectId, fileName: loaded.fileName,
      sessionId: previous.sessionId, revision: previous.revision + 1 });
    previous.disposeHistory(); disposeModel(previous.object);
    this.savedRevision = saved ? this.editor.revision : -1;
  }
  async execute(request: Vibi3DCommandRequest, ownerId: string, context?: Vibi3DExecutionContext): Promise<Vibi3DExecutionResult> {
    this.active();
    if (this.executing) throw new CreationUiError('revision-conflict');
    this.executing = true;
    try { return await this.executeRequest(request, ownerId, context); }
    finally { this.executing = false; }
  }
  private async executeRequest(request: Vibi3DCommandRequest, ownerId: string, context?: Vibi3DExecutionContext): Promise<Vibi3DExecutionResult> {
    this.active(); const editor = this.editor;
    if (editor.revision !== request.expectedRevision) throw new CreationUiError('revision-conflict');
    const assertActive = (): void => {
      this.active(); context?.assertActive?.();
      if (this.editor !== editor || editor.revision !== request.expectedRevision) throw new CreationUiError('revision-conflict');
    };
    assertActive();
    const command = request.commands.length === 1 ? request.commands[0] : undefined;
    if (command?.type === 'stats') return { snapshot: this.snapshot(ownerId), result: { stats: modelSceneStats(editor.object, editor.revision) } };
    if (command?.type === 'checkpoint' || command?.type === 'propose' || command?.type === 'resume') {
      const base = this.document;
      if (!context || !base) throw new CreationUiError('save-before-review');
      const current = this.snapshot(ownerId);
      if (command.type === 'resume') {
        const result = await context.post<{ payload: CreationValue; links?: CreationLink[]; stage: Vibi3DStageRecord }>('resume', { commandId: request.commandId, snapshot: current });
        assertActive(); await this.replace(result.payload, false, assertActive);
        if (result.links) this.referenceLinks = structuredClone(result.links);
        return { snapshot: this.snapshot(ownerId), result: { checkpoint: result.stage } };
      }
      const payload = await externalizeForSave(this.projectId, this.payload()); assertActive();
      const result = await context.post<{ doc?: CreationDoc; stage: Vibi3DStageRecord }>(command.type,
        { commandId: request.commandId, snapshot: current, payload, links: this.links() });
      assertActive();
      // A proposal persists the AI branch for review. Its visible model and the human source remain independent.
      if (result.stage.mode !== 'candidate' && result.doc) {
        if (result.doc.id !== base.id || result.doc.appId !== 'vibi3d' || result.doc.revision !== result.stage.revision) {
          throw new CreationUiError('source-changed-elsewhere');
        }
        this.document = structuredClone(result.doc); this.referenceLinks = structuredClone(result.doc.links); this.savedRevision = editor.revision;
      }
      return { snapshot: this.snapshot(ownerId), result: { checkpoint: result.stage } };
    }
    let prepared: Awaited<ReturnType<typeof prepareVibi3DCommands>> | undefined;
    try {
      if (needsPreparedVibi3DCommands(request.commands)) prepared = await prepareVibi3DCommands(this.projectId, this.document,
        request.commands, request.commandId, editor.object, this.links());
      assertActive();
      await editor.applyAsync(prepared?.commands ?? request.commands, request.expectedRevision,
        { ...prepared, assertActive, onProgress: context?.progress });
      return { snapshot: this.snapshot(ownerId) };
    } finally { prepared?.dispose(); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.editor.disposeHistory(); disposeModel(this.editor.object);
  }
}

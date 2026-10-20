import { randomUUID } from 'node:crypto';
import {
  creationStableJson, creationValueAt, isEmptyVibi3DSource, isVibi3DWorkflowId, validateVibi3DStageChecks,
  VIBI3D_WORKFLOW_LIMITS, type CreationDoc, type CreationCandidateSummary, type CreationValue, type CreationLink,
  type Vibi3DRun, type Vibi3DStageRecord, type Vibi3DSnapshot, type Vibi3DWorkflowCommand, type Vibi3DCaptureUpload,
  type Vibi3DCaptureRecord, type PlatformName,
} from '@vibisual/shared';
import { CreationError, type CreationHost, type CreationStore } from './creationStore.js';
import { Vibi3DWorkflowFiles } from './vibi3dWorkflowFiles.js';
import { guardWorkflowLinks } from './vibi3dWorkflowLinks.js';

interface Receipt { commandId: string; digest: string; inputDigest?: string; stage: Vibi3DStageRecord }
interface RunState { run: Vibi3DRun; receipts: Receipt[] }
type SaveResult = { doc?: CreationDoc; candidate?: CreationCandidateSummary; stage: Vibi3DStageRecord };

export class Vibi3DWorkflowStore {
  private readonly files: Vibi3DWorkflowFiles;
  constructor(host: CreationHost, private readonly creation: CreationStore, platform: PlatformName, private readonly now = Date.now) {
    this.files = new Vibi3DWorkflowFiles(host, platform);
  }
  private runFile(projectId: string, docId: string, runId: string): string {
    if (!isVibi3DWorkflowId(runId)) throw new CreationError(400, 'invalid-run-id');
    return this.files.file(projectId, docId, 'runs', this.files.key(runId), 'run.json');
  }
  private state(projectId: string, docId: string, runId: string): RunState {
    const state = this.files.json<RunState>(this.runFile(projectId, docId, runId));
    if (!state) throw new CreationError(404, 'run-not-found');
    if (state.run.docId !== docId || !this.files.same(state.run.projectId, projectId) || state.run.id !== runId) {
      throw new CreationError(409, 'run-source-mismatch');
    }
    return state;
  }
  private write(state: RunState): void {
    const run = state.run;
    this.files.write(this.runFile(run.projectId, run.docId, run.id), state);
    // An aborted preparation with no checkpoint must not hide the previous resumable work.
    if (run.stages.length) this.files.write(this.files.file(run.projectId, run.docId, 'latest.json'), { runId: run.id });
  }
  read(projectId: string, docId: string, runId?: string): Vibi3DRun | null {
    const latest = runId ?? this.files.json<{ runId: string }>(this.files.file(projectId, docId, 'latest.json'))?.runId;
    return latest ? this.state(projectId, docId, latest).run : null;
  }
  start(projectId: string, docId: string, snapshot: Vibi3DSnapshot, runId: string = randomUUID()): Vibi3DRun {
    const doc = this.creation.get(projectId, docId);
    if (doc.appId !== 'vibi3d' || snapshot.document?.id !== docId) throw new CreationError(409, 'session-source-mismatch');
    const existing = this.files.json<RunState>(this.runFile(projectId, docId, runId));
    if (existing) return this.state(projectId, docId, runId).run;
    if (snapshot.document.dirty && snapshot.document.humanDirty !== false) throw new CreationError(409, 'unsaved-user-edits');
    if (snapshot.document.revision !== doc.revision) throw new CreationError(409, 'revision-conflict');
    const run: Vibi3DRun = { id: runId, projectId, docId, baseRevision: doc.revision, currentRevision: doc.revision,
      initialEmpty: !doc.links.length && !doc.lockedPaths.length && !Object.keys(doc.parameters).length && isEmptyVibi3DSource(doc.payload),
      createdAt: this.now(), stages: [] };
    this.write({ run, receipts: [] });
    return run;
  }
  private guardPayload(doc: CreationDoc, payload: CreationValue): void {
    for (const pointer of doc.lockedPaths) if (creationStableJson(creationValueAt(doc.payload, pointer))
      !== creationStableJson(creationValueAt(payload, pointer))) throw new CreationError(409, 'locked-element-changed', undefined, { pointer });
  }
  private source(projectId: string, docId: string, runId: string, stage: Vibi3DStageRecord, fallbackLinks: CreationLink[]): { payload: CreationValue; links: CreationLink[] } {
    const name = stage.sourcePath.split('/').at(-1);
    if (!name || !/^[a-f0-9]{64}\.json$/.test(name)) throw new CreationError(422, 'workflow-unreadable');
    const file = this.files.file(projectId, docId, 'runs', this.files.key(runId), 'stages', name);
    const value = this.files.json<CreationValue>(file);
    if (!value) throw new CreationError(404, 'stage-not-found');
    const saved = typeof value === 'object' && !Array.isArray(value) && value.format === 'vibi3d-workflow-stage' && value.version === 1 ? value : null;
    return { payload: this.creation.validateArtifactPayload(projectId, saved ? saved.payload : value),
      links: this.creation.validateArtifactLinks(projectId, docId, saved ? saved.links : fallbackLinks) };
  }
  async save(projectId: string, docId: string, runId: string, commandId: string, snapshot: Vibi3DSnapshot,
    command: Extract<Vibi3DWorkflowCommand, { type: 'checkpoint' | 'propose' }>, payloadInput: unknown, links?: unknown, replayOnly = false,
    beforeWrite?: () => void): Promise<SaveResult> {
    let state = this.state(projectId, docId, runId);
    let receipt = state.receipts.find(item => item.commandId === commandId);
    const inputDigest = this.files.key(creationStableJson([command, payloadInput, links ?? null]));
    if (replayOnly && !receipt) throw new CreationError(409, 'command-not-pending');
    if (receipt?.inputDigest && receipt.inputDigest !== inputDigest) throw new CreationError(409, 'request-id-reused');
    const payload = this.creation.validateArtifactPayload(projectId, await this.creation.externalize(projectId, payloadInput));
    // A retry may finish while blobs are externalized. Never overwrite its stages or later captures with stale state.
    state = this.state(projectId, docId, runId); receipt = state.receipts.find(item => item.commandId === commandId);
    const run = state.run;
    if (receipt?.inputDigest && receipt.inputDigest !== inputDigest) throw new CreationError(409, 'request-id-reused');
    const digest = this.files.key(creationStableJson([command, payload, links ?? null]));
    if (receipt) {
      if (receipt.digest !== digest) throw new CreationError(409, 'request-id-reused');
      const current = this.creation.get(projectId, docId);
      if (current.revision !== receipt.stage.revision) throw new CreationError(409, 'revision-conflict');
      return { stage: receipt.stage, ...(receipt.stage.mode === 'commit' ? { doc: current } : {}) };
    }
    if (replayOnly) throw new CreationError(409, 'command-not-pending');
    beforeWrite?.();
    const current = this.creation.get(projectId, docId);
    if (snapshot.document?.dirty && snapshot.document.humanDirty !== false) throw new CreationError(409, 'unsaved-user-edits');
    if (snapshot.document?.id !== docId || snapshot.document.revision !== run.currentRevision) throw new CreationError(409, 'revision-conflict');
    this.guardPayload(current, payload);
    if (state.run.stages.length >= VIBI3D_WORKFLOW_LIMITS.stages) throw new CreationError(409, 'stage-limit');
    const stageId = command.type === 'checkpoint' ? command.stage : 'complete';
    if (command.type === 'propose' && run.candidateId) throw new CreationError(409, 'run-already-proposed');
    const checks = command.type === 'checkpoint' ? validateVibi3DStageChecks(command.checks ?? [])! : [];
    for (const check of checks) if (check.status === 'passed' && check.evidencePath
      && !run.stages.some(stage => stage.captures.some(capture => this.files.same(capture.path, check.evidencePath!)))) {
      throw new CreationError(400, 'capture-evidence-not-found');
    }
    const requestId = `native-${this.files.key(`${runId}:${commandId}`)}`;
    const sourceFile = this.files.file(projectId, docId, 'runs', this.files.key(runId), 'stages', `${this.files.key(`${stageId}:${commandId}`)}.json`);
    const stageLinks = this.creation.validateArtifactLinks(projectId, docId, links ?? current.links);
    guardWorkflowLinks(current.links, stageLinks, current.payload, payload);
    const previous = run.stages.at(-1);
    if (previous) {
      const source = this.source(projectId, docId, runId, previous, current.links);
      guardWorkflowLinks(source.links, stageLinks, source.payload, payload);
    }
    // Checkpoints belong to the AI work run, even when the source starts empty. Applying
    // work to the source is the user's explicit action, never an autosave side effect.
    let candidate: CreationCandidateSummary | undefined;
    if (current.revision !== run.currentRevision) throw new CreationError(409, 'revision-conflict');
    if (command.type === 'propose') {
      candidate = this.creation.propose(projectId, docId, { baseRevision: run.currentRevision, requestId, payload, links: stageLinks, label: command.label });
      run.candidateId = candidate.id;
    }
    // After conflict checks, pin before writing: cleanup must never collect an intermediate texture.
    this.creation.retainArtifactBlobs(projectId, docId, requestId, payload, stageLinks);
    this.files.write(sourceFile, { format: 'vibi3d-workflow-stage', version: 1, payload, links: stageLinks });
    const stage: Vibi3DStageRecord = { id: stageId, label: command.label, revision: run.currentRevision,
      sceneRevision: snapshot.revision, sourcePath: this.files.relative(projectId, sourceFile), createdAt: this.now(),
      mode: candidate ? 'candidate' : 'intermediate', ...(candidate ? { candidateId: candidate.id } : {}),
      captures: [], checks };
    run.stages.push(stage); run.activeStageId = stage.id; state.receipts.push({ commandId, digest, inputDigest, stage }); this.write(state);
    return { ...(candidate ? { candidate } : {}), stage };
  }
  resume(projectId: string, docId: string, runId: string, snapshot: Vibi3DSnapshot, stageId?: string): {
    payload: CreationValue; links: CreationLink[]; run: Vibi3DRun; stage: Vibi3DStageRecord;
  } {
    const state = this.state(projectId, docId, runId); const doc = this.creation.get(projectId, docId);
    if (state.run.candidateId) throw new CreationError(409, 'run-already-proposed');
    if (snapshot.document?.dirty && snapshot.document.humanDirty !== false) throw new CreationError(409, 'unsaved-user-edits');
    if (snapshot.document?.id !== docId || snapshot.document.revision !== doc.revision || doc.revision !== state.run.currentRevision) {
      throw new CreationError(409, 'revision-conflict');
    }
    const stage = stageId ? [...state.run.stages].reverse().find(item => item.id === stageId) : state.run.stages.at(-1);
    if (!stage) throw new CreationError(404, 'stage-not-found');
    const { payload, links } = this.source(projectId, docId, runId, stage, doc.links); this.guardPayload(doc, payload);
    guardWorkflowLinks(doc.links, links, doc.payload, payload);
    state.run.activeStageId = stage.id; this.write(state);
    return { payload, links, run: state.run, stage };
  }
  capture(projectId: string, docId: string, runId: string, commandId: string, snapshot: Vibi3DSnapshot,
    uploads: Vibi3DCaptureUpload[], replayOnly = false): Vibi3DCaptureRecord[] {
    const state = this.state(projectId, docId, runId);
    if (replayOnly) return uploads.map(upload => {
      const saved = state.run.stages.flatMap(stage => stage.captures).find(capture => capture.commandId === commandId
        && capture.view === upload.view && capture.mode === upload.mode && capture.quality === upload.quality);
      if (!saved) throw new CreationError(409, 'command-not-pending');
      this.files.png(projectId, docId, runId, commandId, upload, true);
      return saved;
    });
    const current = this.creation.get(projectId, docId);
    if (snapshot.document?.id !== docId || snapshot.document.revision !== state.run.currentRevision
      || current.revision !== state.run.currentRevision) throw new CreationError(409, 'revision-conflict');
    const stage = [...state.run.stages].reverse().find(item => item.id === state.run.activeStageId) ?? state.run.stages.at(-1);
    if (!stage) throw new CreationError(409, 'checkpoint-required');
    const records = uploads.map(upload => ({ path: this.files.png(projectId, docId, runId, commandId, upload),
      view: upload.view, mode: upload.mode, quality: upload.quality, width: upload.width, height: upload.height,
      ...(upload.raster ? { raster: { ...upload.raster } } : {}),
      revision: snapshot.revision, capturedAt: this.now(), commandId }));
    for (const record of records) if (!stage.captures.some(old => this.files.same(old.path, record.path))) stage.captures.push(record);
    this.write(state);
    return records;
  }
}

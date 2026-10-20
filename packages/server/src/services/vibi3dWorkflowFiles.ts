import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isPathWithin, pathKey, VIBI3D_WORKFLOW_LIMITS, type PlatformName, type Vibi3DCaptureUpload } from '@vibisual/shared';
import { creationDocId, CreationError, type CreationHost } from './creationStore.js';

/** App-owned immutable artifacts use the creation boundary without joining its automatic cleanup. */
export class Vibi3DWorkflowFiles {
  constructor(private readonly host: CreationHost, private readonly platform: PlatformName) {}
  root(projectId: string): string {
    const root = this.host.resolveProjectPath(projectId);
    if (!root) throw new CreationError(404, 'project-not-found');
    return fs.realpathSync(root);
  }
  file(projectId: string, docId: string, ...parts: string[]): string {
    const root = this.root(projectId);
    const file = path.join(root, '.vibisual', 'creation', creationDocId(docId), 'workflow', ...parts);
    if (!isPathWithin(file, root, this.platform)) throw new CreationError(403, 'outside-project');
    let ancestor = file;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!isPathWithin(fs.realpathSync(ancestor), root, this.platform)) throw new CreationError(403, 'outside-project');
    return file;
  }
  key(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  relative(projectId: string, file: string): string { return path.relative(this.root(projectId), file).replace(/\\/g, '/'); }
  same(left: string, right: string): boolean { return pathKey(left, this.platform) === pathKey(right, this.platform); }
  json<T>(file: string): T | null {
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
    catch { throw new CreationError(422, 'workflow-unreadable'); }
  }
  write(file: string, value: unknown): void { this.host.atomicWriteFile(file, JSON.stringify(value)); }
  png(projectId: string, docId: string, runId: string, commandId: string, upload: Vibi3DCaptureUpload, existingOnly = false): string {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(upload.dataUrl);
    if (!match) throw new CreationError(400, 'invalid-capture');
    const data = Buffer.from(match[1]!, 'base64');
    if (data.length > VIBI3D_WORKFLOW_LIMITS.pngBytes) throw new CreationError(413, 'capture-too-large');
    if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(16) !== upload.width
      || data.readUInt32BE(20) !== upload.height || data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') {
      throw new CreationError(400, 'invalid-capture');
    }
    const digest = this.key(`${commandId}:${upload.view}:${upload.mode}:${upload.quality}`);
    const file = this.file(projectId, docId, 'runs', this.key(runId), 'captures', `${digest}.png`);
    if (fs.existsSync(file)) {
      if (!fs.readFileSync(file).equals(data)) throw new CreationError(409, 'capture-id-conflict');
      return this.relative(projectId, file);
    }
    if (existingOnly) throw new CreationError(409, 'command-not-pending');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    return this.relative(projectId, file);
  }
}

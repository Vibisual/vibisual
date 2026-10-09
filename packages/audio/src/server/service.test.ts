import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioServerHost } from '../host.js';
import { AudioService } from './service.js';

function wav(): Buffer {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  bytes.writeInt16LE(1234, 44);
  return bytes;
}

describe('persisted audio editing and immutable assets', () => {
  let root: string;
  let host: AudioServerHost;
  let service: AudioService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisound-service-test-'));
    host = {
      resolveProjectPath: (raw) => raw === 'project' || raw === root ? root : null,
      resolveWorkspacePath: vi.fn((base, relative) => {
        const abs = path.resolve(base, relative);
        const rel = path.relative(base, abs);
        return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : { abs, rel: rel.replace(/\\/g, '/') };
      }),
      atomicWriteFile: (file, data) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, data);
        fs.renameSync(`${file}.tmp`, file);
      },
      info: vi.fn(), warn: vi.fn(),
    };
    service = new AudioService(host);
  });
  afterEach(() => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vibisound-service-test-')) throw new Error('Unsafe test cleanup.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it('creates once and retains edits when reopening the same source document id', () => {
    const first = service.create(root, { id: 'file-a', title: 'First' });
    const edited = service.edit(root, 'file-a', 'patch', { baseVersion: first.doc.version, requestId: 'rename-1', ops: [{ op: 'setDoc', patch: { title: 'Edited' } }] });
    const reopened = new AudioService(host).create(root, { id: 'file-a', title: 'Do not replace' });
    expect(reopened.doc).toEqual(edited.doc);
    expect(reopened.canUndo).toBe(true);
    expect(service.list(root)).toMatchObject([{ id: 'file-a', title: 'Edited', duration: 0 }]);
  });

  it('persists duplicate receipts, returns latest state on replay, and rejects stale/conflicting writes', () => {
    const first = service.create(root, { id: 'doc' });
    const request = { baseVersion: first.doc.version, requestId: 'request-one', actor: 'agent', ops: [{ op: 'setDoc', patch: { title: 'Agent edit' } }] };
    const applied = service.edit(root, 'doc', 'patch', request);
    const human = service.edit(root, 'doc', 'patch', { baseVersion: applied.doc.version, requestId: 'human', ops: [{ op: 'setDoc', patch: { title: 'Human edit' } }] });
    const restarted = new AudioService(host);
    expect(restarted.edit(root, 'doc', 'patch', request)).toMatchObject({ replayed: true, appliedVersion: applied.doc.version, doc: human.doc });
    expect(() => restarted.edit(root, 'doc', 'patch', { ...request, requestId: 'stale' })).toThrow('latest audio project');
    expect(() => restarted.edit(root, 'doc', 'patch', { ...request, ops: [{ op: 'setDoc', patch: { title: 'Different' } }] })).toThrow('another edit');
    expect(restarted.get(root, 'doc').doc.version).toBe(human.doc.version);
  });

  it('undo/redo versions increase and a new edit clears redo without removing the source', () => {
    const first = service.create(root, { id: 'doc', title: 'Original' });
    const changed = service.edit(root, 'doc', 'patch', { baseVersion: first.doc.version, requestId: 'a', ops: [{ op: 'setDoc', patch: { title: 'Changed' } }] });
    const undone = service.edit(root, 'doc', 'undo', { baseVersion: changed.doc.version, requestId: 'b' });
    expect(undone).toMatchObject({ doc: { title: 'Original', version: changed.doc.version + 1 }, canRedo: true });
    const redone = service.edit(root, 'doc', 'redo', { baseVersion: undone.doc.version, requestId: 'c' });
    expect(redone.doc.title).toBe('Changed');
    expect(redone.doc.version).toBe(undone.doc.version + 1);
    const again = service.edit(root, 'doc', 'undo', { baseVersion: redone.doc.version, requestId: 'd' });
    expect(service.edit(root, 'doc', 'patch', { baseVersion: again.doc.version, requestId: 'e', ops: [{ op: 'setDoc', patch: { title: 'New branch' } }] }).canRedo).toBe(false);
  });

  it('measures uploaded bytes and copies imported originals without trusting metadata', async () => {
    const bytes = wav();
    const original = path.join(root, 'voice.wav');
    fs.writeFileSync(original, bytes);
    const asset = await service.assets.import(root, 'voice.wav');
    expect(asset).toMatchObject({ duration: 1, sampleRate: 8000, channels: 1, name: 'voice.wav' });
    expect(fs.readFileSync(original)).toEqual(bytes);
    fs.writeFileSync(original, 'changed outside the app');
    expect(fs.readFileSync(service.assets.resolve(root, asset.path))).toEqual(bytes);
    const uploaded = await service.assets.upload(root, 'same-audio.wav', bytes);
    expect(uploaded.id).toBe(asset.id);
    fs.unlinkSync(service.assets.resolve(root, asset.path));
    expect(await service.assets.upload(root, 'restored-source.wav', bytes)).toEqual(asset);
    expect(fs.readFileSync(service.assets.resolve(root, asset.path))).toEqual(bytes);
    expect(host.resolveWorkspacePath).toHaveBeenCalledWith(root, 'voice.wav');
  });

  it('accepts only registered canonical assets and rejects the whole patch when any source is forged', async () => {
    const first = service.create(root, { id: 'doc' });
    const asset = await service.assets.upload(root, 'voice.wav', wav());
    const ops = [{ op: 'setAsset', asset }, { op: 'addClip', trackId: 'audio', clip: { id: 'voice', assetId: asset.id, at: 0, sourceStart: 0, duration: 1 } }];
    const accepted = service.edit(root, 'doc', 'patch', { baseVersion: first.doc.version, requestId: 'import', ops });
    expect(accepted.doc.tracks[0]?.clips).toHaveLength(1);
    const fake = { ...asset, id: 'forged', path: 'outside.wav' };
    expect(() => service.edit(root, 'doc', 'patch', { baseVersion: accepted.doc.version, requestId: 'forged', ops: [
      { op: 'setDoc', patch: { title: 'Must not persist' } }, { op: 'setAsset', asset: fake },
    ] })).toThrow('Import/register');
    expect(service.get(root, 'doc').doc).toEqual(accepted.doc);
    expect(() => service.edit(root, 'doc', 'patch', { baseVersion: accepted.doc.version, requestId: 'extra', ops: [
      { op: 'setAsset', asset: { ...asset, unverifiedMetadata: 'must not persist' } },
    ] })).toThrow('Import/register');
  });

  it('rejects unsupported file bytes and guarded paths without touching originals', async () => {
    await expect(service.assets.upload(root, 'fake.wav', Buffer.from('not audio'))).rejects.toMatchObject({ status: 422 });
    fs.writeFileSync(path.join(root, 'fake.wav'), 'not audio');
    await expect(service.assets.import(root, 'fake.wav')).rejects.toMatchObject({ status: 422 });
    await expect(service.assets.import(root, '../outside.wav')).rejects.toMatchObject({ status: 403 });
    await expect(service.assets.import(root, 'C:/outside.wav')).rejects.toMatchObject({ status: 400 });
    expect(() => service.create(root, { id: '../escape' })).toThrow('Invalid audio document id');
    expect(() => service.create(root, { id: '__proto__' })).toThrow('Invalid audio document id');
    expect(() => service.project('closed')).toThrow('not open');
    expect(fs.readdirSync(path.join(root, '.vibisual', 'audio', 'assets')).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not follow a playlist disguised as an audio file', async () => {
    const source = path.join(root, 'disguised.wav');
    fs.writeFileSync(source, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n../../outside.wav\n#EXT-X-ENDLIST\n');
    const open = vi.spyOn(fs.promises, 'open');
    try {
      await expect(service.assets.import(root, 'disguised.wav')).rejects.toMatchObject({ status: 422 });
      expect(open.mock.calls.every(([file]) => String(file).includes('import-'))).toBe(true);
    } finally { open.mockRestore(); }
  });

  it('recovers a valid backup and does not replace it with a semantically corrupt current document', () => {
    const first = service.create(root, { id: 'doc', title: 'Backup' });
    service.edit(root, 'doc', 'patch', { baseVersion: first.doc.version, requestId: 'edit', ops: [{ op: 'setDoc', patch: { title: 'Current' } }] });
    const file = path.join(root, '.vibisual', 'audio', 'docs', 'doc.json');
    fs.writeFileSync(file, JSON.stringify({ broken: true }));
    const recovered = service.get(root, 'doc');
    expect(recovered.doc.title).toBe('Backup');
    service.edit(root, 'doc', 'patch', { baseVersion: recovered.doc.version, requestId: 'recovered-edit', ops: [{ op: 'setDoc', patch: { title: 'Recovered edit' } }] });
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).doc.title).toBe('Backup');
  });

  it('keeps the committed version if atomic persistence fails', () => {
    const first = service.create(root, { id: 'doc' });
    const broken = new AudioService({ ...host, atomicWriteFile: () => { throw new Error('disk full'); } });
    expect(() => broken.edit(root, 'doc', 'patch', { baseVersion: first.doc.version, requestId: 'failed', ops: [{ op: 'setDoc', patch: { title: 'Lost' } }] })).toThrow('disk full');
    expect(service.get(root, 'doc').doc).toEqual(first.doc);
  });

  it('does not treat a linked project directory as writable app storage', () => {
    const protectedDir = path.join(root, 'user-documents');
    fs.mkdirSync(protectedDir);
    fs.mkdirSync(path.join(root, '.vibisual'));
    fs.symlinkSync(protectedDir, path.join(root, '.vibisual', 'audio'), 'junction');
    expect(() => service.create(root, { id: 'doc' })).toThrow('symbolic links');
    expect(fs.readdirSync(protectedDir)).toEqual([]);
  });

  it('guards the atomic writer temporary path against hard links to user files', () => {
    const protectedFile = path.join(root, 'original.txt');
    const dir = path.join(root, '.vibisual', 'audio', 'docs');
    fs.writeFileSync(protectedFile, 'keep this content');
    fs.mkdirSync(dir, { recursive: true });
    fs.linkSync(protectedFile, path.join(dir, 'doc.json.tmp'));
    expect(() => service.create(root, { id: 'doc' })).toThrow('hard-linked');
    expect(fs.readFileSync(protectedFile, 'utf8')).toBe('keep this content');
    expect(fs.existsSync(path.join(dir, 'doc.json'))).toBe(false);
  });

  it('stores inert provider drafts and rejects credentials and unknown fields', () => {
    const settings = { providers: [{ id: 'local', kind: 'local', name: 'Local model', endpoint: 'http://localhost:11434/api', model: 'test', capabilities: ['transcribe'] }] };
    expect(service.putSettings(root, settings)).toEqual(settings);
    expect(new AudioService(host).getSettings(root)).toEqual(settings);
    for (const patch of [{ apiKey: 'secret' }, { endpoint: 'https://user:secret@host/api' }, { endpoint: 'https://host/api?token=secret' }]) {
      expect(() => service.putSettings(root, { providers: [{ ...settings.providers[0], ...patch }] })).toThrow();
    }
    expect(service.getSettings(root)).toEqual(settings);
  });
});

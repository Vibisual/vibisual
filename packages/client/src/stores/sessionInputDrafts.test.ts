import { describe, expect, it } from 'vitest';
import type { AgentSessionInputDraft } from './graphStore.js';
import { decodeSessionInputDrafts, encodeSessionInputDrafts } from './sessionInputDrafts.js';

const image = (tempId: string, serverPath: string) => ({
  tempId,
  serverPath,
  previewUrl: `blob:preview-${tempId}`,
  uploading: false,
});

function reload(drafts: Record<string, AgentSessionInputDraft>) {
  return decodeSessionInputDrafts(JSON.parse(JSON.stringify(encodeSessionInputDrafts(drafts))));
}

describe('decodeSessionInputDrafts', () => {
  it('preserves legacy text exactly, including whitespace, and drops empty legacy drafts', () => {
    expect(decodeSessionInputDrafts({
      'agent-1|session-1': '사진을 확인해 주세요\n',
      'agent-1|__new__': '  ',
      'agent-2|session-1': '',
    })).toEqual({
      'agent-1|session-1': { text: '사진을 확인해 주세요\n', attachments: [] },
      'agent-1|__new__': { text: '  ', attachments: [] },
    });
  });

  it.each([undefined, null, true, 42, 'unparsed JSON', [], ['legacy text']])(
    'ignores malformed storage roots: %j',
    (value) => {
      expect(decodeSessionInputDrafts(value)).toEqual({});
    },
  );

  it('isolates malformed entries and attachments without losing valid neighboring drafts', () => {
    expect(decodeSessionInputDrafts({
      nullEntry: null,
      numberEntry: 10,
      arrayEntry: [{ text: 'invalid' }],
      empty: {},
      invalidText: { text: 10, attachments: [] },
      textOnly: { text: 'kept', attachments: 'invalid' },
      imagesOnly: {
        text: false,
        attachments: [
          null, 42, [], {},
          { tempId: '', serverPath: '/tmp/empty-id.png' },
          { tempId: ' ', serverPath: '/tmp/blank-id.png' },
          { tempId: 'wrong-path', serverPath: 42 },
          { tempId: 'empty-path', serverPath: '' },
          { tempId: 'blank-path', serverPath: '  ' },
          { tempId: 'blob-path', serverPath: 'blob:expired-preview' },
          { tempId: 'valid', serverPath: '/tmp/image.png' },
        ],
      },
      legacy: 'still kept',
    })).toEqual({
      textOnly: { text: 'kept', attachments: [] },
      imagesOnly: {
        text: '',
        attachments: [{ tempId: 'valid', serverPath: '/tmp/image.png', previewUrl: '', uploading: false }],
      },
      legacy: { text: 'still kept', attachments: [] },
    });
  });

  it('does not restore upload failures, in-flight uploads, old previews, or send failures', () => {
    expect(decodeSessionInputDrafts({
      session: {
        text: 'retry this',
        sendFailure: 'unconfirmed',
        sendError: { message: 'old error' },
        attachments: [
          { ...image('pending', '/tmp/pending.png'), uploading: true },
          { ...image('failed', '/tmp/failed.png'), error: 'upload failed' },
          image('ready', '/tmp/ready.png'),
        ],
      },
    })).toEqual({
      session: {
        text: 'retry this',
        attachments: [{ tempId: 'ready', serverPath: '/tmp/ready.png', previewUrl: '', uploading: false }],
      },
    });
  });

  it('treats special object keys as data without changing the output prototype', () => {
    const decoded = decodeSessionInputDrafts(JSON.parse('{"__proto__":"saved","constructor":"also saved"}'));
    expect(Object.keys(decoded)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(decoded['__proto__']).toEqual({ text: 'saved', attachments: [] });
  });
});

describe('encodeSessionInputDrafts', () => {
  it('round-trips image-only drafts without persisting browser previews', () => {
    const drafts = { session: { text: '', attachments: [image('pasted', 'C:\\tmp\\붙여넣기.png')] } };
    expect(encodeSessionInputDrafts(drafts)).toEqual({
      session: { text: '', attachments: [{ tempId: 'pasted', serverPath: 'C:\\tmp\\붙여넣기.png' }] },
    });
    expect(reload(drafts)).toEqual({
      session: {
        text: '',
        attachments: [{ tempId: 'pasted', serverPath: 'C:\\tmp\\붙여넣기.png', previewUrl: '', uploading: false }],
      },
    });
    expect(drafts.session.attachments[0]?.previewUrl).toBe('blob:preview-pasted');
  });

  it('round-trips text and multiple images independently across agents and sessions', () => {
    const drafts = {
      'agent-1|session-1': { text: 'first', attachments: [image('one', '/tmp/one.png'), image('two', '/tmp/two.png')] },
      'agent-1|session-2': { text: 'second', attachments: [] },
      'agent-2|session-1': { text: '', attachments: [image('three', '/tmp/three.png')] },
      'agent-2|__new__': { text: 'new session', attachments: [] },
    };
    expect(reload(drafts)).toEqual(Object.fromEntries(Object.entries(drafts).map(([key, draft]) => [key, {
      text: draft.text,
      attachments: draft.attachments.map((attachment) => ({ ...attachment, previewUrl: '' })),
    }])));
  });

  it('saves only successful uploads and excludes transient send state', () => {
    const drafts: Record<string, AgentSessionInputDraft> = {
      session: {
        text: 'keep text',
        sendFailure: 'unconfirmed',
        attachments: [
          image('ready', '/tmp/ready.png'),
          { ...image('pending', '/tmp/pending.png'), uploading: true },
          { ...image('failed', '/tmp/failed.png'), error: 'upload failed' },
          image('missing', ''),
          image('blank', '  '),
          image('blob-path', 'blob:temporary-image'),
        ],
      },
    };
    expect(encodeSessionInputDrafts(drafts)).toEqual({
      session: { text: 'keep text', attachments: [{ tempId: 'ready', serverPath: '/tmp/ready.png' }] },
    });
  });

  it('drops empty drafts and drafts containing only unfinished images', () => {
    expect(encodeSessionInputDrafts({
      empty: { text: '', attachments: [] },
      pending: { text: '', attachments: [{ ...image('pending', ''), uploading: true }] },
      failed: { text: '', attachments: [{ ...image('failed', ''), error: 'failed' }] },
      textOnly: { text: 'keep', attachments: [] },
    })).toEqual({ textOnly: { text: 'keep', attachments: [] } });
  });
});

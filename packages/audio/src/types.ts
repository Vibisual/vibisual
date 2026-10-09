/** Audio documents contain immutable asset references and edits, never decoded PCM. */
export interface AudioAsset {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly duration: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
}

/**
 * A cut keeps the original fade coordinate system. This represents the exact
 * product of the original linear fades, including overlapping fades; it avoids
 * approximating their product with a new piecewise-linear curve.
 * When present this replaces (does not multiply) fadeIn/fadeOut for rendering.
 */
export interface AudioGainEnvelope {
  readonly offset: number;
  readonly duration: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
}

export interface AudioTimelineClip {
  readonly id: string;
  readonly assetId: string;
  /** Project timeline seconds. */
  readonly at: number;
  /** Start in the immutable source asset, in seconds. */
  readonly sourceStart: number;
  readonly duration: number;
  readonly gainDb?: number;
  /** Linear edge fades in seconds. Updating either fade resets an inherited envelope. */
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly gainEnvelope?: AudioGainEnvelope;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly locked?: boolean;
}

export interface AudioTrack {
  readonly id: string;
  readonly label?: string;
  readonly muted?: boolean;
  readonly solo?: boolean;
  readonly gainDb?: number;
  readonly clips: readonly AudioTimelineClip[];
}

export interface AudioDoc {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  /** Monotonically increasing, including server undo/redo. */
  readonly version: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly tracks: readonly AudioTrack[];
  readonly assets: Readonly<Record<string, AudioAsset>>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AudioClipUpdate = Partial<Omit<AudioTimelineClip, 'id'>>;
export type AudioTrackUpdate = Partial<Omit<AudioTrack, 'id' | 'clips'>>;
export type AudioDocUpdate = Partial<Pick<AudioDoc, 'title' | 'sampleRate' | 'channels'>>;

/** Every range is [start,end) in clip-local seconds; crop keeps the clip at its current timeline position. */
export type AudioDocOp =
  | { readonly op: 'addTrack'; readonly track: AudioTrack; readonly beforeTrackId?: string }
  | { readonly op: 'removeTrack'; readonly trackId: string }
  | { readonly op: 'updateTrack'; readonly trackId: string; readonly patch: AudioTrackUpdate }
  | { readonly op: 'addClip'; readonly trackId: string; readonly clip: AudioTimelineClip }
  | { readonly op: 'removeClip'; readonly clipId: string }
  | { readonly op: 'updateClip'; readonly clipId: string; readonly patch: AudioClipUpdate }
  | { readonly op: 'moveClip'; readonly clipId: string; readonly toTrackId: string; readonly at: number }
  | { readonly op: 'splitClip'; readonly clipId: string; readonly at: number; readonly newClipId: string }
  | { readonly op: 'cropClip'; readonly clipId: string; readonly start: number; readonly end: number }
  /** Closes the removed range within this clip only; other clips/tracks never move. */
  | { readonly op: 'deleteClipRange'; readonly clipId: string; readonly start: number; readonly end: number; readonly newClipId: string }
  | { readonly op: 'setAsset'; readonly asset: AudioAsset }
  | { readonly op: 'removeAsset'; readonly assetId: string }
  | { readonly op: 'setDoc'; readonly patch: AudioDocUpdate };

export interface AudioDocPatch {
  readonly baseVersion: number;
  readonly ops: readonly AudioDocOp[];
}

export interface AudioValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type AudioValidateResult =
  | { readonly ok: true; readonly doc: AudioDoc }
  | { readonly ok: false; readonly errors: readonly AudioValidationIssue[] };

export type AudioDocPatchResult =
  | { readonly ok: true; readonly doc: AudioDoc }
  | {
      readonly ok: false;
      readonly reason: 'version-conflict' | 'invalid-op' | 'invalid-doc';
      readonly message: string;
      readonly opIndex?: number;
      readonly errors?: readonly AudioValidationIssue[];
    };

export type AudioProviderCapability = 'generate' | 'transcribe' | 'separate' | 'enhance';
export interface AudioProviderDraft {
  readonly id: string;
  readonly kind: 'api' | 'local';
  readonly name: string;
  readonly endpoint: string;
  readonly model: string;
  readonly capabilities: readonly AudioProviderCapability[];
}
export interface AudioProviderSettings {
  readonly providers: readonly AudioProviderDraft[];
}

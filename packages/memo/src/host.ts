import type { ComponentType, ReactNode } from 'react';
import type { MemoAIStatus, MemoContext, MemoTextResult } from './types.js';

/** Every core interaction is injected here; the app does not import a host package. */
export interface MemoServerHost {
  resolveProjectPath(raw: unknown): string | null;
  resolveWorkspacePath(root: string, relative: string): { abs: string; rel: string } | null;
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
  textTaskStatus(provider?: string): Promise<MemoAIStatus>;
  runTextTask(prompt: string, provider?: string): Promise<MemoTextResult>;
  resolveAppContext(project: string, itemId: string): MemoContext | null;
  getAppAIEnabled?(): boolean;
  setAppAIEnabled?(enabled: boolean): Promise<void>;
}
export interface MemoClientHost {
  Scroll: ComponentType<{ children: ReactNode; fill?: boolean; maxHeight?: number; className?: string }>;
  useLifecycle(params: Readonly<Record<string, string>>, noteId: string | null, flush: () => Promise<boolean>): void;
  openContext(project: string, context: MemoContext): void;
  contexts(project: string): MemoContext[];
  useAIEnabled?(): boolean;
  /** onToggleTask 를 받으면 체크박스를 누를 수 있게 그리고, 그 목록 항목이 원문에서 시작하는 자리를 돌려준다. */
  Markdown?: ComponentType<{ text: string; onToggleTask?: (offset: number) => void }>;
  shortcutLabel?(combo: string): string;
  /** 미디어 경로를 응답을 통째로 싣지 않는 스트리밍 주소로 바꾼다. 없으면 경로 그대로 쓴다. */
  mediaUrl?(path: string): string;
  /** 호스트의 공용 이미지 편집창을 쓴다. 첨부 원본과 불변 판본은 덮어쓰지 않는다. */
  ImageEditor?: ComponentType<{ src: string; close: () => void }>;
}

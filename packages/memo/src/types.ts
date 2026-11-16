export interface MemoContext {
  kind: 'project' | 'app';
  id: string;
  label: string;
  excerpt: string;
}
export interface MemoAttachment {
  id: string; name: string; mime: string; size: number; createdAt: number;
  /** 목록용 작은 미리보기가 함께 저장됐다. */
  thumb?: boolean;
  width?: number; height?: number;
  /** 초 단위 길이(영상·소리). */
  duration?: number;
}
export interface MemoTask { id: string; text: string; checked: boolean }
export interface MemoNote {
  id: string;
  owner: 'local';
  project: string;
  title: string;
  body: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  aiExcluded: boolean;
  tags: string[];
  tasks: MemoTask[];
  context: MemoContext | null;
  attachments: MemoAttachment[];
  deletedAt: number | null;
  requestId: string;
  author: 'user' | 'ai';
}
export interface MemoCitation { noteId: string; version: number; start: number; end: number; quote: string }
export interface MemoClaim { kind: 'decision' | 'proposal' | 'unknown'; text: string; citations: MemoCitation[] }
export interface MemoAIResult {
  title: string;
  summary: string;
  tags: string[];
  tasks: { text: string; citation: MemoCitation }[];
  claims: MemoClaim[];
}
export type MemoAIState = 'running' | 'completed' | 'limited' | 'failed' | 'checking' | 'connection';
export interface MemoAIJob {
  id: string;
  key: string;
  requestId: string;
  mode: 'organize' | 'ask';
  provider?: 'claude' | 'codex';
  question: string;
  state: MemoAIState;
  createdAt: number;
  updatedAt: number;
  sources: MemoNote[];
  result: MemoAIResult | null;
  error: string;
  hostTaskId?: string;
  usage?: Record<string, unknown>;
}
export interface MemoSettings { aiEnabled: boolean }
export interface MemoList { notes: MemoNote[]; settings: MemoSettings }
export interface MemoAIStatus { state: 'available' | 'connection' | 'unknown'; provider: string; subscription?: string }
export interface MemoTextResult {
  state: 'completed' | 'limited' | 'failed' | 'checking' | 'connection';
  text: string;
  hostTaskId?: string;
  usage?: Record<string, unknown>;
}

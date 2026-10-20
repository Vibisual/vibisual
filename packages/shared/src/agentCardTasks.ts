/** A command accepted by the server. Session IDs must come from this receipt. */
export interface CommandReceipt {
  id: string;
  subAgentId: string | null;
}

export interface AgentCardTask {
  id: string;
  title: string;
  sessionId: string | null;
  nodeIds: string[];
  createdAt: number;
}

/** Persist the user's request before preparing outputs or starting a new conversation. */
export interface AgentCardPendingTask {
  /** Claim expiry for explicit recovery after the preparing renderer disappears. Never authorizes automatic resend. */
  leaseUntil?: number;
  id: string;
  mode: 'new' | 'copy';
  text: string;
  sourceTaskId: string | null;
  nodeIds: string[];
  createdAt: number;
  status: 'waiting' | 'preparing' | 'failed';
  error?: string;
  /** Prepared task retained for a retry after submission fails. */
  taskId?: string;
}

export interface AgentCardTaskBook {
  revision: number;
  activeTaskId: string | null;
  tasks: AgentCardTask[];
  pending?: AgentCardPendingTask;
}

export interface AgentCardTaskBookUpdate {
  expectedRevision: number;
  book: Omit<AgentCardTaskBook, 'revision'>;
}

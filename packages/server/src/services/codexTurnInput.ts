/** Native app-server inputs keep application instructions out of the user's message. */
export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string };

export interface CodexTurnInputOptions {
  userText: string;
  images?: readonly string[];
  /** Already-filtered application context; the caller owns context-source switches. */
  appContext?: string;
  appendSystemPrompt?: string;
  livePreamble?: string;
  /** Legacy fallback only: ordinary context already includes the agent's rules. */
  rules?: string;
  edgeInstructions?: string;
  /** Effective config/read value after CLI overrides, never the entire config object. */
  nativeDeveloperInstructions?: unknown;
}

export interface CodexTurnInput {
  input: CodexUserInput[];
  /** Omitted when no app instructions need to override the native setting. */
  developerInstructions?: string;
}

/** Preserve native custom instructions before app additions; omit an unnecessary override. */
export function mergeCodexDeveloperInstructions(native: unknown, app: string): string | undefined {
  const application = app.trim();
  if (!application) return undefined;
  const configured = typeof native === 'string' && native.trim() ? native : '';
  return configured ? `${configured}\n\n${application}` : application;
}

/** Pure assembly for initial turns and steering; image paths never become instruction text. */
export function composeCodexTurnInput(options: CodexTurnInputOptions): CodexTurnInput {
  const stable = [options.appContext?.trim(), options.appendSystemPrompt?.trim()]
    .filter((part): part is string => !!part)
    .join('\n\n');
  const app = [stable || options.rules?.trim(), options.livePreamble?.trim(), options.edgeInstructions?.trim()]
    .filter((part): part is string => !!part)
    .join('\n\n');
  const developerInstructions = mergeCodexDeveloperInstructions(options.nativeDeveloperInstructions, app);
  const input: CodexUserInput[] = [{ type: 'text', text: options.userText, text_elements: [] }];
  for (const imagePath of new Set(options.images ?? [])) {
    if (imagePath.trim()) input.push({ type: 'localImage', path: imagePath });
  }
  return { input, ...(developerInstructions === undefined ? {} : { developerInstructions }) };
}

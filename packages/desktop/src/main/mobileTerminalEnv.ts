/**
 * Keep the desktop Record<string, string> contract on the JSON/WS boundary.
 * The mobile socket already caps the entire frame size; do not truncate values
 * or silently drop an invalid field and launch a different command environment.
 */
export function mobileTerminalEnv(input: unknown): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid-terminal-env');
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => !key || /[=\u0000]/.test(key) || typeof value !== 'string' || value.includes('\u0000'))) {
    throw new Error('invalid-terminal-env');
  }
  return Object.fromEntries(entries);
}

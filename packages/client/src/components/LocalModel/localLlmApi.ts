/** Keep the server's actionable reason; an HTTP number alone cannot explain a failed model choice. */
export async function localLlmResponseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch { /* Proxies may return HTML instead of the API's JSON error. */ }
  return `HTTP ${response.status}`;
}

export type LocalModelBindingResult = { ok: true } | { ok: false; error: string };

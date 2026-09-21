/** Only the five run-scoped tool operations are callable by an agent. Configuration stays in the UI. */
export function isVerificationToolIngress(method: string | undefined, pathname: string): boolean {
  return method === 'POST' && /^\/api\/verification-tools\/(observe|act|check|replay|finalize)$/.test(pathname);
}

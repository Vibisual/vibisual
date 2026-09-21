/** Untrusted verification targets must not receive application snapshots or draft flush requests. */
const verificationWindows = new Set<number>();
export function registerVerificationWindow(id: number): void { verificationWindows.add(id); }
export function unregisterVerificationWindow(id: number): void { verificationWindows.delete(id); }
export function isVerificationWindow(id: number): boolean { return verificationWindows.has(id); }

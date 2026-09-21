import type { VerificationAction, VerificationCheck, VerificationElement, VerificationTarget, VerificationTargetAvailability } from '@vibisual/shared';

export interface VerificationObservation {
  png: Buffer;
  width: number;
  height: number;
  url?: string;
  title?: string;
  elements: VerificationElement[];
}

/** Electron implements this interface; the server owns authorization and the durable ledger. */
export interface VerificationAutomationAdapter {
  probe(target: VerificationTarget): Promise<VerificationTargetAvailability>;
  open(runId: string, target: VerificationTarget): Promise<void>;
  observe(runId: string): Promise<VerificationObservation>;
  act(runId: string, action: VerificationAction): Promise<string>;
  check(runId: string, check: VerificationCheck, referencePng?: Buffer): Promise<{ passed: boolean; detail: string }>;
  close(runId: string): Promise<void>;
}

let adapter: VerificationAutomationAdapter | undefined;
export function setVerificationAutomationAdapter(value: VerificationAutomationAdapter): void { adapter = value; }
export function getVerificationAutomationAdapter(): VerificationAutomationAdapter | undefined { return adapter; }

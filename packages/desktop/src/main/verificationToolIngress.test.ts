import { describe, expect, it } from 'vitest';
import { isVerificationToolIngress } from './verificationToolIngress';

describe('verification tool ingress', () => {
  it('allows only POST calls for the five scoped tools', () => {
    for (const operation of ['observe', 'act', 'check', 'replay', 'finalize']) {
      expect(isVerificationToolIngress('POST', `/api/verification-tools/${operation}`)).toBe(true);
      expect(isVerificationToolIngress('GET', `/api/verification-tools/${operation}`)).toBe(false);
    }
    for (const pathname of ['/api/verification-tools', '/api/verification-tools/start', '/api/verification-tools/act/anything', '/api/verification-tools/../agent-config', '/api/verification-tools/observe/']) {
      expect(isVerificationToolIngress('POST', pathname)).toBe(false);
    }
  });
});

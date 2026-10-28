import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: {} }));

import { isStrongSecretBackend } from './apiCreditCipher';

// §4 API 크레딧 — 키를 감싼 금고가 실제로 지키는지의 판정. 실기가 없는 OS 도 여기서 고정한다.
describe('isStrongSecretBackend', () => {
  it('Windows·macOS 는 OS 금고(DPAPI·키체인)가 지킨다', () => {
    expect(isStrongSecretBackend('win32', undefined)).toBe(true);
    expect(isStrongSecretBackend('darwin', undefined)).toBe(true);
  });
  it('Linux 는 키링이 있을 때만 지킨다 — basic_text·unknown·판정 실패는 못 지킨다', () => {
    expect(isStrongSecretBackend('linux', 'gnome_libsecret')).toBe(true);
    expect(isStrongSecretBackend('linux', 'kwallet5')).toBe(true);
    expect(isStrongSecretBackend('linux', 'basic_text')).toBe(false);
    expect(isStrongSecretBackend('linux', 'unknown')).toBe(false);
    expect(isStrongSecretBackend('linux', undefined)).toBe(false);
  });
});

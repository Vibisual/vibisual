import { safeStorage } from 'electron';
import type { ApiCreditCipher } from '@vibisual/server';

// §4 API 크레딧 — 붙여 넣은 Console API 키를 OS 보안 저장소로 감싼다.
// `safeStorage` 는 OS 마다 금고가 다르다(Windows DPAPI · macOS 키체인 · Linux libsecret/kwallet). 키링 없는 Linux 는 `basic_text`(코드에 박힌 고정 암호)로
// 떨어져 감싸도 지키지 못한다 — 그래서 감쌀 수 있는가(`available`)와 실제로 지키는가(`strong`)를 갈라 화면이 사실대로 말하게 한다.
// CLI 로그인 자격증명(§4)은 여기서 다루지 않는다 — CLI 가 저장한다.

/**
 * OS 금고가 키를 실제로 지키는가. 플랫폼을 인자로 받아 Windows 개발기에서도 세 OS 를 시험한다(멀티플랫폼 규칙).
 * Linux 의 `basic_text`·`unknown`(판정 실패)은 지키지 못하는 것으로 본다.
 */
export function isStrongSecretBackend(platform: NodeJS.Platform, backend: string | undefined): boolean {
  if (platform !== 'linux') return true;
  return !!backend && backend !== 'basic_text' && backend !== 'unknown';
}

export function createApiCreditCipher(platform: NodeJS.Platform = process.platform): ApiCreditCipher {
  return {
    available: () => {
      try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
    },
    strong: () => {
      let backend: string | undefined;
      // `getSelectedStorageBackend` 는 Linux 전용이다 — 다른 OS 에서는 부르지 않는다.
      if (platform === 'linux') {
        try { backend = safeStorage.getSelectedStorageBackend(); } catch { backend = undefined; }
      }
      return isStrongSecretBackend(platform, backend);
    },
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64')),
  };
}

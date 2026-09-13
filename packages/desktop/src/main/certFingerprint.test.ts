import { describe, it, expect } from 'vitest';
import { certFingerprintOf } from './certFingerprint';

// §4 (외부 접속 보안) — 인증서 지문 계산.
//
// 이 값은 사용자가 **폰 화면과 눈으로 대조**하는 값이다. 틀린 지문은 경고가 없는 것보다 나쁘다
// — 사용자는 "확인했다"고 믿고 남의 인증서를 통과시킨다. 그래서 고정 벡터로 묶는다.

/** 알려진 바이트열의 PEM 포장 — 기대값은 같은 바이트의 SHA-256 이다(밖에서 미리 계산). */
const FIXTURE_B64 = 'dmliaXN1YWwtZmluZ2VycHJpbnQtZml4dHVyZQ==';
const FIXTURE_FP =
  'FA:19:D5:76:05:7F:D7:23:D8:8F:A4:7E:E9:97:FF:BA:7C:A8:14:C7:25:77:05:90:1F:B3:EF:14:F5:DA:DF:7F';

const pem = (body: string): string => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;

describe('인증서 지문', () => {
  it('알려진 인증서에서 알려진 지문이 나온다', () => {
    expect(certFingerprintOf(pem(FIXTURE_B64))).toBe(FIXTURE_FP);
  });

  it('브라우저와 같은 표기다 — 대문자 두 글자씩 콜론, 32묶음', () => {
    const fp = certFingerprintOf(pem(FIXTURE_B64));
    expect(fp).not.toBeNull();
    const parts = (fp ?? '').split(':');
    expect(parts).toHaveLength(32); // SHA-256 = 32바이트
    for (const p of parts) expect(p).toMatch(/^[0-9A-F]{2}$/);
  });

  it('줄바꿈 방식이 달라도 같은 값이다 — PEM 은 줄 길이가 제각각이다', () => {
    const wrapped = `-----BEGIN CERTIFICATE-----\n${FIXTURE_B64.slice(0, 10)}\n${FIXTURE_B64.slice(10)}\n-----END CERTIFICATE-----`;
    const crlf = pem(FIXTURE_B64).replace(/\n/g, '\r\n');
    expect(certFingerprintOf(wrapped)).toBe(FIXTURE_FP);
    expect(certFingerprintOf(crlf)).toBe(FIXTURE_FP);
    // 머리말이 아예 없어도 본문만 있으면 같은 값 — 저장 포맷이 바뀌어도 지문은 흔들리지 않는다.
    expect(certFingerprintOf(FIXTURE_B64)).toBe(FIXTURE_FP);
  });

  it('빈 인증서는 null — 화면은 대조할 값이 없으면 칸 자체를 그리지 않는다', () => {
    expect(certFingerprintOf('')).toBeNull();
    expect(certFingerprintOf(pem(''))).toBeNull();
    expect(certFingerprintOf('   \n  \n ')).toBeNull();
  });

  it('base64 가 아닌 글자가 섞이면 null — 조용히 건너뛴 바이트의 지문을 내주지 않는다', () => {
    // Buffer.from(…, 'base64') 는 이상한 글자를 말없이 버린다. 그대로 두면 "틀린 확신"이 된다.
    expect(certFingerprintOf(pem('!!! not base64 !!!'))).toBeNull();
    expect(certFingerprintOf(pem('AAAA$$$BBBB'))).toBeNull();
  });
});

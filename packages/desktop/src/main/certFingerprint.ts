import { createHash } from 'node:crypto';

/**
 * §4 (외부 접속 보안) — 자체 서명 인증서의 SHA-256 지문. 폰은 첫 접속에서 경고를 띄우고 안내는 "계속"을 누르라 하므로, 대조할 값이 없으면
 * 경로 위 공격자의 인증서도 똑같이 넘긴다(도청은 막아도 중간자는 못 막는다) — 데스크톱 화면에 띄워 "지금 폰의 경고가 우리 것인가"를 가리게 한다.
 * 표기는 브라우저 인증서 상세와 같은 `AB:CD:…`(대문자·콜론) — 다르면 같은 값도 달라 보인다.
 * mobileAccess.ts 밖에 둔 것은 시험 때문이다(그 파일은 electron 을 물어 단위 시험에서 못 부른다) — 틀린 지문은 틀린 확신을 주므로 고정 벡터로 묶는다.
 */
export function certFingerprintOf(certPem: string): string | null {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (body === '') return null;
  // base64 가 아닌 글자가 섞여 있으면 Buffer.from 은 **조용히 건너뛴다** — 그대로 두면 엉뚱한
  // 바이트의 지문이 나와 사용자가 맞다고 착각할 수 있다. 모양부터 막는다.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  try {
    const der = Buffer.from(body, 'base64');
    if (der.length === 0) return null;
    const hex = createHash('sha256').update(der).digest('hex').toUpperCase();
    return (hex.match(/.{2}/g) ?? []).join(':');
  } catch {
    return null;
  }
}

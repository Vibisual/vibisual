import { createHash } from 'node:crypto';

/**
 * §4 (외부 접속 보안) — 자체 서명 인증서의 SHA-256 지문.
 *
 * **왜 화면에 띄우는가.** 외부 접속은 자체 서명 HTTPS 라 폰이 첫 접속에서 경고를 띄우고, 우리
 * 안내는 "계속"을 누르라고 가르친다. 그 습관만 남으면 경로 위의 공격자가 **자기 인증서**를
 * 내밀어도 사용자는 똑같이 넘긴다 — 도청은 막아도 중간자는 못 막는 상태다. 데스크톱 화면에
 * 대조할 값이 있어야 "지금 폰에 뜬 경고가 우리 것인가"를 가릴 수 있다.
 *
 * **표기는 브라우저에 맞춘다.** 사용자가 두 화면을 나란히 놓고 눈으로 비교하므로, 브라우저가
 * 인증서 상세에 쓰는 것과 같은 `AB:CD:…`(대문자 · 콜론 구분)여야 한다. 우리끼리 편한 표기를
 * 쓰면 같은 값인데도 달라 보여 오히려 사용자를 잘못된 판단으로 몬다.
 *
 * mobileAccess.ts 밖에 두는 이유는 **시험 때문**이다 — 그 파일은 electron 을 물고 있어 단위
 * 테스트에서 못 부른다. 지문이 틀리면 사용자는 엉뚱한 값을 대조하게 되고, 그건 경고가 없는
 * 것보다 나쁘다(틀린 확신). 그래서 이 계산만은 따로 떼어 고정 벡터로 묶는다.
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

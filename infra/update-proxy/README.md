# 업데이트 피드 프록시

앱의 업데이트 확인 요청을 우리가 받아 **돌고 있는 설치 수**를 세는 Cloudflare Worker.
받는 파일도, 무결성 검사도, 설치 경로도 종전과 같다 — 바뀌는 것은 `latest*.yml` 을
누구에게 묻는가 하나뿐이고, 설치 파일 자체는 GitHub 으로 302 로 돌려보낸다.

세우기 전까지 앱은 **오늘과 완전히 같이 동작한다**(`UPDATE_FEED_URL` 이 비어 있으면
`setFeedURL` 을 호출하지 않는다). 그래서 이 폴더는 언제 배포해도 되고, 배포하지 않아도 된다.

## 왜 필요한가

데스크톱 앱에서 "쓰는 사람이 몇인가"를 재는 업계 통상 경로가 업데이트 확인 요청 로그다.
앱은 어차피 4시간마다 새 버전을 묻는다 — 새로 수집을 시작하는 것이 아니라, 이미 오는 요청을
GitHub 이 받느냐 우리가 받느냐의 차이뿐이다. GitHub 이 받으면 우리에게 남는 것은
`latest.yml` 다운로드 수 한 줄이라 **1대가 자주 물었는지 여럿이 한 번씩 물었는지 가릴 수 없다.**

실측(2026-09-07): 그 숫자는 두 달간 하루 4~7회로 평평했다. 상시 켜 둔 1대의 4시간 주기
(24÷4=6)와 구분되지 않는다.

## 세우기

```bash
cd infra/update-proxy
npx wrangler login

# 방문 표식 저장고
npx wrangler kv namespace create VISITS
#   → 찍혀 나온 id 를 wrangler.toml 의 REPLACE_WITH_KV_NAMESPACE_ID 자리에 넣는다

# 하루치 소금. 이게 없으면 계수 없이 프록시만 한다. 값은 아무 긴 임의 문자열이면 되는데,
# 고르느라 멈추지 않도록 만들어 붙인다(붙여 넣으라고 하면 프롬프트가 뜬다).
#   openssl rand -base64 32
#   (openssl 이 없으면) node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# ⚠️ 이 값을 나중에 바꾸면 그날 이후의 표식이 전부 달라진다 — 어제와 오늘이 끊긴다는 뜻이라
#    사고가 아니면 바꾸지 마라(바꾸는 것 자체가 안전장치이긴 하다).
npx wrangler secret put HASH_SALT

npx wrangler deploy
```

배포되면 주소가 찍힌다(`https://vibisual-update.<계정>.workers.dev`).
동작을 먼저 확인한다.

```bash
curl -I https://<주소>/latest.yml            # 200 + text/yaml
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<주소>/px?e=view"   # 204
curl -s  https://<주소>/stats | head         # 날짜별 집계

# ⚠️ `/stats` 는 엣지에 10분 캐시된다 — 방금 센 것이 바로 안 보이는 것이 정상이다.
#    그 캐시가 없으면 이 주소를 아는 누구든 두드리는 것만으로 KV 읽기 한도를 태울 수 있다.
```

## 사이트에 물리기

사이트(`html/index.html`, 별도 저장소 `Vibisual/vibisual-site`)의 `ENDPOINT` 상수에
`https://<주소>/px` 를 적는다. 비어 있으면 **요청 자체가 나가지 않는다.**

## 앱에 물리기

`packages/shared/src/constants.ts` 의 `UPDATE_FEED_URL` 에 그 주소를 적고 다음 판올림을 낸다.

```ts
export const UPDATE_FEED_URL = 'https://update.example.com';
```

빌드하지 않고 시험하려면 환경변수로 덮어쓸 수 있다.

```bash
VIBISUAL_UPDATE_FEED_URL=https://<주소> <설치된 Vibisual 실행>
```

안전장치는 앱 쪽에 있다(`packages/shared/src/updateFeed.ts`).

- 주소가 비어 있으면 **아무것도 하지 않는다** — 종전 GitHub 피드 그대로.
- `https` 가 아니면 거절한다(loopback 은 예외). 피드는 "다음에 무엇을 설치할지"를 정하는
  채널이라 평문으로 받으면 중간에서 바꿔치기할 수 있고, 그러면 sha512 검사는 **바뀐 yml 의
  해시**를 검사하므로 아무것도 막지 못한다.
- 켜기 전에 실제로 응답하는지 확인하고, 안 되면 GitHub 으로 둔다. 프록시가 죽어도 업데이트는
  계속된다.

## 어떻게 세는가 (그리고 무엇을 남기지 않는가)

- 하루치 소금(`HASH_SALT` + 그날 날짜)을 섞어 SHA-256 으로 접은 **16자**만 남긴다.
  소금에 날짜가 들어가므로 어제와 오늘의 같은 사람을 이을 수 없다.
- **IP 를 저장하지 않는다.** 계정·쿠키·기기 식별자도 없다 — 앱은 아무것도 보내지 않고,
  우리가 보는 것은 HTTP 요청에 원래 실려 오는 것뿐이다.
- 35일 TTL 로 자동 소멸한다. 지우는 것을 사람이 기억할 필요가 없다.
- 쿼리스트링은 읽지도 기록하지도 않는다.
- `HASH_SALT` 를 안 넣으면 계수 없이 넘겨주기만 한다.

이 내용은 `PRIVACY.md` 의 "Update checks" 절과 **한 벌**이다. 여기 동작을 바꾸면 그 문서도
같이 고쳐야 한다 — 우리가 하는 일과 문서가 어긋나는 순간 그 문서는 지킬 수 없는 약속이 된다.

## 비용

무료 요금제 안이다. 설치 하나가 하루 6~7회 물으므로 하루 10만 요청 한도는 설치 1만 대까지
여유가 있고, 설치 파일은 302 로 GitHub 이 내주므로 대역폭이 들지 않는다. KV 쓰기(하루 1,000회)는
엣지 캐시로 **설치당 하루 1회**까지 줄여 두었다.

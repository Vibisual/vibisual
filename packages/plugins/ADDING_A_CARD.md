# 카드 하나 더 만들기

§5.11 플러그인 커널에 카드를 추가할 때 손대야 하는 자리들. **추측이 아니라, 실제로 시험용 카드를 하나
등록해 보고 어떤 검사가 어떤 순서로 걸리는지 관찰해서 적었다**(v4.36).

검사는 전부 이미 있다. 그러니 이 문서를 안 읽어도 결국 걸리기는 한다 — 다만 실패를 하나씩 겪으며
알아내는 대신 한 번에 끝내라고 적어 둔다.

> **⚠ 이 문서는 한동안 틀린 자리를 가리키고 있었다.** "문자열은 `client/src/i18n/locales/en.json` 에
> 넣어라"고 적혀 있었는데, v4.58 에 카드 문자열은 **각 폴더의 `strings.ts`** 로 옮겨 갔고 로케일 파일에
> 남기면 오히려 검사가 실패하는 상태였다. 문서가 검사와 반대를 말하면 읽은 사람이 더 헤맨다 —
> 계약을 늘릴 때는 이 파일도 같은 커밋에서 고쳐야 한다.

---

## 0. 한 폴더 = 한 카드 (자립 규약)

카드는 **폴더째로 다른 앱에 복사해도 그대로 돌아가야 한다**(언리얼 플러그인과 같은 뜻). 그래서
`src/<plugin-id>/` 안에 네 파일이 함께 산다. 하나라도 없으면 `portability.test.ts` 가 잡는다.

| 파일 | 무엇 |
|---|---|
| `index.tsx` | 카드 본체(판정·행·배지) |
| `enforce.ts` | 켰을 때 매 턴 프롬프트에 실릴 규칙 |
| `strings.ts` | 이 카드의 문자열 전량 — **12개 로케일** |
| `plugin.json` | 디스크립터(= `.uplugin`). 매니페스트와 값이 같아야 한다 |

폴더 밖으로 나가는 상대경로 import 는 **`../sdk/index.js` 하나뿐**이다. 남의 플러그인 폴더를 물면 안 되고,
호스트 타입을 `as { … }`·`as any`·`@ts-ignore` 로 우회해도 안 된다 — 우회한 줄은 호스트가 바뀌어도 빌드가
안 잡아 주고, 그 카드만 조용히 죽는다.

## 1. 카드를 만든다

`src/<plugin-id>/index.tsx` — 폴더명이 곧 플러그인 id 다(검사가 이 규약에 기댄다).

```ts
const inspector = defineInspector({
  id: 'my-card', i18nKey: 'myCard', name: 'My Card', category: 'observability',
  needs: ['agentEvents'],          // 실제로 읽는 축만. 안 읽는 축을 적으면 검사가 잡는다
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => ({ key: 'none', tone: 'neutral' }),
  checks: [...],
  noteKey: () => '.note',
});
export const myCardManifest = inspector.manifest;
export const myCardClient = inspector.client;
```

지켜야 할 것 — 전부 검사가 강제한다.

- **기본 비활성**(`defineInspector` 가 알아서 넣는다). 손으로 만들 때도 `enabledByDefault: false`.
- **판정이 한 값으로 굳으면 안 된다.** 어떤 상황에서도 같은 등급만 내는 카드는 켜도 아무것도 재지 않는
  것이다(`judgmentLiveness.test.ts`). 문턱을 상수만으로 계산하면 이렇게 되기 쉽다 — 실제로 `token-budget`
  이 그랬다. 고정이 **의도**라면 그 파일의 예외 목록에 이유와 함께 적어야 통과한다.
- **이력이 없다는 이유로 경고하지 않는다.** 방금 만든 에이전트는 잘못한 게 없다 →
  `framework/activity.ts` 의 `toneIfActive(ctx)` 를 쓰고, `needs` 에 `agentEvents`·`subAgents` 를 함께 적는다.
- **배지는 기본 설정보다 나쁠 때만.** 모든 버블에 붙는 배지는 참이어도 정보가 아니다.
- 패널 카드를 손으로 쓴다면 **`severity` 를 반드시 선언한다.** 빼면 `neutral` 로 떨어져 접힘 대상이 된다.
- **읽는 데이터 축은 호스트도 알아야 한다.** `needs` 에 새 축을 쓰려면 그 축이
  `client/src/plugins/host.tsx` 에서 구독되고 있어야 한다 — 아니면 카드는 던지지 않고 **빈 값을 그린다**.

## 2. 집행을 만든다 — `enforce.ts`

카드는 표시만 하는 물건이 아니다. 켜면 그 프로젝트 에이전트의 **매 턴 프롬프트에 이 규칙이 실린다.**

```ts
export const enforcement = defineEnforcement({
  id: "my-card",
  title: "한 줄 제목",
  rules: [
    "…하라.",   // 명령형으로. "…을 보여 준다" 같은 관측 문구는 검사가 잡는다
  ],
});
```

- 빈 블록 ❌, 규칙 수 상한 있음, **다른 카드와 같은 말 ❌**. 완전히 같은 문장뿐 아니라 **한 낱말만 바꾼
  문장**도 잡힌다(어절 겹침 0.55) — 두 카드를 함께 켜면 같은 지시가 매 턴 두 번 실려 무게만 나뉜다.
- 프로젝트 사정을 읽어야 하면 호스트가 준 탐침(`ctx.fileExists` · `ctx.readFile`)만 쓴다(`node:fs` ❌).

## 3. 문자열을 넣는다 — `src/<id>/strings.ts` 에 12개 로케일

**로케일 JSON(`client/src/i18n/locales/*.json`)에 카드 문자열을 넣지 마라.** 거기 남아 있으면 자립 규약
검사가 실패한다. 정본은 폴더 안이고, 호스트가 `panel.plugins.<i18nKey>` 지붕 아래로 합친다(키 이름은
종전과 같다).

```ts
export const strings = {
  "en": { "desc": "…", "heading": "…", "level": { … }, "check": { … }, "note": "…" },
  "ko": { … },   // ja · zh-CN · es · es-419 · fr · de · hi · id · it · pt-BR 까지 12개
};
```

빠진 키는 렌더 검사가 **이름을 하나하나 대준다**. en 을 채우고 나면 나머지 11개가 완전 일치 검사에
걸린다(en 이 정본이라 순서가 이렇다). 미번역 키는 영어로 폴백되어 **앱은 멀쩡히 돌기 때문에**,
이 검사가 유일한 방어선이다.

카드가 **새 데이터 축이나 새 기여 종류**를 쓰기 시작하면 그 칩 라벨도 12개 로케일에 있어야 한다
(`panel.plugins.need.*` · `contribution.*` — 이 둘은 호스트 창의 문자열이라 로케일 JSON 에 산다).

## 4. 디스크립터를 적는다 — `plugin.json`

매니페스트와 **값이 같아야** 한다(`id` · `name` · `version` · `category` · `descriptionKey` ·
`enabledByDefault` · `contributes` · `clientOnly` · `needs` · `hostApi`). 어긋나면 검사가 어느 필드인지 짚어 준다.

## 5. 등록한다 — 배럴 네 곳

- `src/registry.ts` : 매니페스트 → `PLUGIN_MANIFESTS`
- `src/client.ts` : 클라이언트 모듈 → `PLUGIN_CLIENT_MODULES`
- `src/prompt.ts` : `enforce.ts` 의 `enforcement` → `PLUGIN_PROMPT_MODULES`
- `src/locales.ts` : `strings.ts` 의 `strings` → 로케일 병합

하나만 빠져도 그 자리에 맞는 검사가 잡는다(1:1 대조 · 집행 전수 · 문자열 커버리지).
import 별칭에는 접두사를 붙인다 — id 중 `eval` 처럼 **식별자로 못 쓰는 낱말**이 있다.

> **서버 라우트가 필요한 카드라면** `src/<id>/server.ts` 에 경로를 선언하고 `src/server.ts` 배럴에 싣는다.
> 호스트 코어(`server/src/services/pluginHost.ts`)에 직접 붙이지 마라 — 그러면 폴더를 복사해도 서버 쪽은
> 따라가지 않는다(자립 규약 ⑥). 카드는 express 도 `node:fs` 도 모른다. 필요한 것은 `PluginServerHost` 로 받는다.

## 6. 대장에 적는다 — 두 곳

- `CATALOG.md` : `- [x] **my-card** — 한 줄 설명` (한 줄에 한 항목. 묶어서 포장하면 검사가 잡는다)
- `src/glossaryTerms.ts` : 원문 용어에서 온 카드면 해당 번호의 `cards` 에, 아니면 `DERIVED_CARDS` 에.
  **출처 없는 카드는 남길 수 없다** — 이 대조가 "원문에서 빠뜨린 항목"을 잡는 유일한 장치라서 그렇다.

## 7. 산문에 박힌 숫자를 고친다

주석·문서 열두 군데가 카드 수를 숫자로 적고 있다. `proseCount.test.ts` 가 전부 짚어 준다.
카드 수가 아닌 것을 세는 줄이면 그 줄에 `count-ok` 를 적는다.

---

## 창이 하는 약속도 맞춰야 한다

Plugins 창은 설명을 누르면 "켜면 뭘 보게 되는가"를 편다. 골격(`defineInspector`)을 쓰면 그 목록이
`checks` 에서 **자동으로 파생**되므로 신경 쓸 것이 없다. 카드를 손으로 쓴다면 `usage.checkKeys` 를 직접
적게 되는데, **거기 적은 행과 실제로 그리는 행이 같아야 한다**(`usage.test.ts` 가 양방향으로 본다).

---

## 확인

```bash
pnpm typecheck
pnpm test
```

루트 명령이 5개 패키지 전부를 돈다. 카드 하나를 넣고 위 단계를 다 하면 초록이 된다.

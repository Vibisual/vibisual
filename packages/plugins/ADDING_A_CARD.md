# 카드 하나 더 만들기

§5.11 플러그인 커널에 카드를 추가할 때 손대야 하는 자리들. **추측이 아니라, 실제로 시험용 카드를 하나
등록해 보고 어떤 검사가 어떤 순서로 걸리는지 관찰해서 적었다**(v4.36).

검사는 전부 이미 있다. 그러니 이 문서를 안 읽어도 결국 걸리기는 한다 — 다만 실패를 하나씩 겪으며
알아내는 대신 한 번에 끝내라고 적어 둔다.

---

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

지켜야 할 것 몇 가지 — 전부 검사가 강제한다.

- **기본 비활성**(`defineInspector` 가 알아서 넣는다). 손으로 만들 때도 `enabledByDefault: false`.
- **이력이 없다는 이유로 경고하지 않는다.** 방금 만든 에이전트는 잘못한 게 없다 →
  `framework/activity.ts` 의 `toneIfActive(ctx)` 를 쓰고, `needs` 에 `agentEvents`·`subAgents` 를 함께 적는다.
- **배지는 기본 설정보다 나쁠 때만.** 모든 버블에 붙는 배지는 참이어도 정보가 아니다.
- 패널 카드를 손으로 쓴다면 **`severity` 를 반드시 선언한다.** 빼면 `neutral` 로 떨어져 접힘 대상이 된다.

## 2. 등록한다 — 두 곳

- `src/registry.ts` : 매니페스트 import + `PLUGIN_MANIFESTS` 배열
- `src/client.ts` : 구현 모듈 import + `PLUGIN_CLIENT_MODULES` 배열

둘 중 하나만 하면 "매니페스트와 클라이언트 모듈이 1:1" 검사가 잡는다.

## 3. 문자열을 넣는다 — 영어 먼저, 그다음 11개

`packages/client/src/i18n/locales/en.json` 의 `panel.plugins.<i18nKey>` 아래.
빠진 키는 렌더 검사가 **이름을 하나하나 대준다**:

```
× my-card — 부르는 키가 en.json 에 전부 있다
+ "panel.plugins.myCard.desc"
+ "panel.plugins.myCard.heading"
+ "panel.plugins.myCard.level.none"   …
```

en 을 채우고 나면 그때부터 **나머지 11개 로케일**이 완전 일치 검사에 걸린다(en 이 정본이라 순서가 이렇다).
미번역 키는 영어로 폴백되어 **앱은 멀쩡히 돌기 때문에**, 이 검사가 유일한 방어선이다.

## 4. 대장에 적는다 — 두 곳

- `CATALOG.md` : `- [x] **my-card** — 한 줄 설명` (한 줄에 한 항목. 묶어서 포장하면 검사가 잡는다)
- `src/glossaryTerms.ts` : 원문 용어에서 온 카드면 해당 번호의 `cards` 에, 아니면 `DERIVED_CARDS` 에.
  **출처 없는 카드는 남길 수 없다** — 이 대조가 "원문에서 빠뜨린 항목"을 잡는 유일한 장치라서 그렇다.

## 5. 산문에 박힌 숫자를 고친다

주석·문서 열두 군데가 카드 수를 숫자로 적고 있다. `proseCount.test.ts` 가 전부 짚어 준다.
카드 수가 아닌 것을 세는 줄이면 그 줄에 `count-ok` 를 적는다.

---

## 확인

```bash
pnpm typecheck
pnpm test
```

루트 명령이 5개 패키지 전부를 돈다. 카드 하나를 넣고 위 다섯 단계를 다 하면 초록이 된다.

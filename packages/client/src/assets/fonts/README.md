# Bundled reading fonts (§5.5)

읽기 설정(IDE 상단 [읽기] 패널)에서 고를 수 있는 글꼴을 **앱에 동봉**한 자리입니다. 예전에는 이름만
부르고 OS 설치에 기댔기 때문에 설치돼 있지 않은 글꼴은 조용히 폴백됐고, 오프라인 데스크톱 앱에서는
사용자가 손쓸 방법이 없었습니다. 지금은 여기 있는 파일을 앱이 직접 싣습니다.

여기에는 두 부류가 삽니다 — 읽기 패널에 **뜨는** 글꼴(위 문단)과, 목록에는 없지만 글자가 사라지지
않게 받쳐 주는 **문자 폴백** 글꼴(아래 표의 마지막 세 줄, §5.5 #17-22 ⑤-3)입니다.

- 내려받기 · CSS 생성: `node packages/client/scripts/fetch-reading-fonts.mjs`
- 생성물: `fonts.css` (손으로 고치지 말고 스크립트를 다시 돌리세요) — `packages/client/src/main.tsx` 가 import 합니다.
- 용량: 13종 · 279 파일 · 약 17.8 MB.
  - 한글은 자모별 조각 대신 **묶음 서브셋 파일**(한글 1개 · 라틴 1개)로 받습니다.
  - 한자·데바나가리는 반대로 **조각별 `unicode-range`** 로 받습니다(SC 101 · JP 124 · Devanagari 3).
    묶음 한 덩어리면 한 글자를 그리려고 수 MB 를 통째로 해독해야 하기 때문입니다. 굵기도 400/700
    두 벌 대신 **가변 축 하나(100–900)** 로 받아 14.3 MB 를 9.5 MB 로 줄였습니다.

## 글꼴과 라이선스

모두 **SIL Open Font License 1.1** 이라 재배포·상업적 사용이 허용됩니다. 각 폴더의 `LICENSE.txt` 가
그 글꼴의 라이선스 전문이며, OFL 의 재배포 조건에 따라 글꼴 파일과 함께 둡니다.

| 폴더 | 글꼴 | 출처 |
|---|---|---|
| `pretendard/` | Pretendard (가변 45–920) | `pretendard` (orioncactus) |
| `noto-sans-kr/` | Noto Sans KR 400/700 | `@fontsource/noto-sans-kr` |
| `nanum-gothic/` | Nanum Gothic 400/700 | `@fontsource/nanum-gothic` |
| `nanum-myeongjo/` | Nanum Myeongjo 400/700 | `@fontsource/nanum-myeongjo` |
| `ibm-plex-sans-kr/` | IBM Plex Sans KR 400/700 | `@fontsource/ibm-plex-sans-kr` |
| `gothic-a1/` | Gothic A1 400/700 | `@fontsource/gothic-a1` |
| `spoqa-han-sans-neo/` | Spoqa Han Sans Neo 400/700 | `spoqa-han-sans` |
| `lexend/` | Lexend (가변 100–900) | `@fontsource-variable/lexend` |
| `atkinson-hyperlegible/` | Atkinson Hyperlegible 400/700 + 기울임 | `@fontsource/atkinson-hyperlegible` |
| `inter/` | Inter (가변 100–900) + 기울임 | `@fontsource-variable/inter` |
| `noto-sans-sc/` | Noto Sans SC (가변 100–900) — **문자 폴백**, 中文 | `@fontsource-variable/noto-sans-sc` |
| `noto-sans-jp/` | Noto Sans JP (가변 100–900) — **문자 폴백**, 日本語 | `@fontsource-variable/noto-sans-jp` |
| `noto-sans-devanagari/` | Noto Sans Devanagari (가변 100–900) — **문자 폴백**, हिन्दी | `@fontsource-variable/noto-sans-devanagari` |

Lexend 와 Atkinson Hyperlegible 은 가독성 연구에서 나온 글꼴이라 읽기 패널이 목록에서 점으로 표시합니다.

마지막 세 벌은 읽기 패널 목록(`READING_FONTS`)에 **넣지 않습니다.** 사용자가 고르는 글꼴이 아니라
`--font-sans`·`--font-mono` 스택 뒤에 서서 두부(□)를 막는 자리이기 때문입니다. 차례는 `<html lang>`
이 정합니다(한자는 코드포인트가 같아도 나라마다 자형이 달라, 섞이면 한 문장 안에서 글꼴이 갈립니다).

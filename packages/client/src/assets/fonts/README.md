# Bundled reading fonts (§5.5)

읽기 설정(IDE 상단 [읽기] 패널)에서 고를 수 있는 글꼴을 **앱에 동봉**한 자리입니다. 예전에는 이름만
부르고 OS 설치에 기댔기 때문에 설치돼 있지 않은 글꼴은 조용히 폴백됐고, 오프라인 데스크톱 앱에서는
사용자가 손쓸 방법이 없었습니다. 지금은 여기 있는 파일을 앱이 직접 싣습니다.

- 내려받기 · CSS 생성: `node packages/client/scripts/fetch-reading-fonts.mjs`
- 생성물: `fonts.css` (손으로 고치지 말고 스크립트를 다시 돌리세요) — `packages/client/src/main.tsx` 가 import 합니다.
- 용량: 10종 · 43 파일 · 약 7.2 MB. 한글은 자모별 조각 대신 **묶음 서브셋 파일**(한글 1개 · 라틴 1개)로 받습니다.

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

Lexend 와 Atkinson Hyperlegible 은 가독성 연구에서 나온 글꼴이라 읽기 패널이 목록에서 점으로 표시합니다.

# 배포 채널

GitHub 릴리스 말고 **사람들이 실제로 앱을 찾는 자리**에 올리기 위한 매니페스트.
`.github/scripts/build-packaging-manifests.mjs` 가 릴리스 하나에서 세 채널 것을 한 번에 짓는다.

```bash
node .github/scripts/build-packaging-manifests.mjs v0.1.23
#   → packaging/generated/{winget,homebrew,flathub}/
```

## 해시는 다시 받아서 구하지 않는다

세 채널 모두 매니페스트에 sha256 을 적어야 한다. 그 값을 구하려고 설치본을 내려받으면
**릴리스 다운로드 수가 다시 오염된다** — 2026-09-07 에 스모크에서 그것을 걷어냈는데 같은
숫자를 다른 문으로 채우는 셈이다. 그래서 릴리스 잡이 지은 직후에 계산해
`SHA256SUMS.txt` 를 자산으로 발행하고(`release.yml` 의 `Publish SHA256SUMS.txt`),
생성기는 그 몇 KB 짜리 텍스트만 읽는다. `check-release-assets.mjs` 가 그 자산의 존재를
공개 게이트에서 센다 — 없으면 발행되지 않는다.

## 채널별 상태

| 채널 | 상태 | 막는 것 |
|---|---|---|
| **winget** (Windows) | 포크는 준비됨 | `WINGET_FORK_TOKEN`(PAT). 포크에 밀고 상류에 PR 을 여는 데 필요하다 |
| **Homebrew — 우리 tap** (macOS) | **켜져 있다** | 없음. 저장소·배포키 모두 준비돼 있다 |
| **Homebrew — 공식 cask** | **막혀 있다** | 인지도 요건(별 75 · 포크 30 · 워처 30 중 하나). 현재 별 1 |
| **Flathub** (Linux) | 사람 손이 한 번 필요하다 | 첫 제출은 리뷰 과정이다. 매니페스트는 여기서 짓는다 |

공식 Homebrew cask 는 요건을 넘기 전에는 열어도 닫힌다. 그 사이의 답은 **우리 tap** 이다 —
사용자는 `brew tap Vibisual/tap && brew install --cask vibisual` 로 설치하고, 요건을 넘긴
뒤에는 **같은 캐스크 파일을** 공식 저장소에 그대로 올리면 된다.

## 제출

- **winget** — `.github/workflows/packaging.yml` 이 릴리스 공개 뒤 자동으로 PR 을 연다.
  포크(`Vibisual/winget-pkgs`)는 만들어 두었고, 남은 것은 `WINGET_FORK_TOKEN` 시크릿뿐이다
  (그 포크에 쓰고 `microsoft/winget-pkgs` 에 PR 을 열 수 있는 PAT). 여기만 배포키를 못 쓴다 —
  배포키는 저장소에 밀 수는 있어도 **남의 저장소에 PR 을 열지는 못하기** 때문이다.
  없으면 매니페스트만 아티팩트로 남기고 조용히 지나간다.
- **Homebrew tap** — 같은 워크플로가 `Vibisual/homebrew-tap` 의 `Casks/vibisual.rb` 를
  갱신한다. **PAT 이 아니라 배포키**(`TAP_DEPLOY_KEY`)로 민다 — PAT 은 그 계정이 닿는 모든
  저장소에 쓸 수 있어 캐스크 한 줄을 고치는 일에 견주면 권한이 과하고, 배포키는 이 tap
  하나에만 유효해 새더라도 그 저장소에서 키를 지우는 것으로 끝난다. 이미 걸려 있다.
- **Flathub** — `flathub/flathub` 에 새 브랜치로 PR 을 여는 1회성 과정이다.
  `packaging/generated/flathub/` 의 세 파일이 그 PR 의 내용이고, `extra-data` 의 `size` 가
  0 이면 실제 바이트 수로 채워야 한다(생성기가 릴리스에서 읽어 채우지만, `--sums` 로
  로컬에서 지으면 알 수 없어 0 으로 남는다).

## 미서명 배포에서 각 채널이 겪는 일

아직 코드 서명 인증서가 없다. 채널마다 증상이 다르므로 적어 둔다 — 서명이 붙으면 셋 다 사라진다.

- **winget** — 설치는 된다. Windows SmartScreen 이 "알 수 없는 게시자" 경고를 띄운다.
- **Homebrew cask** — 받은 파일에 격리 속성이 붙어 Gatekeeper 가 첫 실행을 막는다.
  `--no-quarantine` 로 넘길 수 있지만 그건 사용자가 고를 일이고 캐스크가 끌 수 있는 것이 아니다.
- **Flathub** — 서명과 무관하다. Flatpak 은 자체 샌드박스와 서명 체계를 쓴다.

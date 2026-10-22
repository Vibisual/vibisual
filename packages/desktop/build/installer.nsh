; Vibisual 설치 프로그램에 끼워 넣는 NSIS 스크립트 — electron-builder.yml 의 `nsis.include`.
; 하는 일 둘: ① preInit — 새 설치가 가끔 0xC0000005 로 죽는 것을 비껴간다(바로 아래)
;            ② licensePage — 설치 언어를 고른 뒤 그 언어의 사용권 계약에 동의해야 설치한다(맨 아래).
;
; ☠️ 왜 있나 — 새 설치에서 설치 프로그램이 가끔 0xC0000005 로 죽는다(아무것도 설치하지 않고 끝난다).
;   electron-builder 24.13.3 의 multiUser.nsh(setInstallModePerUser)는 레지스트리에 이전 설치 위치가
;   없을 때(= 새 설치) 기본 폴더를 SHGetKnownFolderPath 로 받아 그 문자열을
;       System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'
;   로 읽는다. electron-builder 가 쓰는 NSIS 3.04 빌드는 NSIS_MAX_STRLEN=8192 라, 수십 바이트짜리 문자열
;   뒤로 16,384바이트를 통째로 복사한다. 그 문자열이 커밋된 메모리 끝 가까이에 놓이면 System.dll 의
;   복사 루프가 원본을 읽다가 죽는다(System.dll+0x1581 `mov al,[ecx+edx]`).
;   - 2026-09-13 스모크: Windows 설치 23회 중 6회. 같은 설치본이 러너마다 통과·실패가 갈렸다.
;   - 문자열을 페이지 끝에 두고 같은 줄을 부르면 매번 0xC0000005 로 죽는다(재현함).
;   상위는 app-builder-lib 26.x 에서 이 줄을 lstrcpynW 로 바꿨다. 24→26 판올림 대신 여기서 비껴간다.
;
; 어떻게 — .onInit 맨 앞(preInit)에서, 이전 설치 위치가 비어 있을 때만 템플릿과 **같은** 기본 폴더를
;   안전하게 계산해 InstallLocation 에 먼저 적는다(lstrcpynW 는 NUL 에서 멈춘다). 그러면 템플릿은
;   레지스트리 값을 읽는 분기로 가서 문제의 줄을 타지 않는다. 설치 폴더는 전과 같다.
;   - 이미 깔린 사람(자동 업데이트)은 값이 있으므로 여기서 아무것도 하지 않는다.
;   - /D= 로 폴더를 지정하면 템플릿이 이 뒤에 덮어쓴다 — 동작은 그대로다.
;   - 설치 단계(installer.nsh 의 registryAddInstallInfo)가 최종 $INSTDIR 로 같은 값을 다시 쓰고,
;     이전 판 제거(uninstallOldVersion)는 Uninstall 키가 없으면 이 값을 보기 전에 끝난다.
;   - HKCU\Software 는 32·64비트 레지스트리 보기가 공유하는 자리라, 템플릿이 64 보기로 바꾸기 전에
;     적어도 같은 값을 읽는다.
;
; ⚠️ electron-builder 는 makensis 를 -WX(경고도 오류)로 부른다 — 여기서 경고가 하나라도 나면 Windows 빌드가 멈춘다.
; ⚠️ 제거 프로그램을 만드는 단계(BUILD_UNINSTALLER)도 같은 .onInit 에서 preInit 을 부르고, 그 실행 파일은
;    **빌드 기계에서 실행된다.** 그래서 그 단계에서는 아무것도 하지 않는다(빌드 PC 레지스트리에 값을 남기지 않게).
; 계약 시험: packages/server/src/releasePackaging.test.ts 「Windows 설치 프로그램」.

!macro preInit
  !ifndef BUILD_UNINSTALLER
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
      StrCpy $0 "$LocalAppData\Programs"
      StrCpy $2 0
      ; 사용자별 Program Files 는 기본 위치가 아닐 수 있다 — 템플릿과 같은 known folder 를 묻는다.
      System::Call 'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'
      ${If} $1 == 0
        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'
      ${EndIf}
      ; 실패해도 메모리를 돌려줄 수 있다.
      ${If} $2 != 0
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      ${EndIf}
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$0\${APP_FILENAME}"
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  !endif
!macroend

; ─────────────────────────────────────────────────────────────────────────────
; 설치 언어 고르기 → 사용권 계약 동의 (2026-10-13, 사용자 지시 — "다른 시중 앱들처럼", "그 전에 언어를 고르게")
;
; 순서: .onInit 의 언어 선택 창(electron-builder.yml `nsis.displayLanguageSelector: true` → 템플릿이 preInit 다음에
;   MUI_LANGDLL_DISPLAY 를 부른다. 기본 선택은 OS 언어) → 아래 licensePage(고른 언어의 약관 요약 + 동의 체크 → [설치])
;   → 설치. 동의 화면 안에서 언어를 바꾸는 손잡이는 표준 MUI 화면에 없다 — 그래서 앞에서 고르게 했다.
;
; 업데이트는 전처럼 조용하다:
;   - 언어 창은 무인(/S) 설치면 뜨지 않는다(MUI2 Localization.nsh 의 MUI_LANGDLL_DISPLAY 가 ${Silent} 를 본다).
;   - 동의 화면은 --updated 면 건너뛴다(oneClick.nsh 가 licensePage 앞에 skipPageIfUpdated 를 넣는다).
;   - 자동 업데이트(quitAndInstall(true, true) · 종료 시 설치)·smoke.yml·/reinstall 은 전부 /S 로 돈다.
;
; ⚠️ 약관 파일을 buildResources(packages/desktop/resources/)에 `license_*.txt` 로 두지 마라.
;   그렇게 두면 electron-builder 가 동의 화면을 알아서 만들어 주지만, dmg-builder 의 addLicenseToDmg 도 같은 파일을
;   보고 dmg 에 동의 창(SLA)을 조건 없이 붙인다. 그러면 `hdiutil attach` 가 동의 입력을 기다려 macOS 자체 업데이트
;   (packages/desktop/src/main/macSelfInstall.ts)·smoke·try-mac·reinstall-mac 이 멈춘다 — 비대화로 수락하는 공식
;   수단이 없다. 그래서 파일은 build/license/ 에 두고 licensePage 매크로를 여기서 직접 정의한다(electron-builder 는
;   license 파일을 못 찾으면 이 매크로를 만들지 않으므로 겹치지 않는다).
; ⚠️ 언어 목록은 electron-builder.yml `nsis.installerLanguages` 와 한 몸이다. 거기 있는 언어마다 아래 LicenseLangString
;   이 하나씩 있어야 한다 — 하나라도 빠지면 makensis 가 "not set in language table" 경고를 내고, -WX 라 빌드가 멈춘다.
;   번호는 electron-builder util/langs.js 의 lcid 와 같다(es_ES 는 SpanishInternational = 3082).
; ⚠️ 약관 파일은 UTF-8 BOM 으로 저장한다 — BOM 이 없으면 NSIS 가 ANSI 로 읽어 한글·일본어·중국어가 깨진다.
; 계약 시험: packages/server/src/releasePackaging.test.ts 「설치 동의 화면」.

; 코드페이지가 다른 언어도 목록에 남긴다. 이 정의가 없으면 LangDLL 이 시스템 코드페이지로 걸러서
; 한국어 Windows 에서 일본어·중국어·유럽어가 목록에서 사라진다(유니코드 설치기라 거를 까닭이 없다).
!define MUI_LANGDLL_ALLLANGUAGES

!macro licensePage
  ; 체크해야 [설치]가 켜진다 — 시중 설치기의 "위 약관에 동의합니다" 칸.
  !define MUI_LICENSEPAGE_CHECKBOX
  ; 동의 다음은 곧바로 설치라 단추 이름도 [설치]로 둔다.
  !define MUI_LICENSEPAGE_BUTTON "$(^InstallBtn)"
  LicenseLangString MUILicense 1033 "${PROJECT_DIR}\build\license\license_en_US.txt"
  LicenseLangString MUILicense 1042 "${PROJECT_DIR}\build\license\license_ko_KR.txt"
  LicenseLangString MUILicense 1041 "${PROJECT_DIR}\build\license\license_ja_JP.txt"
  LicenseLangString MUILicense 2052 "${PROJECT_DIR}\build\license\license_zh_CN.txt"
  LicenseLangString MUILicense 1031 "${PROJECT_DIR}\build\license\license_de_DE.txt"
  LicenseLangString MUILicense 1036 "${PROJECT_DIR}\build\license\license_fr_FR.txt"
  LicenseLangString MUILicense 3082 "${PROJECT_DIR}\build\license\license_es_ES.txt"
  LicenseLangString MUILicense 1046 "${PROJECT_DIR}\build\license\license_pt_BR.txt"
  LicenseLangString MUILicense 1040 "${PROJECT_DIR}\build\license\license_it_IT.txt"
  LicenseLangString MUILicense 1057 "${PROJECT_DIR}\build\license\license_id_ID.txt"
  LicenseLangString MUILicense 1081 "${PROJECT_DIR}\build\license\license_hi_IN.txt"
  !insertmacro MUI_PAGE_LICENSE "$(MUILicense)"
!macroend

; ─────────────────────────────────────────────────────────────────────────────
; 제거할 때 Claude Code·코덱스 설정에 남은 우리 훅을 걷는다 (2026-10-22, 사용자 지시 — SCENARIO §3.6 「수명」 · §5.7 #24-3 ⑤)
;
; 왜: 우리 훅은 앱이 켜져 있는 동안만 둔다 — 앱은 끌 때 스스로 걷는다. 그런데 앱이 팅겼거나, 제거기의 "앱 실행 중"
;   처리가 앱을 강제로 끝냈으면(taskkill /f) 걷을 기회가 없었다. 그대로 파일을 지우면 훅이 부를 handler.mjs 가 사라져
;   이 PC 의 모든 Claude Code 세션에 오류 알림이 남는다.
; 어떻게: 사용자 확인과 "앱 실행 중" 처리가 끝난 뒤(un.onInit 의 끝 — customUnInit), 파일을 지우기 **전**에 앱을
;   `--vibisual-remove-hooks` 로 한 번 부른다. 앱의 시작 진입점(bootstrap.ts)이 그 인자를 보면 잠금·창·서버 없이
;   저장된 포트를 가리키는 우리 훅만 걷고(모든 설정 홈 · 상태 줄 되돌리기 · 코덱스 전역 훅) 끝난다(hookCleanup.ts).
;   인자 글자는 packages/desktop/src/main/hookLifecycle.ts 의 HOOK_CLEANUP_ARG 와 같다.
; 업데이트(--updated)면 건너뛴다 — 설치기는 옛 판을 지울 때 늘 이 표시를 붙이고, 그때는 앱이 끌 때 이미 걷었으며
;   새 판이 켜지며 다시 깐다.
; 30초 상한(nsExec /TIMEOUT) — 앱이 어떤 이유로 멎어도 제거가 멈추지 않는다. 결과는 버린다 — 걷지 못해도 제거는 계속한다.
; 계약 시험: packages/server/src/releasePackaging.test.ts 「제거기 — 남은 훅을 걷는다」.
!macro customUnInit
  ${ifNot} ${isUpdated}
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      Push $0
      nsExec::Exec /TIMEOUT=30000 `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --vibisual-remove-hooks`
      Pop $0
      Pop $0
    ${EndIf}
  ${endIf}
!macroend

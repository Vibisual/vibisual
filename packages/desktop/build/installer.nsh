; Vibisual 설치 프로그램에 끼워 넣는 NSIS 스크립트 — electron-builder.yml 의 `nsis.include`.
; 하는 일: ① preInit — 새 설치가 가끔 0xC0000005 로 죽는 것을 비껴간다 ② licensePage — 고른 언어의 사용권 계약 동의
;   ③ customUnInit — 제거 때 남은 훅을 걷는다.
;
; ① 왜: electron-builder 24.13.3 multiUser.nsh 는 새 설치(이전 위치 없음)에서 SHGetKnownFolderPath 결과를
;       System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'
;   로 읽어 문자열 뒤 16,384바이트를 통째로 복사한다(NSIS_MAX_STRLEN=8192) — 커밋된 메모리 끝 근처면 System.dll 이 죽는다.
;   2026-09-13 스모크: Windows 설치 23회 중 6회. 상위는 app-builder-lib 26.x 에서 lstrcpynW 로 고쳤다 — 판올림 대신 여기서 비껴간다.
; 어떻게: 이전 위치가 비었을 때만 템플릿과 같은 기본 폴더를 lstrcpynW 로 안전하게 구해 InstallLocation 에 먼저 적는다 —
;   템플릿은 레지스트리 값을 읽는 분기로 가 문제의 줄을 안 탄다. 설치 폴더·자동 업데이트·/D= 동작은 그대로이고,
;   설치 단계(registryAddInstallInfo)가 최종 $INSTDIR 로 같은 값을 다시 쓴다.
;   HKCU\Software 는 32·64비트 보기가 공유하는 자리라 템플릿이 64 보기로 바꾸기 전에도 같은 값을 읽는다.
;
; ⚠️ makensis 는 -WX(경고도 오류)로 불린다 — 경고 하나로 Windows 빌드가 멈춘다.
; ⚠️ BUILD_UNINSTALLER 단계도 preInit 을 부르고 그 실행 파일은 빌드 기계에서 돈다 — 그 단계에선 아무것도 하지 않는다.
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

; ② 설치 언어 고르기 → 사용권 계약 동의. 순서: .onInit 의 언어 선택 창(`nsis.displayLanguageSelector: true` — 템플릿이
;   preInit 다음에 MUI_LANGDLL_DISPLAY 를 부른다, 기본은 OS 언어) → licensePage(약관 + 동의 체크 → [설치]) → 설치.
;   표준 MUI 동의 화면엔 언어를 바꾸는 손잡이가 없어 앞에서 고르게 한다.
; 업데이트는 조용하다 — 언어 창은 /S 면 안 뜨고(${Silent}), 동의 화면은 --updated 면 건너뛴다(skipPageIfUpdated).
;   자동 업데이트·smoke.yml·/reinstall 은 전부 /S 로 돈다.
; ⚠️ 약관 파일을 buildResources(packages/desktop/resources/)에 `license_*.txt` 로 두지 마라 — dmg-builder 의 addLicenseToDmg 가
;   dmg 에 동의 창(SLA)을 붙여 `hdiutil attach` 가 입력을 기다리고, macOS 자체 업데이트(macSelfInstall.ts)·smoke·try-mac·
;   reinstall-mac 이 멈춘다. 그래서 build/license/ 에 두고 licensePage 를 여기서 정의한다(electron-builder 의 것과 안 겹친다).
; ⚠️ 언어 목록은 electron-builder.yml `nsis.installerLanguages` 와 한 몸 — 언어마다 LicenseLangString 이 있어야 한다
;   (빠지면 "not set in language table" 경고 → -WX 로 빌드 정지). 번호는 electron-builder util/langs.js 의 lcid(es_ES = 3082).
; ⚠️ 약관 파일은 UTF-8 BOM — 없으면 NSIS 가 ANSI 로 읽어 한글·일본어·중국어가 깨진다.
; 계약 시험: packages/server/src/releasePackaging.test.ts 「설치 동의 화면」.

; 코드페이지가 다른 언어도 목록에 남긴다 — 없으면 LangDLL 이 시스템 코드페이지로 걸러 한국어 Windows 에서 일본어·중국어·유럽어가 사라진다.
!define MUI_LANGDLL_ALLLANGUAGES

!macro licensePage
  ; 체크해야 [설치]가 켜진다.
  !define MUI_LICENSEPAGE_CHECKBOX
  ; 동의 다음이 곧바로 설치라 단추도 [설치].
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

; ③ 제거할 때 Claude Code·코덱스 설정에 남은 우리 훅을 걷는다(SCENARIO §3.6 「수명」 · §5.7 #24-3 ⑤).
; 왜: 훅은 앱이 끌 때 스스로 걷지만, 앱이 팅겼거나 제거기가 강제로 끝냈으면(taskkill /f) 남는다 — 그대로 파일을 지우면
;   훅이 부를 handler.mjs 가 사라져 이 PC 의 모든 Claude Code 세션에 오류 알림이 남는다.
; 어떻게: "앱 실행 중" 처리 뒤(un.onInit 끝 — customUnInit), 파일을 지우기 전에 앱을 `--vibisual-remove-hooks` 로 부른다 —
;   bootstrap.ts 가 그 인자를 보면 잠금·창·서버 없이 우리 훅만 걷고 끝난다(hookCleanup.ts). 인자 글자는 hookLifecycle.ts 의 HOOK_CLEANUP_ARG.
; --updated 면 건너뛴다(앱이 끌 때 이미 걷었고 새 판이 다시 깐다). 30초 상한, 결과는 버린다 — 걷지 못해도 제거는 계속한다.
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

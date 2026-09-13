; Vibisual 설치 프로그램에 끼워 넣는 NSIS 스크립트 — electron-builder.yml 의 `nsis.include`.
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

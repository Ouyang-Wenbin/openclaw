; OpenClaw NSIS installer script.
; Built by: pnpm windows:installer (scripts/package-windows.mjs runs makensis with SOURCE_DIR and VERSION).

!ifndef SOURCE_DIR
!define SOURCE_DIR "dist\openclaw-win32-x64-portable"
!endif
!ifndef VERSION
!define VERSION "0.0.0"
!endif

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "OpenClaw"
OutFile "dist\OpenClaw-${VERSION}-setup.exe"
Unicode True
RequestExecutionLevel admin
InstallDir "$PROGRAMFILES64\OpenClaw"
InstallDirRegKey HKLM "Software\OpenClaw" "InstallPath"

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIR
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "OpenClaw" SecMain
  SetOutPath $INSTDIR
  File /r "${SOURCE_DIR}\*.*"
  SetOutPath $INSTDIR

  ; Desktop shortcut (openclaw.cmd)
  CreateShortCut "$DESKTOP\OpenClaw.lnk" "$INSTDIR\openclaw.cmd" "" "$INSTDIR" SW_SHOWNORMAL

  ; Start menu shortcut
  CreateDirectory "$SMPROGRAMS\OpenClaw"
  CreateShortCut "$SMPROGRAMS\OpenClaw\OpenClaw.lnk" "$INSTDIR\openclaw.cmd" "" "$INSTDIR" SW_SHOWNORMAL
  CreateShortCut "$SMPROGRAMS\OpenClaw\Uninstall OpenClaw.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR" SW_SHOWNORMAL

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Registry for Add/Remove Programs and install path
  WriteRegStr HKLM "Software\OpenClaw" "InstallPath" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw" "DisplayName" "OpenClaw"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw" "Publisher" "OpenClaw"
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\OpenClaw.lnk"
  Delete "$SMPROGRAMS\OpenClaw\OpenClaw.lnk"
  Delete "$SMPROGRAMS\OpenClaw\Uninstall OpenClaw.lnk"
  RMDir "$SMPROGRAMS\OpenClaw"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "Software\OpenClaw"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw"
SectionEnd

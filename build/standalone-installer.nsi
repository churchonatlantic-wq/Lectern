; Lectern Windows installer. Built with makensis (works on Windows, macOS and Linux, no Wine needed).
;   makensis -DVERSION=1.0.0 -DSRCDIR=dist/win-unpacked -DOUTFILE=dist/Lectern-Setup-1.0.0.exe build/standalone-installer.nsi
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APPNAME "Lectern"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel admin
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Lectern"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Lectern"
!define MUI_FINISHPAGE_SHOWREADME "https://ndi.video/tools/"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Get NDI Tools (needed for NDI outputs)"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Lectern needs 64-bit Windows 10 or later."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Lectern" SecMain
  SectionIn RO
  ; close a running copy so files can be replaced
  nsExec::Exec 'taskkill /IM "${APPNAME}.exe" /F'
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall ${APPNAME}.exe"

  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"

  ; .lectern service files open in Lectern
  WriteRegStr HKLM "Software\Classes\.lectern" "" "Lectern.Service"
  WriteRegStr HKLM "Software\Classes\Lectern.Service" "" "Lectern Service"
  WriteRegStr HKLM "Software\Classes\Lectern.Service\DefaultIcon" "" "$INSTDIR\${APPNAME}.exe,0"
  WriteRegStr HKLM "Software\Classes\Lectern.Service\shell\open\command" "" '"$INSTDIR\${APPNAME}.exe" "%1"'

  WriteRegStr HKLM "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${REGKEY}" "Publisher" "Lectern"
  WriteRegStr HKLM "${REGKEY}" "DisplayIcon" "$INSTDIR\${APPNAME}.exe"
  WriteRegStr HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall ${APPNAME}.exe"'
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1

  ; let Lectern through the Windows firewall (NDI and the phone remote)
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="${APPNAME}" dir=in action=allow program="$INSTDIR\${APPNAME}.exe" enable=yes profile=private,domain'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${APPNAME}.exe" /F'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Classes\.lectern"
  DeleteRegKey HKLM "Software\Classes\Lectern.Service"
  DeleteRegKey HKLM "Software\${APPNAME}"
  DeleteRegKey HKLM "${REGKEY}"
SectionEnd

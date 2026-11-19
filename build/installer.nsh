; Extra steps for electron-builder's standard NSIS installer (picked up automatically from build/installer.nsh).
; Lets Lectern through the Windows firewall for NDI and the phone remote.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Lectern"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Lectern" dir=in action=allow program="$INSTDIR\Lectern.exe" enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Lectern"'
!macroend

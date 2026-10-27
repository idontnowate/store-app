; installer.nsi — ملف تثبيت برنامج إدارة المتجر لويندوز (يُبنى بـ makensis)
; يثبت لهذا المستخدم فقط فلا يحتاج صلاحيات المدير، ويضع أيقونة على سطح المكتب وقائمة ابدأ
Unicode true
!include "MUI2.nsh"
!include "version.nsh"

!define APPNAME "إدارة المتجر"
!define COMPANY "IP TECH WORLD"
!define EXE "IPStore.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\IPStore"

Name "${APPNAME}"
OutFile "..\dist\IPStore-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\IPStore"
InstallDirRegKey HKCU "Software\IPStore" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${COMPANY}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© ${COMPANY}"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل البرنامج الآن"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

Section "Install"
    ; نغلق البرنامج إن كان مفتوحًا، حتى يمكن استبدال ملفاته عند التحديث
    nsExec::Exec 'taskkill /IM ${EXE} /F'
    SetOutPath "$INSTDIR"
    File /r "..\dist\win-unpacked\*.*"
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}"
    CreateDirectory "$SMPROGRAMS\${APPNAME}"
    CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}"
    CreateShortcut "$SMPROGRAMS\${APPNAME}\إزالة البرنامج.lnk" "$INSTDIR\Uninstall.exe"

    WriteRegStr HKCU "Software\IPStore" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
    WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
    WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${REGKEY}" "Publisher" "${COMPANY}"
    WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
    WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
    nsExec::Exec 'taskkill /IM ${EXE} /F'
    Delete "$DESKTOP\${APPNAME}.lnk"
    RMDir /r "$SMPROGRAMS\${APPNAME}"
    RMDir /r "$INSTDIR"
    DeleteRegKey HKCU "${REGKEY}"
    DeleteRegKey HKCU "Software\IPStore"
    ; التشغيل مع ويندوز (إن فعّله المستخدم)
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.إدارة المتجر"
SectionEnd

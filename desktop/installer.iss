; Установщик «Нитеграф» для Windows (Inno Setup 6).
; Собирается после PyInstaller: iscc /DAppVersion=1.2.3 desktop\installer.iss
; Ставится в профиль пользователя (права администратора не нужны).

#define AppName "Нитеграф"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{8C2C9E5E-6E0B-4F1A-9B7F-3C1F2D4A9B10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Aleksandr Zheleznoy
AppPublisherURL=https://github.com/alzhelez/string_art
DefaultDirName={localappdata}\Programs\Nitegraf
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Nitegraf-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Nitegraf.exe
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; при обновлении убираем библиотеки прошлой версии (портреты лежат отдельно, в %LOCALAPPDATA%\Nitegraf)
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\Nitegraf\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\Nitegraf.exe"
Name: "{group}\Удалить {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Nitegraf.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Nitegraf.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

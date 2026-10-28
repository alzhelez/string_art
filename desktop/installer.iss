; Установщик «Нитеграф» для Windows (Inno Setup 6).
; Собирается после PyInstaller: iscc /DAppVersion=1.2.3 desktop\installer.iss
; Ставится в профиль пользователя (права администратора не нужны).

; Название программы — используется в нескольких местах ниже
#define AppName "Нитеграф"
; Если версию не передали при сборке (/DAppVersion=…)
#ifndef AppVersion
  ; …берём версию по умолчанию
  #define AppVersion "1.0.0"
; Конец условия
#endif

; Основные параметры установщика
[Setup]
; Постоянный уникальный id программы: по нему новая версия ставится поверх старой (двойная { — экранирование)
AppId={{8C2C9E5E-6E0B-4F1A-9B7F-3C1F2D4A9B10}
; Название в мастере установки
AppName={#AppName}
; Версия
AppVersion={#AppVersion}
; Название с версией (в списке программ)
AppVerName={#AppName} {#AppVersion}
; Издатель
AppPublisher=Aleksandr Zheleznoy
; Сайт издателя (ссылка в «Программы и компоненты»)
AppPublisherURL=https://github.com/alzhelez/string_art
; Папка установки — в профиле пользователя, права администратора не нужны
DefaultDirName={localappdata}\Programs\Nitegraf
; Папка в меню «Пуск»
DefaultGroupName={#AppName}
; Не спрашивать про папку в меню «Пуск»
DisableProgramGroupPage=yes
; Устанавливать без прав администратора
PrivilegesRequired=lowest
; Куда положить готовый установщик
OutputDir=..\dist
; Имя файла установщика (Nitegraf-Setup.exe)
OutputBaseFilename=Nitegraf-Setup
; Значок установщика
SetupIconFile=icon.ico
; Значок в списке установленных программ
UninstallDisplayIcon={app}\Nitegraf.exe
; Название в списке установленных программ
UninstallDisplayName={#AppName}
; Максимальное сжатие
Compression=lzma2/max
; Сжатие всех файлов одним блоком (меньше размер)
SolidCompression=yes
; Современный вид мастера
WizardStyle=modern
; Только 64-битная Windows
ArchitecturesAllowed=x64compatible
; Устанавливать в 64-битном режиме
ArchitecturesInstallIn64BitMode=x64compatible
; Предложить закрыть запущенную программу перед обновлением
CloseApplications=yes

; Язык мастера установки
[Languages]
; Русский
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

; Дополнительные галочки в мастере
[Tasks]
; «Создать значок на рабочем столе»
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

; Что удалить перед установкой
[InstallDelete]
; при обновлении убираем библиотеки прошлой версии (портреты лежат отдельно, в %LOCALAPPDATA%\Nitegraf)
; Папка библиотек прошлой версии
Type: filesandordirs; Name: "{app}\_internal"

; Какие файлы ставить
[Files]
; Всё содержимое сборки PyInstaller со всеми подпапками
Source: "..\dist\Nitegraf\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Ярлыки
[Icons]
; Ярлык в меню «Пуск»
Name: "{group}\{#AppName}"; Filename: "{app}\Nitegraf.exe"
; Ярлык удаления в меню «Пуск»
Name: "{group}\Удалить {#AppName}"; Filename: "{uninstallexe}"
; Ярлык на рабочем столе (если отмечена галочка)
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Nitegraf.exe"; Tasks: desktopicon

; Что запустить после установки
[Run]
; Галочка «Запустить Нитеграф» в конце установки
Filename: "{app}\Nitegraf.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; LiquidSpectra - Windows installer (Inno Setup 6)
; Compile from the repo root:
;   & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' installer\LiquidSpectra.iss
; Source: and OutputDir: paths are relative to this file (installer/).

#define MyAppName "LiquidSpectra"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "LiquidAudio"
#define MyAppURL "https://github.com/Rafthouse/LiquidSpectra"
#define MyAppExeName "LiquidSpectra.exe"

[Setup]
AppId={{7A0B3E2F-9C4D-4E5F-8A1B-2C3D4E5F6A7B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist-windows
OutputBaseFilename=LiquidSpectra-{#MyAppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; VST3 bundle -> C:\Program Files\Common Files\VST3\LiquidSpectra.vst3
Source: "..\build\LiquidSpectra_artefacts\Release\VST3\LiquidSpectra.vst3\*"; DestDir: "{commoncf}\VST3\LiquidSpectra.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs
; Standalone app -> C:\Program Files\LiquidSpectra\
Source: "..\build\LiquidSpectra_artefacts\Release\Standalone\LiquidSpectra.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch LiquidSpectra"; Flags: nowait postinstall skipifsilent

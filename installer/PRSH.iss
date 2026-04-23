; Inno Setup script for ProjectRioStreamHelper (PRSH).
;
; Produces PRSH-Setup.exe which installs the PyInstaller-built app into
; Program Files, adds Start Menu / Desktop shortcuts, and registers an
; uninstaller.
;
; Invoked by .github/workflows/build-release.yml after PyInstaller finishes.
; Expects the onedir output at dist\PRSH\ (relative to repo root) and the
; app version passed in via /DAppVersion=X.Y.Z.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "ProjectRioStreamHelper"
#define AppShortName "PRSH"
#define AppPublisher "Project Rio"
#define AppExeName "PRSH.exe"

[Setup]
; A unique GUID identifies this app to the Windows installer registry.
; Never change this after the first release or upgrades will break.
AppId={{B6F1E4A2-8D3C-4E7A-A5F2-9C1B3D8E6F47}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/matt-gree/ProjectRioStreamHelper
AppSupportURL=https://github.com/matt-gree/ProjectRioStreamHelper/issues
DefaultDirName={autopf}\{#AppShortName}
DefaultGroupName={#AppShortName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
OutputBaseFilename=PRSH-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; Bundle everything PyInstaller produced under dist\PRSH\ (includes _internal\).
Source: "..\dist\PRSH\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppShortName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppShortName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppShortName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon
; Friendly-named uninstaller shortcut placed next to the app, so users who
; open the install folder can launch the uninstaller without hunting down
; the default unins000.exe.
Name: "{app}\Uninstall {#AppShortName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppShortName}"; Flags: nowait postinstall skipifsilent

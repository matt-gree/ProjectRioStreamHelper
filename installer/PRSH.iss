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
SetupIconFile=..\public\logo.ico
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; Bundle everything PyInstaller produced under dist\PRSH\ (includes _internal\).
; Note: the gc-overlay controller input display is macOS-only and is not built
; or bundled on Windows (PRSH.spec gates it on Darwin), so it is intentionally
; absent here — the in-app UI hides the feature on Windows as well.
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
; The in-app updater (server/updater.py) runs this installer /SILENT, which
; skips the postinstall entry above — so it asks for the relaunch explicitly.
; runasoriginaluser: the installer is elevated, PRSH must not be.
Filename: "{app}\{#AppExeName}"; Parameters: "--after-update"; Flags: nowait runasoriginaluser; Check: RelaunchRequested

[Code]
var
  DeleteUserData: Boolean;

const
  SYNCHRONIZE = $00100000;

function OpenProcess(dwDesiredAccess: Cardinal; bInheritHandle: Boolean; dwProcessId: Cardinal): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: THandle; dwMilliseconds: Cardinal): Cardinal;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

// /WAITPID=<pid>: the in-app updater launches this installer and THEN exits,
// so the files it is about to replace are still open when setup starts. Wait
// (up to 30s) for that process to be gone before touching anything.
function InitializeSetup: Boolean;
var
  Pid: Cardinal;
  H: THandle;
begin
  Result := True;
  Pid := StrToIntDef(ExpandConstant('{param:WAITPID|0}'), 0);
  if Pid <> 0 then
  begin
    H := OpenProcess(SYNCHRONIZE, False, Pid);
    if H <> 0 then
    begin
      WaitForSingleObject(H, 30000);
      CloseHandle(H);
    end;
  end;
end;

function RelaunchRequested: Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;

procedure InitializeUninstallProgressForm;
begin
  DeleteUserData := MsgBox(
    'Also delete your PRSH settings, layouts, and tournament data?' #13#10 #13#10 +
    'Yes - removes %LOCALAPPDATA%\PRSH\ (settings, stream labels, branding, logs).' #13#10 +
    'No  - keeps them so a future reinstall picks up where you left off.',
    mbConfirmation, MB_YESNO or MB_DEFBUTTON2
  ) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppData: String;
begin
  if (CurUninstallStep = usPostUninstall) and DeleteUserData then
  begin
    AppData := ExpandConstant('{localappdata}\PRSH');
    if DirExists(AppData) then
      DelTree(AppData, True, True, True);
  end;
end;

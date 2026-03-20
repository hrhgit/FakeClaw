#ifndef AppVersion
  #error AppVersion is required
#endif

#ifndef StageDir
  #error StageDir is required
#endif

#ifndef OutputDir
  #define OutputDir AddBackslash(SourcePath) + "dist"
#endif

#ifndef AppIconPath
  #error AppIconPath is required
#endif

#define MyAppName "FakeClaw"
#define MyAppExe "tray\\bin\\FakeClaw.Tray.exe"

[Setup]
AppId={{AA3CB6E1-31EE-4D2D-BD79-2B887C15A6D8}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
DefaultDirName={autopf}\FakeClaw
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=FakeClaw-Setup-{#AppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExe}
SetupIconFile={#AppIconPath}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}\FakeClaw"; Filename: "{app}\{#MyAppExe}"
Name: "{commondesktop}\FakeClaw"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "启动 FakeClaw"; Flags: nowait postinstall skipifsilent

[Code]
function ReadNodeVersion(var VersionText: AnsiString): Boolean;
var
  TempFile: string;
  ResultCode: Integer;
  FileLoaded: Boolean;
begin
  TempFile := ExpandConstant('{tmp}\fakeclaw-node-version.txt');
  if FileExists(TempFile) then
  begin
    DeleteFile(TempFile);
  end;

  Result := Exec(
    ExpandConstant('{cmd}'),
    '/C node -v > "' + TempFile + '"',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );

  FileLoaded := False;
  if Result and (ResultCode = 0) then
  begin
    if FileExists(TempFile) then
    begin
      LoadStringFromFile(TempFile, VersionText);
      FileLoaded := True;
    end;
  end;

  if Result and (ResultCode = 0) and FileLoaded then
  begin
    VersionText := Trim(VersionText);
    Result := VersionText <> '';
  end
  else
  begin
    Result := False;
  end;
end;

function ParseNodeMajorVersion(const VersionText: string): Integer;
var
  Cleaned: string;
  DotPos: Integer;
begin
  Cleaned := Trim(VersionText);
  if (Length(Cleaned) > 0) and ((Cleaned[1] = 'v') or (Cleaned[1] = 'V')) then
  begin
    Delete(Cleaned, 1, 1);
  end;

  DotPos := Pos('.', Cleaned);
  if DotPos > 1 then
  begin
    Cleaned := Copy(Cleaned, 1, DotPos - 1);
  end;

  Result := StrToIntDef(Cleaned, 0);
end;

function InitializeSetup(): Boolean;
var
  VersionText: AnsiString;
  MajorVersion: Integer;
begin
  Result := True;

  if not ReadNodeVersion(VersionText) then
  begin
    MsgBox(
      '安装 FakeClaw 前需要先安装 Node.js 22 或更高版本。'#13#10 +
      '请先完成 Node.js 安装，然后重新运行本安装程序。',
      mbCriticalError,
      MB_OK
    );
    Result := False;
    exit;
  end;

  MajorVersion := ParseNodeMajorVersion(VersionText);
  if MajorVersion < 22 then
  begin
    MsgBox(
      '检测到的 Node.js 版本为 ' + VersionText + '。'#13#10 +
      'FakeClaw 正式版要求 Node.js 22 或更高版本。',
      mbCriticalError,
      MB_OK
    );
    Result := False;
  end;
end;

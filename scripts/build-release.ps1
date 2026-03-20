[CmdletBinding()]
param(
  [switch]$SkipInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot "package.json"
$packageLockPath = Join-Path $repoRoot "package-lock.json"
$trayBuildScript = Join-Path $PSScriptRoot "build-tray-app.ps1"
$installerScript = Join-Path $repoRoot "installer\FakeClaw.iss"
$distRoot = Join-Path $repoRoot "dist"
$intermediateRoot = Join-Path $distRoot "intermediate"
$runtimeInstallRoot = Join-Path $intermediateRoot "runtime"
$trayReleaseExe = Join-Path $intermediateRoot "FakeClaw.Tray.exe"
$appIconPath = Join-Path $intermediateRoot "FakeClaw.ico"
$stageRoot = Join-Path $distRoot "stage\FakeClaw"
$outputRoot = Join-Path $distRoot "release"

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Resolve-InnoSetupCompiler {
  $startMenuShortcut = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Inno Setup 6\Inno Setup Compiler.lnk"
  $candidates = @(
    $env:INNO_SETUP_COMPILER,
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  if (Test-Path -LiteralPath $startMenuShortcut) {
    try {
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($startMenuShortcut)
      $shortcutTarget = [string]$shortcut.TargetPath
      if (-not [string]::IsNullOrWhiteSpace($shortcutTarget)) {
        $shortcutDirectory = Split-Path -Parent $shortcutTarget
        $shortcutCliCompiler = Join-Path $shortcutDirectory "ISCC.exe"
        $candidates += @($shortcutCliCompiler, $shortcutTarget)
      }
    } catch {
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Inno Setup compiler not found. Set INNO_SETUP_COMPILER or install Inno Setup 6."
}

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw "Missing package.json: $packageJsonPath"
}

if (-not (Test-Path -LiteralPath $packageLockPath)) {
  throw "Missing package-lock.json: $packageLockPath"
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "Missing package.json version"
}

New-Item -ItemType Directory -Path $intermediateRoot -Force | Out-Null

if (Test-Path -LiteralPath $runtimeInstallRoot) {
  Remove-Item -LiteralPath $runtimeInstallRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $runtimeInstallRoot -Force | Out-Null
Copy-Item -LiteralPath $packageJsonPath -Destination (Join-Path $runtimeInstallRoot "package.json") -Force
Copy-Item -LiteralPath $packageLockPath -Destination (Join-Path $runtimeInstallRoot "package-lock.json") -Force

Push-Location $runtimeInstallRoot
try {
  npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci --omit=dev failed"
  }
} finally {
  Pop-Location
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $trayBuildScript -OutputPath $trayReleaseExe -IconPath $appIconPath
if ($LASTEXITCODE -ne 0) {
  throw "Tray build failed"
}

if (-not (Test-Path -LiteralPath $appIconPath)) {
  throw "Missing app icon: $appIconPath"
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$filesToCopy = @(
  ".env.example",
  "README.md"
)

foreach ($relativePath in $filesToCopy) {
  Copy-Item -LiteralPath (Join-Path $repoRoot $relativePath) -Destination (Join-Path $stageRoot $relativePath) -Force
}

Copy-DirectoryContents -Source (Join-Path $repoRoot "src") -Destination (Join-Path $stageRoot "src")
Copy-DirectoryContents -Source (Join-Path $repoRoot "public") -Destination (Join-Path $stageRoot "public")
Copy-DirectoryContents -Source (Join-Path $runtimeInstallRoot "node_modules") -Destination (Join-Path $stageRoot "node_modules")

New-Item -ItemType Directory -Path (Join-Path $stageRoot "config") -Force | Out-Null
Copy-Item `
  -LiteralPath (Join-Path $repoRoot "config\desktop-automation.config.json") `
  -Destination (Join-Path $stageRoot "config\desktop-automation.config.json") `
  -Force

New-Item -ItemType Directory -Path (Join-Path $stageRoot "scripts") -Force | Out-Null
$runtimeScripts = @(
  "calibrate-desktop-automation.ps1",
  "capture-desktop-screenshot.ps1",
  "codex-automation.ps1",
  "fakeclaw-paths.ps1",
  "keep-display-awake.ps1",
  "minimize-codex-window.ps1",
  "windows-toast-listener-helper.cs",
  "windows-toast-listener.ps1"
)
foreach ($scriptName in $runtimeScripts) {
  Copy-Item `
    -LiteralPath (Join-Path $repoRoot ("scripts\" + $scriptName)) `
    -Destination (Join-Path $stageRoot ("scripts\" + $scriptName)) `
    -Force
}

New-Item -ItemType Directory -Path (Join-Path $stageRoot "tray\bin") -Force | Out-Null
Copy-Item `
  -LiteralPath $trayReleaseExe `
  -Destination (Join-Path $stageRoot "tray\bin\FakeClaw.Tray.exe") `
  -Force

New-Item -ItemType Directory -Path (Join-Path $stageRoot "docs") -Force | Out-Null
$releaseDocs = @(
  "messaging-platforms.md",
  "windows-release-trial.md"
)
foreach ($docName in $releaseDocs) {
  Copy-Item `
    -LiteralPath (Join-Path $repoRoot ("docs\" + $docName)) `
    -Destination (Join-Path $stageRoot ("docs\" + $docName)) `
    -Force
}

Copy-Item -LiteralPath $packageJsonPath -Destination (Join-Path $stageRoot "package.json") -Force

if (-not $SkipInstaller) {
  $innoCompiler = Resolve-InnoSetupCompiler
  & $innoCompiler `
    "/DAppVersion=$version" `
    "/DStageDir=$stageRoot" `
    "/DOutputDir=$outputRoot" `
    "/DAppIconPath=$appIconPath" `
    $installerScript

  if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup build failed"
  }
}

Write-Host "[ok] Release staging prepared:" $stageRoot
if (-not $SkipInstaller) {
  Write-Host "[ok] Installer output:" (Join-Path $outputRoot ("FakeClaw-Setup-" + $version + ".exe"))
}

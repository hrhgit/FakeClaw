[CmdletBinding()]
param(
  [string]$SourceAllowList = "Code,Cursor,Windsurf,Trae,Kiro,CodeBuddy,Antigravity,JetBrains,Zed,Codex,PowerShell",
  [int]$PollIntervalMs = 1500,
  [switch]$ExitAfterInit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$sourcePath = Join-Path $scriptRoot "windows-toast-listener-helper.cs"
$binDir = Join-Path $scriptRoot "bin"
$exePath = Join-Path $binDir "windows-toast-listener-helper.exe"
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$systemRuntimeFacade = "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.7.1\Facades\System.Runtime.dll"
$systemRuntimeWinRt = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Runtime.WindowsRuntime.dll"

if (-not (Test-Path $sourcePath)) {
  throw "Missing helper source: $sourcePath"
}

if (-not (Test-Path $cscPath)) {
  throw "Missing csc compiler: $cscPath"
}

foreach ($path in @($systemRuntimeFacade, $systemRuntimeWinRt)) {
  if (-not (Test-Path $path)) {
    throw "Missing dependency: $path"
  }
}

if (-not (Test-Path $binDir)) {
  New-Item -ItemType Directory -Path $binDir | Out-Null
}

$needsBuild = -not (Test-Path $exePath)

if (-not $needsBuild) {
  $needsBuild = (Get-Item $sourcePath).LastWriteTimeUtc -gt (Get-Item $exePath).LastWriteTimeUtc
}

if ($needsBuild) {
  & $cscPath `
    /nologo `
    /target:exe `
    "/out:$exePath" `
    /r:$systemRuntimeWinRt `
    /r:$systemRuntimeFacade `
    $sourcePath

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to compile helper executable"
  }
}

$args = @(
  "--source-allow-list", $SourceAllowList,
  "--poll-interval-ms", "$PollIntervalMs"
)

if ($ExitAfterInit) {
  $args += "--exit-after-init"
}

& $exePath @args
exit $LASTEXITCODE

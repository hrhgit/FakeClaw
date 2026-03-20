[CmdletBinding()]
param(
  [string]$OutputPath = "",
  [string]$IconPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "tray\FakeClaw.Tray"
$iconGeneratorScript = Join-Path $PSScriptRoot "generate-app-icon.ps1"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  Join-Path $repoRoot "tray\bin\FakeClaw.Tray.exe"
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}
$binDir = Split-Path -Parent $outputPath
$iconOutputPath = if ([string]::IsNullOrWhiteSpace($IconPath)) {
  Join-Path $binDir "FakeClaw.ico"
} else {
  [System.IO.Path]::GetFullPath($IconPath)
}
$generatedAssemblyInfoPath = Join-Path $binDir "FakeClaw.Tray.AssemblyInfo.g.cs"
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$packageJsonPath = Join-Path $repoRoot "package.json"

if (-not (Test-Path $cscPath)) {
  throw "Missing csc compiler: $cscPath"
}

if (-not (Test-Path $sourceDir)) {
  throw "Missing tray source directory: $sourceDir"
}

if (-not (Test-Path $packageJsonPath)) {
  throw "Missing package.json: $packageJsonPath"
}

if (-not (Test-Path $iconGeneratorScript)) {
  throw "Missing icon generator script: $iconGeneratorScript"
}

if (-not (Test-Path $binDir)) {
  New-Item -ItemType Directory -Path $binDir | Out-Null
}

$iconOutputDir = Split-Path -Parent $iconOutputPath
if (-not (Test-Path $iconOutputDir)) {
  New-Item -ItemType Directory -Path $iconOutputDir | Out-Null
}

$sources = Get-ChildItem -Path $sourceDir -Filter *.cs | Sort-Object Name | ForEach-Object { $_.FullName }
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$productVersion = [string]$packageJson.version
if ([string]::IsNullOrWhiteSpace($productVersion)) {
  throw "Missing package.json version"
}

$versionParts = $productVersion.Split(".") | Where-Object { $_ -ne "" }
while ($versionParts.Count -lt 4) {
  $versionParts += "0"
}
$assemblyVersion = ($versionParts | Select-Object -First 4) -join "."
$assemblyInfoContent = @"
using System.Reflection;

[assembly: AssemblyTitle("FakeClaw Tray")]
[assembly: AssemblyProduct("FakeClaw")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$productVersion")]
"@

if ($sources.Count -eq 0) {
  throw "No tray source files found in $sourceDir"
}

Set-Content -LiteralPath $generatedAssemblyInfoPath -Value $assemblyInfoContent -Encoding UTF8

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $iconGeneratorScript -OutputPath $iconOutputPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to generate tray icon"
}

& $cscPath `
  /nologo `
  /target:winexe `
  /out:$outputPath `
  /win32icon:$iconOutputPath `
  /langversion:5 `
  /codepage:65001 `
  /r:System.Windows.Forms.dll `
  /r:System.Drawing.dll `
  /r:System.Net.Http.dll `
  /r:System.Web.Extensions.dll `
  $generatedAssemblyInfoPath `
  $sources

if ($LASTEXITCODE -ne 0) {
  throw "Failed to build tray application"
}

Write-Host "[ok] Built tray application: $outputPath"

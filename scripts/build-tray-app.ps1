[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "tray\FakeClaw.Tray"
$binDir = Join-Path $repoRoot "tray\bin"
$outputPath = Join-Path $binDir "FakeClaw.Tray.exe"
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $cscPath)) {
  throw "Missing csc compiler: $cscPath"
}

if (-not (Test-Path $sourceDir)) {
  throw "Missing tray source directory: $sourceDir"
}

if (-not (Test-Path $binDir)) {
  New-Item -ItemType Directory -Path $binDir | Out-Null
}

$sources = Get-ChildItem -Path $sourceDir -Filter *.cs | Sort-Object Name | ForEach-Object { $_.FullName }

if ($sources.Count -eq 0) {
  throw "No tray source files found in $sourceDir"
}

& $cscPath `
  /nologo `
  /target:winexe `
  /out:$outputPath `
  /langversion:5 `
  /codepage:65001 `
  /r:System.Windows.Forms.dll `
  /r:System.Drawing.dll `
  /r:System.Net.Http.dll `
  /r:System.Web.Extensions.dll `
  $sources

if ($LASTEXITCODE -ne 0) {
  throw "Failed to build tray application"
}

Write-Host "[ok] Built tray application: $outputPath"

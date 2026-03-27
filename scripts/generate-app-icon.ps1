[CmdletBinding()]
param(
  [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $repoRoot "tray\FakeClaw.Tray\FakeClaw.svg"
$rendererScriptPath = Join-Path $PSScriptRoot "render-svg-icon.mjs"
$generatorScriptPath = Join-Path $PSScriptRoot "generate-app-icon.py"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  Join-Path $repoRoot "tray\FakeClaw.Tray\FakeClaw.ico"
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}
$previewOutputPath = Join-Path (Split-Path -Parent $outputPath) (([System.IO.Path]::GetFileNameWithoutExtension($outputPath)) + ".preview.png")
$tempToken = [System.Guid]::NewGuid().ToString("N")
$renderPngPath = Join-Path $env:TEMP ("fakeclaw-icon-render-" + $tempToken + ".png")
$nodeCommand = "node"
$pythonCommand = "python"

if (-not (Test-Path -LiteralPath $svgPath)) {
  throw "Missing SVG icon source: $svgPath"
}

if (-not (Test-Path -LiteralPath $generatorScriptPath)) {
  throw "Missing icon generator script: $generatorScriptPath"
}

if (-not (Test-Path -LiteralPath $rendererScriptPath)) {
  throw "Missing SVG renderer script: $rendererScriptPath"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $previewOutputPath) -Force | Out-Null

if (Test-Path -LiteralPath $renderPngPath) {
  Remove-Item -LiteralPath $renderPngPath -Force
}
if (Test-Path -LiteralPath $previewOutputPath) {
  Remove-Item -LiteralPath $previewOutputPath -Force
}

& $nodeCommand $rendererScriptPath $svgPath $renderPngPath 256
if ($LASTEXITCODE -ne 0) {
  throw "Failed to render SVG to PNG with resvg"
}

try {
  & $pythonCommand $generatorScriptPath $renderPngPath $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate icon"
  }

  Copy-Item -LiteralPath $renderPngPath -Destination $previewOutputPath -Force
} finally {
  if (Test-Path -LiteralPath $renderPngPath) {
    Remove-Item -LiteralPath $renderPngPath -Force
  }
}

Write-Host "[ok] Generated icon:" $outputPath
Write-Host "[ok] Generated preview:" $previewOutputPath

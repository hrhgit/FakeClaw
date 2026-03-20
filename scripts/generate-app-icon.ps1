[CmdletBinding()]
param(
  [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $repoRoot "tray\FakeClaw.Tray\FakeClaw.svg"
$sourcePath = Join-Path $PSScriptRoot "generate-app-icon.cs"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  Join-Path $repoRoot "tray\FakeClaw.Tray\FakeClaw.ico"
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}
$compilerPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$generatorExe = Join-Path $env:TEMP "fakeclaw-icon-generator.exe"
$renderHtmlPath = Join-Path $env:TEMP "fakeclaw-icon-render.html"
$renderPngPath = Join-Path $env:TEMP "fakeclaw-icon-render.png"
$croppedPngPath = Join-Path $env:TEMP "fakeclaw-icon-render-cropped.png"

if (-not (Test-Path -LiteralPath $compilerPath)) {
  throw "Missing csc compiler: $compilerPath"
}

if (-not (Test-Path -LiteralPath $svgPath)) {
  throw "Missing SVG icon source: $svgPath"
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing icon generator source: $sourcePath"
}

Add-Type -AssemblyName System.Drawing

function Resolve-EdgePath {
  $candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Missing headless browser. Install Microsoft Edge or Google Chrome."
}

New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null

$edgePath = Resolve-EdgePath
$svgMarkup = Get-Content -LiteralPath $svgPath -Raw -Encoding UTF8
$html = @"
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: 256px;
      height: 256px;
      overflow: hidden;
      background: transparent;
    }

    svg {
      display: block;
      width: 256px;
      height: 256px;
    }
  </style>
</head>
<body>
$svgMarkup
</body>
</html>
"@

Set-Content -LiteralPath $renderHtmlPath -Value $html -Encoding UTF8
if (Test-Path -LiteralPath $renderPngPath) {
  Remove-Item -LiteralPath $renderPngPath -Force
}
if (Test-Path -LiteralPath $croppedPngPath) {
  Remove-Item -LiteralPath $croppedPngPath -Force
}

& $edgePath --headless --disable-gpu --hide-scrollbars "--force-device-scale-factor=1" "--window-size=256,360" "--screenshot=$renderPngPath" (([System.Uri] (Resolve-Path -LiteralPath $renderHtmlPath).Path).AbsoluteUri)
$rendered = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if ((Test-Path -LiteralPath $renderPngPath) -and (Get-Item -LiteralPath $renderPngPath).Length -gt 0) {
    $rendered = $true
    break
  }

  Start-Sleep -Milliseconds 250
}

if (-not $rendered) {
  throw "Failed to render SVG to PNG"
}

$renderedImage = New-Object System.Drawing.Bitmap($renderPngPath)
try {
  $cropped = $renderedImage.Clone((New-Object System.Drawing.Rectangle(0, 0, 256, 256)), $renderedImage.PixelFormat)
  try {
    $cropped.Save($croppedPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $cropped.Dispose()
  }
} finally {
  $renderedImage.Dispose()
}
Move-Item -LiteralPath $croppedPngPath -Destination $renderPngPath -Force

& $compilerPath /nologo /target:exe /out:$generatorExe /r:System.Drawing.dll $sourcePath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to compile icon generator"
}

try {
  & $generatorExe $renderPngPath $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate icon"
  }
} finally {
  if (Test-Path -LiteralPath $generatorExe) {
    Remove-Item -LiteralPath $generatorExe -Force
  }
  if (Test-Path -LiteralPath $renderHtmlPath) {
    Remove-Item -LiteralPath $renderHtmlPath -Force
  }
  if (Test-Path -LiteralPath $renderPngPath) {
    Remove-Item -LiteralPath $renderPngPath -Force
  }
  if (Test-Path -LiteralPath $croppedPngPath) {
    Remove-Item -LiteralPath $croppedPngPath -Force
  }
}

Write-Host "[ok] Generated icon:" $outputPath

[CmdletBinding()]
param(
  [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $repoRoot "tray\FakeClaw.Tray\FakeClaw.svg"
$outputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  Join-Path $env:TEMP "fakeclaw-icon-preview.png"
} else {
  [System.IO.Path]::GetFullPath($OutputPath)
}

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

if (-not (Test-Path -LiteralPath $svgPath)) {
  throw "Missing SVG icon source: $svgPath"
}

Add-Type -AssemblyName System.Drawing

$edgePath = Resolve-EdgePath
$htmlPath = Join-Path $env:TEMP "fakeclaw-icon-preview.html"
$croppedOutputPath = Join-Path $env:TEMP "fakeclaw-icon-preview-cropped.png"
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

Set-Content -LiteralPath $htmlPath -Value $html -Encoding UTF8
if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Force
}
if (Test-Path -LiteralPath $croppedOutputPath) {
  Remove-Item -LiteralPath $croppedOutputPath -Force
}

& $edgePath --headless --disable-gpu --hide-scrollbars "--force-device-scale-factor=1" "--window-size=256,360" "--screenshot=$outputPath" (([System.Uri] (Resolve-Path -LiteralPath $htmlPath).Path).AbsoluteUri)

for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if ((Test-Path -LiteralPath $outputPath) -and (Get-Item -LiteralPath $outputPath).Length -gt 0) {
    $renderedImage = New-Object System.Drawing.Bitmap($outputPath)
    try {
      $cropped = $renderedImage.Clone((New-Object System.Drawing.Rectangle(0, 0, 256, 256)), $renderedImage.PixelFormat)
      try {
        $cropped.Save($croppedOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $cropped.Dispose()
      }
    } finally {
      $renderedImage.Dispose()
    }
    Move-Item -LiteralPath $croppedOutputPath -Destination $outputPath -Force

    Write-Host "[ok] Rendered preview:" $outputPath
    Remove-Item -LiteralPath $htmlPath -Force
    return
  }

  Start-Sleep -Milliseconds 250
}

Remove-Item -LiteralPath $htmlPath -Force
if (Test-Path -LiteralPath $croppedOutputPath) {
  Remove-Item -LiteralPath $croppedOutputPath -Force
}
throw "Failed to render SVG preview"

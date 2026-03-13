param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ScreenshotNative {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

  [DllImport("shcore.dll", SetLastError = true)]
  public static extern int SetProcessDpiAwareness(int awareness);
}
"@

function Write-JsonResult {
  param([hashtable]$Payload)

  $Payload | ConvertTo-Json -Compress -Depth 4
}

function Enable-DpiAwareness {
  $perMonitorV2 = [System.IntPtr](-4)

  try {
    if ([ScreenshotNative]::SetProcessDpiAwarenessContext($perMonitorV2)) {
      return "per-monitor-v2"
    }
  } catch {
  }

  try {
    if ([ScreenshotNative]::SetProcessDpiAwareness(2) -eq 0) {
      return "per-monitor"
    }
  } catch {
  }

  try {
    if ([ScreenshotNative]::SetProcessDPIAware()) {
      return "system"
    }
  } catch {
  }

  return "unaware"
}

try {
  $dpiMode = Enable-DpiAwareness
  $directory = Split-Path -Parent $OutputPath
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  $screens = [System.Windows.Forms.Screen]::AllScreens
  if ($screens.Count -eq 0) {
    throw "No screens found"
  }

  $left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
  $top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
  $right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
  $bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
  $width = [int]($right - $left)
  $height = [int]($bottom - $top)
  $left = [int]$left
  $top = [int]$top

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()

  Write-Output (
    Write-JsonResult @{
      status = "success"
      path = $OutputPath
      width = $width
      height = $height
      dpiMode = $dpiMode
    }
  )
} catch {
  Write-Output (
    Write-JsonResult @{
      status = "failed"
      failureReason = $_.Exception.Message
      path = $OutputPath
    }
  )
}

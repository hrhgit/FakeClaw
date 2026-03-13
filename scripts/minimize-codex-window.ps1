param()

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class CodexWindowNative {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Write-JsonResult {
  param(
    [string]$Status,
    [string]$FailureReason = "",
    [hashtable]$Data = @{}
  )

  $payload = @{
    status = $Status
    failureReason = $FailureReason
  } + $Data

  $payload | ConvertTo-Json -Compress -Depth 4
}

function Get-CodexProcess {
  $candidates = Get-Process Codex -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending

  foreach ($process in $candidates) {
    if ($process.MainWindowTitle -match "Codex" -or [string]::IsNullOrWhiteSpace($process.MainWindowTitle)) {
      return $process
    }
  }

  return $null
}

try {
  $process = Get-CodexProcess
  if ($null -eq $process) {
    Write-Output (
      Write-JsonResult -Status "noop" -Data @{
        minimized = $false
        reason = "process_not_found"
      }
    )
    exit 0
  }

  $handle = [System.IntPtr]([int64]$process.MainWindowHandle)
  if ($handle -eq [System.IntPtr]::Zero) {
    Write-Output (
      Write-JsonResult -Status "noop" -Data @{
        minimized = $false
        reason = "window_not_found"
        processId = $process.Id
      }
    )
    exit 0
  }

  $wasMinimized = [CodexWindowNative]::IsIconic($handle)
  if (-not $wasMinimized) {
    [void][CodexWindowNative]::ShowWindowAsync($handle, 6)
    Start-Sleep -Milliseconds 120
  }

  Write-Output (
    Write-JsonResult -Status "success" -Data @{
      minimized = $true
      wasMinimized = $wasMinimized
      processId = $process.Id
      windowTitle = $process.MainWindowTitle
    }
  )
} catch {
  Write-Output (Write-JsonResult -Status "failed" -FailureReason $_.Exception.Message)
}

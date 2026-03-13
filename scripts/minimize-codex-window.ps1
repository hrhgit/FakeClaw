param(
  [ValidateSet("codex", "cursor", "trae", "traecn", "codebuddy", "codebuddycn", "antigravity")]
  [string]$TargetApp = "codex"
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DesktopWindowNative {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Get-TargetConfig {
  switch ($TargetApp) {
    "cursor" {
      return @{
        Id = "cursor"
        DisplayName = "Cursor"
        ProcessNames = @("Cursor")
        TitleRegex = "Cursor"
      }
    }
    "trae" {
      return @{
        Id = "trae"
        DisplayName = "Trae"
        ProcessNames = @("Trae")
        TitleRegex = "Trae"
      }
    }
    "traecn" {
      return @{
        Id = "traecn"
        DisplayName = "Trae CN"
        ProcessNames = @("Trae CN")
        TitleRegex = "Trae"
      }
    }
    "codebuddy" {
      return @{
        Id = "codebuddy"
        DisplayName = "CodeBuddy"
        ProcessNames = @("CodeBuddy")
        TitleRegex = "CodeBuddy"
      }
    }
    "codebuddycn" {
      return @{
        Id = "codebuddycn"
        DisplayName = "CodeBuddy CN"
        ProcessNames = @("CodeBuddy CN")
        TitleRegex = "CodeBuddy"
      }
    }
    "antigravity" {
      return @{
        Id = "antigravity"
        DisplayName = "Antigravity"
        ProcessNames = @("Antigravity")
        TitleRegex = "Antigravity"
      }
    }
    default {
      return @{
        Id = "codex"
        DisplayName = "Codex"
        ProcessNames = @("Codex")
        TitleRegex = "Codex"
      }
    }
  }
}

$targetConfig = Get-TargetConfig

function Write-JsonResult {
  param(
    [string]$Status,
    [string]$FailureReason = "",
    [hashtable]$Data = @{}
  )

  $payload = @{
    status = $Status
    failureReason = $FailureReason
    targetApp = $targetConfig.Id
    targetDisplayName = $targetConfig.DisplayName
  } + $Data

  $payload | ConvertTo-Json -Compress -Depth 4
}

function Get-TargetProcess {
  $candidates = foreach ($processName in $targetConfig.ProcessNames) {
    Get-Process $processName -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 }
  }

  $ordered = $candidates | Sort-Object StartTime -Descending

  foreach ($process in $ordered) {
    if (
      $process.MainWindowTitle -match $targetConfig.TitleRegex -or
      [string]::IsNullOrWhiteSpace($process.MainWindowTitle)
    ) {
      return $process
    }
  }

  return $null
}

try {
  $process = Get-TargetProcess
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

  $wasMinimized = [DesktopWindowNative]::IsIconic($handle)
  if (-not $wasMinimized) {
    [void][DesktopWindowNative]::ShowWindowAsync($handle, 6)
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

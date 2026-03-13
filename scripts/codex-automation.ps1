param(
  [string]$Prompt = "",
  [string]$LaunchCommand = "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App",
  [ValidateSet("open", "focus", "paste", "send")]
  [string]$Mode = "send"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class CodexAutomationNative {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function Write-JsonResult {
  param(
    [string]$Status,
    [string]$FailureReason = "",
    [hashtable]$Data = @{}
  )

  $payload = @{
    status = $Status
    failureReason = $FailureReason
    mode = $Mode
  } + $Data

  $payload | ConvertTo-Json -Compress -Depth 6
}

function Start-CodexApplication {
  param([string]$Command)

  if ([string]::IsNullOrWhiteSpace($Command)) {
    return
  }

  if ($Command.StartsWith("shell:", [System.StringComparison]::OrdinalIgnoreCase)) {
    Start-Process -FilePath "explorer.exe" -ArgumentList $Command | Out-Null
    return
  }

  if (Test-Path -LiteralPath $Command) {
    Start-Process -FilePath $Command | Out-Null
    return
  }

  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $Command | Out-Null
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

function Wait-ForCodexProcess {
  param([int]$TimeoutMs = 15000)

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)

  while ((Get-Date) -lt $deadline) {
    $process = Get-CodexProcess
    if ($null -ne $process) {
      return $process
    }

    Start-Sleep -Milliseconds 250
  }

  return $null
}

function Activate-Window {
  param([System.Diagnostics.Process]$Process)

  $handle = [System.IntPtr]([int64]$Process.MainWindowHandle)
  if ($handle -eq [System.IntPtr]::Zero) {
    return $false
  }

  if ([CodexAutomationNative]::IsIconic($handle)) {
    [void][CodexAutomationNative]::ShowWindowAsync($handle, 9)
  } else {
    [void][CodexAutomationNative]::ShowWindowAsync($handle, 5)
  }

  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($Process.Id)
  Start-Sleep -Milliseconds 150
  [void][CodexAutomationNative]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 250

  return $true
}

function Get-ElementBounds {
  param([System.Windows.Automation.AutomationElement]$Element)

  $rect = $Element.Current.BoundingRectangle
  return @{
    Left = [double]$rect.Left
    Top = [double]$rect.Top
    Width = [double]$rect.Width
    Height = [double]$rect.Height
  }
}

function Test-PatternSupport {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationPattern]$Pattern
  )

  $patternObject = $null
  return $Element.TryGetCurrentPattern($Pattern, [ref]$patternObject)
}

function Get-InputCandidate {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [hashtable]$WindowBounds
  )

  if ($Element.Current.IsOffscreen -or -not $Element.Current.IsEnabled) {
    return $null
  }

  $bounds = Get-ElementBounds -Element $Element
  if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or $bounds.Width -lt 20 -or $bounds.Height -lt 8) {
    return $null
  }

  $typeName = $Element.Current.ControlType.ProgrammaticName
  $className = [string]$Element.Current.ClassName
  $elementName = [string]$Element.Current.Name
  $isFocusable = $Element.Current.IsKeyboardFocusable
  $hasValuePattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
  $hasTextPattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
  $descriptor = "$typeName $className $elementName"
  $isSupportedType = $typeName -match "ControlType\.(Edit|Document|Group|Pane|Custom)$"

  if (-not $isSupportedType) {
    return $null
  }

  if ($typeName -match "ControlType\.(Button|Thumb|Image|MenuItem|ListItem|TabItem)$") {
    return $null
  }

  if ($descriptor -match "Terminal input|xterm-helper-textarea") {
    return $null
  }

  $looksLikeComposer = $descriptor -match "ProseMirror|composer|prompt|textarea|editor|input"
  $isLargeEditorSurface = $bounds.Width -ge 300 -and $bounds.Height -ge 24 -and $bounds.Height -le 220
  $isMainPane = $bounds.Left -ge ($WindowBounds.Left + 250)
  $isLowerZone = $bounds.Top -ge ($WindowBounds.Top + ($WindowBounds.Height * 0.65))
  $isRootLikeSurface = $bounds.Width -ge ($WindowBounds.Width * 0.95) -and $bounds.Height -ge ($WindowBounds.Height * 0.5)

  $priority = switch -Regex ($typeName) {
    "ControlType\.Edit$" { 900; break }
    "ControlType\.(Group|Pane|Custom)$" {
      if ($looksLikeComposer) {
        1000
      } elseif ($hasValuePattern -or $hasTextPattern -or ($isFocusable -and $isLargeEditorSurface)) {
        650
      } else {
        0
      }
      break
    }
    "ControlType\.Document$" {
      if ($looksLikeComposer) {
        950
      } elseif ($isRootLikeSurface) {
        0
      } else {
        500
      }
      break
    }
    default {
      if ($looksLikeComposer) {
        800
      } elseif ($hasValuePattern -or $hasTextPattern) {
        400
      } else {
        0
      }
    }
  }

  if ($priority -eq 0) {
    return $null
  }

  $score = $priority

  if ($looksLikeComposer) {
    $score += 300
  }

  if ($isMainPane) {
    $score += 80
  }

  if ($isLowerZone) {
    $score += 120
  }

  if ($isLargeEditorSurface) {
    $score += 140
  }

  if ($isRootLikeSurface) {
    $score -= 250
  }

  $score += [int]([Math]::Min($bounds.Width, 1600) / 10)
  $score += [int]([Math]::Min($bounds.Height, 220) / 8)
  $score += [int]([Math]::Max($bounds.Top - $WindowBounds.Top, 0) / 12)

  return @{
    Element = $Element
    TypeName = $typeName
    ClassName = $className
    Score = $score
    Bounds = $bounds
    Name = $elementName
  }
}

function Invoke-LeftClick {
  param([hashtable]$Bounds)

  $x = [int][Math]::Round($Bounds.Left + ($Bounds.Width / 2))
  $y = [int][Math]::Round($Bounds.Top + ($Bounds.Height / 2))

  [void][CodexAutomationNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 80
  [CodexAutomationNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [CodexAutomationNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

function Prime-InputElement {
  param([hashtable]$Target)

  if ($Target.Bounds.Width -le 0 -or $Target.Bounds.Height -le 0) {
    throw "focus_input_failed"
  }

  try {
    $Target.Element.SetFocus()
    Start-Sleep -Milliseconds 120
  } catch {
  }

  Invoke-LeftClick -Bounds $Target.Bounds
  Start-Sleep -Milliseconds 120
}

function Find-CodexComposer {
  param([System.Diagnostics.Process]$Process)

  $windowHandle = [System.IntPtr]([int64]$Process.MainWindowHandle)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-ElementBounds -Element $root
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)

    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) {
      continue
    }

    $typeName = [string]$element.Current.ControlType.ProgrammaticName
    if ($typeName -notmatch "ControlType\.(Group|Document|Custom)$") {
      continue
    }

    $className = [string]$element.Current.ClassName
    if ($className -notmatch "(^| )ProseMirror( |$)") {
      continue
    }

    $bounds = Get-ElementBounds -Element $element
    if (
      $bounds.Width -lt 300 -or
      $bounds.Height -lt 20 -or
      $bounds.Height -gt 220 -or
      $bounds.Left -lt ($windowBounds.Left + 250) -or
      $bounds.Top -lt ($windowBounds.Top + ($windowBounds.Height * 0.65))
    ) {
      continue
    }

    $candidates += @{
      Element = $element
      TypeName = $typeName
      ClassName = $className
      Score = $bounds.Width + ($bounds.Height * 5) + ($bounds.Top - $windowBounds.Top)
      Bounds = $bounds
      Name = [string]$element.Current.Name
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  return ($candidates | Sort-Object Score -Descending | Select-Object -First 1)
}

function Find-CodexInput {
  param([System.Diagnostics.Process]$Process)

  $windowHandle = [System.IntPtr]([int64]$Process.MainWindowHandle)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-ElementBounds -Element $root
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $candidate = Get-InputCandidate -Element $all.Item($index) -WindowBounds $windowBounds
    if ($null -ne $candidate) {
      $candidates += $candidate
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  $ordered = $candidates | Sort-Object Score -Descending

  if ($ordered.Count -gt 1) {
    $gap = [int]$ordered[0].Score - [int]$ordered[1].Score
    $sameRegion =
      [Math]::Abs([double]$ordered[0].Bounds.Left - [double]$ordered[1].Bounds.Left) -le 4 -and
      [Math]::Abs([double]$ordered[0].Bounds.Top - [double]$ordered[1].Bounds.Top) -le 4 -and
      [Math]::Abs([double]$ordered[0].Bounds.Width - [double]$ordered[1].Bounds.Width) -le 8 -and
      [Math]::Abs([double]$ordered[0].Bounds.Height - [double]$ordered[1].Bounds.Height) -le 8

    if ($gap -lt 10) {
      if ($sameRegion) {
        return @{
          Ambiguous = $false
          Top = $ordered[0]
        }
      }

      return @{
        Ambiguous = $true
        Top = $ordered[0]
        RunnerUp = $ordered[1]
      }
    }
  }

  return @{
    Ambiguous = $false
    Top = $ordered[0]
  }
}

try {
  $process = Get-CodexProcess

  if ($null -eq $process) {
    Start-CodexApplication -Command $LaunchCommand
    $process = Wait-ForCodexProcess -TimeoutMs 15000
  }

  if ($null -eq $process) {
    Write-Output (Write-JsonResult -Status "failed" -FailureReason "app_not_found")
    exit 0
  }

  if (-not (Activate-Window -Process $process)) {
    Write-Output (Write-JsonResult -Status "failed" -FailureReason "window_activation_failed")
    exit 0
  }

  if ($Mode -eq "open") {
    Write-Output (
      Write-JsonResult -Status "success" -Data @{
        processId = $process.Id
        windowTitle = $process.MainWindowTitle
      }
    )
    exit 0
  }

  $target = Find-CodexComposer -Process $process

  if ($null -eq $target) {
    $selection = Find-CodexInput -Process $process
    if ($null -eq $selection) {
      Write-Output (Write-JsonResult -Status "failed" -FailureReason "focus_input_failed")
      exit 0
    }

    if ($selection.Ambiguous) {
      Write-Output (Write-JsonResult -Status "failed" -FailureReason "focus_input_ambiguous")
      exit 0
    }

    $target = $selection.Top
  }

  if ($null -eq $target) {
    Write-Output (Write-JsonResult -Status "failed" -FailureReason "focus_input_failed")
    exit 0
  }
  Prime-InputElement -Target $target

  if ($Mode -eq "focus") {
    Write-Output (
      Write-JsonResult -Status "success" -Data @{
        processId = $process.Id
        windowTitle = $process.MainWindowTitle
        selectedControlType = $target.TypeName
        selectedControlName = $target.Name
        selectedClassName = $target.ClassName
        bounds = $target.Bounds
      }
    )
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($Prompt)) {
    Write-Output (Write-JsonResult -Status "failed" -FailureReason "prompt_required")
    exit 0
  }

  [System.Windows.Forms.Clipboard]::SetText($Prompt)
  Start-Sleep -Milliseconds 100

  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($process.Id)
  Start-Sleep -Milliseconds 100
  $shell.SendKeys("^v")
  Start-Sleep -Milliseconds 200

  if ($Mode -eq "paste") {
    Write-Output (
      Write-JsonResult -Status "success" -Data @{
        processId = $process.Id
        windowTitle = $process.MainWindowTitle
        selectedControlType = $target.TypeName
        selectedControlName = $target.Name
        selectedClassName = $target.ClassName
        bounds = $target.Bounds
      }
    )
    exit 0
  }

  $shell.SendKeys("{ENTER}")

  Write-Output (
    Write-JsonResult -Status "success" -Data @{
      processId = $process.Id
      windowTitle = $process.MainWindowTitle
      selectedControlType = $target.TypeName
      selectedControlName = $target.Name
      selectedClassName = $target.ClassName
      bounds = $target.Bounds
    }
  )
} catch {
  Write-Output (Write-JsonResult -Status "failed" -FailureReason $_.Exception.Message)
}

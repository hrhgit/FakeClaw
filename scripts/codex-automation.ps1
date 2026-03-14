param(
  [string]$Prompt = "",
  [string]$LaunchCommand = "",
  [string]$ConfigPath = "",
  [ValidateSet("codex", "vscode", "cursor", "trae", "traecn", "codebuddy", "codebuddycn", "antigravity")]
  [string]$TargetApp = "codex",
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

public static class DesktopAutomationNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

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

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$AUTOMATION_CONFIG_PATH = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\config\desktop-automation.config.json")
  )
} else {
  [System.IO.Path]::GetFullPath($ConfigPath)
}

function Get-ConfigChildValue {
  param(
    $Node,
    [string]$Key
  )

  if ($null -eq $Node) {
    return $null
  }

  if ($Node -is [System.Collections.IDictionary]) {
    if ($Node.Contains($Key)) {
      return $Node[$Key]
    }

    return $null
  }

  $property = $Node.PSObject.Properties[$Key]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Get-ConfigValue {
  param(
    $Node,
    [string[]]$Path
  )

  $current = $Node
  foreach ($segment in $Path) {
    $current = Get-ConfigChildValue -Node $current -Key $segment
    if ($null -eq $current) {
      return $null
    }
  }

  return $current
}

function Get-ConfigNumber {
  param(
    $Node,
    [string[]]$Path,
    $Default = $null
  )

  $value = Get-ConfigValue -Node $Node -Path $Path
  if ($null -eq $value) {
    return $Default
  }

  try {
    return [double]$value
  } catch {
    return $Default
  }
}

function Load-AutomationConfig {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  try {
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    throw "automation_config_invalid: $Path"
  }
}

function Get-TargetConfig {
  switch ($TargetApp) {
    "vscode" {
      return @{
        Id = "vscode"
        DisplayName = "VS Code"
        ProcessNames = @("Code", "Code - Insiders")
        TitleRegex = "Visual Studio Code|VS Code|Code - Insiders"
        PreferredZone = "rightBottom"
        ConfigId = "vscode"
      }
    }
    "cursor" {
      return @{
        Id = "cursor"
        DisplayName = "Cursor"
        ProcessNames = @("Cursor")
        TitleRegex = "Cursor"
        PreferredZone = "rightBottom"
        ConfigId = "cursor"
      }
    }
    "trae" {
      return @{
        Id = "trae"
        DisplayName = "Trae"
        ProcessNames = @("Trae")
        TitleRegex = "Trae"
        PreferredZone = "rightBottom"
        ConfigId = "trae"
      }
    }
    "traecn" {
      return @{
        Id = "traecn"
        DisplayName = "Trae CN"
        ProcessNames = @("Trae CN")
        TitleRegex = "Trae"
        PreferredZone = "rightBottom"
        ConfigId = "trae"
      }
    }
    "codebuddy" {
      return @{
        Id = "codebuddy"
        DisplayName = "CodeBuddy"
        ProcessNames = @("CodeBuddy")
        TitleRegex = "CodeBuddy"
        PreferredZone = "rightBottom"
        ConfigId = "codebuddy"
      }
    }
    "codebuddycn" {
      return @{
        Id = "codebuddycn"
        DisplayName = "CodeBuddy CN"
        ProcessNames = @("CodeBuddy CN")
        TitleRegex = "CodeBuddy"
        PreferredZone = "rightBottom"
        ConfigId = "codebuddy"
      }
    }
    "antigravity" {
      return @{
        Id = "antigravity"
        DisplayName = "Antigravity"
        ProcessNames = @("Antigravity")
        TitleRegex = "Antigravity"
        PreferredZone = "rightBottom"
        ConfigId = "antigravity"
      }
    }
    default {
      return @{
        Id = "codex"
        DisplayName = "Codex"
        ProcessNames = @("Codex")
        TitleRegex = "Codex"
        PreferredZone = "mainBottom"
        ConfigId = "codex"
      }
    }
  }
}

$targetConfig = Get-TargetConfig
$automationConfig = Load-AutomationConfig -Path $AUTOMATION_CONFIG_PATH
$sharedAutomationConfig = Get-ConfigValue -Node $automationConfig -Path @("shared")
$targetAutomationConfig = Get-ConfigValue -Node $automationConfig -Path @("targets", $targetConfig.ConfigId)

function Get-SharedAutomationNumberSetting {
  param(
    [string[]]$Path,
    [double]$Default
  )

  return Get-ConfigNumber -Node $sharedAutomationConfig -Path $Path -Default $Default
}

function Get-TargetAutomationNumberSetting {
  param(
    [string[]]$Path,
    [double]$Default
  )

  $targetValue = Get-ConfigNumber -Node $targetAutomationConfig -Path $Path
  if ($null -ne $targetValue) {
    return $targetValue
  }

  return Get-ConfigNumber -Node $sharedAutomationConfig -Path $Path -Default $Default
}

function Resolve-MinThreshold {
  param(
    [double]$Dimension,
    [double]$Ratio = 0,
    [double]$MinPx = 0
  )

  return [double][Math]::Max($MinPx, ($Dimension * $Ratio))
}

function Resolve-MaxThreshold {
  param(
    [double]$Dimension,
    [double]$Ratio = 0,
    [double]$MinMaxPx = 0
  )

  return [double][Math]::Max($MinMaxPx, ($Dimension * $Ratio))
}

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
    targetApp = $targetConfig.Id
    targetDisplayName = $targetConfig.DisplayName
  } + $Data

  $payload | ConvertTo-Json -Compress -Depth 6
}

function Start-TargetApplication {
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

function Wait-ForTargetProcess {
  param([int]$TimeoutMs = 15000)

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)

  while ((Get-Date) -lt $deadline) {
    $process = Get-TargetProcess
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

  if ([DesktopAutomationNative]::IsIconic($handle)) {
    [void][DesktopAutomationNative]::ShowWindowAsync($handle, 9)
  } else {
    [void][DesktopAutomationNative]::ShowWindowAsync($handle, 5)
  }

  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($Process.Id)
  Start-Sleep -Milliseconds 150
  [void][DesktopAutomationNative]::SetForegroundWindow($handle)
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

function Test-IsFiniteNumber {
  param([double]$Value)

  return -not [double]::IsNaN($Value) -and -not [double]::IsInfinity($Value)
}

function Get-WindowBounds {
  param(
    [System.Diagnostics.Process]$Process,
    [System.Windows.Automation.AutomationElement]$RootElement = $null
  )

  $handle = [System.IntPtr]([int64]$Process.MainWindowHandle)

  if ($handle -ne [System.IntPtr]::Zero) {
    $rect = New-Object DesktopAutomationNative+RECT
    if ([DesktopAutomationNative]::GetWindowRect($handle, [ref]$rect)) {
      $width = [double]($rect.Right - $rect.Left)
      $height = [double]($rect.Bottom - $rect.Top)

      if ($width -gt 0 -and $height -gt 0) {
        return @{
          Left = [double]$rect.Left
          Top = [double]$rect.Top
          Width = $width
          Height = $height
        }
      }
    }
  }

  if ($null -ne $RootElement) {
    $bounds = Get-ElementBounds -Element $RootElement
    if (
      (Test-IsFiniteNumber -Value $bounds.Left) -and
      (Test-IsFiniteNumber -Value $bounds.Top) -and
      (Test-IsFiniteNumber -Value $bounds.Width) -and
      (Test-IsFiniteNumber -Value $bounds.Height) -and
      $bounds.Width -gt 0 -and
      $bounds.Height -gt 0
    ) {
      return $bounds
    }
  }

  return $null
}

function Test-PatternSupport {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationPattern]$Pattern
  )

  $patternObject = $null
  return $Element.TryGetCurrentPattern($Pattern, [ref]$patternObject)
}

function Get-RootElement {
  param([System.Diagnostics.Process]$Process)

  $windowHandle = [System.IntPtr]([int64]$Process.MainWindowHandle)
  if ($windowHandle -eq [System.IntPtr]::Zero) {
    return $null
  }

  return [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
}

function Get-CandidateDescriptor {
  param([System.Windows.Automation.AutomationElement]$Element)

  $typeName = [string]$Element.Current.ControlType.ProgrammaticName
  $className = [string]$Element.Current.ClassName
  $elementName = [string]$Element.Current.Name
  $automationId = [string]$Element.Current.AutomationId

  return [string]::Join(" ", @($typeName, $className, $elementName, $automationId))
}

function Get-ZoneFlags {
  param(
    [hashtable]$Bounds,
    [hashtable]$WindowBounds
  )

  $rightStartRatio = Get-SharedAutomationNumberSetting -Path @("zones", "rightStartRatio") -Default 0.58
  $mainPaneStartRatio = Get-SharedAutomationNumberSetting -Path @("zones", "mainPaneStartRatio") -Default 0.12
  $mainPaneStartMinPx = Get-SharedAutomationNumberSetting -Path @("zones", "mainPaneStartMinPx") -Default 160
  $lowerStartRatio = Get-SharedAutomationNumberSetting -Path @("zones", "lowerStartRatio") -Default 0.65
  $rightBottomStartRatio = Get-SharedAutomationNumberSetting -Path @("zones", "rightBottomStartRatio") -Default 0.45
  $rootLikeWidthRatio = Get-SharedAutomationNumberSetting -Path @("zones", "rootLikeWidthRatio") -Default 0.95
  $rootLikeHeightRatio = Get-SharedAutomationNumberSetting -Path @("zones", "rootLikeHeightRatio") -Default 0.5
  $mainPaneStartOffset = Resolve-MinThreshold -Dimension $WindowBounds.Width -Ratio $mainPaneStartRatio -MinPx $mainPaneStartMinPx

  $isRightZone = $Bounds.Left -ge ($WindowBounds.Left + ($WindowBounds.Width * $rightStartRatio))
  $isMainPane = $Bounds.Left -ge ($WindowBounds.Left + $mainPaneStartOffset)
  $isLowerZone = $Bounds.Top -ge ($WindowBounds.Top + ($WindowBounds.Height * $lowerStartRatio))
  $isRightBottomZone = $isRightZone -and ($Bounds.Top -ge ($WindowBounds.Top + ($WindowBounds.Height * $rightBottomStartRatio)))
  $isRootLikeSurface =
    $Bounds.Width -ge ($WindowBounds.Width * $rootLikeWidthRatio) -and
    $Bounds.Height -ge ($WindowBounds.Height * $rootLikeHeightRatio)

  return @{
    IsRightZone = $isRightZone
    IsMainPane = $isMainPane
    IsLowerZone = $isLowerZone
    IsRightBottomZone = $isRightBottomZone
    IsRootLikeSurface = $isRootLikeSurface
  }
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
  $genericMinWidthPx = Get-SharedAutomationNumberSetting -Path @("genericInput", "minWidthPx") -Default 20
  $genericMinHeightPx = Get-SharedAutomationNumberSetting -Path @("genericInput", "minHeightPx") -Default 8
  if (
    $bounds.Width -le 0 -or
    $bounds.Height -le 0 -or
    $bounds.Width -lt $genericMinWidthPx -or
    $bounds.Height -lt $genericMinHeightPx
  ) {
    return $null
  }

  $typeName = [string]$Element.Current.ControlType.ProgrammaticName
  if ($typeName -notmatch "ControlType\.(Edit|Document|Group|Pane|Custom)$") {
    return $null
  }

  if ($typeName -match "ControlType\.(Button|Thumb|Image|MenuItem|ListItem|TabItem)$") {
    return $null
  }

  $className = [string]$Element.Current.ClassName
  $elementName = [string]$Element.Current.Name
  $isFocusable = $Element.Current.IsKeyboardFocusable
  $hasValuePattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
  $hasTextPattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
  $descriptor = Get-CandidateDescriptor -Element $Element
  $zoneFlags = Get-ZoneFlags -Bounds $bounds -WindowBounds $WindowBounds

  if ($descriptor -match "Terminal input|xterm-helper-textarea|search|command palette") {
    return $null
  }

  $looksLikeComposer =
    $descriptor -match "ProseMirror|composer|prompt|textarea|editor|input|chat|message|ask"
  $largeEditorMinWidth =
    Resolve-MinThreshold `
      -Dimension $WindowBounds.Width `
      -Ratio (Get-SharedAutomationNumberSetting -Path @("genericInput", "largeEditorMinWidthRatio") -Default 0.1) `
      -MinPx (Get-SharedAutomationNumberSetting -Path @("genericInput", "largeEditorMinWidthPx") -Default 140)
  $largeEditorMinHeightPx =
    Get-SharedAutomationNumberSetting -Path @("genericInput", "largeEditorMinHeightPx") -Default 24
  $largeEditorMaxHeight =
    Resolve-MaxThreshold `
      -Dimension $WindowBounds.Height `
      -Ratio (Get-SharedAutomationNumberSetting -Path @("genericInput", "largeEditorMaxHeightRatio") -Default 0.35) `
      -MinMaxPx (Get-SharedAutomationNumberSetting -Path @("genericInput", "largeEditorMaxHeightPx") -Default 240)
  $isLargeEditorSurface =
    $bounds.Width -ge $largeEditorMinWidth -and
    $bounds.Height -ge $largeEditorMinHeightPx -and
    $bounds.Height -le $largeEditorMaxHeight

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
      } elseif ($zoneFlags.IsRootLikeSurface) {
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

  if ($targetConfig.PreferredZone -eq "rightBottom") {
    if ($zoneFlags.IsRightZone) {
      $score += 200
    }

    if ($zoneFlags.IsRightBottomZone) {
      $score += 240
    }
  } else {
    if ($zoneFlags.IsMainPane) {
      $score += 80
    }

    if ($zoneFlags.IsLowerZone) {
      $score += 120
    }
  }

  if ($isLargeEditorSurface) {
    $score += 140
  }

  if ($zoneFlags.IsRootLikeSurface) {
    $score -= 250
  }

  $score += [int]([Math]::Min($bounds.Width, 1600) / 10)
  $score += [int]([Math]::Min($bounds.Height, 240) / 8)
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

  [void][DesktopAutomationNative]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 80
  [DesktopAutomationNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [DesktopAutomationNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
}

function New-BoundsFromCenterPoint {
  param(
    [double]$CenterX,
    [double]$CenterY,
    [double]$Width,
    [double]$Height
  )

  return @{
    Left = $CenterX - ($Width / 2)
    Top = $CenterY - ($Height / 2)
    Width = $Width
    Height = $Height
  }
}

function Get-CoordinateFallbackClickBoundsSequence {
  param([hashtable]$Target)

  $isCoordinateFallback = $Target.ContainsKey("IsCoordinateFallback") -and [bool]$Target.IsCoordinateFallback

  if (-not $isCoordinateFallback) {
    return @($Target.Bounds)
  }

  $gridEnabled = Get-TargetAutomationNumberSetting -Path @("clickFallback", "gridEnabled") -Default 1
  if ([double]$gridEnabled -eq 0) {
    return @($Target.Bounds)
  }

  $widthPx = [double]$Target.Bounds.Width
  $heightPx = [double]$Target.Bounds.Height
  $centerX = [double]$Target.Bounds.Left + ($widthPx / 2)
  $centerY = [double]$Target.Bounds.Top + ($heightPx / 2)
  $stepXPx =
    Get-TargetAutomationNumberSetting `
      -Path @("clickFallback", "gridStepXPx") `
      -Default ([Math]::Max([int][Math]::Round($widthPx / 2), 10))
  $stepYPx =
    Get-TargetAutomationNumberSetting `
      -Path @("clickFallback", "gridStepYPx") `
      -Default ([Math]::Max([int][Math]::Round($heightPx / 2), 8))
  $sequence = @(
    @{ dx = 0; dy = 0 }
    @{ dx = -1; dy = 0 }
    @{ dx = 1; dy = 0 }
    @{ dx = 0; dy = -1 }
    @{ dx = 0; dy = 1 }
    @{ dx = -1; dy = -1 }
    @{ dx = 1; dy = -1 }
    @{ dx = -1; dy = 1 }
    @{ dx = 1; dy = 1 }
  )

  return @(
    foreach ($point in $sequence) {
      New-BoundsFromCenterPoint `
        -CenterX ($centerX + ($point.dx * $stepXPx)) `
        -CenterY ($centerY + ($point.dy * $stepYPx)) `
        -Width $widthPx `
        -Height $heightPx
    }
  )
}

function Get-CoordinateFallbackTarget {
  param([System.Diagnostics.Process]$Process)

  $xRatio = Get-ConfigNumber -Node $targetAutomationConfig -Path @("clickFallback", "xRatio")
  $yRatio = Get-ConfigNumber -Node $targetAutomationConfig -Path @("clickFallback", "yRatio")

  if ($null -eq $xRatio -or $null -eq $yRatio) {
    return $null
  }

  $root = Get-RootElement -Process $Process
  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }

  $offsetXPx = Get-TargetAutomationNumberSetting -Path @("clickFallback", "offsetXPx") -Default 0
  $offsetYPx = Get-TargetAutomationNumberSetting -Path @("clickFallback", "offsetYPx") -Default 0
  $widthPx = Get-TargetAutomationNumberSetting -Path @("clickFallback", "widthPx") -Default 24
  $heightPx = Get-TargetAutomationNumberSetting -Path @("clickFallback", "heightPx") -Default 24

  $centerX = $windowBounds.Left + ($windowBounds.Width * $xRatio) + $offsetXPx
  $centerY = $windowBounds.Top + ($windowBounds.Height * $yRatio) + $offsetYPx

  return @{
    Element = $null
    TypeName = "CoordinateFallback"
    ClassName = "CoordinateFallback"
    Score = 0
    Bounds = New-BoundsFromCenterPoint -CenterX $centerX -CenterY $centerY -Width $widthPx -Height $heightPx
    Name = "coordinate-fallback"
    IsCoordinateFallback = $true
  }
}

function Prime-InputElement {
  param([hashtable]$Target)

  if ($Target.Bounds.Width -le 0 -or $Target.Bounds.Height -le 0) {
    throw "focus_input_failed"
  }

  if ($Target.ContainsKey("Element") -and $null -ne $Target.Element) {
    try {
      $Target.Element.SetFocus()
      Start-Sleep -Milliseconds 120
    } catch {
    }
  }

  $clickBoundsSequence = Get-CoordinateFallbackClickBoundsSequence -Target $Target
  foreach ($clickBounds in $clickBoundsSequence) {
    Invoke-LeftClick -Bounds $clickBounds
  }

  if ($Target.ContainsKey("IsCoordinateFallback") -and [bool]$Target.IsCoordinateFallback) {
    Start-Sleep -Milliseconds 150
  }

  Start-Sleep -Milliseconds 120
}

function Find-CodexComposer {
  param([System.Diagnostics.Process]$Process)

  $root = Get-RootElement -Process $Process
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }
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
    $minWidth =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthRatio") -Default 0.18) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthPx") -Default 180)
    $minHeightPx = Get-TargetAutomationNumberSetting -Path @("composerSearch", "minHeightPx") -Default 20
    $maxHeight =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Height `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightRatio") -Default 0.35) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightPx") -Default 220)
    $minLeftOffset =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minLeftRatio") -Default 0.12) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minLeftPx") -Default 160)
    $minTop = $windowBounds.Top + ($windowBounds.Height * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minTopRatio") -Default 0.65))
    if (
      $bounds.Width -lt $minWidth -or
      $bounds.Height -lt $minHeightPx -or
      $bounds.Height -gt $maxHeight -or
      $bounds.Left -lt ($windowBounds.Left + $minLeftOffset) -or
      $bounds.Top -lt $minTop
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

function Find-CursorComposer {
  param([System.Diagnostics.Process]$Process)

  $root = Get-RootElement -Process $Process
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)

    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) {
      continue
    }

    $typeName = [string]$element.Current.ControlType.ProgrammaticName
    if ($typeName -notmatch "ControlType\.(Edit|Document|Group|Pane|Custom)$") {
      continue
    }

    $bounds = Get-ElementBounds -Element $element
    $minWidth =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthRatio") -Default 0.1) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthPx") -Default 140)
    $minHeightPx = Get-TargetAutomationNumberSetting -Path @("composerSearch", "minHeightPx") -Default 20
    $maxHeight =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Height `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightRatio") -Default 0.35) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightPx") -Default 260)
    $minLeft = $windowBounds.Left + ($windowBounds.Width * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minLeftRatio") -Default 0.58))
    $minTop = $windowBounds.Top + ($windowBounds.Height * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minTopRatio") -Default 0.45))
    $maxWidth =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthRatio") -Default 0.48) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthPx") -Default 520)
    if (
      $bounds.Width -lt $minWidth -or
      $bounds.Height -lt $minHeightPx -or
      $bounds.Height -gt $maxHeight -or
      $bounds.Left -lt $minLeft -or
      $bounds.Top -lt $minTop
    ) {
      continue
    }

    if ($bounds.Width -gt $maxWidth) {
      continue
    }

    $descriptor = Get-CandidateDescriptor -Element $element
    if ($descriptor -match "Terminal input|xterm-helper-textarea|search|command palette") {
      continue
    }

    $hasValuePattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
    $hasTextPattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
    $looksLikeComposer =
      $descriptor -match "composer|prompt|chat|message|input|editor|textarea|ask|agent|ProseMirror"

    $score = 0

    if ($looksLikeComposer) {
      $score += 500
    }

    if ($element.Current.IsKeyboardFocusable) {
      $score += 120
    }

    if ($hasValuePattern -or $hasTextPattern) {
      $score += 160
    }

    $score += [int]($bounds.Width / 4)
    $score += [int]($bounds.Height * 4)
    $score += [int]($bounds.Left - $windowBounds.Left)
    $score += [int]($bounds.Top - $windowBounds.Top)

    $candidates += @{
      Element = $element
      TypeName = $typeName
      ClassName = [string]$element.Current.ClassName
      Score = $score
      Bounds = $bounds
      Name = [string]$element.Current.Name
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  return ($candidates | Sort-Object Score -Descending | Select-Object -First 1)
}

function Find-VSCodeComposer {
  param([System.Diagnostics.Process]$Process)

  $root = Get-RootElement -Process $Process
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }

  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)

    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) {
      continue
    }

    $typeName = [string]$element.Current.ControlType.ProgrammaticName
    if ($typeName -notmatch "ControlType\.(Edit|Document|Group|Pane|Custom)$") {
      continue
    }

    $bounds = Get-ElementBounds -Element $element
    $minWidth =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthRatio") -Default 0.08) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthPx") -Default 120)
    $minHeightPx = Get-TargetAutomationNumberSetting -Path @("composerSearch", "minHeightPx") -Default 20
    $maxHeight =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Height `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightRatio") -Default 0.4) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightPx") -Default 280)
    $minLeft = $windowBounds.Left + ($windowBounds.Width * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minLeftRatio") -Default 0.52))
    $minTop = $windowBounds.Top + ($windowBounds.Height * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minTopRatio") -Default 0.4))
    $maxWidth =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthRatio") -Default 0.56) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthPx") -Default 640)
    if (
      $bounds.Width -lt $minWidth -or
      $bounds.Height -lt $minHeightPx -or
      $bounds.Height -gt $maxHeight -or
      $bounds.Left -lt $minLeft -or
      $bounds.Top -lt $minTop
    ) {
      continue
    }

    if ($bounds.Width -gt $maxWidth) {
      continue
    }

    $descriptor = Get-CandidateDescriptor -Element $element
    if ($descriptor -match "Terminal input|xterm-helper-textarea|search|command palette|findinput|replaceinput") {
      continue
    }

    $hasValuePattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
    $hasTextPattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
    $looksLikeVsCodeChat =
      $descriptor -match "chat|agent|assistant|copilot|cline|roo|continue|composer|prompt|message|ask|panel input"
    $looksLikeEditableSurface =
      $descriptor -match "textarea|input|editor|prosemirror" -or
      $element.Current.IsKeyboardFocusable -or
      $hasValuePattern -or
      $hasTextPattern

    if (-not $looksLikeVsCodeChat -and -not $looksLikeEditableSurface) {
      continue
    }

    $score = 0

    if ($looksLikeVsCodeChat) {
      $score += 700
    }

    if ($descriptor -match "copilot|assistant|cline|roo|continue") {
      $score += 260
    }

    if ($descriptor -match "textarea|input|editor|prosemirror") {
      $score += 220
    }

    if ($element.Current.IsKeyboardFocusable) {
      $score += 160
    }

    if ($hasValuePattern -or $hasTextPattern) {
      $score += 180
    }

    switch -Regex ($typeName) {
      "ControlType\.Edit$" { $score += 240; break }
      "ControlType\.Document$" { $score += 180; break }
      "ControlType\.(Group|Pane|Custom)$" { $score += 120; break }
    }

    $score += [int]($bounds.Width / 4)
    $score += [int]($bounds.Height * 4)
    $score += [int]($bounds.Left - $windowBounds.Left)
    $score += [int]($bounds.Top - $windowBounds.Top)

    $candidates += @{
      Element = $element
      TypeName = $typeName
      ClassName = [string]$element.Current.ClassName
      Score = $score
      Bounds = $bounds
      Name = [string]$element.Current.Name
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  return ($candidates | Sort-Object Score -Descending | Select-Object -First 1)
}

function Find-AntigravityComposer {
  param([System.Diagnostics.Process]$Process)

  $root = Get-RootElement -Process $Process
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }

  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $element = $all.Item($index)

    if ($element.Current.IsOffscreen -or -not $element.Current.IsEnabled) {
      continue
    }

    $typeName = [string]$element.Current.ControlType.ProgrammaticName
    if ($typeName -ne "ControlType.Edit") {
      continue
    }

    $bounds = Get-ElementBounds -Element $element
    $minWidth =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthRatio") -Default 0.12) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minWidthPx") -Default 120)
    $maxWidth =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Width `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthRatio") -Default 0.5) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxWidthPx") -Default 520)
    $minHeight =
      Resolve-MinThreshold `
        -Dimension $windowBounds.Height `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minHeightRatio") -Default 0.03) `
        -MinPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minHeightPx") -Default 24)
    $maxHeight =
      Resolve-MaxThreshold `
        -Dimension $windowBounds.Height `
        -Ratio (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightRatio") -Default 0.2) `
        -MinMaxPx (Get-TargetAutomationNumberSetting -Path @("composerSearch", "maxHeightPx") -Default 120)
    $minLeft = $windowBounds.Left + ($windowBounds.Width * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minLeftRatio") -Default 0.58))
    $minTop = $windowBounds.Top + ($windowBounds.Height * (Get-TargetAutomationNumberSetting -Path @("composerSearch", "minTopRatio") -Default 0.7))
    if (
      $bounds.Width -lt $minWidth -or
      $bounds.Width -gt $maxWidth -or
      $bounds.Height -lt $minHeight -or
      $bounds.Height -gt $maxHeight -or
      $bounds.Left -lt $minLeft -or
      $bounds.Top -lt $minTop
    ) {
      continue
    }

    $descriptor = Get-CandidateDescriptor -Element $element
    if ($descriptor -match "Terminal input|xterm-helper-textarea|search|command palette") {
      continue
    }

    $hasValuePattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
    $hasTextPattern = Test-PatternSupport -Element $element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
    if (-not $element.Current.IsKeyboardFocusable -and -not $hasValuePattern -and -not $hasTextPattern) {
      continue
    }

    $score = 1000

    if ($descriptor -match "cursor-text|input|editor|chat|message|ask|workflow") {
      $score += 300
    }

    if ($hasValuePattern) {
      $score += 160
    }

    if ($hasTextPattern) {
      $score += 160
    }

    if ($element.Current.IsKeyboardFocusable) {
      $score += 140
    }

    $score += [int]($bounds.Width / 4)
    $score += [int]($bounds.Height * 4)
    $score += [int]($bounds.Top - $windowBounds.Top)

    $candidates += @{
      Element = $element
      TypeName = $typeName
      ClassName = [string]$element.Current.ClassName
      Score = $score
      Bounds = $bounds
      Name = [string]$element.Current.Name
    }
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  return ($candidates | Sort-Object Score -Descending | Select-Object -First 1)
}

function Find-PreferredComposer {
  param([System.Diagnostics.Process]$Process)

  switch ($targetConfig.Id) {
    "vscode" {
      $vscodeTarget = Find-VSCodeComposer -Process $Process
      if ($null -ne $vscodeTarget) {
        return $vscodeTarget
      }

      return Find-CursorComposer -Process $Process
    }
    "cursor" {
      return Find-CursorComposer -Process $Process
    }
    "trae" {
      return Find-CursorComposer -Process $Process
    }
    "traecn" {
      return Find-CursorComposer -Process $Process
    }
    "codebuddy" {
      return Find-CursorComposer -Process $Process
    }
    "codebuddycn" {
      return Find-CursorComposer -Process $Process
    }
    "antigravity" {
      $antigravityTarget = Find-AntigravityComposer -Process $Process
      if ($null -ne $antigravityTarget) {
        return $antigravityTarget
      }

      return Find-CursorComposer -Process $Process
    }
    default {
      return Find-CodexComposer -Process $Process
    }
  }
}

function Find-GenericInput {
  param([System.Diagnostics.Process]$Process)

  $root = Get-RootElement -Process $Process
  if ($null -eq $root) {
    return $null
  }

  $windowBounds = Get-WindowBounds -Process $Process -RootElement $root
  if ($null -eq $windowBounds) {
    return $null
  }
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
  $process = Get-TargetProcess

  if ($null -eq $process) {
    Start-TargetApplication -Command $LaunchCommand
    $process = Wait-ForTargetProcess -TimeoutMs 15000
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

  $target = Find-PreferredComposer -Process $process

  if ($null -eq $target) {
    $selection = Find-GenericInput -Process $process
    if ($null -ne $selection) {
      if ($selection.Ambiguous) {
        Write-Output (Write-JsonResult -Status "failed" -FailureReason "focus_input_ambiguous")
        exit 0
      }

      $target = $selection.Top
    }

    if ($null -eq $target) {
      $target = Get-CoordinateFallbackTarget -Process $process
    }
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

param(
  [ValidateSet("codex", "cursor", "trae", "traecn", "codebuddy", "codebuddycn", "antigravity")]
  [string]$TargetApp,
  [ValidateSet("analyze", "calibrate")]
  [string]$Mode = "analyze",
  [int]$TopCount = 12,
  [string]$LaunchCommand = "",
  [string]$ConfigPath = "",
  [switch]$OpenIfMissing
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DesktopCalibrationNative {
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
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\config\desktop-automation.config.json")
  )
}

function Get-TargetConfig {
  switch ($TargetApp) {
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

  if ([DesktopCalibrationNative]::IsIconic($handle)) {
    [void][DesktopCalibrationNative]::ShowWindowAsync($handle, 9)
  } else {
    [void][DesktopCalibrationNative]::ShowWindowAsync($handle, 5)
  }

  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate($Process.Id)
  Start-Sleep -Milliseconds 150
  [void][DesktopCalibrationNative]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 250

  return $true
}

function Get-RootElement {
  param([System.Diagnostics.Process]$Process)

  $windowHandle = [System.IntPtr]([int64]$Process.MainWindowHandle)
  if ($windowHandle -eq [System.IntPtr]::Zero) {
    return $null
  }

  return [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
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

function Get-WindowBounds {
  param(
    [System.Diagnostics.Process]$Process,
    [System.Windows.Automation.AutomationElement]$RootElement = $null
  )

  $handle = [System.IntPtr]([int64]$Process.MainWindowHandle)

  if ($handle -ne [System.IntPtr]::Zero) {
    $rect = New-Object DesktopCalibrationNative+RECT
    if ([DesktopCalibrationNative]::GetWindowRect($handle, [ref]$rect)) {
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
    if ($bounds.Width -gt 0 -and $bounds.Height -gt 0) {
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

function Get-CandidateDescriptor {
  param([System.Windows.Automation.AutomationElement]$Element)

  $typeName = [string]$Element.Current.ControlType.ProgrammaticName
  $className = [string]$Element.Current.ClassName
  $elementName = [string]$Element.Current.Name
  $automationId = [string]$Element.Current.AutomationId

  return [string]::Join(" ", @($typeName, $className, $elementName, $automationId))
}

function Clamp-Number {
  param(
    [double]$Value,
    [double]$Min,
    [double]$Max
  )

  return [double][Math]::Max($Min, [Math]::Min($Value, $Max))
}

function Round-Number {
  param(
    [double]$Value,
    [int]$Digits = 3
  )

  return [double]([Math]::Round($Value, $Digits))
}

function New-CandidateRecord {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [hashtable]$WindowBounds
  )

  if ($Element.Current.IsOffscreen -or -not $Element.Current.IsEnabled) {
    return $null
  }

  $bounds = Get-ElementBounds -Element $Element
  if ($bounds.Width -lt 20 -or $bounds.Height -lt 8) {
    return $null
  }

  $typeName = [string]$Element.Current.ControlType.ProgrammaticName
  if ($typeName -notmatch "ControlType\.(Edit|Document|Group|Pane|Custom)$") {
    return $null
  }

  $descriptor = Get-CandidateDescriptor -Element $Element
  if ($descriptor -match "Terminal input|xterm-helper-textarea|search|command palette") {
    return $null
  }

  $className = [string]$Element.Current.ClassName
  $elementName = [string]$Element.Current.Name
  $automationId = [string]$Element.Current.AutomationId
  $hasValuePattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.ValuePattern]::Pattern)
  $hasTextPattern = Test-PatternSupport -Element $Element -Pattern ([System.Windows.Automation.TextPattern]::Pattern)
  $isFocusable = [bool]$Element.Current.IsKeyboardFocusable

  $leftRatio = ($bounds.Left - $WindowBounds.Left) / $WindowBounds.Width
  $topRatio = ($bounds.Top - $WindowBounds.Top) / $WindowBounds.Height
  $widthRatio = $bounds.Width / $WindowBounds.Width
  $heightRatio = $bounds.Height / $WindowBounds.Height
  $rightGapRatio = (($WindowBounds.Left + $WindowBounds.Width) - ($bounds.Left + $bounds.Width)) / $WindowBounds.Width
  $bottomGapRatio = (($WindowBounds.Top + $WindowBounds.Height) - ($bounds.Top + $bounds.Height)) / $WindowBounds.Height

  $looksLikeComposer = $descriptor -match "ProseMirror|composer|prompt|textarea|editor|input|chat|message|ask|agent|workflow|cursor-text"
  $looksLikeCodex = $className -match "(^| )ProseMirror( |$)"
  $isRootLikeSurface = $widthRatio -ge 0.9 -and $heightRatio -ge 0.75

  if (
    $typeName -match "ControlType\.(Group|Pane|Custom)$" -and
    -not $looksLikeComposer -and
    -not $hasValuePattern -and
    -not $hasTextPattern -and
    -not $isFocusable
  ) {
    return $null
  }

  if ($automationId -eq "RootWebArea") {
    return $null
  }

  if ($isRootLikeSurface -and -not $looksLikeCodex) {
    return $null
  }

  $score = 0

  switch -Regex ($typeName) {
    "ControlType\.Edit$" { $score += 900; break }
    "ControlType\.Document$" { $score += 760; break }
    "ControlType\.(Group|Pane|Custom)$" { $score += 680; break }
  }

  if ($looksLikeComposer) {
    $score += 260
  }

  if ($looksLikeCodex) {
    $score += 520
  }

  if ($hasValuePattern) {
    $score += 150
  }

  if ($hasTextPattern) {
    $score += 150
  }

  if ($isFocusable) {
    $score += 120
  }

  switch ($targetConfig.ConfigId) {
    "codex" {
      if ($leftRatio -ge 0.08) {
        $score += 90
      }

      if ($topRatio -ge 0.55) {
        $score += 220
      }

      if ($widthRatio -ge 0.2) {
        $score += 120
      }
      break
    }
    default {
      if ($typeName -eq "ControlType.Edit") {
        $score += 180
      }

      if ($leftRatio -ge 0.4) {
        $score += 80
      }

      if ($leftRatio -ge 0.55) {
        $score += 180
      }

      if ($topRatio -ge 0.4) {
        $score += 100
      }

      if ($topRatio -ge 0.6) {
        $score += 180
      }

      if ($rightGapRatio -le 0.08) {
        $score += 90
      }

      if ($bottomGapRatio -le 0.12) {
        $score += 90
      }
      break
    }
  }

  if ($widthRatio -ge 0.95 -and $heightRatio -ge 0.5) {
    $score -= 260
  }

  $score += [int]([Math]::Min($bounds.Width, 1200) / 8)
  $score += [int]([Math]::Min($bounds.Height, 240) * 3)

  return [pscustomobject]@{
    Score = $score
    TypeName = $typeName
    ClassName = $className
    Name = $elementName
    AutomationId = $automationId
    IsFocusable = $isFocusable
    HasValuePattern = [bool]$hasValuePattern
    HasTextPattern = [bool]$hasTextPattern
    Bounds = [pscustomobject]@{
      Left = [int][Math]::Round($bounds.Left)
      Top = [int][Math]::Round($bounds.Top)
      Width = [int][Math]::Round($bounds.Width)
      Height = [int][Math]::Round($bounds.Height)
    }
    Ratios = [pscustomobject]@{
      Left = Round-Number $leftRatio
      Top = Round-Number $topRatio
      Width = Round-Number $widthRatio
      Height = Round-Number $heightRatio
      RightGap = Round-Number $rightGapRatio
      BottomGap = Round-Number $bottomGapRatio
    }
    Descriptor = $descriptor
  }
}

function Get-CalibratedComposerSearch {
  param(
    [pscustomobject]$Candidate,
    [hashtable]$WindowBounds
  )

  $leftRatio = [double]$Candidate.Ratios.Left
  $topRatio = [double]$Candidate.Ratios.Top
  $widthRatio = [double]$Candidate.Ratios.Width
  $heightRatio = [double]$Candidate.Ratios.Height
  $leftPx = [double]$Candidate.Bounds.Left - $WindowBounds.Left
  $widthPx = [double]$Candidate.Bounds.Width
  $heightPx = [double]$Candidate.Bounds.Height

  switch ($targetConfig.ConfigId) {
    "codex" {
      return [ordered]@{
        minWidthRatio = Round-Number (Clamp-Number ($widthRatio * 0.42) 0.08 0.8)
        minWidthPx = [int][Math]::Round([Math]::Max(120, $widthPx * 0.45))
        minHeightPx = [int][Math]::Round([Math]::Max(16, $heightPx * 0.55))
        maxHeightRatio = Round-Number (Clamp-Number ([Math]::Max(0.16, $heightRatio * 3.2)) 0.16 0.6)
        maxHeightPx = [int][Math]::Round([Math]::Max(120, $heightPx * 2.8))
        minLeftRatio = Round-Number (Clamp-Number ($leftRatio - 0.08) 0.03 0.6)
        minLeftPx = [int][Math]::Round([Math]::Max(80, $leftPx - 80))
        minTopRatio = Round-Number (Clamp-Number ($topRatio - 0.12) 0.35 0.9)
      }
    }
    "antigravity" {
      return [ordered]@{
        minWidthRatio = Round-Number (Clamp-Number ($widthRatio * 0.5) 0.06 0.7)
        minWidthPx = [int][Math]::Round([Math]::Max(100, $widthPx * 0.5))
        maxWidthRatio = Round-Number (Clamp-Number ([Math]::Max($widthRatio + 0.1, $widthRatio * 1.35)) 0.18 0.9)
        maxWidthPx = [int][Math]::Round([Math]::Max(320, $widthPx * 1.45))
        minHeightRatio = Round-Number (Clamp-Number ($heightRatio * 0.55) 0.012 0.18)
        minHeightPx = [int][Math]::Round([Math]::Max(18, $heightPx * 0.55))
        maxHeightRatio = Round-Number (Clamp-Number ([Math]::Max(0.08, $heightRatio * 2.4)) 0.08 0.35)
        maxHeightPx = [int][Math]::Round([Math]::Max(90, $heightPx * 2.4))
        minLeftRatio = Round-Number (Clamp-Number ($leftRatio - 0.1) 0.2 0.8)
        minTopRatio = Round-Number (Clamp-Number ($topRatio - 0.1) 0.25 0.95)
      }
    }
    default {
      return [ordered]@{
        minWidthRatio = Round-Number (Clamp-Number ($widthRatio * 0.48) 0.05 0.7)
        minWidthPx = [int][Math]::Round([Math]::Max(100, $widthPx * 0.5))
        maxWidthRatio = Round-Number (Clamp-Number ([Math]::Max($widthRatio + 0.08, $widthRatio * 1.35)) 0.16 0.85)
        maxWidthPx = [int][Math]::Round([Math]::Max(320, $widthPx * 1.45))
        minHeightPx = [int][Math]::Round([Math]::Max(16, $heightPx * 0.5))
        maxHeightRatio = Round-Number (Clamp-Number ([Math]::Max(0.12, $heightRatio * 2.8)) 0.12 0.45)
        maxHeightPx = [int][Math]::Round([Math]::Max(100, $heightPx * 2.5))
        minLeftRatio = Round-Number (Clamp-Number ($leftRatio - 0.1) 0.2 0.8)
        minTopRatio = Round-Number (Clamp-Number ($topRatio - 0.12) 0.18 0.95)
      }
    }
  }
}

function Get-CoordinateFallbackConfig {
  switch ($targetConfig.ConfigId) {
    "codebuddy" {
      return [ordered]@{
        xRatio = 0.853
        yRatio = 0.84
        widthPx = 24
        heightPx = 24
      }
    }
    default {
      return $null
    }
  }
}

function New-DefaultCalibrationConfig {
  return [pscustomobject]@{
    shared = [pscustomobject]@{
      zones = [pscustomobject]@{
        rightStartRatio = 0.58
        mainPaneStartRatio = 0.12
        mainPaneStartMinPx = 160
        lowerStartRatio = 0.65
        rightBottomStartRatio = 0.45
        rootLikeWidthRatio = 0.95
        rootLikeHeightRatio = 0.5
      }
      genericInput = [pscustomobject]@{
        minWidthPx = 20
        minHeightPx = 8
        largeEditorMinWidthRatio = 0.1
        largeEditorMinWidthPx = 140
        largeEditorMinHeightPx = 24
        largeEditorMaxHeightRatio = 0.35
        largeEditorMaxHeightPx = 240
      }
    }
    targets = [pscustomobject]@{}
  }
}

function Set-JsonObjectProperty {
  param(
    $Object,
    [string]$Name,
    $Value
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  } else {
    $property.Value = $Value
  }
}

function Ensure-JsonObject {
  param(
    $Parent,
    [string]$PropertyName
  )

  $property = $Parent.PSObject.Properties[$PropertyName]
  if ($null -eq $property -or $null -eq $property.Value) {
    $newObject = [pscustomobject]@{}
    Set-JsonObjectProperty -Object $Parent -Name $PropertyName -Value $newObject
    return $newObject
  }

  return $property.Value
}

function Write-CalibrationConfig {
  param(
    [string]$Path,
    $ComposerSearch,
    $ClickFallback
  )

  $created = $false

  if (-not (Test-Path -LiteralPath $Path)) {
    $directory = Split-Path -Path $Path -Parent
    if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path -LiteralPath $directory)) {
      New-Item -Path $directory -ItemType Directory -Force | Out-Null
    }

    $config = New-DefaultCalibrationConfig
    $created = $true
  } else {
    $config = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  }

  $targets = Ensure-JsonObject -Parent $config -PropertyName "targets"
  $targetNode = Ensure-JsonObject -Parent $targets -PropertyName $targetConfig.ConfigId

  if ($null -ne $ComposerSearch) {
    $composerNode = Ensure-JsonObject -Parent $targetNode -PropertyName "composerSearch"

    foreach ($entry in $ComposerSearch.GetEnumerator()) {
      Set-JsonObjectProperty -Object $composerNode -Name $entry.Key -Value $entry.Value
    }
  }

  if ($null -ne $ClickFallback) {
    $clickFallbackNode = Ensure-JsonObject -Parent $targetNode -PropertyName "clickFallback"

    foreach ($entry in $ClickFallback.GetEnumerator()) {
      Set-JsonObjectProperty -Object $clickFallbackNode -Name $entry.Key -Value $entry.Value
    }
  }

  $json = $config | ConvertTo-Json -Depth 20
  Set-Content -LiteralPath $Path -Value $json -Encoding UTF8

  return $created
}

try {
  $process = Get-TargetProcess

  if ($null -eq $process -and $OpenIfMissing) {
    Start-TargetApplication -Command $LaunchCommand
    $process = Wait-ForTargetProcess -TimeoutMs 15000
  }

  if ($null -eq $process) {
    throw "app_not_found"
  }

  if (-not (Activate-Window -Process $process)) {
    throw "window_activation_failed"
  }

  $root = Get-RootElement -Process $process
  if ($null -eq $root) {
    throw "root_element_not_found"
  }

  $windowBounds = Get-WindowBounds -Process $process -RootElement $root
  if ($null -eq $windowBounds) {
    throw "window_bounds_not_found"
  }

  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $candidates = @()

  for ($index = 0; $index -lt $all.Count; $index += 1) {
    $candidate = New-CandidateRecord -Element $all.Item($index) -WindowBounds $windowBounds
    if ($null -ne $candidate) {
      $candidates += $candidate
    }
  }

  $fallbackClick = $null
  $topCandidates = @()
  $selected = $null
  $composerSearch = $null

  if ($candidates.Count -eq 0) {
    $fallbackClick = Get-CoordinateFallbackConfig

    if ($null -eq $fallbackClick) {
      throw "no_candidates_found"
    }
  } else {
    $ordered = $candidates | Sort-Object Score -Descending
    $topCandidates = @(
      $ordered |
        Select-Object -First ([Math]::Max(1, $TopCount)) |
        ForEach-Object {
          $suggestedComposerSearch = Get-CalibratedComposerSearch -Candidate $_ -WindowBounds $windowBounds
          $candidate = $_ | Select-Object *
          $candidate | Add-Member -NotePropertyName SuggestedComposerSearch -NotePropertyValue ([pscustomobject]$suggestedComposerSearch)
          $candidate
        }
    )
    $selected = $topCandidates[0]
    $composerSearch = [ordered]@{}
    foreach ($property in $selected.SuggestedComposerSearch.PSObject.Properties) {
      $composerSearch[$property.Name] = $property.Value
    }
  }
  $wroteConfig = $false
  $configCreated = $false

  if ($Mode -eq "calibrate") {
    $configCreated = [bool](Write-CalibrationConfig -Path $ConfigPath -ComposerSearch $composerSearch -ClickFallback $fallbackClick)
    $wroteConfig = $true
  }

  $payload = [ordered]@{
    status = "success"
    mode = $Mode
    targetApp = $targetConfig.Id
    targetDisplayName = $targetConfig.DisplayName
    processId = $process.Id
    windowTitle = $process.MainWindowTitle
    configPath = $ConfigPath
    wroteConfig = $wroteConfig
    configCreated = $configCreated
    fallbackOnly = ($null -eq $selected -and $null -ne $fallbackClick)
    windowBounds = [ordered]@{
      left = [int][Math]::Round($windowBounds.Left)
      top = [int][Math]::Round($windowBounds.Top)
      width = [int][Math]::Round($windowBounds.Width)
      height = [int][Math]::Round($windowBounds.Height)
    }
    selectedCandidate = $selected
    inferredComposerSearch = $composerSearch
    fallbackClick = $fallbackClick
    topCandidates = $topCandidates
  }

  Write-Output ($payload | ConvertTo-Json -Depth 8)
  exit 0
} catch {
  Write-Output ([ordered]@{
    status = "failed"
    mode = $Mode
    targetApp = $targetConfig.Id
    targetDisplayName = $targetConfig.DisplayName
    failureReason = $_.Exception.Message
    configPath = $ConfigPath
  } | ConvertTo-Json -Depth 6)
  exit 1
}

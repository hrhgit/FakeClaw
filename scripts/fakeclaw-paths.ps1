function Resolve-FakeClawAppRoot {
  return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}

function Resolve-FakeClawLocalAppDataRoot {
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return $env:LOCALAPPDATA
  }

  return [System.IO.Path]::Combine($HOME, "AppData", "Local")
}

function Resolve-FakeClawDataRoot {
  $explicitDataRoot = [string]$env:FAKECLAW_DATA_DIR
  if (-not [string]::IsNullOrWhiteSpace($explicitDataRoot)) {
    return [System.IO.Path]::GetFullPath($explicitDataRoot)
  }

  $appRoot = Resolve-FakeClawAppRoot
  if (Test-Path -LiteralPath (Join-Path $appRoot ".env")) {
    return $appRoot
  }

  return [System.IO.Path]::Combine((Resolve-FakeClawLocalAppDataRoot), "FakeClaw")
}

function Resolve-FakeClawDesktopAutomationConfigPath {
  param([string]$ExplicitPath = "")

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    return [System.IO.Path]::GetFullPath($ExplicitPath)
  }

  $appRoot = Resolve-FakeClawAppRoot
  $dataRoot = Resolve-FakeClawDataRoot
  $userConfigPath = Join-Path $dataRoot "config\desktop-automation.config.json"
  $bundledConfigPath = Join-Path $appRoot "config\desktop-automation.config.json"

  if (Test-Path -LiteralPath $userConfigPath) {
    return $userConfigPath
  }

  return $bundledConfigPath
}

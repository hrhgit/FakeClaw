param(
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class PowerRequestNative {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$ES_DISPLAY_REQUIRED = [uint32]2

function Request-KeepDisplayAwake {
  $flags = [uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED)
  $result = [PowerRequestNative]::SetThreadExecutionState($flags)

  if ($result -eq 0) {
    throw "SetThreadExecutionState failed"
  }
}

try {
  if ($IntervalSeconds -lt 5) {
    $IntervalSeconds = 5
  }

  Write-Output "[keep-awake] started (interval=${IntervalSeconds}s)"

  while ($true) {
    Request-KeepDisplayAwake
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  [void][PowerRequestNative]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Output "[keep-awake] stopped"
}

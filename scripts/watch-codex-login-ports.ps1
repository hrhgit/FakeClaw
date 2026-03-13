param(
    [int]$DurationSeconds = 120,
    [int]$PollMilliseconds = 500,
    [switch]$IncludeEstablished
)

$ErrorActionPreference = "Stop"

function Get-TargetProcesses {
    $all = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @("Codex", "codex")
    }

    $byId = @{}
    foreach ($proc in $all) {
        $path = $null
        try {
            $path = $proc.Path
        } catch {
            $path = $null
        }

        $byId[[string]$proc.ProcessId] = [pscustomobject]@{
            ProcessId = [int]$proc.ProcessId
            Name = $proc.ProcessName
            Path = $path
        }
    }

    return $byId
}

function Parse-Endpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Endpoint
    )

    if ($Endpoint.StartsWith("[")) {
        $closing = $Endpoint.LastIndexOf("]")
        if ($closing -lt 0) {
            return $null
        }

        $address = $Endpoint.Substring(1, $closing - 1)
        $portPart = $Endpoint.Substring($closing + 1).TrimStart(":")
        return [pscustomobject]@{
            Address = $address
            Port = $portPart
        }
    }

    $idx = $Endpoint.LastIndexOf(":")
    if ($idx -lt 0) {
        return $null
    }

    return [pscustomobject]@{
        Address = $Endpoint.Substring(0, $idx)
        Port = $Endpoint.Substring($idx + 1)
    }
}

function Get-NetstatRows {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Processes
    )

    $rows = @()
    $lines = netstat -ano -p TCP

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed.StartsWith("TCP")) {
            continue
        }

        $parts = $trimmed -split "\s+"
        if ($parts.Count -lt 5) {
            continue
        }

        $owningPid = $parts[4]
        if (-not $Processes.ContainsKey($owningPid)) {
            continue
        }

        $local = Parse-Endpoint -Endpoint $parts[1]
        $remote = Parse-Endpoint -Endpoint $parts[2]
        if ($null -eq $local -or $null -eq $remote) {
            continue
        }

        $state = $parts[3]
        if (-not $IncludeEstablished.IsPresent -and $state -eq "ESTABLISHED") {
            continue
        }

        $proc = $Processes[$owningPid]
        $rows += [pscustomobject]@{
            ProcessId = [int]$owningPid
            ProcessName = $proc.Name
            ProcessPath = $proc.Path
            State = $state
            LocalAddress = $local.Address
            LocalPort = $local.Port
            RemoteAddress = $remote.Address
            RemotePort = $remote.Port
        }
    }

    return $rows
}

function New-RowKey {
    param(
        [Parameter(Mandatory = $true)]
        $Row
    )

    return "{0}|{1}|{2}|{3}|{4}|{5}" -f `
        $Row.ProcessId, `
        $Row.State, `
        $Row.LocalAddress, `
        $Row.LocalPort, `
        $Row.RemoteAddress, `
        $Row.RemotePort
}

Write-Host "Watching Codex-related ports for $DurationSeconds seconds. Trigger the login flow now." -ForegroundColor Cyan
if (-not $IncludeEstablished.IsPresent) {
    Write-Host "Only new LISTENING/CLOSE_WAIT/TIME_WAIT style rows are shown. Add -IncludeEstablished to also show active connections." -ForegroundColor DarkGray
}

$known = @{}
$deadline = (Get-Date).AddSeconds($DurationSeconds)

$initialProcesses = Get-TargetProcesses
$initialRows = Get-NetstatRows -Processes $initialProcesses
foreach ($row in $initialRows) {
    $known[(New-RowKey -Row $row)] = $true
}

while ((Get-Date) -lt $deadline) {
    $processes = Get-TargetProcesses
    $rows = Get-NetstatRows -Processes $processes

    foreach ($row in $rows) {
        $key = New-RowKey -Row $row
        if ($known.ContainsKey($key)) {
            continue
        }

        $known[$key] = $true
        $stamp = Get-Date -Format "HH:mm:ss.fff"
        $remote = if ($row.State -eq "LISTENING") { "-" } else { "$($row.RemoteAddress):$($row.RemotePort)" }

        Write-Host ""
        Write-Host "[$stamp] NEW $($row.State)" -ForegroundColor Yellow
        Write-Host ("  PID   : {0}" -f $row.ProcessId)
        Write-Host ("  Name  : {0}" -f $row.ProcessName)
        Write-Host ("  Local : {0}:{1}" -f $row.LocalAddress, $row.LocalPort)
        Write-Host ("  Remote: {0}" -f $remote)
        Write-Host ("  Path  : {0}" -f $row.ProcessPath)
    }

    Start-Sleep -Milliseconds $PollMilliseconds
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green

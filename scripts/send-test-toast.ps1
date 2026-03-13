[CmdletBinding()]
param(
  [string]$Title = "AIassistant Test Notification",
  [string]$Message = "This is a sample Windows toast sent from PowerShell.",
  [string]$SourceAppId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null

if ([string]::IsNullOrWhiteSpace($SourceAppId)) {
  $startApp = Get-StartApps | Where-Object { $_.Name -eq "Windows PowerShell" } | Select-Object -First 1

  if ($null -eq $startApp -or [string]::IsNullOrWhiteSpace($startApp.AppID)) {
    throw "Could not find a registered AppID for Windows PowerShell."
  }

  $SourceAppId = $startApp.AppID
}

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(@"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$([System.Security.SecurityElement]::Escape($Title))</text>
      <text>$([System.Security.SecurityElement]::Escape($Message))</text>
    </binding>
  </visual>
</toast>
"@)

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($SourceAppId).Show($toast)

Write-Output "[send-test-toast] sent from source '$SourceAppId'"

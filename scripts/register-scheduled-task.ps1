# Registers a Windows Task Scheduler task that:
#  - runs Mon-Fri at 8:00 AM
#  - also runs at every system startup
# Both triggers point at run-dev-all.bat, which kills any existing
# dev processes and then runs `npm run dev:all`.

$ErrorActionPreference = "Stop"

$taskName   = "AzureDashboard-DevAll"
$scriptDir  = $PSScriptRoot
$batPath    = Join-Path $scriptDir "run-dev-all.bat"
$projectDir = Split-Path $scriptDir -Parent

if (-not (Test-Path $batPath)) {
    throw "Could not find $batPath"
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $projectDir

$weekdayTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8am
$startupTrigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($weekdayTrigger, $startupTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description "Kill existing dev processes and run npm run dev:all for azure-dashboard" `
    -Force

Write-Host "Scheduled task '$taskName' registered." -ForegroundColor Green
Write-Host "Triggers: Mon-Fri at 8:00 AM, and at system startup."
Write-Host "Action: $batPath"

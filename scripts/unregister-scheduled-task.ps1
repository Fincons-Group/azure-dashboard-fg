# Removes the scheduled task created by register-scheduled-task.ps1

$taskName = "AzureDashboard-DevAll"

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Scheduled task '$taskName' removed." -ForegroundColor Yellow

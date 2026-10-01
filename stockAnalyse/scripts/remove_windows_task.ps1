$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "StockReport-Service" -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName "StockReport-Service" -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName "StockReport-Service" -Confirm:$false
    Write-Host "Removed StockReport-Service."
}
else {
    Write-Host "StockReport-Service is not installed."
}

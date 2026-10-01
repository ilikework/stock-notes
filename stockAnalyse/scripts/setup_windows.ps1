param(
    [string]$LegacyConfig = "D:\personal\monitor\config.example.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

Set-Location $projectRoot

if (-not (Test-Path $venvPython)) {
    $pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonLauncher) {
        & py -3 -m venv .venv
    }
    else {
        & python -m venv .venv
    }
}

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "pip upgrade failed"
}
& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    throw "dependency installation failed"
}
& $venvPython -m pytest -q
if ($LASTEXITCODE -ne 0) {
    throw "tests failed; scheduled tasks were not created"
}

if (-not (Test-Path $LegacyConfig)) {
    throw "Telegram configuration not found: $LegacyConfig"
}
$legacy = Get-Content -Raw -Encoding UTF8 $LegacyConfig | ConvertFrom-Json
$telegram = $legacy.notify.telegram
if (-not $telegram.bot_token -or -not $telegram.chat_id) {
    throw "Telegram bot_token or chat_id is missing from $LegacyConfig"
}

[Environment]::SetEnvironmentVariable(
    "TELEGRAM_BOT_TOKEN",
    [string]$telegram.bot_token,
    [EnvironmentVariableTarget]::User
)
[Environment]::SetEnvironmentVariable(
    "TELEGRAM_CHAT_ID",
    [string]$telegram.chat_id,
    [EnvironmentVariableTarget]::User
)

$env:TELEGRAM_BOT_TOKEN = [string]$telegram.bot_token
$env:TELEGRAM_CHAT_ID = [string]$telegram.chat_id

$runner = Join-Path $PSScriptRoot "run_service.ps1"
$powershell = (Get-Command powershell.exe).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType S4U `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

Register-ScheduledTask `
    -TaskName "StockReport-Service" `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "A-share and Nikkei 225 Telegram report service" `
    -Force | Out-Null

Start-ScheduledTask -TaskName "StockReport-Service"
Write-Host "Installed and started StockReport-Service."
Write-Host "The service schedules reports at 10:30 and 16:05 Asia/Tokyo."
Write-Warning "The reused Bot Token is exposed in the legacy example file. Revoke it in BotFather as soon as practical."

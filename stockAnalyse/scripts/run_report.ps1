param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("open", "close")]
    [string]$ReportType
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$logDirectory = Join-Path $projectRoot "logs"
$env:TELEGRAM_BOT_TOKEN = [Environment]::GetEnvironmentVariable(
    "TELEGRAM_BOT_TOKEN",
    [EnvironmentVariableTarget]::User
)
$env:TELEGRAM_CHAT_ID = [Environment]::GetEnvironmentVariable(
    "TELEGRAM_CHAT_ID",
    [EnvironmentVariableTarget]::User
)

$env:STOCK_REPORT_WRITE_KEY = [Environment]::GetEnvironmentVariable(
    "STOCK_REPORT_WRITE_KEY",
    [EnvironmentVariableTarget]::User
)

if (-not (Test-Path $python)) {
    throw "Virtual environment not found: $python"
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdout = Join-Path $logDirectory "$ReportType-$timestamp.out.log"
$stderr = Join-Path $logDirectory "$ReportType-$timestamp.err.log"

$process = Start-Process `
    -FilePath $python `
    -ArgumentList @("main.py", "--once", $ReportType, "--send") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

exit $process.ExitCode

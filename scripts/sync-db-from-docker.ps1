# Sync Docker MySQL database to local MySQL
# Run this when switching FROM Docker production TO npm/local development

param(
    [string]$LocalUser = "root",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [string]$LocalHost = "localhost",
    [string]$LocalPort = "3306",
    [string]$MySqlPath = ""
)

Write-Host "=== Syncing Docker MySQL to Local MySQL ===" -ForegroundColor Cyan

# Find MySQL path
$mysql = "mysql"

# Common MySQL installation paths on Windows
$mysqlPaths = @(
    "C:\Program Files\MySQL\MySQL Server 8.0\bin",
    "C:\Program Files\MySQL\MySQL Server 8.1\bin",
    "C:\Program Files\MySQL\MySQL Server 8.2\bin",
    "C:\Program Files\MySQL\MySQL Server 8.3\bin",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin",
    "C:\Program Files\MySQL\MySQL Server 9.0\bin",
    "C:\xampp\mysql\bin",
    "C:\wamp64\bin\mysql\mysql8.0.31\bin",
    "C:\laragon\bin\mysql\mysql-8.0.30-winx64\bin"
)

# If MySqlPath provided, use it
if ($MySqlPath) {
    $mysqlPaths = @($MySqlPath) + $mysqlPaths
}

# Check if mysql is available
$found = $false
foreach ($path in $mysqlPaths) {
    if (Test-Path "$path\mysql.exe") {
        $mysql = "$path\mysql.exe"
        $found = $true
        Write-Host "Found MySQL at: $path" -ForegroundColor Gray
        break
    }
}

# Try command directly if not found in common paths
if (-not $found) {
    try {
        $null = Get-Command mysql -ErrorAction Stop
        $found = $true
    } catch {
        Write-Host "Error: mysql not found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please either:" -ForegroundColor Yellow
        Write-Host "  1. Add MySQL bin folder to your PATH" -ForegroundColor Yellow
        Write-Host "  2. Run with -MySqlPath parameter:" -ForegroundColor Yellow
        Write-Host "     .\sync-db-from-docker.ps1 -MySqlPath 'C:\Program Files\MySQL\MySQL Server 8.0\bin'" -ForegroundColor Gray
        exit 1
    }
}

# Check if Docker containers are running
$dbContainer = docker ps --filter "name=quadslab-db" --format "{{.Names}}" 2>$null
if (-not $dbContainer) {
    Write-Host "Error: Docker database container is not running." -ForegroundColor Red
    Write-Host "Run 'docker-compose up -d' first." -ForegroundColor Yellow
    exit 1
}

# Create backup filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "quadslab_docker_backup_$timestamp.sql"

# Export from Docker MySQL
Write-Host "Exporting from Docker MySQL..." -ForegroundColor Yellow
docker-compose exec -T db mysqldump -u quadslab -pbotpassword quadslab_bot > $backupFile

if (-not (Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "Error: Failed to create database backup from Docker." -ForegroundColor Red
    exit 1
}

Write-Host "Backup created: $backupFile ($(("{0:N2}" -f ((Get-Item $backupFile).Length / 1KB))) KB)" -ForegroundColor Green

# Import into local MySQL
Write-Host "Importing into local MySQL..." -ForegroundColor Yellow
$env:MYSQL_PWD = $LocalPassword
Get-Content $backupFile | & $mysql -h $LocalHost -P $LocalPort -u $LocalUser $LocalDatabase
$env:MYSQL_PWD = ""

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database synced successfully!" -ForegroundColor Green
} else {
    Write-Host "Error during import. Check the logs." -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
Write-Host "Docker backup saved as: $backupFile" -ForegroundColor Gray
Write-Host "You can delete this file if the sync was successful." -ForegroundColor Gray

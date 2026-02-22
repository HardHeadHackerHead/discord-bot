# Sync local MySQL database to Docker MySQL
# Run this when switching FROM npm/local development TO Docker production

param(
    [string]$LocalUser = "root",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [string]$LocalHost = "localhost",
    [string]$LocalPort = "3306",
    [string]$MySqlPath = ""
)

Write-Host "=== Syncing Local MySQL to Docker MySQL ===" -ForegroundColor Cyan

# Find MySQL path
$mysqldump = "mysqldump"

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

# Check if mysqldump is available
$found = $false
foreach ($path in $mysqlPaths) {
    if (Test-Path "$path\mysqldump.exe") {
        $mysqldump = "$path\mysqldump.exe"
        $found = $true
        Write-Host "Found MySQL at: $path" -ForegroundColor Gray
        break
    }
}

# Try command directly if not found in common paths
if (-not $found) {
    try {
        $null = Get-Command mysqldump -ErrorAction Stop
        $found = $true
    } catch {
        Write-Host "Error: mysqldump not found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please either:" -ForegroundColor Yellow
        Write-Host "  1. Add MySQL bin folder to your PATH" -ForegroundColor Yellow
        Write-Host "  2. Run with -MySqlPath parameter:" -ForegroundColor Yellow
        Write-Host "     .\sync-db-to-docker.ps1 -MySqlPath 'C:\Program Files\MySQL\MySQL Server 8.0\bin'" -ForegroundColor Gray
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

# Stop the bot container during migration
Write-Host "Stopping bot container during migration..." -ForegroundColor Yellow
docker-compose stop bot

# Create backup filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $PSScriptRoot "..\quadslab_backup_$timestamp.sql"

# Export from local MySQL using cmd.exe to avoid PowerShell encoding issues
# Added --set-gtid-purged=OFF to avoid GTID issues
# Added --column-statistics=0 for compatibility
Write-Host "Exporting from local MySQL..." -ForegroundColor Yellow
if ($LocalPassword) {
    $env:MYSQL_PWD = $LocalPassword
}

# Use cmd.exe to run mysqldump to avoid PowerShell encoding issues
$cmdCommand = "`"$mysqldump`" --set-gtid-purged=OFF --column-statistics=0 --routines --triggers -h $LocalHost -P $LocalPort -u $LocalUser $LocalDatabase"
cmd /c "$cmdCommand > `"$backupFile`" 2>&1"
$env:MYSQL_PWD = ""

if (-not (Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "Error: Failed to create database backup." -ForegroundColor Red
    docker-compose start bot
    exit 1
}

Write-Host "Backup created: $backupFile ($(("{0:N2}" -f ((Get-Item $backupFile).Length / 1KB))) KB)" -ForegroundColor Green

# Copy to Docker container
Write-Host "Copying backup to Docker container..." -ForegroundColor Yellow
docker cp $backupFile quadslab-db:/tmp/backup.sql

# Import into Docker MySQL
# First, drop and recreate the database to ensure clean import
Write-Host "Preparing Docker database..." -ForegroundColor Yellow
docker-compose exec -T db mysql -u root -prootpassword -e "DROP DATABASE IF EXISTS quadslab_bot; CREATE DATABASE quadslab_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
docker-compose exec -T db mysql -u root -prootpassword -e "GRANT ALL PRIVILEGES ON quadslab_bot.* TO 'quadslab'@'%';"

# Import with foreign key checks disabled
Write-Host "Importing into Docker MySQL..." -ForegroundColor Yellow
docker-compose exec -T db sh -c "mysql -u quadslab -pbotpassword quadslab_bot < /tmp/backup.sql"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database synced successfully!" -ForegroundColor Green
} else {
    Write-Host "First import attempt failed. Trying with foreign key checks disabled..." -ForegroundColor Yellow
    docker-compose exec -T db sh -c "echo 'SET FOREIGN_KEY_CHECKS=0;' | cat - /tmp/backup.sql | mysql -u quadslab -pbotpassword quadslab_bot"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Database synced successfully!" -ForegroundColor Green
        # Re-enable foreign key checks
        docker-compose exec -T db mysql -u quadslab -pbotpassword quadslab_bot -e "SET FOREIGN_KEY_CHECKS=1;"
    } else {
        Write-Host "Error during import. Check the logs." -ForegroundColor Red
    }
}

# Clean up temp file in container
docker-compose exec -T db rm -f /tmp/backup.sql 2>$null

# Start the bot container
Write-Host "Starting bot container..." -ForegroundColor Yellow
docker-compose start bot

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
Write-Host "Local backup saved as: $backupFile" -ForegroundColor Gray
Write-Host "You can delete this file if the sync was successful." -ForegroundColor Gray

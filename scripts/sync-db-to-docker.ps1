# Sync local PostgreSQL database to Docker PostgreSQL
# Run this when switching FROM npm/local development TO Docker production

param(
    [string]$LocalUser = "postgres",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [string]$LocalHost = "localhost",
    [string]$LocalPort = "5432"
)

Write-Host "=== Syncing Local PostgreSQL to Docker PostgreSQL ===" -ForegroundColor Cyan

# Check if pg_dump is available
$pgdump = "pg_dump"
$found = $false

# Common PostgreSQL installation paths on Windows
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin",
    "C:\Program Files\PostgreSQL\14\bin",
    "C:\Program Files\PostgreSQL\17\bin"
)

foreach ($path in $pgPaths) {
    if (Test-Path "$path\pg_dump.exe") {
        $pgdump = "$path\pg_dump.exe"
        $found = $true
        Write-Host "Found PostgreSQL at: $path" -ForegroundColor Gray
        break
    }
}

if (-not $found) {
    try {
        $null = Get-Command pg_dump -ErrorAction Stop
        $found = $true
    } catch {
        Write-Host "Error: pg_dump not found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please either:" -ForegroundColor Yellow
        Write-Host "  1. Add PostgreSQL bin folder to your PATH" -ForegroundColor Yellow
        Write-Host "  2. Install PostgreSQL client tools" -ForegroundColor Yellow
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

# Export from local PostgreSQL
Write-Host "Exporting from local PostgreSQL..." -ForegroundColor Yellow
$env:PGPASSWORD = $LocalPassword
& $pgdump -h $LocalHost -p $LocalPort -U $LocalUser -d $LocalDatabase --clean --if-exists > $backupFile
$env:PGPASSWORD = ""

if (-not (Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "Error: Failed to create database backup." -ForegroundColor Red
    docker-compose start bot
    exit 1
}

Write-Host "Backup created: $backupFile ($(("{0:N2}" -f ((Get-Item $backupFile).Length / 1KB))) KB)" -ForegroundColor Green

# Copy to Docker container
Write-Host "Copying backup to Docker container..." -ForegroundColor Yellow
docker cp $backupFile quadslab-db:/tmp/backup.sql

# Import into Docker PostgreSQL
Write-Host "Importing into Docker PostgreSQL..." -ForegroundColor Yellow
docker-compose exec -T db psql -U quadslab -d quadslab_bot -f /tmp/backup.sql

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database synced successfully!" -ForegroundColor Green
} else {
    Write-Host "Warning: Import completed with warnings (this is often OK for --clean imports)." -ForegroundColor Yellow
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

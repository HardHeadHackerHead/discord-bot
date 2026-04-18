# Sync Docker PostgreSQL database to local PostgreSQL
# Run this when switching FROM Docker production TO npm/local development

param(
    [string]$LocalUser = "postgres",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [string]$LocalHost = "localhost",
    [string]$LocalPort = "5432"
)

Write-Host "=== Syncing Docker PostgreSQL to Local PostgreSQL ===" -ForegroundColor Cyan

# Check if psql is available
$psql = "psql"
$found = $false

# Common PostgreSQL installation paths on Windows
$pgPaths = @(
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin",
    "C:\Program Files\PostgreSQL\14\bin",
    "C:\Program Files\PostgreSQL\17\bin"
)

foreach ($path in $pgPaths) {
    if (Test-Path "$path\psql.exe") {
        $psql = "$path\psql.exe"
        $found = $true
        Write-Host "Found PostgreSQL at: $path" -ForegroundColor Gray
        break
    }
}

if (-not $found) {
    try {
        $null = Get-Command psql -ErrorAction Stop
        $found = $true
    } catch {
        Write-Host "Error: psql not found!" -ForegroundColor Red
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

# Create backup filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "quadslab_docker_backup_$timestamp.sql"

# Export from Docker PostgreSQL
Write-Host "Exporting from Docker PostgreSQL..." -ForegroundColor Yellow
docker-compose exec -T db pg_dump -U quadslab -d quadslab_bot --clean --if-exists > $backupFile

if (-not (Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
    Write-Host "Error: Failed to create database backup from Docker." -ForegroundColor Red
    exit 1
}

Write-Host "Backup created: $backupFile ($(("{0:N2}" -f ((Get-Item $backupFile).Length / 1KB))) KB)" -ForegroundColor Green

# Import into local PostgreSQL
Write-Host "Importing into local PostgreSQL..." -ForegroundColor Yellow
$env:PGPASSWORD = $LocalPassword
Get-Content $backupFile | & $psql -h $LocalHost -p $LocalPort -U $LocalUser -d $LocalDatabase
$env:PGPASSWORD = ""

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database synced successfully!" -ForegroundColor Green
} else {
    Write-Host "Warning: Import completed with warnings (this is often OK for --clean imports)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Sync Complete ===" -ForegroundColor Cyan
Write-Host "Docker backup saved as: $backupFile" -ForegroundColor Gray
Write-Host "You can delete this file if the sync was successful." -ForegroundColor Gray

# Switch from local development to Docker production
# This script:
# 1. Rebuilds the Docker image with latest code
# 2. Starts the Docker containers
# 3. Syncs your local database to Docker
# 4. Syncs your local data folder (images, state files) to Docker

param(
    [string]$LocalUser = "root",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [switch]$SkipDbSync = $false,
    [switch]$SkipDataSync = $false,
    [switch]$NoBuild = $false
)

Write-Host "=== Switching to Docker Production ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build Docker image (unless skipped)
if (-not $NoBuild) {
    Write-Host "[1/4] Building Docker image with latest code..." -ForegroundColor Yellow
    docker-compose build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Docker build failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "Build complete!" -ForegroundColor Green
} else {
    Write-Host "[1/4] Skipping Docker build (using existing image)" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Start containers
Write-Host "[2/4] Starting Docker containers..." -ForegroundColor Yellow
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to start containers." -ForegroundColor Red
    exit 1
}

# Wait for MySQL to be ready
Write-Host "Waiting for MySQL to be ready..." -ForegroundColor Gray
Start-Sleep -Seconds 10

Write-Host ""

# Step 3: Sync database (unless skipped)
if (-not $SkipDbSync) {
    Write-Host "[3/4] Syncing local database to Docker..." -ForegroundColor Yellow
    & "$PSScriptRoot\sync-db-to-docker.ps1" -LocalUser $LocalUser -LocalPassword $LocalPassword -LocalDatabase $LocalDatabase
} else {
    Write-Host "[3/4] Skipping database sync" -ForegroundColor Gray
}

Write-Host ""

# Step 4: Sync data folder (images, state files)
$botContainer = docker ps --filter "name=quadslab-bot" --format "{{.Names}}" 2>$null
if (-not $SkipDataSync -and $botContainer) {
    Write-Host "[4/4] Syncing local data folder to Docker..." -ForegroundColor Yellow

    $localDataDir = Join-Path $PSScriptRoot "..\data"
    if (Test-Path $localDataDir) {
        # Copy data folder to Docker container
        docker cp "$localDataDir/." "${botContainer}:/app/data/"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Data folder synced successfully!" -ForegroundColor Green

            # Show what was synced
            $welcomeImages = Get-ChildItem -Path "$localDataDir\welcome-images" -ErrorAction SilentlyContinue
            if ($welcomeImages) {
                Write-Host "  - Welcome images: $($welcomeImages.Count) files" -ForegroundColor Gray
            }
            if (Test-Path "$localDataDir\welcome-prompt-state.json") {
                Write-Host "  - Prompt cycler state: synced" -ForegroundColor Gray
            }
        } else {
            Write-Host "Warning: Failed to sync data folder" -ForegroundColor Yellow
        }
    } else {
        Write-Host "No local data folder found, skipping" -ForegroundColor Gray
    }
} else {
    Write-Host "[4/4] Skipping data folder sync" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Switch Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Docker bot is now running with your latest code and data." -ForegroundColor Green
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Gray
Write-Host "  docker-compose logs -f bot    # View bot logs" -ForegroundColor Gray
Write-Host "  docker-compose restart bot    # Restart the bot" -ForegroundColor Gray
Write-Host "  docker-compose down           # Stop everything" -ForegroundColor Gray

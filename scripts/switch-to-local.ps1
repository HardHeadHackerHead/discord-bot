# Switch from Docker production to local development
# This script:
# 1. Syncs Docker database to your local MySQL
# 2. Syncs Docker data folder (images, state files) to local
# 3. Stops the Docker containers
# 4. Reminds you to start local dev

param(
    [string]$LocalUser = "root",
    [string]$LocalPassword = "",
    [string]$LocalDatabase = "quadslab_bot",
    [switch]$SkipDbSync = $false,
    [switch]$SkipDataSync = $false,
    [switch]$KeepDockerRunning = $false
)

Write-Host "=== Switching to Local Development ===" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
$botContainer = docker ps --filter "name=quadslab-bot" --format "{{.Names}}" 2>$null
$dbContainer = docker ps --filter "name=quadslab-db" --format "{{.Names}}" 2>$null
if (-not $dbContainer) {
    Write-Host "Docker containers are not running." -ForegroundColor Yellow
    Write-Host "If you need to sync data from Docker, start it first with 'docker-compose up -d'" -ForegroundColor Gray
    $SkipDbSync = $true
    $SkipDataSync = $true
}

# Step 1: Sync database (unless skipped)
if (-not $SkipDbSync) {
    Write-Host "[1/3] Syncing Docker database to local..." -ForegroundColor Yellow
    & "$PSScriptRoot\sync-db-from-docker.ps1" -LocalUser $LocalUser -LocalPassword $LocalPassword -LocalDatabase $LocalDatabase
} else {
    Write-Host "[1/3] Skipping database sync" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Sync data folder (images, state files)
if (-not $SkipDataSync -and $botContainer) {
    Write-Host "[2/3] Syncing Docker data folder to local..." -ForegroundColor Yellow

    # Create local data directory if it doesn't exist
    $localDataDir = Join-Path $PSScriptRoot "..\data"
    if (-not (Test-Path $localDataDir)) {
        New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null
    }

    # Copy data folder from Docker container
    docker cp "${botContainer}:/app/data/." $localDataDir
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
        Write-Host "Warning: Failed to sync data folder (may not exist yet)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[2/3] Skipping data folder sync" -ForegroundColor Gray
}

Write-Host ""

# Step 3: Stop Docker containers (unless keeping them running)
if (-not $KeepDockerRunning) {
    Write-Host "[3/3] Stopping Docker containers..." -ForegroundColor Yellow
    docker-compose down
    Write-Host "Docker containers stopped." -ForegroundColor Green
} else {
    Write-Host "[3/3] Keeping Docker containers running (as requested)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Switch Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ready for local development!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the bot locally:" -ForegroundColor Gray
Write-Host "  npm run dev     # Development with hot-reload" -ForegroundColor Gray
Write-Host "  npm run build && npm start   # Production build" -ForegroundColor Gray
Write-Host ""
Write-Host "When done developing, run:" -ForegroundColor Gray
Write-Host "  .\scripts\switch-to-docker.ps1" -ForegroundColor Gray

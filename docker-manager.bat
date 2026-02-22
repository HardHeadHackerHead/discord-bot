@echo off
setlocal enabledelayedexpansion
title QuadsLab Bot - Docker Manager

:menu
cls
echo ========================================
echo   QuadsLab Bot - Docker Manager
echo ========================================
echo.
echo   DOCKER CONTROLS
echo   ---------------
echo   1. Start Docker (docker-compose up -d)
echo   2. Stop Docker (docker-compose down)
echo   3. Restart Docker
echo   4. Rebuild and Start (full deploy)
echo   5. View Bot Logs (live)
echo   6. View Bot Status
echo.
echo   DATABASE SYNC
echo   -------------
echo   7. Push Local DB to Docker (local -^> docker)
echo   8. Pull Docker DB to Local (docker -^> local)
echo.
echo   DEVELOPMENT
echo   -----------
echo   9. Switch to Local Dev (sync db + images, stop docker)
echo   10. Switch to Docker (build, start, sync db + images)
echo.
echo   OTHER
echo   -----
echo   11. Open Docker Desktop
echo   12. Check Docker Status
echo   0. Exit
echo.
echo ========================================
set /p choice="Select an option: "

if "%choice%"=="1" goto start_docker
if "%choice%"=="2" goto stop_docker
if "%choice%"=="3" goto restart_docker
if "%choice%"=="4" goto rebuild_docker
if "%choice%"=="5" goto view_logs
if "%choice%"=="6" goto view_status
if "%choice%"=="7" goto sync_to_docker
if "%choice%"=="8" goto sync_from_docker
if "%choice%"=="9" goto switch_to_local
if "%choice%"=="10" goto switch_to_docker
if "%choice%"=="11" goto open_docker_desktop
if "%choice%"=="12" goto check_docker
if "%choice%"=="0" goto end

echo Invalid option. Please try again.
pause
goto menu

:start_docker
cls
echo Starting Docker containers...
echo.
docker-compose up -d
echo.
echo Docker started!
pause
goto menu

:stop_docker
cls
echo Stopping Docker containers...
echo.
docker-compose down
echo.
echo Docker stopped!
pause
goto menu

:restart_docker
cls
echo Restarting Docker containers...
echo.
docker-compose restart
echo.
echo Docker restarted!
pause
goto menu

:rebuild_docker
cls
echo ========================================
echo   Full Deploy - Rebuild and Start
echo ========================================
echo.
echo This will:
echo   1. Stop Docker containers
echo   2. Rebuild the bot image
echo   3. Start Docker containers
echo.
set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
echo [1/3] Stopping Docker...
docker-compose down

echo.
echo [2/3] Rebuilding bot image...
docker-compose build bot

echo.
echo [3/3] Starting Docker...
docker-compose up -d

echo.
echo ========================================
echo   Deploy complete!
echo ========================================
pause
goto menu

:view_logs
cls
echo Viewing bot logs (press Ctrl+C to stop)...
echo.
docker-compose logs -f bot
pause
goto menu

:view_status
cls
echo ========================================
echo   Container Status
echo ========================================
echo.
docker-compose ps
echo.
pause
goto menu

:sync_to_docker
cls
echo ========================================
echo   Push Local DB to Docker
echo ========================================
echo.
echo This will OVERWRITE the Docker database with your local database.
echo.
set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
echo Syncing local database to Docker...
call npm run docker:sync-to
echo.
echo Sync complete!
pause
goto menu

:sync_from_docker
cls
echo ========================================
echo   Pull Docker DB to Local
echo ========================================
echo.
echo This will OVERWRITE your local database with the Docker database.
echo.
set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
echo Syncing Docker database to local...
call npm run docker:sync-from
echo.
echo Sync complete!
pause
goto menu

:switch_to_local
cls
echo ========================================
echo   Switch to Local Development
echo ========================================
echo.
echo This will:
echo   1. Sync Docker DB to local (backup production data)
echo   2. Sync Docker data folder to local (welcome images, state files)
echo   3. Stop Docker containers
echo   4. You can then run: npm run dev
echo.
set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
call npm run local:switch
echo.
echo ========================================
echo   Ready for local development!
echo   Run: npm run dev
echo ========================================
pause
goto menu

:switch_to_docker
cls
echo ========================================
echo   Switch to Docker Production
echo ========================================
echo.
echo This will:
echo   1. Rebuild Docker image with current code
echo   2. Start Docker containers
echo   3. Sync local DB to Docker
echo   4. Sync local data folder to Docker (welcome images, state files)
echo.
set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
call npm run docker:switch
echo.
echo ========================================
echo   Docker is now running!
echo ========================================
pause
goto menu

:open_docker_desktop
cls
echo Opening Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo.
echo Docker Desktop is starting...
pause
goto menu

:check_docker
cls
echo ========================================
echo   Docker Status Check
echo ========================================
echo.
echo Checking if Docker is running...
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Docker is running!
    echo.
    echo Container status:
    docker-compose ps
) else (
    echo [X] Docker is NOT running!
    echo.
    echo Please start Docker Desktop first.
)
echo.
pause
goto menu

:end
echo Goodbye!
exit /b 0

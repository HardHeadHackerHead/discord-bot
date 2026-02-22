# Docker Workflow Guide

This document explains how to use Docker for production deployment and the development workflow.

## Development Philosophy

**Docker = Stable Production Version**
- Docker runs the "tried and true" working version of the bot
- Only push to Docker after features are tested and working

**npm = Active Development**
- All new feature development happens with `npm run dev`
- Test thoroughly before deploying to Docker

This means you can have two versions of the bot:
1. **Docker version**: Stable, production-ready code
2. **npm version**: Development code being actively worked on

> **Important**: Only one instance should run at a time (they share the same bot token). Stop Docker before running npm, and stop npm before starting Docker.

## NPM Commands

| Command | Description |
|---------|-------------|
| `npm run docker:switch` | Switch to Docker production (rebuild + sync local DB → Docker) |
| `npm run local:switch` | Switch to local development (sync Docker DB → local + stop Docker) |
| `npm run docker:sync-to` | Sync local MySQL → Docker MySQL (without rebuilding) |
| `npm run docker:sync-from` | Sync Docker MySQL → local MySQL |

## Docker Compose Commands

| Command | Description |
|---------|-------------|
| `docker-compose up -d` | Start containers in background |
| `docker-compose down` | Stop containers |
| `docker-compose down -v` | Stop containers AND delete database volume (fresh start) |
| `docker-compose build` | Rebuild image with current code |
| `docker-compose build bot` | Rebuild only the bot image (faster) |
| `docker-compose build --no-cache` | Rebuild from scratch (ignores cache) |
| `docker-compose logs -f bot` | View bot logs (live) |
| `docker-compose logs --tail=50 bot` | View last 50 lines of bot logs |
| `docker-compose logs -f db` | View database logs (live) |
| `docker-compose restart bot` | Restart just the bot |
| `docker-compose ps` | Check container status |

## Development Workflow

### Starting a New Feature

```powershell
# 1. Stop Docker (keep the stable version's data safe)
docker-compose down

# 2. Optionally sync latest Docker data to local before starting
npm run docker:sync-from

# 3. Start development server with hot-reload
npm run dev

# 4. Develop and test your feature
#    - Make code changes
#    - Test in Discord
#    - Fix bugs
#    - Repeat until working
```

### Deploying to Docker (Feature Complete)

```powershell
# 1. Stop the npm dev server (Ctrl+C)

# 2. Build TypeScript to check for compile errors
npm run build

# 3. If build succeeds, deploy to Docker
docker-compose down                  # Ensure stopped
docker-compose build bot             # Rebuild with new code
docker-compose up -d                 # Start production

# 4. Verify it's working
docker-compose logs --tail=50 bot    # Check startup logs
docker-compose ps                    # Verify containers are running
```

### Quick Reference: Full Deploy Command

```powershell
# One-liner to rebuild and restart Docker
docker-compose down && docker-compose build bot && docker-compose up -d
```

## Typical Scenarios

### 1. "I want to add a new feature"

```powershell
# Stop Docker, develop locally, then deploy when ready
docker-compose down              # Stop Docker
npm run dev                      # Develop with hot-reload
# ... make changes, test thoroughly ...
# When feature is working:
npm run build                    # Verify it compiles
docker-compose build bot && docker-compose up -d  # Deploy
```

### 2. "I need to make a quick bug fix"

```powershell
docker-compose down              # Stop Docker
npm run dev                      # Fix locally
# ... fix the bug, verify it works ...
npm run build                    # Verify it compiles
docker-compose build bot && docker-compose up -d  # Deploy fix
```

### 3. "I want to check what's running in Docker"

```powershell
docker-compose ps                # See container status
docker-compose logs --tail=100 bot  # See recent logs
```

### 4. "Something's broken in Docker, rollback to local development"

```powershell
docker-compose down              # Stop Docker
npm run dev                      # Run locally to debug
```

### 5. "I just want to restart Docker with existing code"

```powershell
docker-compose restart bot
```

### 6. "Something's broken, start completely fresh"

```powershell
docker-compose down -v           # Delete everything including database
docker-compose build --no-cache  # Rebuild from scratch
docker-compose up -d             # Start fresh
npm run docker:sync-to           # Import your local data
```

## Database Sync Strategies

### Before Starting Development
If Docker has been running in production and you want the latest data:
```powershell
npm run docker:sync-from         # Copy Docker DB → Local
```

### After Development Complete
If you made database changes during development that should go to production:
```powershell
npm run docker:sync-to           # Copy Local DB → Docker
```

### Just Sync Database (no rebuild)

```powershell
npm run docker:sync-to    # Local → Docker (after local testing)
npm run docker:sync-from  # Docker → Local (before local testing)
```

## File Locations

| File | Purpose |
|------|---------|
| `Dockerfile` | Defines how the bot image is built |
| `docker-compose.yml` | Defines bot + MySQL services |
| `docker-entrypoint.sh` | Startup script (runs prisma db push if needed) |
| `.env` | Your environment variables (BOT_TOKEN, etc.) |
| `scripts/sync-db-to-docker.ps1` | Local → Docker sync script |
| `scripts/sync-db-from-docker.ps1` | Docker → Local sync script |
| `scripts/switch-to-docker.ps1` | Full switch to production |
| `scripts/switch-to-local.ps1` | Full switch to development |

## Environment Variables

The following environment variables are used by Docker (set in `.env` or `docker-compose.yml`):

| Variable | Description | Default |
|----------|-------------|---------|
| `BOT_TOKEN` | Discord bot token | (required) |
| `CLIENT_ID` | Discord application ID | (required) |
| `NODE_ENV` | Environment mode | `production` |
| `MYSQL_PASSWORD` | MySQL user password | `botpassword` |
| `MYSQL_ROOT_PASSWORD` | MySQL root password | `rootpassword` |
| `LOG_LEVEL` | Logging level | `info` |
| `WEBHOOK_SERVER_PORT` | Port for website webhook server | `3001` |
| `WEBSITE_URL` | Website base URL | (required for website integration) |
| `WEBSITE_WEBHOOK_SECRET` | Shared secret for API auth | (required for website integration) |

## Website Integration in Docker

The bot includes ngrok support inside Docker, so it works the same as local development.

### With Ngrok (Recommended for dynamic URLs)
Set these in your `.env` file:
```
NGROK_ENABLED=true
NGROK_AUTH_TOKEN=your_ngrok_auth_token
NGROK_REGION=us
```

When the bot starts:
1. Ngrok tunnel is created automatically
2. Bot registers the ngrok URL with the website via `/api/discord/register-bot`
3. Website uses the registered URL for all bot communication

This is the easiest setup since the website always gets the current URL automatically.

### Without Ngrok (Static IP/Domain)
If you have a static IP or domain, you can disable ngrok:
```
NGROK_ENABLED=false
```

Then configure your website to use the server's public IP/domain directly:
- Example: `http://your-server-ip:3001`

### Production Setup with Reverse Proxy

For HTTPS in production, use nginx to proxy requests:

```nginx
# /etc/nginx/sites-available/bot-webhook
server {
    listen 443 ssl;
    server_name bot-api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then configure the website to use `https://bot-api.yourdomain.com` as the bot endpoint.

## Troubleshooting

### Port 3306 already in use

If you have MySQL running locally, Docker can't use port 3306. The docker-compose.yml maps to port 3307 externally. If you need to connect to Docker MySQL from your machine:

```
Host: localhost
Port: 3307
User: quadslab
Password: botpassword
Database: quadslab_bot
```

### Database sync fails

1. Make sure Docker containers are running: `docker-compose up -d`
2. Wait for MySQL to be ready (check with `docker-compose logs db`)
3. Try running the sync script directly with verbose output

### Bot won't start - "modules table not found"

The entrypoint script should auto-detect this and run `prisma db push`. If it doesn't:

```powershell
docker-compose exec bot npx prisma db push
docker-compose restart bot
```

### Need to completely reset

```powershell
docker-compose down -v   # Removes volumes (database data)
docker-compose up -d     # Fresh start
npm run docker:sync-to   # Import your local data
```

### Logs appear truncated or frozen

Docker buffers logs. To see real-time output:
```powershell
docker-compose logs -f bot         # Follow logs live
docker logs quadslab-bot 2>&1      # Direct container logs
```

# OpenWA Docker Deployment Guide

## Quick Start

```bash
# Build the image
docker build -t openwa:latest .

# Run the container
docker run -d \
  --name openwa-api \
  -p 2785:2785 \
  --restart unless-stopped \
  openwa:latest

# Verify
curl http://localhost:2785/api/health
```

## With Persistent Data Volume

```bash
# Create volume
docker volume create openwa-data

# Run with volume
docker run -d \
  --name openwa-api \
  -p 2785:2785 \
  -v openwa-data:/app/data \
  --restart unless-stopped \
  openwa:latest
```

## Using Docker Compose (Recommended)

```bash
# Basic (SQLite, local storage)
docker compose up -d

# With PostgreSQL
docker compose --profile postgres up -d

# Full stack (PostgreSQL + Redis + Dashboard)
docker compose --profile full up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Available Profiles

| Profile | Services |
|---------|----------|
| `postgres` | PostgreSQL database |
| `redis` | Redis cache |
| `minio` | S3-compatible storage |
| `with-dashboard` | Web dashboard |
| `with-proxy` | Traefik reverse proxy |
| `full` | All services |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `2785` | API port |
| `DATABASE_TYPE` | `sqlite` | Database type (sqlite/postgres) |
| `DATABASE_HOST` | `postgres` | PostgreSQL host |
| `DATABASE_PORT` | `5432` | PostgreSQL port |
| `DATABASE_USERNAME` | `openwa` | PostgreSQL user |
| `DATABASE_PASSWORD` | `openwa` | PostgreSQL password |
| `REDIS_ENABLED` | `false` | Enable Redis |
| `REDIS_HOST` | `redis` | Redis host |
| `STORAGE_TYPE` | `local` | Storage type (local/s3) |
| `API_MASTER_KEY` | (auto-generated) | Admin API key |
| `PUPPETEER_HEADLESS` | `true` | Run browser in headless mode |

## Container Management

```bash
# Stop
docker stop openwa-api

# Start
docker start openwa-api

# Restart
docker restart openwa-api

# View logs
docker logs -f openwa-api

# Execute command in container
docker exec -it openwa-api sh

# Remove container
docker rm -f openwa-api
```

## Data Persistence

Data is stored in `/app/data` inside the container:
- `data/openwa.sqlite` - Main database
- `data/sessions/` - WhatsApp session data
- `data/media/` - Media files

Mount a volume to persist data:
```bash
docker run -v /path/to/data:/app/data openwa:latest
```

## Ports

| Service | Port | Description |
|---------|------|-------------|
| API | 2785 | REST API endpoints |
| Dashboard | 2886 | Web UI (with --profile with-dashboard) |
| Swagger | 2785/api/docs | API documentation |

## Health Check

```bash
# Check health
curl http://localhost:2785/api/health

# Check readiness
curl http://localhost:2785/api/health/ready
```

## Security Notes

1. **API Key**: Generated on first run, stored in database
2. **Docker Socket**: Mounted read-only for container orchestration
3. **Running as root**: Required for Docker socket access
4. **For stricter security**: Use Docker socket proxy

## Troubleshooting

```bash
# Check if container is running
docker ps | grep openwa

# Check logs
docker logs openwa-api

# Check resource usage
docker stats openwa-api

# Check network
docker exec openwa-api netstat -tlnp
```
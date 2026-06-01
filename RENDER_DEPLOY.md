# Render Deployment Configuration

This guide explains how to deploy OpenWA on Render.

## Option 1: Connect Git Repository (Recommended)

1. Go to [render.com](https://render.com) and sign up/login
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository `ipadyptab-byte/whatsapp-message`
4. Configure the build:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run start:prod`
5. Add environment variables:
   - `NODE_ENV` = `production`
   - `PORT` = `2785`
6. Click **"Create Web Service"**

## Option 2: Docker Deployment

1. Go to [render.com](https://render.com) and sign up/login
2. Click **"New +"** → **"Blueprint"**
3. Or go directly to: https://dashboard.render.com/blueprints
4. Create `render.yaml` in your repository (already added)
5. Click **"Create New Instance"**

## Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Run in production mode |
| `PORT` | `2785` | Port (Render sets this automatically) |
| `DATABASE_TYPE` | `sqlite` | Use embedded SQLite |
| `STORAGE_TYPE` | `local` | Use local file storage |
| `REDIS_ENABLED` | `false` | Disable Redis |
| `QUEUE_ENABLED` | `false` | Disable queue system |

## Disk Configuration

For persistent data, add a **Persistent Disk**:
- **Mount Path:** `/app/data`
- **Size:** 1GB+ recommended
- This stores: SQLite database, session data, media files

## Health Check

Render will automatically check:
- `GET http://localhost:2785/api/health`
- Expected: `{"status":"ok",...}`

## Resource Recommendations

| Plan | Use Case |
|------|----------|
| **Starter** ($7/mo) | Testing, low traffic |
| **Basic** ($15/mo) | Small production |
| **Standard** ($25/mo) | Production with moderate traffic |

## Important Notes

1. **WhatsApp Sessions**: Data is stored in `/app/data/sessions` - ensure persistent disk is attached
2. **No Redis**: Default configuration uses in-memory caching
3. **No PostgreSQL**: Default uses SQLite (sufficient for most use cases)
4. **Single Instance**: WhatsApp sessions don't support horizontal scaling
# ⚡ Activity Tracker Backend v2 — PostgreSQL

Cloud-ready backend API for Activity Tracker. Works with the Chrome extension and Android app.

## Quick Deploy to Railway (Free)

### 1. Push to GitHub
```bash
cd activity-tracker-backend
git init
git add .
git commit -m "Activity Tracker Backend v2"
gh repo create activity-tracker-backend --private --push
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app) → **New Project**
2. Click **Deploy from GitHub Repo** → Select your repo
3. Railway auto-detects Node.js and runs `npm start`
4. **Add PostgreSQL:** Click **+ New** → **Database** → **PostgreSQL**
5. Railway auto-sets `DATABASE_URL` for you
6. **Add environment variable:** `JWT_SECRET` = any random string (e.g. `openssl rand -hex 32`)
7. Your API is live at: `https://your-app.up.railway.app/api`

### 3. Update Your Apps
- **Chrome Extension** Sync tab → Server URL: `https://your-app.up.railway.app/api`
- **Android App** Sync tab → Server URL: `https://your-app.up.railway.app/api`

---

## Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL installed and running

### Setup
```bash
# Create database
psql -c "CREATE DATABASE activity_tracker;"

# Install & run
npm install
cp .env.example .env  # Edit DATABASE_URL if needed
npm start
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/activity_tracker` | PostgreSQL connection string |
| `JWT_SECRET` | Yes | `dev-secret-change-me` | JWT signing key (use random string in prod) |
| `PORT` | No | `3000` | Server port |
| `JWT_EXPIRES_IN` | No | `30d` | Token expiry |
| `NODE_ENV` | No | `development` | Set to `production` for SSL DB connections |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Create account |
| POST | /api/auth/login | — | Login |
| GET | /api/auth/profile | ✅ | User profile + stats |
| POST | /api/devices | ✅ | Register device |
| GET | /api/devices | ✅ | List devices |
| POST | /api/sync/push | ✅ | Push usage data |
| GET | /api/sync/pull | ✅ | Pull aggregated data |
| POST | /api/screenshots/upload-base64 | ✅ | Upload screenshot |
| GET | /api/analytics/daily | ✅ | Daily summary |
| GET | /api/analytics/weekly | ✅ | Weekly summary |
| GET | /api/analytics/trends | ✅ | Week-over-week trends |
| GET | /api/health | — | Health check |

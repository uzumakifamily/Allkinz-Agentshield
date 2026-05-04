# Deploying AgentShield to Railway

This guide walks you through a production deployment of AgentShield on Railway from scratch. Estimated time: 15 minutes.

---

## Prerequisites

- A [Railway](https://railway.app) account (free tier works)
- The [Railway CLI](https://docs.railway.app/develop/cli) installed: `npm install -g @railway/cli`
- A [Brevo](https://brevo.com) account for transactional email (free tier: 300 emails/day)
- (Optional) Google OAuth credentials for Google sign-in

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/allkinz/agent-shield
cd agent-shield
```

---

## Step 2 — Log in to Railway

```bash
railway login
```

Follow the browser prompt to authenticate.

---

## Step 3 — Create a new Railway project

```bash
railway init
```

Select **Empty Project** when prompted. Give it a name like `agentshield`.

---

## Step 4 — Set environment variables

Set all required env vars via the Railway dashboard or CLI:

```bash
# Required
railway variables set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
railway variables set NODE_ENV=production

# Email (Brevo)
railway variables set BREVO_API_KEY="xkeysib-your-actual-key"
railway variables set EMAIL_FROM="noreply@yourdomain.com"
railway variables set EMAIL_FROM_NAME="AgentShield"

# Google OAuth (optional — skip if not using Google sign-in)
railway variables set GOOGLE_CLIENT_ID="your-google-client-id"
railway variables set GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

> **Do not** set `PORT` — Railway injects this automatically.

---

## Step 5 — Add a persistent volume for SQLite

AgentShield uses SQLite. Railway ephemeral filesystems are wiped on redeploy, so you must attach a volume:

1. In the Railway dashboard, open your service
2. Go to **Settings → Volumes**
3. Click **Add Volume**
4. Mount path: `/data`
5. Set the env var: `railway variables set DATABASE_PATH=/data/shield.db`

The volume persists across deployments. Your audit logs and user data survive restarts.

---

## Step 6 — Deploy

```bash
railway up
```

Railway will build from `package.json` → `npm install` → `npm start` (`node server.js`).

Watch the build logs in the dashboard or with:

```bash
railway logs
```

---

## Step 7 — Verify the deployment

Once the build shows **Deploy successful**, check the health endpoint:

```bash
curl https://your-project.up.railway.app/health
# → { "status": "ok", "version": "1.0.0", "timestamp": "..." }
```

---

## Step 8 — Set up a custom domain (optional)

1. In the Railway dashboard → your service → **Settings → Domains**
2. Click **Add Custom Domain**
3. Enter your domain (e.g. `agentshield.yourdomain.com`)
4. Railway provides a CNAME record — add it to your DNS provider
5. Railway auto-provisions a TLS certificate via Let's Encrypt

---

## Step 9 — Configure Google OAuth redirect URI (if using Google sign-in)

In the Google Cloud Console → your OAuth 2.0 credential:
- Add authorised redirect URI: `https://agentshield.yourdomain.com/api/auth/google/callback`
- Add authorised JavaScript origin: `https://agentshield.yourdomain.com`

---

## Step 10 — Update Plausible Analytics domain (optional)

If you forked the repo and changed the domain, update the Plausible script in `public/index.html`:

```html
<script defer data-domain="your-actual-domain.com" src="https://plausible.io/js/script.js"></script>
```

---

## Redeploy after code changes

```bash
git add .
git commit -m "your change"
railway up
```

Or connect Railway to your GitHub repo for automatic deploys on push.

---

## Useful Railway commands

```bash
railway status        # current deployment status
railway logs          # stream logs
railway shell         # open shell in running container
railway variables     # list all env vars
railway open          # open project in browser
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Cannot find module './db'` | Run `npm install` locally first, then `railway up` |
| SQLite data lost on redeploy | Make sure the volume is mounted at `/data` and `DATABASE_PATH=/data/shield.db` is set |
| OTP emails not arriving | Check `BREVO_API_KEY` is correct and `EMAIL_FROM` is a verified sender in Brevo |
| Google OAuth redirect mismatch | Ensure the redirect URI in Google Console exactly matches `https://your-domain/api/auth/google/callback` |
| 502 on Railway | Check `railway logs` — usually a missing env var (`JWT_SECRET`) or a port binding issue |

---

## Architecture note

Railway injects `PORT` automatically. The server binds to `0.0.0.0:$PORT` which is what Railway's reverse proxy expects. Never hard-code port 3000 in production.

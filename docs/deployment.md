# Deployment

BRIDGE needs **one always-on web service that supports WebSockets** and a **PostgreSQL** database. The Docker image serves the API, the WebSocket endpoint and the web app from one origin, so HTTPS and WSS just work behind any host's TLS.

**Recommended: Render Blueprint** (`render.yaml`): one Docker web service + one managed PostgreSQL, both in Singapore. About $7/month (Starter web) + $6/month (basic-256mb Postgres). Set the database plan to `free` to trial it (Render deletes free databases after 30 days). Supabase is an alternative free database (section 1).

> Vercel/Netlify alone won't work: their serverless functions don't keep WebSocket connections open. You can host the web app there, but the API must run on a WebSocket-capable host (option C).

---

## Quick path: Render Blueprint (~10 minutes)

The code is already on GitHub (`Ashish-Manash01/Bridge`).

1. Sign in at **render.com** with GitHub (this lets Render read the repo).
2. **New → Blueprint** → select `Bridge` → Render reads `render.yaml` and plans two resources: the `bridge` web service and the `bridge-db` database.
3. When prompted, paste `SARVAM_API_KEY` (and optionally `MYMEMORY_CONTACT_EMAIL`). `SECRET_KEY` is generated and `DATABASE_URL` is wired to the database automatically.
4. **Apply**. The first build takes ~5–8 minutes (web app build + Python image). Migrations run on start.
5. Open `https://bridge-xxxx.onrender.com/api/health`. Expect `{"status":"ok","database":true,"environment":"production"}`.
6. Optional verification from your PC: `cd services/api && python -m scripts.smoke_live https://bridge-xxxx.onrender.com` (44 live checks; uses a little Sarvam credit).
7. Test with 2–3 phones (checklist in `docs/testing.md`).

Every push to `main` redeploys automatically (`autoDeploy: true`).

Custom domain: Render → bridge → Settings → Custom Domains → add `bridge.yourdomain.com` and create the CNAME it shows. HTTPS is automatic.

## 1. Alternative database: Supabase (free tier)

1. supabase.com → **New project** → region Mumbai (`ap-south-1`) → set a database password.
2. **Project Settings → Database → Connection string → URI**, **Session pooler** (port 5432):
   `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
3. In `render.yaml`, replace the `fromDatabase` block of `DATABASE_URL` with `sync: false`, delete the `databases:` section, and paste this URI when prompted. BRIDGE converts `postgresql://` to the async driver automatically and is pooler-compatible.

Backups: Render paid Postgres and Supabase both keep daily backups. To delete everything: `DELETE FROM rooms;` cascades to participants, utterances, translations, feedback, glossary and summaries.

## 2B. App: Railway or Fly.io (alternatives)

**Railway:** New Project → Deploy from GitHub repo (detects the `Dockerfile`) → add a PostgreSQL plugin → Variables: `BRIDGE_ENV=production`, `SECRET_KEY`, `DATABASE_URL` (from the plugin), the provider variables and `SARVAM_API_KEY`; `PORT` is provided automatically → Settings → Networking → Generate Domain.

**Fly.io:**
```bash
fly launch --no-deploy          # detects the Dockerfile; pick region bom (Mumbai)
fly secrets set SECRET_KEY=... DATABASE_URL=... SARVAM_API_KEY=...
fly deploy
```
Keep at least one machine running (`min_machines_running = 1`) so WebSockets aren't cut by scale-to-zero.

## 2C. Split hosting (web on Vercel, API elsewhere)

1. Deploy the API as in 2A/2B (it still works without the web app).
2. Vercel → Import repo → Root directory `apps/web` → Framework Next.js → env vars:
   `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`, `NEXT_PUBLIC_WEB_URL=https://yourdomain.com` → Deploy.
3. Set the API's `CORS_ORIGINS=https://yourdomain.com`.

## 3. Switching to production providers (when you have keys)

Set env vars on the host and redeploy; no code changes:

```
STT_PROVIDER=sarvam
TRANSLATION_PROVIDER=sarvam
TRANSLATION_FALLBACK_PROVIDER=mymemory
TTS_PROVIDER=sarvam
SARVAM_API_KEY=...
SARVAM_TRANSLATE_MODE=formal        # optional; default
SARVAM_TTS_MODEL=bulbul:v3          # optional; default (v2 is retired)
```

Then run the evaluation from your machine against the same config (`python -m scripts.evaluate_providers` with the keys in `.env`) and commit the updated `app/core/evaluation_results.json`.

## 4. Staging vs production

Create a second Render service (or Railway environment) named `bridge-staging` from the same repo, with its **own** Supabase project and `BRIDGE_ENV=staging`. Test there first (including the e2e suite: `E2E_BASE_URL=https://bridge-staging.onrender.com npm run test:e2e`), then promote.

## 5. Operations checklist

- [ ] `/api/health` monitored (Render does this; add UptimeRobot for alerts)
- [ ] Logs: Render → Logs (structured JSON, no message content)
- [ ] Cost: `usage_records` table holds provider usage and estimated cost per room
- [ ] Limits tuned in env (`MAX_PARTICIPANTS_PER_ROOM`, `MAX_AUDIO_SECONDS_PER_ROOM`, rate limits)
- [ ] Run a single instance (in-process realtime hub). For multiple instances see `docs/architecture.md#scaling-notes`
- [ ] Privacy policy published before public launch (`docs/privacy.md`)
- [ ] Provider data-retention terms reviewed

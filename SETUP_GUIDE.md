# DashView — Odoo Live Setup Guide

## How it works (after this fix)

```
Your Browser  →  Cloudflare Worker (free proxy)  →  Your Odoo
```

- **No Node.js server needed**
- **No backend to host**
- **Works on GitHub Pages as-is**
- The Cloudflare Worker sits between your browser and Odoo, handles CORS, and can be locked to your own site and Odoo host (see `wrangler.jsonc`). Note: the API key is stored in this browser and sent to your Worker with each request, so it is visible in the browser's network tab — use a dedicated read-only Odoo user

---

## Setup — 3 steps, ~5 minutes

### Step 1 — Create an Odoo API Key

1. Login to your Odoo instance
2. Go to **Settings → Users → [Your User] → Account Security**
3. Click **New API Key** → give it a name (e.g. "DashView") → copy the key
4. ⚠️ Use this API key, NOT your login password

### Step 2 — Deploy the Cloudflare Worker (free)

1. Go to [workers.cloudflare.com](https://workers.cloudflare.com) → create a free account (no credit card)
2. Click **"Create Worker"**
3. Replace all the default code with the contents of **`cloudflare-worker.js`** from this project
4. Click **"Save & Deploy"**
5. Copy the Worker URL (looks like: `https://dashview-proxy.YOUR-NAME.workers.dev`)

### Step 3 — Configure the Dashboard

1. Open your dashboard (GitHub Pages URL or locally)
2. Go to **Settings** → **Odoo integration**
3. Fill in:
   - **Odoo URL**: `https://yourcompany.odoo.com` (or your self-hosted URL)
   - **Database**: your database name (found in Odoo URL or Settings)
   - **Username/email**: your Odoo login email
   - **API key**: the key you created in Step 1
   - **Proxy URL**: the Worker URL from Step 2
4. Click **"Connect to Odoo"**
5. Navigate to **Odoo (Live)** in the sidebar — your live data will load!

---

## What you get

### Odoo (Live) tab
- **Modules rail** — browse all your installed Odoo modules
- **Model browser** — see all data models (Sales Orders, Leads, Products, etc.)
- **Live records table** — paginated, real-time data with search & filters
- **Executive breakdown** — group by any field (Stage, Salesperson, etc.) and see totals
- **Saved views** — save filter+groupby combinations for quick access
- **Auto-refresh** — configurable interval to keep data current

### Settings panel indicators
- Connection status (Live / Demo / Not connected)
- Last tested timestamp

---

## Troubleshooting

### "Authentication failed"
- Double-check your Odoo URL, database name, and username
- Make sure you're using an **API key**, not your login password
- For Odoo Online (`*.odoo.com`), the database name is usually the subdomain

### "Network error" or "Could not reach Odoo"
- Verify the Cloudflare Worker is deployed and the URL is correct
- Check that your Odoo instance allows external HTTPS access
- For self-hosted Odoo, make sure port 443/80 is open and accessible

### "No models found" after selecting a module
- This is normal for some utility modules that don't define their own models
- Try selecting a different module (e.g. "Sales", "CRM", "Inventory")

### Data loads but shows demo content
- Make sure the **Proxy URL** field is filled in (without it, it falls to demo mode)
- Check the status pill next to "Live Odoo" — it should show "● Live — connected"

---

## Production tips (CEO/Director scale)

- **CORS lock-down**: Set `ALLOWED_ORIGINS` and `ALLOWED_ODOO_HOSTS` in the Worker variables to exact production values; do not rely on wildcard defaults
- **Read-only user**: Create a dedicated read-only Odoo user for the dashboard instead of using an admin account
- **Browser credential warning**: Worker/browser mode can expose the API key to the browser session. For production, prefer the authenticated Node or FastAPI service with server-managed credentials.
- **Rate limiting**: Cloudflare Workers free tier = 100,000 requests/day — plenty for a director dashboard
- **Heavy reports**: Consider adding a caching layer in the Worker for expensive `read_group` calls

---

## Files changed in this fix

| File | Change |
|------|--------|
| `cloudflare-worker.js` | Added missing `models` endpoint for module→model browsing |
| `js/odoo-live.js` | **Completely rewritten** — removed Node.js server dependency, now calls Cloudflare Worker directly |
| `js/odoo-service.js` | Added `dv:odoo-config-saved` event dispatch so Live view reloads when Settings are saved |
| `dashboard.html` | Updated banner text, settings steps, and browse link |
| `SETUP_GUIDE.md` | This file |

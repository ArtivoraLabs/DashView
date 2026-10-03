# DashView — GitHub se Deploy karna (Free, No Server)

## ✅ Step 1: GitHub Pages ON karo (1 minute)

1. GitHub pe apna repo kholo
2. **Settings** → **Pages** (left sidebar mein)
3. **Source**: `GitHub Actions` select karo
4. Save karo

Ab har baar `main` branch pe push karne pe auto-deploy ho jaayega. ✅

**Tumhara live URL:**
```
https://TUMHARA-USERNAME.github.io/REPO-NAME/
```

---

## ✅ Step 2: Odoo Connect karna (Cloudflare Worker — Free)

> **Production safety:** The Worker/browser flow is intended for low-trust or
> development deployments. Configure exact `ALLOWED_ORIGINS` and
> `ALLOWED_ODOO_HOSTS` values before deploying, and use a dedicated read-only
> Odoo account. Never put an administrator credential in the browser.

### 2a. Cloudflare Worker deploy karo (5 minute)

1. **workers.cloudflare.com** kholo → Free account banao (no credit card)
2. **"Create Application"** → **"Create Worker"**
3. Is repo ka `cloudflare-worker.js` file ka sara code copy karo
4. Worker editor mein paste karo → **Save & Deploy**
5. Worker variables mein `ALLOWED_ORIGINS` (exact dashboard origin) aur
   `ALLOWED_ODOO_HOSTS` (exact Odoo hostname) set karo
6. Worker URL copy karo:
   ```
   https://dashview-proxy.TUMHARA-NAME.workers.dev
   ```

### 2b. Dashboard mein configure karo

Dashboard kholo → **Settings** → **Odoo integration**:

| Field | Value |
|-------|-------|
| Odoo URL | `https://yourcompany.odoo.com` |
| Database | `yourcompany-live` |
| Username | `admin@yourcompany.com` |
| API Key | (Odoo → Settings → Users → API Keys) |
| Proxy URL | `https://dashview-proxy.NAAM.workers.dev` |

**Connect to Odoo** dabao → Live data aane lagega ✅

---

## Kya kya free milta hai

| Service | Cost | Kya karta hai |
|---------|------|---------------|
| GitHub Pages | FREE | Dashboard host karta hai |
| GitHub Actions | FREE | Auto-deploy karta hai |
| Cloudflare Workers | FREE | Odoo proxy (100k req/day) |

**Koi credit card nahi, koi server nahi, koi subscription nahi.**

---

## Local development (optional)

```bash
# Sirf frontend chalana:
# koi bhi file manager mein dashboard.html double-click karo

# Backend + Odoo proxy locally:
cd server
cp .env.example .env    # apni values fill karo
npm install
npm start               # :4000 pe chalta hai
```

---

## Repo structure

```
/
├── .github/
│   └── workflows/
│       └── static.yml         ← Auto-deploy GitHub Actions
├── js/
│   └── odoo-service.js        ← Updated: Cloudflare Worker support
├── server/                    ← Optional Node.js backend
├── cloudflare-worker.js       ← Cloudflare Worker proxy code
├── dashboard.html             ← Main dashboard
└── DEPLOY.md                  ← Ye file
```

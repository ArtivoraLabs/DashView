# DashView

Live GitHub organization dashboard for **ArtivoraLabs** — projects, task
status and repository activity, pulled automatically from the GitHub
GraphQL API and displayed on a glass-styled landing page and dashboard.

## What's here

- `index.html` — marketing / landing page
- `dashboard.html` — the live dashboard (projects, charts, repositories)
- `script.js` — fetches `/api/dashboard` and renders everything
- `server.js` — Express server that queries GitHub on the dashboard's behalf
- `style.css` — unused now (all styling was moved inline into the two HTML
  files); safe to delete

## 1. Install dependencies

```bash
npm install
```

## 2. Configure your GitHub token

Never put a real token directly in `server.js` or commit it to git — that
was how the original version was set up, and anyone with the source could
use it. Instead:

1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```
2. [Create a GitHub token](https://github.com/settings/tokens) with:
   - Classic token → `repo` and `read:org` scopes, **or**
   - Fine-grained token → **Projects: Read-only** and **Contents: Read-only**
     on the ArtivoraLabs org
3. Put it in `.env`:
   ```
   GITHUB_TOKEN=ghp_your_token_here
   GITHUB_ORG=ArtivoraLabs
   ```

`.env` is already in `.gitignore` so it never gets committed.

## 3. Run it

```bash
npm start
```

Then open **http://localhost:3000** — this serves the landing page,
dashboard, and API from one server, so live data works everywhere on the
site out of the box.

## How the data flows

- New projects you create in the ArtivoraLabs org, and any repositories
  the token can see, show up on the dashboard automatically on the next
  sync — nothing needs to be added by hand.
- The dashboard polls `/api/dashboard` on load and every 5 minutes, and
  the **Refresh** button forces an immediate re-sync.
- Each project card links out to its board on GitHub ("View board"), and
  each repository links to its GitHub page — that's the "open project"
  action.
- Responses are cached server-side for 60 seconds (configurable via
  `CACHE_TTL_MS`) to stay well within GitHub's API rate limits.

## Deploying

`server.js` needs somewhere that runs Node (Render, Railway, Fly.io, a VPS,
etc.) — GitHub Pages only serves static files, so it can't host the API.

If you deploy the API and the static pages to different origins, set
`ALLOWED_ORIGINS` in the API's environment to the static site's URL, and
change the `API` constant at the top of `script.js` to the API's full URL.

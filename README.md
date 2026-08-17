# ArtivoraLabs - AI Platform Landing Page

A fully static, dependency-free landing page for an AI platform, built with
plain **HTML, CSS, and JavaScript** - no build step, no framework, no
`node_modules`. Features an Apple-inspired "liquid glass" design system with
scroll-driven animations, a working AI command-bar demo, a simulated
developer workspace, and a functional GitHub integration panel.

**Live demo:** deploy in one click with GitHub Pages (see below).

---

## ✨ Features

- **Liquid glass UI system** - blurred glass panels, pointer-tracked highlight, glass buttons/pills/inputs
- **Animated hero** - video/gradient background, staggered entrance animation, rotating placeholder prompts
- **Working AI command bar** - type or click a suggestion chip and get a simulated, keyword-matched reply with a "thinking" animation
- **Live capability search** - filter the 12 capability cards in real time
- **Animated stat counters** that count up when scrolled into view
- **Autonomous workflow demo** - self-advancing step tracker
- **Developer workspace simulation** - clickable file explorer that swaps syntax-highlighted code, a self-typing terminal, git change list, and AI task timeline
- **GitHub panel** - editable repo name, 9 working action buttons that write to a live activity log, selectable branches, copyable commit hashes
- **Early-access modal** - validated email form with a success state
- **Newsletter signup** in the footer
- **Scrollspy navigation**, scroll progress bar, back-to-top button
- Fully responsive (mobile / tablet / desktop) and respects `prefers-reduced-motion`
- **AI Studio** - three genuinely functional, client-side tools (no backend, no API key):
  - **Image Generator** - type a prompt, pick a style and palette, and get a unique
    procedurally-generated SVG image (seeded off your prompt text so results are
    reproducible). Download as real `.svg` or rasterized `.png`.
  - **Code Debugger** - real static analysis in the browser: genuine JavaScript
    syntax checking (`new Function`), JSON validation (`JSON.parse`), HTML tag-balance
    checking (`DOMParser`), and structural heuristics for Python (indentation,
    bracket balance, missing colons). Produces a code health score and a findings list.
  - **Report Studio** - fill in a title, summary, bullet points, and a CSV data table,
    then export a real downloadable **Word report (.docx)**, **PowerPoint deck (.pptx)**
    with an auto-generated chart slide, or **Excel workbook (.xlsx)** - built client-side
    with `docx`, `pptxgenjs`, and `SheetJS` (loaded from CDN on first use).
- **Dashboard** (`dashboard.html`) - a workspace intelligence view, linked from the main
  nav:
  - **Connect GitHub** button in the top bar - type a GitHub username or org (public
    accounts need no token) and the dashboard re-renders from real data: your repos,
    their language/health grade, open PRs and issues, your recent public events, and
    a 14-day commit/PR chart. Disconnect any time to fall back to demo data - nothing
    is ever sent anywhere except `api.github.com`, and the connection only lives in
    this browser's `localStorage` (see `js/github-live.js`).
  - **Add project** button - create your own project cards (name, status, progress,
    open PRs, link) that live in `localStorage` and sit alongside your GitHub-derived
    rows in the same table, each editable/deletable inline. This works whether or not
    you're connected to GitHub.
  - KPI row, a shipping-velocity chart, a live activity feed, and a searchable/
    exportable (CSV) projects table - all driven by the shape defined in
    `js/dashboard-data.js` (the demo generator) or `js/github-live.js` (the real
    fetcher), so the rendering code doesn't care which one is active.
- **AI Assistant** (`ai.html`) - a chat interface that runs **entirely client-side,
  with no API key and no network calls**. Your message is scored against a small
  local topic library (rate limiting, testing/CI, refactors, auth, webhooks,
  databases, performance, deploys, git/PRs, debugging, code review, docs, security)
  in `js/assistant.js`, and it replies with a tailored, structured answer for the
  best-matching topic - including a fallback plan when nothing matches well. Ask it
  directly ("are you a real AI?") and it will tell you plainly how it works.

## 📁 Project structure

```
├── index.html              # Landing page markup
├── dashboard.html          # Workspace dashboard (KPIs, charts, activity log, repos)
├── 404.html                # Branded not-found page (GitHub Pages picks this up automatically)
├── manifest.json           # Web app manifest (add-to-home-screen)
├── robots.txt
├── sitemap.xml
├── CHANGELOG.md            # Production-readiness audit + merge log
├── css/
│   ├── globals.css         # Design tokens, reset, reveal-on-scroll, toasts
│   ├── glass.css           # Liquid glass component system + modal
│   ├── navbar.css
│   ├── hero.css             # Hero, AI input, capability cards, stat strip
│   ├── workspace.css       # Dev workspace, GitHub panel, footer
│   ├── studio.css          # AI Studio: image generator, debugger, report builder
│   ├── dashboard.css       # Dashboard shell, KPIs, charts, activity log, repo table
│   └── responsive.css
├── js/
│   ├── github-config.js      # Paste a repo (and optional token) here for a LIVE GitHub panel
│   ├── main.js               # Core site interactivity (vanilla JS, no dependencies)
│   ├── studio.js             # AI Studio logic (image gen, code analysis, doc export)
│   ├── dashboard-data.js     # Deterministic demo-data generator (swap point for a real API)
│   └── dashboard.js          # Dashboard rendering + interactions (charts, ⌘K, shortcuts, CSV)
├── assets/
│   ├── favicon.svg
│   ├── favicon-16x16.png / favicon-32x32.png / apple-touch-icon.png
│   ├── icon-192.png / icon-512.png    # manifest.json icons
│   └── og-image.png                    # Open Graph / Twitter social preview (1200×630)
└── .github/workflows/static.yml   # Auto-deploy to GitHub Pages
```

## ✅ Before you launch

This project has been through a production-readiness pass - see
[`CHANGELOG.md`](CHANGELOG.md) for the full list of what was audited and
fixed. Two things need your input before a real deploy:

1. **Replace the placeholder domain.** `your-domain.example.com` appears in
   `index.html`'s canonical/Open Graph/Twitter tags, `sitemap.xml`, and
   `robots.txt`. Search-and-replace it with your real domain once you know it.
2. **Replace the hero background video.** The current `<source>` URL in
   `.hero-video-wrapper` points to a CloudFront link from another generation
   platform - convenient for a demo, but not something you own or control
   long-term. Swap in a video hosted on your own domain/CDN before launch (the
   gradient fallback already handles it gracefully either way if the request
   ever fails).

## 🔌 Show a real GitHub repo (optional)

The GitHub panel on the homepage (`#github`) ships with demo data. To make
it live:

1. Open `js/github-config.js`.
2. Set `repo: 'owner/repo'` to a real repository.
3. Leave `token: ''` blank if the repo is public - that's enough for stars,
   language, branches, and recent commits (60 requests/hour).
4. Only add a token for the higher rate limit or a private repo - **read
   the warning comment at the top of that file first.** This is a static
   site with no backend, so anything in that file is visible to anyone who
   views the page source.

If the repo field is empty, or the request fails for any reason (rate
limit, network, typo), the panel just keeps showing the demo data - nothing
breaks.

## 🚀 Run it locally

No build step required. Any static file server works:

```bash
# Option 1 - Python
python3 -m http.server 8080

# Option 2 - Node
npx serve .

# Option 3 - VS Code
# Right-click index.html → "Open with Live Server"
```

Then open `http://localhost:8080`.

> Opening `index.html` directly via `file://` also works. A gradient
> fallback is wired up via the `onerror` handler on the `<video>` tag in
> case the remote background video can't be reached (e.g. no internet
> connection, or a strict local network policy).

## 🌐 Deploy live with GitHub Pages

1. Create a new GitHub repository and push this project to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - ArtivoraLabs landing page"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. In your repository on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main` (or re-run the workflow from the **Actions** tab) - the
   included workflow at `.github/workflows/static.yml` will build and deploy
   automatically.
5. Your site will be live at `https://<your-username>.github.io/<your-repo>/`.

Every subsequent push to `main` redeploys automatically - no extra
configuration needed.

### Using a custom domain

Add a `CNAME` file at the project root containing your domain
(e.g. `artivoralabs.ai`), then point your DNS `A`/`CNAME` records at GitHub
Pages per [GitHub's custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).

## 🎨 Customizing

- **Colors / spacing / radii** - edit the CSS variables at the top of `css/base.css`
- **Copy & content** - edit directly in `index.html`
- **AI assistant replies** - edit the `TOPICS` array in `js/assistant.js` (keywords +
  response templates); the matching logic itself (`buildResponse`) doesn't need to
  change when you just want to add or tweak a topic
- **Dashboard projects** - use the "Add project" button in the UI (stored in
  `localStorage`, no file editing needed), or edit `js/dashboard-data.js` to change
  the demo dataset shown before you connect a real GitHub account
- **Hero background video** - swap the `<source>` URL inside `.hero-video-wrapper` in `index.html`

## 🧩 Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses
`backdrop-filter` for the glass effect, `IntersectionObserver` for scroll
reveals, and the Clipboard API for copy buttons - all with graceful
degradation where unsupported.

## 📄 License

MIT - see [LICENSE](LICENSE).

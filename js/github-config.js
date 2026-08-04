/**
 * NeuralKinetics — GitHub API configuration
 * ---------------------------------------------------------------
 * Paste your details below to make the GitHub panel on the
 * homepage (#github) show a REAL repository instead of demo data.
 *
 *   repo  → "owner/repo", e.g. "vercel/next.js" or your own repo
 *   token → OPTIONAL. A GitHub Personal Access Token.
 *
 * ── Do you need a token at all? ──────────────────────────────
 * No, if the repo is public. Unauthenticated requests already
 * work and are enough to show stars, language, branches and
 * recent commits — you just get 60 requests/hour per visitor.
 *
 * Only add a token if you need the higher 5,000 req/hour limit,
 * or the repo is private.
 *
 * ── READ THIS BEFORE PASTING A TOKEN ─────────────────────────
 * This site is a static frontend (see .github/workflows/static.yml)
 * with no server. ANY value you put in this file ships as plain
 * text in the deployed site's source — every visitor's browser can
 * read it via "View Source", and if this repo is public on GitHub,
 * it's also permanently visible in your git history.
 *
 * So:
 *   1. If this site is going to be public, do NOT paste a real
 *      token here. Leave `token: ''` and rely on the 60/hour
 *      unauthenticated limit — it's the safe default.
 *   2. If you must use a token (e.g. running this only locally,
 *      or the repo is not public), create a *fine-grained* PAT at
 *      https://github.com/settings/tokens?type=beta scoped to
 *      "Only select repositories" → this one repo → Repository
 *      permissions → Contents: Read-only, Metadata: Read-only.
 *      Never use a classic token with broad "repo" or "admin"
 *      scopes here.
 *   3. Add this file to .gitignore (already done below in the
 *      repo root) before committing, so the token never reaches
 *      git history or a public deploy.
 *   4. Rotate/revoke the token immediately if you ever paste it
 *      into a repo you push publicly by mistake.
 * ---------------------------------------------------------------
 */
window.NK_GITHUB_CONFIG = {
  // The repository to display, as "owner/repo".
  repo: '',

  // Optional. Leave blank unless you've read the warning above.
  token: ''
};

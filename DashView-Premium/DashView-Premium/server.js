/**
 * DashView Premium · server.js
 * ArtivoraLabs Organization Intelligence Platform
 *
 * Express server that:
 *   • Queries GitHub GraphQL API for org projects + repositories
 *   • Caches responses in-memory (TTL: 60 s, refreshed in the background)
 *   • Exposes /api/dashboard, /api/health, and serves static files
 */

'use strict';

const express = require('express');
const https   = require('https');
const path    = require('path');
require('dotenv').config();

// ── Config ──────────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT, 10) || 3000;
const GH_TOKEN   = process.env.GITHUB_TOKEN;
const GH_ORG     = process.env.GITHUB_ORG || 'ArtivoraLabs';
const CACHE_TTL  = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60;   // seconds
const LOG_LEVEL  = (process.env.LOG_LEVEL || 'info').toLowerCase();

if (!GH_TOKEN) {
  console.error('❌  GITHUB_TOKEN is not set. Create a .env file — see .env.example.');
  process.exit(1);
}

// ── Logger ──────────────────────────────────────────────────────
const log = {
  info:  (...a) => LOG_LEVEL !== 'silent' && console.log ('ℹ ', ...a),
  warn:  (...a) => LOG_LEVEL !== 'silent' && console.warn('⚠ ', ...a),
  error: (...a) => console.error('✖ ', ...a),
  debug: (...a) => LOG_LEVEL === 'debug'  && console.log ('[debug]', ...a),
};

// ── GitHub GraphQL query ─────────────────────────────────────────
const QUERY = `
  query OrgDashboard($org: String!) {
    organization(login: $org) {
      name
      url
      description
      projectsV2(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          id number title shortDescription closed url updatedAt
          items(first: 100) {
            nodes {
              id
              content {
                ... on Issue      { state title url createdAt closedAt }
                ... on PullRequest { state title url createdAt closedAt }
                ... on DraftIssue  { title createdAt }
              }
            }
          }
        }
      }
      repositories(
        first: 30,
        orderBy: { field: UPDATED_AT, direction: DESC },
        privacy: PUBLIC
      ) {
        nodes {
          name description url isPrivate updatedAt pushedAt
          stargazerCount forkCount openIssues: issues(states: OPEN)  { totalCount }
          primaryLanguage { name color }
          defaultBranchRef { name }
          licenseInfo       { spdxId }
        }
      }
    }
  }
`;

// ── GitHub GraphQL fetcher ───────────────────────────────────────
function ghFetch(query, variables) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify({ query, variables });
    const opts   = {
      hostname: 'api.github.com',
      path:     '/graphql',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':    `DashView/2.0 (${GH_ORG})`,
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.errors?.length) {
            return reject(new Error(parsed.errors.map(e => e.message).join('; ')));
          }
          resolve(parsed.data);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('GitHub request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── In-memory cache ──────────────────────────────────────────────
let cache = {
  data:       null,
  fetchedAt:  null,
  inFlight:   false,
  error:      null,
};

function isFresh() {
  return cache.data && cache.fetchedAt && (Date.now() - cache.fetchedAt) < CACHE_TTL * 1000;
}

async function refreshCache({ background = false } = {}) {
  if (cache.inFlight) {
    log.debug('Skipping refresh — already in flight');
    return;
  }
  cache.inFlight = true;
  log.info(`Fetching org data from GitHub GraphQL (org: ${GH_ORG})…`);

  try {
    const data      = await ghFetch(QUERY, { org: GH_ORG });
    cache.data      = data;
    cache.fetchedAt = Date.now();
    cache.error     = null;
    log.info(`✔ Cache refreshed — ${data.organization.projectsV2.nodes.length} projects, ${data.organization.repositories.nodes.length} repos`);
  } catch (e) {
    log.error('GitHub fetch failed:', e.message);
    cache.error = e.message;
    if (background && cache.data) {
      log.warn('Serving stale cache after background refresh failure');
    }
  } finally {
    cache.inFlight = false;
  }
}

// ── Express app ──────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Serve static files from the same directory
app.use(express.static(path.join(__dirname)));

// Simple request logger
app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.path}`);
  next();
});

// ── GET /api/health ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:     'ok',
    org:        GH_ORG,
    port:       PORT,
    cached:     !!cache.data,
    cacheAge:   cache.fetchedAt ? Math.round((Date.now() - cache.fetchedAt) / 1000) : null,
    cacheTtl:   CACHE_TTL,
    lastError:  cache.error || null,
    version:    '2.0.0',
    timestamp:  new Date().toISOString(),
  });
});

// ── GET /api/dashboard ───────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';

  try {
    if (forceRefresh || !cache.data) {
      await refreshCache();
    } else if (!isFresh()) {
      // Return stale data immediately, refresh in background
      refreshCache({ background: true });
    }

    if (!cache.data) {
      const code = cache.error ? 502 : 503;
      return res.status(code).json({ error: cache.error || 'Data not yet available. Retry in a moment.' });
    }

    res.json({
      ...cache.data,
      cached:    !forceRefresh,
      stale:     !isFresh(),
      fetchedAt: cache.fetchedAt,
      cacheAge:  Math.round((Date.now() - cache.fetchedAt) / 1000),
    });
  } catch (e) {
    log.error('/api/dashboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 404 → index.html (SPA fallback) ─────────────────────────────
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Boot ─────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('');
  console.log('  ██████╗  █████╗ ███████╗██╗  ██╗██╗   ██╗██╗███████╗██╗    ██╗');
  console.log('  ██╔══██╗██╔══██╗██╔════╝██║  ██║██║   ██║██║██╔════╝██║    ██║');
  console.log('  ██║  ██║███████║███████╗███████║██║   ██║██║█████╗  ██║ █╗ ██║');
  console.log('  ██║  ██║██╔══██║╚════██║██╔══██║╚██╗ ██╔╝██║██╔══╝  ██║███╗██║');
  console.log('  ██████╔╝██║  ██║███████║██║  ██║ ╚████╔╝ ██║███████╗╚███╔███╔╝');
  console.log('  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝ ');
  console.log('');
  console.log(`  ArtivoraLabs Intelligence Platform  v2.0`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📊  http://localhost:${PORT}/dashboard.html`);
  console.log(`  ♻️   http://localhost:${PORT}/api/dashboard`);
  console.log(`  🩺  http://localhost:${PORT}/api/health`);
  console.log(`  🏢  Org: ${GH_ORG}   Cache TTL: ${CACHE_TTL}s`);
  console.log('');

  // Warm the cache immediately on boot
  await refreshCache();

  // Schedule background refreshes
  setInterval(() => refreshCache({ background: true }), CACHE_TTL * 1000);
  log.info(`Background cache refresh every ${CACHE_TTL}s`);
});

module.exports = app; // for testing

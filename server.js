require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.GITHUB_ORG || "ArtivoraLabs";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60_000; // 1 minute
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.error(
    "\n[DashView] Missing GITHUB_TOKEN.\n" +
      "Create a .env file (see .env.example) with a GitHub token that has\n" +
      "'read:project' and 'repo' scopes, then restart the server.\n"
  );
}

app.use(
  cors(
    ALLOWED_ORIGINS.length
      ? { origin: ALLOWED_ORIGINS }
      : {} // dev default: allow all origins
  )
);
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// Simple in-memory cache so we don't hammer the GitHub API on every page load
// ---------------------------------------------------------------------------
let cache = { data: null, fetchedAt: 0 };

const QUERY = `
  query($org: String!) {
    organization(login: $org) {
      name
      url
      avatarUrl
      projectsV2(first: 10) {
        nodes {
          id
          title
          number
          shortDescription
          url
          closed
          updatedAt
          items(first: 100) {
            totalCount
            nodes {
              content {
                ... on Issue {
                  title
                  state
                  url
                }
                ... on PullRequest {
                  title
                  state
                  url
                }
              }
            }
          }
        }
      }
      repositories(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          name
          description
          url
          isPrivate
          primaryLanguage {
            name
          }
          stargazerCount
          forkCount
          updatedAt
        }
      }
    }
  }
`;

async function fetchFromGitHub() {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { org: ORG } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }

  if (!result.data || !result.data.organization) {
    throw new Error(
      `No data returned for organization "${ORG}". Check the org name and ` +
        `that your token has access to it.`
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/api/dashboard", async (req, res) => {
  if (!TOKEN) {
    return res.status(500).json({
      error: "Server is missing GITHUB_TOKEN. See .env.example.",
    });
  }

  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  const forceRefresh = req.query.refresh === "true";

  if (fresh && cache.data && !forceRefresh) {
    return res.json({ ...cache.data, cached: true });
  }

  try {
    const data = await fetchFromGitHub();
    cache = { data, fetchedAt: Date.now() };
    res.json({ ...data, cached: false });
  } catch (error) {
    console.error("[DashView] GitHub fetch failed:", error.message);

    // Serve stale cache rather than a hard failure, if we have one
    if (cache.data) {
      return res.json({ ...cache.data, cached: true, stale: true });
    }

    res.status(502).json({ error: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, org: ORG, hasToken: Boolean(TOKEN) });
});

app.listen(PORT, () => {
  console.log(`DashView server running on http://localhost:${PORT}`);
  console.log(`Tracking organization: ${ORG}`);
});

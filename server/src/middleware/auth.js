const jwt = require('jsonwebtoken');
const db = require('../db/db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'dashview-api', audience: 'dashview-web'
    });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (!Number.isSafeInteger(payload.id) || !Number.isSafeInteger(payload.orgId) ||
      !Number.isSafeInteger(payload.tokenVersion)) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const account = db.prepare(
    'SELECT id, org_id, email, name, role, token_version FROM users WHERE id = ? AND org_id = ?'
  ).get(payload.id, payload.orgId);
  if (!account || account.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: 'Session revoked. Sign in again.' });
  }
  req.user = {
    id: account.id, orgId: account.org_id, email: account.email,
    name: account.name, role: account.role, tokenVersion: account.token_version
  };
  next();
}

function requireOrgRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Resolves :projectId from the URL, verifies the authenticated user
// actually has access to it (via project_members, org-scoped), and
// attaches req.project. Never trusts a project id/role claimed by the
// client body - membership is always looked up server-side.
function requireProjectAccess(minRole) {
  const roleRank = { viewer: 0, member: 1, admin: 2, owner: 3 };
  return (req, res, next) => {
    const projectId = Number(req.params.projectId || req.body.projectId || req.query.projectId);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?')
      .get(projectId, req.user.orgId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const membership = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(projectId, req.user.id);

    // Org owners/admins implicitly have access to every project in the org.
    const effectiveRole = membership ? membership.role : (req.user.role === 'owner' || req.user.role === 'admin' ? req.user.role : null);
    if (!effectiveRole) return res.status(403).json({ error: 'No access to this project' });

    if (minRole && roleRank[effectiveRole] < roleRank[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role on this project` });
    }

    req.project = project;
    req.projectRole = effectiveRole;
    next();
  };
}

module.exports = { requireAuth, requireOrgRole, requireProjectAccess };

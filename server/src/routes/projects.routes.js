const express = require('express');
const { requireAuth, requireProjectAccess } = require('../middleware/auth');
const svc = require('../services/projectService');

const router = express.Router();
router.use(requireAuth);

// Organization overview: all projects the user's org has.
router.get('/projects', (req, res) => {
  res.json({ projects: svc.get_projects(req.user.orgId) });
});

// Create a new project in the caller's org. Org-level owner/admin only -
// role comes from the verified JWT, never the request body.
router.post('/projects', (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Requires owner or admin role' });
  }
  const { name, slug, description } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
  try {
    const project = svc.create_project(req.user.orgId, { name, slug, description });
    res.status(201).json(project);
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'A project with that slug already exists' : e.message });
  }
});

router.get('/projects/:projectId/summary', requireProjectAccess('viewer'), (req, res) => {
  res.json(svc.get_project_summary(req.project.id));
});

router.get('/projects/:projectId/stats', requireProjectAccess('viewer'), (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json(svc.get_project_stats(req.project.id, { days }));
});

router.get('/projects/:projectId/users', requireProjectAccess('viewer'), (req, res) => {
  const { limit, offset } = req.query;
  res.json({ users: svc.get_users(req.project.id, { limit: Number(limit) || 50, offset: Number(offset) || 0 }) });
});

router.get('/projects/:projectId/orders', requireProjectAccess('viewer'), (req, res) => {
  const { limit, offset, status } = req.query;
  res.json({ orders: svc.get_orders(req.project.id, { limit: Number(limit) || 50, offset: Number(offset) || 0, status }) });
});

router.get('/projects/:projectId/revenue', requireProjectAccess('viewer'), (req, res) => {
  const days = Number(req.query.days) || 30;
  res.json(svc.get_revenue(req.project.id, { days }));
});

router.get('/projects/:projectId/activity', requireProjectAccess('viewer'), (req, res) => {
  res.json({ activity: svc.get_activity(req.project.id, { limit: Number(req.query.limit) || 30 }) });
});

router.get('/projects/:projectId/search', requireProjectAccess('viewer'), (req, res) => {
  const q = String(req.query.q || '');
  if (!q) return res.status(400).json({ error: 'q is required' });
  res.json(svc.search_project_data(req.project.id, q));
});

router.get('/projects/:projectId/report', requireProjectAccess('viewer'), (req, res) => {
  res.json(svc.generate_project_report(req.project.id));
});

module.exports = router;

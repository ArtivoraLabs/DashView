const express = require('express');
const { requireAuth, requireProjectAccess } = require('../middleware/auth');
const gateway = require('../ai/gateway');

const router = express.Router();
router.use(requireAuth);

// Lets the frontend build a provider/model picker from what's actually configured.
router.get('/ai/providers', (req, res) => {
  res.json({ available: gateway.availableProviders(), default: gateway.resolveProviderModel() });
});

// history: [{role: 'user'|'assistant', content: string}]
// provider/model: optional per-request override
// confirmed: must be true for the AI to be allowed to execute a write tool
router.post('/projects/:projectId/ai/chat', requireProjectAccess('viewer'), async (req, res) => {
  const { history, provider, model, confirmed } = req.body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history (array of {role, content}) is required' });
  }

  const allowWrites = ['owner', 'admin'].includes(req.projectRole);

  try {
    const result = await gateway.chat({
      history,
      requested: { provider, model },
      ctx: { projectId: req.project.id, projectRole: req.projectRole, confirmed: !!confirmed },
      allowWrites,
    });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;

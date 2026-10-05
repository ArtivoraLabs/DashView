// Small in-memory fixed-window rate limiter (no dependency). One process only:
// behind several instances, put a shared limiter (Cloudflare / nginx) in front as well.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.min(windowMs, 60000));
  if (timer.unref) timer.unref();
  return (req, res, next) => {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - h.n)));
    if (h.n > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((h.reset - now) / 1000))));
      return res.status(429).json({ error: message || 'Too many requests. Try again shortly.' });
    }
    next();
  };
}
module.exports = { rateLimit };

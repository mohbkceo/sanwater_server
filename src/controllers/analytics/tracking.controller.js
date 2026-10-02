const AnalyticsEvent = require('../../models/analyticsEvent.model');
const { BROWSER_EVENTS, LEGACY_BROWSER_EVENTS, SUBJECT_TYPES } = require('../../config/analytics');
const { identify, browserEvent, isAdminPath, normalizePath } = require('../../services/analytics/tracking');

function adaptLegacy(body) {
  const name = LEGACY_BROWSER_EVENTS[body?.type] || body?.name;
  const meta = body?.meta || {};
  const subject = body?.subject || (meta.product_id ? { type: 'product', id: meta.product_id } : meta.article_id ? { type: 'article', id: meta.article_id } : null);
  return { name, subject, path: body?.path || meta.page, progress: body?.progress ?? meta.progress, relatedProductId: body?.relatedProductId, acquisition: body?.acquisition || {
    source: body?.source, medium: body?.medium, campaign: body?.campaign, referrer: body?.referrer,
  }, device: body?.device && typeof body.device === 'string' ? { type: body.device, language: body.language } : body?.device };
}
async function track(req, res) {
  try {
    const body = adaptLegacy(req.body);
    if (!BROWSER_EVENTS.includes(body.name) || isAdminPath(body.path) || !body.path ||
        (body.subject && (!SUBJECT_TYPES.includes(body.subject.type) || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(body.subject.id || ''))))) {
      return res.sendStatus(400);
    }
    body.path = normalizePath(body.path);
    const identity = await identify(req, res, body);
    const event = browserEvent(body, identity);
    await AnalyticsEvent.create(event);
    return res.sendStatus(204);
  } catch (error) {
    // Tracking must never stop the public site or customer form.
    return res.sendStatus(204);
  }
}
module.exports = { track, adaptLegacy };

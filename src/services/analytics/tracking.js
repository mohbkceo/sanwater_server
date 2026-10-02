const crypto = require('crypto');
const AnalyticsVisitor = require('../../models/analyticsVisitor.model');
const AnalyticsSession = require('../../models/analyticsSession.model');
const AnalyticsEvent = require('../../models/analyticsEvent.model');
const { BROWSER_EVENTS, BUSINESS_EVENTS, SUBJECT_TYPES, LEGACY_BROWSER_EVENTS } = require('../../config/analytics');

const TIMEOUT_MS = 30 * 60 * 1000;
const VISITOR_COOKIE = 'sw_visitor';
const SESSION_COOKIE = 'sw_session';
const text = (v, max = 160) => typeof v === 'string' ? v.trim().slice(0, max) : null;
const cookieSecret = () => process.env.ANALYTICS_COOKIE_SECRET || process.env.JWT_SECRET;
function sign(id) {
  if (!cookieSecret()) throw new Error('Analytics cookie secret is required');
  return `${id}.${crypto.createHmac('sha256', cookieSecret()).update(id).digest('hex')}`;
}
function unsign(value) {
  if (!value || typeof value !== 'string') return null;
  const at = value.lastIndexOf('.');
  if (at < 1) return null;
  const id = value.slice(0, at);
  const expected = sign(id).slice(at + 1);
  const received = value.slice(at + 1);
  return expected.length === received.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)) ? id : null;
}
function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/', maxAge };
}
function normalizePath(path) {
  if (!path || typeof path !== 'string') return '/';
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').slice(0, 500);
  if (!pathname.startsWith('/')) return '/';
  return pathname
    .replace(/\/(reset|verify|token|invite)\/[^/]+/gi, '/$1/:redacted')
    .replace(/\/[a-f\d]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[a-f\d]{8}-[a-f\d-]{27,}(?=\/|$)/gi, '/:id');
}
function isAdminPath(path) {
  return /^\/(?:sanwater\/admins|admin|dashboard)(?:\/|$)/i.test(normalizePath(path));
}
function safeReferrer(referrer) {
  try { const url = new URL(referrer); return /^https?:$/.test(url.protocol) ? url.origin : null; } catch { return null; }
}
function classifyChannel(touch) {
  const medium = String(touch.medium || '').toLowerCase();
  const source = String(touch.source || '').toLowerCase();
  const host = (() => { try { return new URL(touch.referrer).hostname.toLowerCase(); } catch { return ''; } })();
  if (touch.clickIds?.gclid || touch.clickIds?.gbraid || touch.clickIds?.wbraid || touch.clickIds?.msclkid || /cpc|ppc|paid.search/.test(medium)) return 'Paid Search';
  if (touch.clickIds?.fbclid || touch.clickIds?.ttclid || /paid.social|social.paid/.test(medium)) return 'Paid Social';
  if (/email|newsletter/.test(medium)) return 'Email';
  if (/affiliate/.test(medium)) return 'Affiliate';
  if (/creator|influencer/.test(medium)) return 'Creator';
  if (/display|banner/.test(medium)) return 'Display';
  if (/social/.test(medium) || /facebook|instagram|tiktok|linkedin|twitter|x.com|pinterest/.test(`${source} ${host}`)) return 'Organic Social';
  if (/organic/.test(medium) || /google|bing|yahoo|duckduckgo/.test(`${source} ${host}`)) return 'Organic Search';
  if (source && source !== 'direct') return 'Other';
  if (host) return 'Referral';
  return 'Direct';
}
function acquisitionFrom(body = {}) {
  const input = body.acquisition || {};
  const clickIds = Object.fromEntries(['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid'].map(k => [k, text(input[k], 160)]).filter(([, v]) => v));
  const touch = {
    source: text(input.source || input.utm_source, 100), medium: text(input.medium || input.utm_medium, 100),
    campaign: text(input.campaign || input.utm_campaign, 160), content: text(input.content || input.utm_content, 160),
    term: text(input.term || input.utm_term, 160), utmId: text(input.utmId || input.utm_id, 160),
    referrer: safeReferrer(input.referrer), clickIds,
  };
  touch.channel = classifyChannel(touch);
  return touch;
}
function meaningfulTouch(touch) {
  return !!(touch.source || touch.medium || touch.campaign || touch.utmId || Object.keys(touch.clickIds).length || touch.channel === 'Referral');
}
function newExternalTouch(oldTouch, touch) {
  return meaningfulTouch(touch) && JSON.stringify([touch.source, touch.medium, touch.campaign, touch.utmId, touch.referrer, touch.clickIds]) !== JSON.stringify([oldTouch?.source, oldTouch?.medium, oldTouch?.campaign, oldTouch?.utmId, oldTouch?.referrer, oldTouch?.clickIds]);
}
function shouldStartNewSession(session, touch, now = new Date()) {
  return !session || now - session.lastActivityAt > TIMEOUT_MS || newExternalTouch(session.acquisition, touch);
}
async function identify(req, res, body = {}) {
  const now = new Date();
  const touch = acquisitionFrom(body);
  const visitorId = unsign(req.cookies?.[VISITOR_COOKIE]) || crypto.randomUUID();
  const previousSessionId = unsign(req.cookies?.[SESSION_COOKIE]);
  let visitor = await AnalyticsVisitor.findOne({ visitorId });
  if (!visitor) visitor = new AnalyticsVisitor({ visitorId, firstSeenAt: now, lastSeenAt: now, firstTouch: touch, lastTouch: touch, lastNonDirectTouch: meaningfulTouch(touch) ? touch : null });
  else visitor.lastSeenAt = now;
  let session = previousSessionId ? await AnalyticsSession.findOne({ sessionId: previousSessionId, visitorId }) : null;
  if (session && shouldStartNewSession(session, touch, now)) { session.endedAt = session.lastActivityAt; await session.save(); session = null; }
  if (!session) {
    visitor.lastTouch = touch;
    if (meaningfulTouch(touch)) visitor.lastNonDirectTouch = touch;
    session = new AnalyticsSession({ sessionId: crypto.randomUUID(), visitorId, startedAt: now, lastActivityAt: now, landingPage: normalizePath(body.path), acquisition: touch, device: { type: text(body.device?.type, 20), language: text(body.device?.language, 40) } });
  }
  else session.lastActivityAt = now;
  await Promise.all([visitor.save(), session.save()]);
  res.cookie(VISITOR_COOKIE, sign(visitorId), cookieOptions(365 * 24 * 60 * 60 * 1000));
  res.cookie(SESSION_COOKIE, sign(session.sessionId), cookieOptions(TIMEOUT_MS));
  return { visitor, session };
}
function browserEvent(body, identity) {
  const name = LEGACY_BROWSER_EVENTS[body.name || body.type] || body.name;
  if (!BROWSER_EVENTS.includes(name)) return null;
  const subjectType = body.subject?.type;
  const subjectId = text(body.subject?.id, 80);
  if ((subjectType && !SUBJECT_TYPES.includes(subjectType)) || (subjectType && !subjectId)) return null;
  const properties = {};
  if (name === 'article_reading_progress' && Number.isFinite(body.progress)) properties.progress = Math.max(0, Math.min(100, Number(body.progress)));
  if (name === 'article_product_clicked' && /^[a-f\d]{24}$/i.test(String(body.relatedProductId || ''))) properties.relatedProductId = String(body.relatedProductId);
  return {
    eventId: crypto.randomUUID(), name, visitorId: identity.visitor.visitorId, sessionId: identity.session.sessionId,
    subject: subjectType ? { type: subjectType, id: subjectId } : undefined,
    origin: 'browser', attributionSnapshot: { firstTouch: identity.visitor.firstTouch, lastTouch: identity.visitor.lastTouch, lastNonDirectTouch: identity.visitor.lastNonDirectTouch },
    properties: { ...properties, path: normalizePath(body.path) }, occurredAt: new Date(),
  };
}
async function emitBusinessEvent(name, subjectType, subjectId, transitionId, properties = {}, identity = {}) {
  if (!BUSINESS_EVENTS.includes(name) || !SUBJECT_TYPES.includes(subjectType) || !subjectId || !transitionId) throw new Error('Invalid business event');
  const eventId = `${subjectType}:${subjectId}:${name}:${transitionId}`;
  return AnalyticsEvent.updateOne({ eventId }, { $setOnInsert: {
    eventId, name, subject: { type: subjectType, id: String(subjectId) }, origin: identity.userId ? 'admin' : 'server',
    userId: identity.userId || null, visitorId: identity.visitorId || null, sessionId: identity.sessionId || null,
    properties, occurredAt: new Date(),
  } }, { upsert: true });
}
module.exports = { TIMEOUT_MS, VISITOR_COOKIE, SESSION_COOKIE, normalizePath, isAdminPath, classifyChannel, acquisitionFrom, meaningfulTouch, newExternalTouch, shouldStartNewSession, identify, browserEvent, emitBusinessEvent, unsign };

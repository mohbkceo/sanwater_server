const sanitize = require('sanitize-html');

function publicOrigin(required = false) {
  const value = process.env.PUBLIC_SITE_ORIGIN || process.env.FRONTEND_URL;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    if (required) { const error = new Error('Configure PUBLIC_SITE_ORIGIN or FRONTEND_URL for public article HTML'); error.statusCode = 503; throw error; }
    return null;
  }
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function plainText(html) {
  return sanitize(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity])
    .replace(/&#(\d+);/g, (_, number) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : '')
    .replace(/\s+/g, ' ').trim();
}
function imageUrl(value, origin) {
  if (!value) return null;
  try { const url = new URL(value, origin || undefined); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function isPublic(article, now = new Date()) {
  return article.status === 'published' || (article.status === 'scheduled' && article.publishedAt && new Date(article.publishedAt) <= now);
}
function metadata(article, options = {}) {
  const origin = options.origin || publicOrigin();
  const site = process.env.PUBLIC_SITE_NAME || 'San Water';
  const headline = String(article.title || '').replace(/\s+/g, ' ').trim();
  const title = `${headline} | ${site}`;
  const description = plainText(article.excerpt || article.content).slice(0, 160).trim();
  const canonicalUrl = origin && article.slug ? `${origin}/news/${encodeURIComponent(article.slug)}` : null;
  const image = imageUrl(article.coverImage || process.env.PUBLIC_OG_IMAGE, origin);
  const indexable = Boolean(isPublic(article));
  const validDate = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : undefined;
  const structuredData = indexable && canonicalUrl && validDate(article.publishedAt) ? {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline, description,
    mainEntityOfPage: canonicalUrl, datePublished: validDate(article.publishedAt), dateModified: validDate(article.updatedAt || article.publishedAt),
    publisher: { '@type': 'Organization', name: site, url: origin },
    ...(article.author && !String(article.author).includes('@') ? { author: [{ '@type': 'Person', name: plainText(article.author) }] } : {}),
    ...(image ? { image: [image] } : {}),
  } : null;
  return { title, description, canonicalUrl, image, robots: indexable ? 'index,follow' : 'noindex,nofollow', openGraph: { title, description, image, url: canonicalUrl, type: 'article' }, twitter: { card: image ? 'summary_large_image' : 'summary', title, description, image }, structuredData };
}
function applyMetadata(article) {
  const generated = metadata(article);
  article.seoTitle = generated.title;
  article.seoDescription = generated.description;
  if (generated.canonicalUrl) article.canonicalUrl = generated.canonicalUrl;
}
function metadataTags(data) {
  const tag = (key, value, property = false) => value == null ? '' : `<meta ${property ? 'property' : 'name'}="${key}" content="${escape(value)}">`;
  return `<title>${escape(data.title)}</title>${tag('description', data.description)}${tag('robots', data.robots)}` +
    (data.canonicalUrl ? `<link rel="canonical" href="${escape(data.canonicalUrl)}">` : '') +
    Object.entries(data.openGraph).map(([key, value]) => tag(`og:${key}`, value, true)).join('') +
    Object.entries(data.twitter).map(([key, value]) => tag(`twitter:${key}`, value)).join('') +
    (data.structuredData ? `<script type="application/ld+json">${JSON.stringify(data.structuredData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')}</script>` : '');
}
function renderArticleHTML(template, article) {
  const data = metadata(article, { origin: publicOrigin(true) });
  const body = `<main><a href="/news">San Water · News</a><article><h1>${escape(article.title)}</h1>${article.excerpt ? `<p>${escape(article.excerpt)}</p>` : ''}${data.image ? `<img src="${escape(data.image)}" alt="">` : ''}${require('../utils/sanitizeNewsHtml')(article.content)}</article></main>`;
  return template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '').replace(/<meta\b(?=[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi, '')
    .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi, '').replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</head>', `${metadataTags(data)}</head>`).replace(/<div\b([^>]*\bid=["']root["'][^>]*)>[\s\S]*?<\/div>/i, `<div$1>${body}</div>`);
}
module.exports = { publicOrigin, metadata, applyMetadata, metadataTags, renderArticleHTML, plainText, isPublic, escape };

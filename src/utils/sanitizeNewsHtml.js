const sanitizeHtml = require('sanitize-html');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const PALETTE = new Set(['blue', 'slate', 'green', 'amber', 'red']);
const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const WIDTH = new Set(['normal', 'wide', 'full']);
const BLOCKS = new Set(['gallery', 'cta', 'product', 'stats', 'quote', 'accordion', 'download']);
const text = (value, max = 300) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '').trim().slice(0, max);

function safeUrl(value, internal = true) {
  if (typeof value !== 'string' || value.length > 2000 || /[\\\u0000-\u001f]/.test(value)) return '';
  if (internal && value && !value.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(value) && !/\s/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function safeLinkUrl(value) {
  if (typeof value === 'string' && value.length <= 2000 && !/[\\\u0000-\u001f]/.test(value) && /^mailto:[^\s<>@"']+@[^\s<>@"']+$/i.test(value)) return value;
  return safeUrl(value);
}

function cleanPayload(type, raw) {
  let value;
  try { value = JSON.parse(decodeURIComponent(raw || '')); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (type === 'product') return typeof value.id === 'string' && OBJECT_ID.test(value.id) ? { id: value.id.toLowerCase() } : null;
  if (type === 'cta') {
    const url = safeUrl(value.url);
    return url && text(value.label, 100) ? { label: text(value.label, 100), url, text: text(value.text, 300), style: ['primary', 'secondary', 'outline'].includes(value.style) ? value.style : 'primary', align: ALIGN.has(value.align) ? value.align : 'left' } : null;
  }
  if (type === 'gallery') {
    const images = (Array.isArray(value.images) ? value.images : []).slice(0, 20).map((item) => ({ src: safeUrl(item?.src, false), alt: text(item?.alt, 200), caption: text(item?.caption, 300) })).filter((item) => item.src);
    return images.length ? { images, layout: value.layout === 'three' ? 'three' : 'two' } : null;
  }
  if (type === 'stats') {
    const items = (Array.isArray(value.items) ? value.items : []).slice(0, 4).map((item) => ({ value: text(item?.value, 30), unit: text(item?.unit, 30), label: text(item?.label, 100) })).filter((item) => item.value && item.label);
    return items.length >= 2 ? { items } : null;
  }
  if (type === 'quote') return text(value.quote, 2000) ? { quote: text(value.quote, 2000), author: text(value.author, 100), role: text(value.role, 100) } : null;
  if (type === 'accordion') {
    const items = (Array.isArray(value.items) ? value.items : []).slice(0, 15).map((item) => ({ title: text(item?.title, 200), answer: text(item?.answer, 3000) })).filter((item) => item.title && item.answer);
    return items.length ? { items } : null;
  }
  if (type === 'download') {
    const url = safeUrl(value.url);
    const ext = url ? new URL(url, 'https://sanwater.dz').pathname.split('.').pop().toUpperCase() : '';
    return url && text(value.title, 200) && ['PDF', 'DOCX', 'XLSX', 'ZIP'].includes(ext) ? { url, title: text(value.title, 200), description: text(value.description, 300), size: text(value.size, 50), fileType: ext } : null;
  }
  return null;
}

function sanitizeNewsHtml(content = '') {
  return sanitizeHtml(String(content), {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'a', 'ul', 'ol', 'li', 'label', 'blockquote', 'hr', 'img', 'figure', 'figcaption', 'code', 'pre', 'span', 'mark', 'sub', 'sup', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'input'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title', 'data-caption', 'data-width', 'data-align'],
      p: ['dir', 'data-align'], h2: ['dir', 'data-align'], h3: ['dir', 'data-align'], h4: ['dir', 'data-align'],
      th: ['colspan', 'rowspan', 'data-align'], td: ['colspan', 'rowspan', 'data-align'],
      span: ['data-color'], mark: ['data-highlight'], div: ['data-content-type', 'data-payload', 'data-video-id', 'data-width', 'data-caption', 'data-callout-type'],
      ul: ['data-type'], li: ['data-type', 'data-checked'],
      input: ['type', 'checked', 'disabled'],
    },
    allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      a: (tagName, attrs) => ({ tagName, attribs: { href: safeLinkUrl(attrs.href), ...(attrs.target === '_blank' ? { target: '_blank' } : {}), rel: 'noopener noreferrer' } }),
      img: (tagName, attrs) => ({ tagName, attribs: { src: safeUrl(attrs.src, false), alt: text(attrs.alt, 200), ...(attrs['data-caption'] ? { 'data-caption': text(attrs['data-caption'], 300) } : {}), 'data-width': WIDTH.has(attrs['data-width']) ? attrs['data-width'] : 'normal', 'data-align': ALIGN.has(attrs['data-align']) ? attrs['data-align'] : 'center' } }),
      div: (tagName, attrs) => {
        const type = attrs['data-content-type'];
        if (type === 'youtube' && VIDEO_ID.test(attrs['data-video-id'] || '')) return { tagName, attribs: { 'data-content-type': type, 'data-video-id': attrs['data-video-id'], 'data-width': WIDTH.has(attrs['data-width']) ? attrs['data-width'] : 'normal', 'data-caption': text(attrs['data-caption'], 300) } };
        if (type === 'callout') return { tagName, attribs: { 'data-content-type': type, 'data-callout-type': ['info', 'tip', 'warning', 'success'].includes(attrs['data-callout-type']) ? attrs['data-callout-type'] : 'info' } };
        const payload = BLOCKS.has(type) ? cleanPayload(type, attrs['data-payload']) : null;
        return payload ? { tagName, attribs: { 'data-content-type': type, 'data-payload': encodeURIComponent(JSON.stringify(payload)) } } : { tagName, attribs: {} };
      },
      span: (tagName, attrs) => ({ tagName, attribs: PALETTE.has(attrs['data-color']) ? { 'data-color': attrs['data-color'] } : {} }),
      mark: (tagName, attrs) => ({ tagName, attribs: PALETTE.has(attrs['data-highlight']) ? { 'data-highlight': attrs['data-highlight'] } : {} }),
      input: (tagName, attrs) => ({ tagName, attribs: attrs.type === 'checkbox' ? { type: 'checkbox', disabled: 'disabled', ...(attrs.checked !== undefined ? { checked: 'checked' } : {}) } : {} }),
      ul: (tagName, attrs) => ({ tagName, attribs: attrs['data-type'] === 'taskList' ? { 'data-type': 'taskList' } : {} }),
      li: (tagName, attrs) => ({ tagName, attribs: attrs['data-type'] === 'taskItem' ? { 'data-type': 'taskItem', 'data-checked': attrs['data-checked'] === 'true' ? 'true' : 'false' } : {} }),
      p: directionAndAlignment, h2: directionAndAlignment, h3: directionAndAlignment, h4: directionAndAlignment,
      th: cellAttrs, td: cellAttrs,
    },
    exclusiveFilter: (frame) => (frame.tag === 'img' && !frame.attribs.src) || (frame.tag === 'div' && frame.attribs['data-content-type'] === 'youtube' && !VIDEO_ID.test(frame.attribs['data-video-id'] || '')),
  });
}

function directionAndAlignment(tagName, attrs) {
  return { tagName, attribs: { ...(ALIGN.has(attrs['data-align']) ? { 'data-align': attrs['data-align'] } : {}), ...(['rtl', 'ltr', 'auto'].includes(attrs.dir) ? { dir: attrs.dir } : {}) } };
}
function cellAttrs(tagName, attrs) {
  const span = (name) => { const n = Number(attrs[name]); return Number.isInteger(n) && n > 1 && n <= 20 ? { [name]: String(n) } : {}; };
  return { tagName, attribs: { ...span('colspan'), ...span('rowspan'), ...(ALIGN.has(attrs['data-align']) ? { 'data-align': attrs['data-align'] } : {}) } };
}

module.exports = sanitizeNewsHtml;
module.exports.cleanPayload = cleanPayload;

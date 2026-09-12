const sanitizeHtml = require('sanitize-html');

module.exports = function sanitizeNewsHtml(content = '') {
  return sanitizeHtml(String(content), {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'img', 'figure', 'figcaption', 'code', 'pre', 'span'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], span: ['class'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer', ...(attribs.target === '_blank' ? { target: '_blank' } : {}) } }),
    },
  });
};

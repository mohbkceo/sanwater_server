const test = require('node:test');
const assert = require('node:assert/strict');
const sanitize = require('../src/utils/sanitizeNewsHtml');
const { autosaveNewsSchema, updateNewsSchema } = require('../src/middlewares/validators/schemas/newsValidator');
const NewsRevision = require('../src/models/newsRevision.model');

const payload = (value) => encodeURIComponent(JSON.stringify(value));

test('enhanced formatting, direction, and tables survive sanitization', () => {
  const html = '<h2 dir="ltr" data-align="center">Title</h2><p dir="rtl"><strong>مرحبا</strong><mark data-highlight="amber">نص</mark><s>old</s><sup>2</sup></p><table><tbody><tr><th colspan="2">Head</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>';
  const result = sanitize(html);
  assert.match(result, /dir="rtl"/);
  assert.match(result, /data-align="center"/);
  assert.match(result, /data-highlight="amber"/);
  assert.match(result, /<table>/);
  assert.match(result, /colspan="2"/);
});

test('checklist structure survives without enabling interactive saved inputs', () => {
  const result = sanitize('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked onclick="evil()"></label><div><p>Done</p></div></li></ul>');
  assert.match(result, /data-type="taskList"/);
  assert.match(result, /data-type="taskItem"/);
  assert.match(result, /data-checked="true"/);
  assert.match(result, /disabled="disabled"/);
  assert.doesNotMatch(result, /onclick/);
});

test('controlled blocks survive save validation and sanitizer', () => {
  const content = [
    '<div data-content-type="youtube" data-video-id="dQw4w9WgXcQ" data-width="wide"></div>',
    `<div data-content-type="product" data-payload="${payload({ id: '507f1f77bcf86cd799439011' })}"></div>`,
    `<div data-content-type="gallery" data-payload="${payload({ layout: 'three', images: [{ src: 'https://example.com/a.jpg', alt: 'Image' }] })}"></div>`,
    '<div data-content-type="callout" data-callout-type="warning"><p>Note</p></div>',
  ].join('');
  assert.equal(autosaveNewsSchema.validate({ content }).error, undefined);
  assert.equal(updateNewsSchema.validate({ content }).error, undefined);
  const result = sanitize(content);
  for (const type of ['youtube', 'product', 'gallery', 'callout']) assert.match(result, new RegExp(`data-content-type="${type}"`));
  assert.match(result, /data-video-id="dQw4w9WgXcQ"/);
});

test('malicious scripts, attributes, URLs, and frames are removed', () => {
  const html = '<script>alert(1)</script><style>x{}</style><iframe src="https://evil.test"></iframe><p onclick="alert(1)" style="color:red">Safe</p><a href="javascript:alert(1)" onmouseover="x">Bad</a><img src="data:image/svg+xml,x" onerror="x"><div data-content-type="youtube" data-video-id="not-a-valid-id" data-evil="x"></div>';
  const result = sanitize(html);
  assert.doesNotMatch(result, /script|style|iframe|onclick|onmouseover|onerror|javascript:|data:image|data-evil|data-video-id/);
  assert.match(result, /<p>Safe<\/p>/);
});

test('legacy HTTP and email links retain safe targets', () => {
  const result = sanitize('<p><a href="mailto:hello@example.com">Email</a> <a href="https://example.com" target="_blank">Site</a> <a href="/contact">Contact</a> <a href="#details">Details</a></p>');
  assert.match(result, /href="mailto:hello@example.com"/);
  assert.match(result, /rel="noopener noreferrer"/);
  assert.match(result, /target="_blank"/);
  assert.match(result, /href="\/contact"/);
  assert.match(result, /href="#details"/);
});

test('custom payload is normalized and unsafe fields are discarded', () => {
  const raw = payload({ label: 'View', url: 'https://example.com', style: 'evil', onclick: 'alert(1)' });
  const result = sanitize(`<div data-content-type="cta" data-payload="${raw}"></div>`);
  const encoded = result.match(/data-payload="([^"]+)"/)?.[1];
  const value = JSON.parse(decodeURIComponent(encoded));
  assert.deepEqual(value, { label: 'View', url: 'https://example.com/', text: '', style: 'primary', align: 'left' });
  assert.doesNotThrow(() => sanitize(`<div data-content-type="product" data-payload="${payload({ id: ['507f1f77bcf86cd799439011'] })}"></div><div data-content-type="quote" data-payload="${payload({ quote: { toString: 'broken' } })}"></div>`));
});

test('representative article blocks survive autosave, update, and sanitization', () => {
  const blocks = [
    ['gallery', { layout: 'three', images: ['a', 'b', 'c'].map((name) => ({ src: `https://example.com/${name}.jpg`, alt: name, caption: name })) }],
    ['quote', { quote: 'Clean water matters', author: 'San Water', role: 'Team' }],
    ['product', { id: '507f1f77bcf86cd799439011' }],
    ['stats', { items: [{ value: '15+', label: 'Countries' }, { value: '98%', label: 'Efficiency' }] }],
    ['accordion', { items: [{ title: 'How?', answer: 'With care.' }] }],
    ['cta', { label: 'Contact us', url: '/contact', style: 'primary', align: 'center' }],
    ['download', { title: 'Brochure', url: 'https://example.com/brochure.pdf', fileType: 'PDF' }],
  ];
  const content = '<h2>Title</h2><p><strong>Bold</strong> <em>italic</em> <mark data-highlight="blue">highlight</mark></p><p dir="rtl">العربية</p><p dir="ltr">Français</p><div data-content-type="callout" data-callout-type="info"><p>Info</p></div><img src="https://example.com/image.jpg" alt="Image" data-caption="Caption"><div data-content-type="youtube" data-video-id="dQw4w9WgXcQ"></div>' + blocks.map(([type, data]) => `<div data-content-type="${type}" data-payload="${payload(data)}"></div>`).join('') + '<p>Finish</p><hr>';
  assert.equal(autosaveNewsSchema.validate({ content }).error, undefined);
  assert.equal(updateNewsSchema.validate({ content }).error, undefined);
  const saved = sanitize(content);
  for (const [type] of blocks) assert.match(saved, new RegExp(`data-content-type="${type}"`));
  assert.match(saved, /data-content-type="product"\s+data-payload="[^"]+"/);
  assert.match(saved, /data-callout-type="info"/);
  assert.match(saved, /data-video-id="dQw4w9WgXcQ"/);
  assert.match(saved, /data-caption="Caption"/);
  assert.match(saved, /dir="rtl"/);
  assert.match(saved, /<hr \/>/);
  assert.equal(sanitize(saved), saved);
  const revision = new NewsRevision({ article: '507f1f77bcf86cd799439011', editor: '507f1f77bcf86cd799439012', version: 1, snapshot: { content: saved } });
  assert.equal(revision.validateSync(), undefined);
  assert.equal(revision.snapshot.content, saved);
});

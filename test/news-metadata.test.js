const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const News = require('../src/models/news.model');
const controller = require('../src/controllers/news/news.controller');
const { metadata, renderArticleHTML } = require('../src/services/newsMetadata');
const { newsSchema, updateNewsSchema, autosaveNewsSchema } = require('../src/middlewares/validators/schemas/newsValidator');
const validate = require('../src/middlewares/validators/validate');
const oldOrigin = process.env.PUBLIC_SITE_ORIGIN;
const shell = '<!doctype html><html><head><title>SPA</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
let database, app;
before(async () => {
  process.env.PUBLIC_SITE_ORIGIN = 'https://public.example';
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { uid: new mongoose.Types.ObjectId(), email: 'editor@example.com' }; next(); });
  app.post('/news', validate(newsSchema), controller.createNews);
  app.put('/news/:id', validate(updateNewsSchema), controller.updateNews);
  app.patch('/news/:id/autosave', validate(autosaveNewsSchema), controller.autosaveNews);
  app.post('/news/:id/revisions/:revisionId/restore', controller.restoreRevision);
  app.get('/news/article/:slug', controller.getNewsBySlug);
  app.get('/news/render/:slug', controller.publicHTML);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
});
after(async () => { await mongoose.disconnect(); await database?.stop(); if (oldOrigin === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = oldOrigin; });
test('create, autosave, edit, and restore generate metadata while preserving public URLs', async () => {
  const created = await request(app).post('/news').send({ title: 'Water care', content: '<p>Clean water &amp; care.</p>', excerpt: 'Editorial summary', status: 'draft' }).expect(201);
  const id = created.body.data._id;
  const slug = created.body.data.slug;
  assert.equal(created.body.data.seoTitle, 'Water care | San Water');
  assert.equal(created.body.data.canonicalUrl, `https://public.example/news/${slug}`);
  await request(app).patch(`/news/${id}/autosave`).send({ title: 'Updated water care', content: '<p>Updated body.</p>' }).expect(200);
  const published = await request(app).put(`/news/${id}`).send({ status: 'published' }).expect(200);
  assert.equal(published.body.data.slug, slug);
  assert.equal(published.body.data.seoTitle, 'Updated water care | San Water');
  const revision = await require('../src/models/newsRevision.model').findOne({ article: id }).sort({ version: 1 });
  await request(app).post(`/news/${id}/revisions/${revision._id}/restore`).expect(200);
  const restored = await News.findById(id);
  assert.equal(restored.title, 'Water care'); assert.equal(restored.slug, slug);
  assert.equal(restored.seoDescription, 'Editorial summary');
});
test('clients cannot author SEO fields or publish through autosave', async () => {
  for (const schema of [newsSchema, updateNewsSchema, autosaveNewsSchema]) assert.ok(schema.validate({ title: 'Valid title', content: '<p>Body</p>', seoTitle: 'Injected title' }).error);
  assert.ok(autosaveNewsSchema.validate({ status: 'published' }).error);
  assert.ok(newsSchema.validate({ title: 'Scheduled', content: 'Body', status: 'scheduled', publishedAt: '2000-01-01' }).error);
});
test('public HTML has generated social metadata, safe JSON-LD, and real article content before JavaScript', async () => {
  const article = await News.create({ title: 'Water <care>', content: '<p>Real public article</p><script>bad()</script>', author: 'Editorial team', coverImage: 'https://images.example/cover.jpg', status: 'published' });
  const originalFetch = global.fetch;
  global.fetch = async url => { assert.equal(String(url), 'https://public.example/index.html'); return { ok: true, text: async () => shell }; };
  try {
    const response = await request(app).get(`/news/render/${article.slug}`).expect(200);
    assert.match(response.text, /<meta property="og:title"/);
    assert.match(response.text, /https:\/\/images.example\/cover.jpg/);
    assert.match(response.text, /application\/ld\+json/);
    assert.match(response.text, /Real public article/);
    assert.doesNotMatch(response.text, /bad\(\)/);
    assert.match(response.text, /<script type="module" src="\/assets\/app.js"/);
    const api = await request(app).get(`/news/article/${article.slug}`).expect(200);
    assert.equal(api.body.data.metadata.canonicalUrl, `https://public.example/news/${article.slug}`);
  } finally { global.fetch = originalFetch; }
});
test('drafts, future scheduled, archived, and missing articles are not public or indexable', async () => {
  for (const status of ['draft', 'scheduled', 'archived']) {
    const article = await News.create({ title: `Private ${status}`, content: 'Private content', author: 'Team', status, publishedAt: new Date('2099-01-01') });
    assert.equal(metadata(article).robots, 'noindex,nofollow');
    await request(app).get(`/news/article/${article.slug}`).expect(404);
    const response = await request(app).get(`/news/render/${article.slug}`).expect(404);
    assert.match(response.headers['x-robots-tag'], /noindex/); assert.doesNotMatch(response.text, /Private content/);
  }
});
test('metadata serialization escapes titles, attributes and structured data', () => {
  const html = renderArticleHTML(shell, { title: '</script><img onerror="evil()">', slug: 'safe', excerpt: '"quoted" & plain', content: '<p>Safe</p>', status: 'published', publishedAt: new Date(), author: 'A </script> name' });
  assert.doesNotMatch(html, /<img onerror/); assert.match(html, /&quot;quoted&quot; &amp; plain/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

// End-to-end with a real (in-memory) MongoDB: legacy postings, add/edit/remove link, public exposure.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const Hiring = require('../src/models/hiring.model');
const jobs = require('../src/controllers/contents/hiringController');
const errorHandler = require('../src/utils/error.middleware');

let database, app;
before(async () => {
  database = await MongoMemoryServer.create(); await mongoose.connect(database.getUri());
  app = express(); app.use(express.json());
  const admin = (req, _res, next) => { req.user = { uid: new mongoose.Types.ObjectId().toString() }; next(); };
  app.post('/hiring', admin, jobs.createHiring);
  app.put('/hiring/:id', admin, jobs.updateHiring);
  app.get('/hiring', jobs.getHiringList);
  app.get('/hiring/:id', jobs.getHiringById);
  app.use((error, _req, res, _next) => errorHandler(res, error));
});
after(async () => { await mongoose.disconnect(); await database?.stop(); });

const posting = { title: 'Installer', location: 'Alger', type: 'Full-time', description: 'Real position details', status: 'published' };

test('legacy postings without the field are preserved and read back with no link', async () => {
  const { insertedId } = await Hiring.collection.insertOne({ ...posting, requirements: [], benefits: [], publishDate: new Date(), deletedAt: null });
  const response = await request(app).get(`/hiring/${insertedId}`).expect(200);
  assert.equal(response.body.data.title, 'Installer');
  assert.equal(response.body.data.applicationUrl, '');
  await request(app).put(`/hiring/${insertedId}`).send({ status: 'closed' }).expect(200);
  const raw = await Hiring.collection.findOne({ _id: insertedId });
  assert.equal(raw.title, 'Installer'); assert.equal(raw.status, 'closed');
});

test('add, edit and remove a link through the API, persisted in MongoDB', async () => {
  const created = await request(app).post('/hiring').send({ ...posting, applicationUrl: 'jobs.example.com/apply' }).expect(201);
  const id = created.body.data._id;
  assert.equal((await Hiring.findById(id).lean()).applicationUrl, 'https://jobs.example.com/apply');
  const list = await request(app).get('/hiring').expect(200);
  assert.equal(list.body.data.find(row => row._id === id).applicationUrl, 'https://jobs.example.com/apply');

  await request(app).put(`/hiring/${id}`).send({ applicationUrl: 'https://careers.example.org/42' }).expect(200);
  assert.equal((await Hiring.findById(id).lean()).applicationUrl, 'https://careers.example.org/42');

  await request(app).put(`/hiring/${id}`).send({ applicationUrl: 'javascript:alert(1)' }).expect(400);
  assert.equal((await Hiring.findById(id).lean()).applicationUrl, 'https://careers.example.org/42');

  await request(app).put(`/hiring/${id}`).send({ applicationUrl: '' }).expect(200);
  assert.equal((await Hiring.findById(id).lean()).applicationUrl, '');
});

test('schema blocks unsafe links written outside the controller', async () => {
  await assert.rejects(Hiring.create({ ...posting, applicationUrl: 'javascript:alert(1)' }), /Application URL/);
  const doc = await Hiring.create(posting);
  await assert.rejects(Hiring.findByIdAndUpdate(doc._id, { applicationUrl: 'http://localhost/x' }, { runValidators: true }), /Application URL/);
});

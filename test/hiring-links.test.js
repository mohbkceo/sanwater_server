const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const Hiring = require('../src/models/hiring.model');
const Application = require('../src/models/application.model');
const jobs = require('../src/controllers/contents/hiringController');
const applications = require('../src/controllers/contents/applicationController');
const { publicSubmissionLimiter } = require('../src/middlewares/rateLimit');
let database, app;
before(async()=>{
  database=await MongoMemoryServer.create();await mongoose.connect(database.getUri());
  app=express();app.use(express.json());
  app.get('/content/hiring/:id',jobs.getHiringById);
  app.post('/content/hiring/:id/applications',publicSubmissionLimiter,applications.submit);
  app.get('/admin/applications',applications.list);
  app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
});
after(async()=>{await mongoose.disconnect();await database?.stop();});
const job = (title,status='published') => Hiring.create({title,location:'Alger',type:'Full-time',description:'Real position details',status});
test('two jobs have independent immutable application identities and submissions use the existing application collection',async()=>{
  const first=await job('Installer'),second=await job('Sales adviser');
  const link=id=>`/hiring/${id}/apply`;
  assert.notEqual(link(first._id),link(second._id));
  const original=link(first._id);first.title='Senior installer';await first.save();assert.equal(link(first._id),original);
  const response=await request(app).get(`/content/hiring/${first._id}`).expect(200);assert.equal(response.body.data.title,'Senior installer');
  for(const position of [first,second])await request(app).post(`/content/hiring/${position._id}/applications`).send({fullName:'Test Candidate',email:`candidate-${position._id}@example.com`,phone:'0550000000',message:'Introduction'}).expect(201);
  const saved=await Application.find().lean();assert.equal(saved.length,2);assert.deepEqual(new Set(saved.map(row=>String(row.hiringId))),new Set([String(first._id),String(second._id)]));
  const list=await request(app).get(`/admin/applications?hiringId=${first._id}`).expect(200);assert.equal(list.body.data.total,1);assert.equal(list.body.data.rows[0].hiringId.title,'Senior installer');
});
test('draft, closed, deleted and missing jobs cannot receive applications without bypassing the public limiter',async()=>{
  for(const status of ['draft','closed','deleted']){
    const row=await job(`Unavailable ${status}`,status==='deleted'?'published':status);
    if(status==='deleted'){row.deletedAt=new Date();await row.save();}
    await request(app).get(`/content/hiring/${row._id}`).expect(status==='closed'?410:404);
    await request(app).post(`/content/hiring/${row._id}/applications`).send({fullName:'Candidate',email:'candidate@example.com'}).expect(404);
  }
  await request(app).get('/content/hiring/not-an-id').expect(404);
  const position=await job('Valid job');
  await request(app).post(`/content/hiring/${position._id}/applications`).send({fullName:'X',email:'invalid',hiringId:position._id}).expect(429);
  let result;
  await applications.submit({params:{id:String(position._id)},body:{fullName:'X',email:'invalid',hiringId:String(position._id)}},{status(code){result=code;return this;},json(){return this;}},error=>{throw error;});
  assert.equal(result,400);
});

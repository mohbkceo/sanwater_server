const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const express=require('express');
const request=require('supertest');
const intelligence=require('../src/controllers/analytics/intelligence.controller');
const contacts=require('../src/controllers/contents/contactController');
const authorize=require('../src/middlewares/authentication/authorize');
const {PERMISSIONS:P}=require('../src/config/permissions');
const Contact=require('../src/models/contactSubmission.model');
const fixtures={
 product:['product.model',{name:'Water filter',productId:'SW-42',serialNumber:'filter-42',status:'published'},P.ANALYTICS.PRODUCTS],
 product_family:['family.model',{name:'Water family',slug:'water-family',isActive:true},P.ANALYTICS.PRODUCTS],
 lead:['lead.model',{fullName:'Water customer',company:'Water company',status:'new'},P.ANALYTICS.SALES],
 quotation:['quotation.model',{requester:{fullName:'Water buyer',company:'Company'},status:'submitted',pricing:{total:1800}},P.ANALYTICS.SALES],
 hiring_position:['hiring.model',{title:'Water installer',type:'Full-time',status:'published',deletedAt:null},P.ANALYTICS.HIRING],
 application:['application.model',{candidate:{fullName:'Water candidate'},stage:'applied'},P.ANALYTICS.HIRING],
 article:['news.model',{title:'Water news',category:'Water care',status:'published'},P.ANALYTICS.CONTENT],
 admin_user:['user.model',{fullName:'Water admin',role:'admin',password:'not-for-output'},P.LOGS.VIEW],
};
let database,app;
const withPermissions=(call,permissions)=>call.set('x-test-permissions',permissions.join(','));
before(async()=>{
 database=await MongoMemoryServer.create();await mongoose.connect(database.getUri());
 for(const [file,record] of Object.values(fixtures))await require(`../src/models/${file}`).collection.insertOne({...record,createdAt:new Date('2026-11-01'),updatedAt:new Date('2026-11-02')});
 await require('../src/models/analyticsSession.model').collection.insertOne({acquisition:{campaign:'Water campaign'},createdAt:new Date()});
 app=express();app.use(express.json());app.use((req,res,next)=>{const grants=req.get('x-test-permissions');if(!grants)return res.sendStatus(401);req.user={uid:new mongoose.Types.ObjectId(),role:'admin',permissions:grants.split(',')};next();});
 app.get('/explore',intelligence.explorer);
 app.get('/messages',authorize(P.SUBMISSIONS.VIEW),contacts.getSubmissions);
 app.get('/messages/:id',authorize(P.SUBMISSIONS.VIEW),contacts.getSubmission);
 app.put('/messages/:id',authorize(P.SUBMISSIONS.MANAGE),contacts.updateSubmissionStatus);
 app.delete('/messages/:id',authorize(P.SUBMISSIONS.MANAGE),contacts.deleteSubmission);
 app.delete('/messages',authorize(P.SUBMISSIONS.MANAGE),contacts.deleteManySubmissions);
 app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
});
after(async()=>{await mongoose.disconnect();await database?.stop();});
test('Explorer searches all supported categories with type permissions and safe type-specific projections',async()=>{
 for(const [type,[,record,permission]] of Object.entries(fixtures)){
  const response=await withPermissions(request(app).get(`/explore?type=${type}&search=Water`),[P.ANALYTICS.EXPLORE,permission]).expect(200);
  assert.equal(response.body.data.rows.length,1,type);assert.doesNotMatch(JSON.stringify(response.body),/not-for-output|password/);
 }
 const campaign=await withPermissions(request(app).get('/explore?type=campaign&search=Water'),[P.ANALYTICS.EXPLORE,P.ANALYTICS.MARKETING]).expect(200);assert.equal(campaign.body.data.rows[0].sessions,1);
 const quote=await withPermissions(request(app).get('/explore?type=quotation&search=buyer&status=submitted'),[P.ANALYTICS.EXPLORE,P.ANALYTICS.SALES]).expect(200);assert.equal(quote.body.data.rows[0].requester.fullName,'Water buyer');
 await withPermissions(request(app).get('/explore?type=lead'),[P.ANALYTICS.EXPLORE,P.ANALYTICS.PRODUCTS]).expect(403);
 await withPermissions(request(app).get('/explore?type=product'),[P.ANALYTICS.PRODUCTS]).expect(403);
 await withPermissions(request(app).get('/explore?type=__proto__'),[P.ANALYTICS.EXPLORE]).expect(400);
 const literal=await withPermissions(request(app).get('/explore?type=product&search=.*'),[P.ANALYTICS.EXPLORE,P.ANALYTICS.PRODUCTS]).expect(200);assert.equal(literal.body.data.total,0);
});
test('Explorer supports server pagination and product identifier searches',async()=>{
 const permissions=[P.ANALYTICS.EXPLORE,P.ANALYTICS.PRODUCTS];
 await require('../src/models/product.model').collection.insertOne({name:'Second product',productId:'SW-43',createdAt:new Date('2026-11-03')});
 const page=await withPermissions(request(app).get('/explore?type=product&page=2&limit=1'),permissions).expect(200);assert.equal(page.body.data.total,2);assert.equal(page.body.data.rows.length,1);
 const identifier=await withPermissions(request(app).get('/explore?type=product&search=SW-42'),permissions).expect(200);assert.equal(identifier.body.data.rows[0].productId,'SW-42');
});
test('Submissions use a private paginated inbox, safe statuses, full detail, and permissioned deletion',async()=>{
 const [first,second]=await Contact.create([{name:'Sender one',email:'one@example.com',subject:'Support',message:'A private message',status:'pending'},{name:'Sender two',email:'two@example.com',subject:'Prices',message:'Another private message',status:'read'}]);
 const read=[P.SUBMISSIONS.VIEW],manage=[P.SUBMISSIONS.VIEW,P.SUBMISSIONS.MANAGE];
 await request(app).get('/messages?paged=true').expect(401);
 const list=await withPermissions(request(app).get('/messages?paged=true&status=pending&search=Support'),read).expect(200);assert.equal(list.body.data.total,1);assert.equal(list.body.data.rows[0].message,undefined);assert.equal(list.body.data.rows[0].preview,'A private message');
 const detail=await withPermissions(request(app).get(`/messages/${first._id}`),read).expect(200);assert.equal(detail.body.data.message,'A private message');
 await withPermissions(request(app).delete(`/messages/${first._id}`),read).expect(403);
 await withPermissions(request(app).put(`/messages/${first._id}`).send({status:'invalid'}),manage).expect(400);
 await withPermissions(request(app).put(`/messages/${first._id}`).send({status:'read'}),manage).expect(200);
 await withPermissions(request(app).put(`/messages/${first._id}`).send({status:'archived'}),manage).expect(200);
 await withPermissions(request(app).delete('/messages').send({ids:['invalid']}),manage).expect(400);assert.equal(await Contact.countDocuments(),2);
 await withPermissions(request(app).delete('/messages').send({ids:[String(first._id),String(second._id)]}),manage).expect(200);assert.equal(await Contact.countDocuments(),0);
});

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const charts=require('../src/services/analytics/visualizations');
const {resolvePeriod}=require('../src/services/analytics.helpers');
const Events=require('../src/models/analyticsEvent.model');
const Sessions=require('../src/models/analyticsSession.model');
const Application=require('../src/models/application.model');
const controller=require('../src/controllers/analytics/intelligence.controller');
let database;
const p=resolvePeriod({from:'2026-11-01',to:'2026-11-03'});
before(async()=>{database=await MongoMemoryServer.create();await mongoose.connect(database.getUri());
 await Sessions.collection.insertMany([{sessionId:'one',visitorId:'same',startedAt:new Date('2026-11-01T23:59:00Z'),acquisition:{source:'search'}},{sessionId:'two',visitorId:'same',startedAt:new Date('2026-11-02'),acquisition:{source:'direct'}}]);
 await Application.collection.insertMany([{createdAt:new Date('2026-11-01'),stage:'applied'},{createdAt:new Date('2026-11-03'),stage:'hired'},{createdAt:new Date('2026-10-01'),stage:'applied'}]);
 await Events.collection.insertMany([{eventId:'one',name:'product_viewed',subject:{type:'product',id:'p1'},occurredAt:new Date('2026-11-02T23:59:00Z')},{eventId:'two',name:'article_viewed',subject:{type:'article',id:'a1'},occurredAt:new Date('2026-11-03')}]);
});
after(async()=>{await mongoose.disconnect();await database?.stop();});
test('session distribution counts sessions once even when a visitor returns through another source',async()=>{
 const report=await charts.forDomain('marketing',p);assert.equal(report.distribution.rows.reduce((sum,row)=>sum+row.value,0),2);assert.equal(report.distribution.unit,'sessions');assert.equal(report.timeSeries.missing,'unknown');assert.deepEqual(report.timeSeries.rows.map(row=>row.date),['2026-11-01','2026-11-02']);
});
test('business time series and current statuses refer to the same creation-period population',async()=>{
 const report=await charts.forDomain('hiring',p);assert.deepEqual(report.timeSeries.rows,[{date:'2026-11-01',value:1},{date:'2026-11-03',value:1}]);assert.equal(report.timeSeries.missing,'zero');assert.equal(report.distribution.rows.reduce((sum,row)=>sum+row.value,0),2);
});
test('tracked event series filter by event type and exact subject without inventing missing observations',async()=>{
 const domain=await charts.forDomain('products',p);assert.deepEqual(domain.timeSeries.rows,[{date:'2026-11-02',value:1}]);assert.equal(domain.timeSeries.missing,'unknown');const subject=await charts.forSubject('article','a1',p);assert.deepEqual(subject.rows,[{date:'2026-11-03',value:1}]);
});
test('report authorization runs before chart queries, including prototype-like names',async()=>{
 const errors=[];const req={user:{role:'admin',permissions:[]},params:{domain:'products'},query:{}};await controller.domain(req,{},error=>errors.push(error));assert.equal(errors[0].statusCode,403);req.params.domain='__proto__';await controller.domain(req,{},error=>errors.push(error));assert.equal(errors[1].statusCode,404);
});

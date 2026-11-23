const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('crypto');
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
process.env.PRIVATE_KEY=keys.privateKey.export({type:'pkcs8',format:'pem'});process.env.PUBLIC_KEY=keys.publicKey.export({type:'spki',format:'pem'});process.env.NODE_ENV='test';
const mongoose=require('mongoose');const {MongoMemoryServer}=require('mongodb-memory-server');const request=require('supertest');
const app=require('../src/app');const User=require('../src/models/user.model');const {hashPassword,comparePassword}=require('../src/utils/Password');const {generateAccessToken}=require('../src/utils/generateComplexToken');
let database,user,cookie;
before(async()=>{database=await MongoMemoryServer.create();await mongoose.connect(database.getUri());user=await User.create({fullName:'Profile fixture',email:'profile@example.test',password:await hashPassword('OldPassword123!'),role:'admin',permissions:[]});cookie=`access_token=${generateAccessToken(user)}; csrf_token=profile-test`;});
after(async()=>{await mongoose.disconnect();await database?.stop();});
const change=(path,body)=>request(app).put(path).set('Cookie',cookie).set('X-CSRF-Token','profile-test').send(body);
test('profile uses authenticated identity, preserves email and role, and requires CSRF for changes',async()=>{
 await request(app).get('/user/profile/me').expect(401);
 const read=await request(app).get('/user/profile/me').set('Cookie',cookie).expect(200);assert.equal(read.body.data.basicInfo.email,user.email);
 await request(app).put('/user/profile/basic').set('Cookie',cookie).send({fullName:'New Name'}).expect(403);
 await change('/user/profile/basic',{fullName:'X'}).expect(400);
 await change('/user/profile/basic',{fullName:'Updated fixture',phone:'0555555555',email:'changed@example.test',role:'super_admin'}).expect(200);
 const saved=await User.findById(user._id);assert.equal(saved.fullName,'Updated fixture');assert.equal(saved.email,user.email);assert.equal(saved.role,'admin');assert.equal(saved.phone,'0555555555');
});
test('password endpoint rejects mismatch and wrong current password before saving a valid hash',async()=>{
 const path='/user/security/password';await change(path,{oldPassword:'OldPassword123!',newPassword:'NewPassword123!',confirmPassword:'different'}).expect(400);
 await change(path,{oldPassword:'wrong',newPassword:'NewPassword123!',confirmPassword:'NewPassword123!'}).expect(401);
 await change(path,{oldPassword:'OldPassword123!',newPassword:'NewPassword123!',confirmPassword:'NewPassword123!'}).expect(200);
 const saved=await User.findById(user._id).select('+password');assert.equal(await comparePassword('NewPassword123!',saved.password),true);assert.equal(await comparePassword('OldPassword123!',saved.password),false);
});

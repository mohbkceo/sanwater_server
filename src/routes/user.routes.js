
const express = require('express');
const router = express.Router();

const { authSanWater } = require('../middlewares');

const { signIn, register, logout, refreshTokenValidation } = require('../controllers');


router.post('/auth/register', register);
router.post('/auth/signin', signIn);
router.post('/auth/logout', logout);
router.get('/auth/getaccesstoken/v1', refreshTokenValidation);



module.exports = router;

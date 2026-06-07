const express = require('express');
const router = express.Router();

const { authSanWater } = require('../middlewares');
const { fetchAdmins, deleteAdmins } = require('../controllers');

router.get('/admins/v1', authSanWater, fetchAdmins);
router.delete('/admins/v1', authSanWater, deleteAdmins);

const express = require('express');
const router = express.Router();

const { authSanWater, authorize } = require('../middlewares');
const { signIn, register, logout, refreshTokenValidation } = require('../controllers');
const User = require('../models/user.model');
const returnResponse  = require('../utils/responseHandler');
const { SUCCESS } = require('../config/messages');


router.post('/auth/register', register);
router.post('/auth/signin', signIn);
router.post('/auth/logout', logout);
router.get('/auth/getaccesstoken/v1', refreshTokenValidation);


router.get('/', authSanWater, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find().select('-password');
    return returnResponse(res, SUCCESS.RESOURCES_FOUND , users);
  } catch (err) {
    next(err);
  }
});

const { logActivity } = require('../utils/logger');

router.put('/:id/role', authSanWater, authorize('super_admin', true), async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password');
    await logActivity(req, 'ROLE_CHANGE', 'User', user._id, { newRole: role, userEmail: user.email });
    returnResponse(res, SUCCESS.RESOURCES_UPDATED, user);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authSanWater, authorize('super_admin', true), async (req, res, next) => {
  try {
    const { uid, email } = req.user;
     const user = await User.findByIdAndDelete(req.params.id);
    await logActivity(req, 'DELETE', 'User', user._id, { responsible: uid, responsibleEmail: email });
    returnResponse(res, SUCCESS.RESOURCES_DELETED);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

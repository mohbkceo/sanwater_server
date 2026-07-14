
const express = require('express');
const router = express.Router();

const { authSanWater, authorize } = require('../middlewares');
const { signIn, register, logout, refreshTokenValidation } = require('../controllers');
const User = require('../models/user.model');
const returnResponse  = require('../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../config/messages');


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
const { getUserProfile, updateBasicInfo, changePassword, getSecurityInfo } = require('../controllers/users/userController');
const CostumeExption = require('../utils/CostumeException');

// User profile management routes
router.get('/profile/me', authSanWater, getUserProfile);
router.get('/security/me', authSanWater, getSecurityInfo);
router.put('/profile/basic', authSanWater, updateBasicInfo);
router.put('/security/password', authSanWater, changePassword);

router.put('/:id/role', authSanWater, authorize('super_admin', true), async (req, res, next) => {
  try {
    const { role } = req.body;
    const { id } = req.params;
    const { uid } = req.user;

    if(uid === id){
      throw new CostumeExption(ERRORS.UNAUTHORIZED?.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, {
        message: 'The user can not delete itself'
      });
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        {
          message: 'User not found'
        }
      );
    }
    
    await user.updateOne({ role }, {new: true}).select('-password');
    await logActivity(req, 'ROLE_CHANGE', 'User', user._id, { newRole: role, userEmail: user.email });
    returnResponse(res, SUCCESS.RESOURCES_UPDATED, user);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authSanWater, authorize('super_admin', true), async (req, res, next) => {
  try {
    const { uid, email } = req.user;
    const { id } = req.params
    if(uid === id){
      throw new CostumeExption(ERRORS.UNAUTHORIZED?.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, {
        message: 'The user can not delete itself'
      });
    }
    
    const user = await User.findById(id);
    if (!user) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        {
          message: 'User not found'
        }
      );
    }
    if(user?.role === 'super_admin'){
    
      throw new CostumeExption(ERRORS.UNAUTHORIZED?.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, {
        message: 'Super admin cannot be delted'
      });
    }
    await user.deleteOne()
    await logActivity(req, 'DELETE', 'User', user._id, { responsible: uid, responsibleEmail: email });
    returnResponse(res, SUCCESS.RESOURCES_DELETED);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

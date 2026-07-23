
const express = require('express');
const router = express.Router();

const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS, ROLES, ALL_PERMISSIONS } = require('../config/permissions');
const { signIn, register, logout, refreshTokenValidation } = require('../controllers');
const User = require('../models/user.model');
const returnResponse  = require('../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../config/messages');


router.post('/auth/register', register);
router.post('/auth/signin', signIn);
router.post('/auth/logout', logout);
router.get('/auth/getaccesstoken/v1', refreshTokenValidation);


router.get('/', authSanWater, authorize(PERMISSIONS.USERS.VIEW), async (req, res, next) => {
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

router.put('/:id/permissions', authSanWater, authorize(PERMISSIONS.USERS.MANAGE_PERMISSIONS), async (req, res, next) => {
  try {
    const { permissions, role } = req.body;
    const { id } = req.params;
    const { uid } = req.user;

    const user = await User.findById(id);
    if (!user) {
      throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'User not found' });
    }

    // Protection for super_admin
    if (user.role === ROLES.SUPER_ADMIN) {
      throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, { message: 'Super admin permissions and role are immutable' });
    }

    const updateData = {};
    if (permissions !== undefined) {
      if (!Array.isArray(permissions) || permissions.some(p => !ALL_PERMISSIONS.includes(p))) {
        throw new CostumeExption(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode, ERRORS.INVALID.key, { message: 'Invalid permissions provided' });
      }
      updateData.permissions = permissions;
    }
    if (role !== undefined && role !== ROLES.ADMIN) {
      throw new CostumeExption(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode, ERRORS.INVALID.key, { message: 'Only the admin role can be assigned' });
    }
    if (role !== undefined) updateData.role = role;

    const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
    await logActivity(req, 'PERMISSIONS_CHANGE', 'User', user._id, { newPermissions: permissions, newRole: role, userEmail: user.email });
    returnResponse(res, SUCCESS.RESOURCES_UPDATED, updatedUser);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authSanWater, authorize(PERMISSIONS.USERS.DELETE), async (req, res, next) => {
  try {
    const { uid, email } = req.user;
    const { id } = req.params;

    if (uid === id) {
      throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, { message: 'You cannot delete yourself' });
    }

    const user = await User.findById(id);
    if (!user) {
      throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'User not found' });
    }

    if (user.role === ROLES.SUPER_ADMIN) {
      throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, { message: 'Super admin cannot be deleted' });
    }

    await user.deleteOne();
    await logActivity(req, 'DELETE', 'User', user._id, { responsible: uid, responsibleEmail: email });
    returnResponse(res, SUCCESS.RESOURCES_DELETED);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

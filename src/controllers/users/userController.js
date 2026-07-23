const User = require('../../models/user.model');
const { ERRORS, SUCCESS } = require('../../config/messages');
const CostumeException = require('../../utils/CostumeException');
const returnResponse = require('../../utils/responseHandler');
const errorHandler = require('../../utils/error.middleware');
const { logActivity } = require('../../utils/logger');
const { hashPassword, comparePassword } = require('../../utils/Password');

/**
 * Get current user's profile information
 * Separates basic info and security info
 */
async function getUserProfile(req, res) {
  try {
    const userId = req.user.uid;

    const user = await User.findById(userId).select('-password');

    if (!user) {
      throw new CostumeException(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: 'user_not_found' }
      );
    }

    // Organize user data into Basic Info and Security Info sections
    const userProfile = {
      basicInfo: {
        fullName: user.fullName,
        email: user.email,
        phone: user.phone || null,
        profileImage: user.profileImage || null,
      },
      securityInfo: {
        role: user.role,
        permissions: user.permissions || [],
        createdWith: user.createdWith || null,
        authKey: user.authKey || null,
        hasPassword: !!user.password,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };

    return returnResponse(res, SUCCESS.RESOURCES_FOUND, userProfile);
  } catch (error) {
    errorHandler(res, error);
  }
}

/**
 * Update user's basic information
 * Allows users to update: fullName, phone, profileImage
 */
async function updateBasicInfo(req, res) {
  try {
    const userId = req.user.uid;
    const { fullName, phone, profileImage } = req.body;

    // Validate required fields
    if (!fullName || fullName.trim().length < 2) {
      throw new CostumeException(
        'Full name must be at least 2 characters long',
        400,
        'INVALID_INPUT',
        { message: 'invalid_fullname' }
      );
    }

    // Prepare update object
    const updateData = {};
    if (fullName) updateData.fullName = fullName.trim();
    if (phone !== undefined) updateData.phone = phone || null;
    if (profileImage !== undefined) updateData.profileImage = profileImage || null;

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).select('-password');

    if (!user) {
      throw new CostumeException(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: 'user_not_found' }
      );
    }

    await logActivity(req, 'UPDATE', 'User', userId, {
      updatedFields: Object.keys(updateData),
    });

    const basicInfo = {
      fullName: user.fullName,
      email: user.email,
      phone: user.phone || null,
      profileImage: user.profileImage || null,
    };

    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, basicInfo);
  } catch (error) {
    errorHandler(res, error);
  }
}

/**
 * Change user's password
 * Requires old password verification
 */
async function changePassword(req, res) {
  try {
    const userId = req.user.uid;
    const { oldPassword, newPassword, confirmPassword } = req.body;

    // Validate required fields
    if (!oldPassword || !newPassword || !confirmPassword) {
      throw new CostumeException(
        'Old password, new password, and confirmation are required',
        400,
        'REQUIRED',
        { message: 'missing_required_fields' }
      );
    }

    if (newPassword !== confirmPassword) {
      throw new CostumeException(
        'New password and confirmation do not match',
        400,
        'INVALID_INPUT',
        { message: 'password_mismatch' }
      );
    }

    if (newPassword.length < 6) {
      throw new CostumeException(
        'New password must be at least 6 characters long',
        400,
        'INVALID_INPUT',
        { message: 'password_too_short' }
      );
    }

    // Fetch user with password field
    const user = await User.findById(userId).select('+password');

    if (!user) {
      throw new CostumeException(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: 'user_not_found' }
      );
    }

    // Verify old password
    const isPasswordValid = await comparePassword(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new CostumeException(
        'Old password is incorrect',
        401,
        'UNAUTHORIZED',
        { message: 'invalid_old_password' }
      );
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    await user.save();

    await logActivity(req, 'UPDATE', 'User', userId, {
      action: 'password_changed',
    });

    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, {
      message: 'Password changed successfully',
    });
  } catch (error) {
    errorHandler(res, error);
  }
}

/**
 * Get user's security information
 * Only returns security-related fields
 */
async function getSecurityInfo(req, res) {
  try {
    const userId = req.user.uid;

    const user = await User.findById(userId).select('-password');

    if (!user) {
      throw new CostumeException(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: 'user_not_found' }
      );
    }

    const securityInfo = {
      role: user.role,
      permissions: user.permissions || [],
      createdWith: user.createdWith || null,
      authKey: user.authKey || null,
      hasPassword: !!user.password,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return returnResponse(res, SUCCESS.RESOURCES_FOUND, securityInfo);
  } catch (error) {
    errorHandler(res, error);
  }
}

module.exports = {
  getUserProfile,
  updateBasicInfo,
  changePassword,
  getSecurityInfo,
};

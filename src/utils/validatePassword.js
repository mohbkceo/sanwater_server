const CostumeExption = require('../middlewares/CostumeException');
const { ERRORS } = require('../config/messages');

const PASSWORD_RULES = {
  MIN_LENGTH: 8,
  UPPERCASE: /[A-Z]/,
  LOWERCASE: /[a-z]/,
  NUMBER: /[0-9]/,
  WHITESPACE: /\s/
};

function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new CostumeExption(
      'Password must be a string',
      ERRORS.INVALID.statusCode
    );
  }

  if (password.length < PASSWORD_RULES.MIN_LENGTH) {
    throw new CostumeExption(
      `Password must be at least ${PASSWORD_RULES.MIN_LENGTH} characters`,
      ERRORS.INVALID.statusCode
    );
  }

  if (!PASSWORD_RULES.UPPERCASE.test(password)) {
    throw new CostumeExption(
      'Password must contain at least one uppercase letter',
      ERRORS.INVALID.statusCode
    );
  }

  if (!PASSWORD_RULES.LOWERCASE.test(password)) {
    throw new CostumeExption(
      'Password must contain at least one lowercase letter',
      ERRORS.INVALID.statusCode
    );
  }

  if (!PASSWORD_RULES.NUMBER.test(password)) {
    throw new CostumeExption(
      'Password must contain at least one number',
      ERRORS.INVALID.statusCode
    );
  }

  if (PASSWORD_RULES.WHITESPACE.test(password)) {
    throw new CostumeExption(
      'Password must not contain spaces',
      ERRORS.INVALID.statusCode
    );
  }

  return true;
}

module.exports = validatePassword;

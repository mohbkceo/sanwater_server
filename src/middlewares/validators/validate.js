const returnResponse = require('../../utils/responseHandler');

const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
        const errorMessage = error.details.map((detail) => detail.message).join(', ');
        return res.status(400).json({ success: false, message: errorMessage, fields: Object.fromEntries(error.details.map(detail => [detail.path.join('.'), detail.message])) });
    }
    next();
};

module.exports = validate;

const errorHandler = require('../utils/error.middleware')
const authSanWater = require('./authentication/auth.sanwatergroup')
const authorize = require('./authentication/authorize')




module.exports = {errorHandler, authSanWater, authorize}
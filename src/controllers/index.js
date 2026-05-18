const { signIn, register, logout } = require("./sanwater_group/auth.controller");
const refreshTokenValidation = require("./sanwater_group/refreshToken");


module.exports = {signIn, register, logout, refreshTokenValidation }
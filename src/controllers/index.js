const { signIn, register, logout } = require("./sanwater_group/auth.controller");
const refreshTokenValidation = require("./sanwater_group/refreshToken");

const { fetchAdmins, deleteAdmins } = require('./sanwater_group/admins.contoller')


module.exports = {signIn, register, logout, refreshTokenValidation, fetchAdmins, deleteAdmins}
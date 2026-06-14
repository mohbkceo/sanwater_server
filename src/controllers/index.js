const { signIn, register, logout } = require("./sanwater_group/auth.controller");
const refreshTokenValidation = require("./sanwater_group/refreshToken");

const { fetchAdmins, deleteAdmins } = require('./sanwater_group/admins.contoller');
const { getPageContent, updatePageContent } = require("./contents/pageContent.controller");

module.exports = {signIn, register, getPageContent, updatePageContent, logout, refreshTokenValidation, fetchAdmins, deleteAdmins}
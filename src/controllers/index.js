const { signIn, register, logout } = require("./sanwater_group/auth.controller");
const refreshTokenValidation = require("./sanwater_group/refreshToken");

const { getPageContent, updatePageContent } = require("./contents/pageContent.controller");

module.exports = {signIn, register, getPageContent, updatePageContent, logout, refreshTokenValidation}
const jwt = require('jsonwebtoken')


 function  generateToken (user) {
    const token =  jwt.sign({id:user._id, username:user.username, email:user.email}, process.env.JWT_SECRET)
    return token;
}
module.exports = generateToken
const User = require('../models/user.model');



const { hashPassword, comparePassword } = require('../utils/Password');

const CostumeExption = require('../utils/CostumeException')

const {ERRORS} = require('../config/messages')
const {deepMerge} = require('../config/data_controle');
const { default: mongoose } = require('mongoose');


class UserService {
 

  async creatUser(userData){
      try {
        const userSchema = {
            fullName: true,
            phone: true,
            email: true
        }
        let hashedPassword = await hashPassword(userData?.password);
        let costmizedUser = {};
        deepMerge(costmizedUser, userData, userSchema);
        const createdUser =  await User.create({
         ...costmizedUser,
         password: hashedPassword,
         email: costmizedUser?.email.toLowerCase(),
        });
          return createdUser;
        } catch (err) {
          throw err;
        } 

  
  }

  

 

  async updateField(username, field, fieldName) {
    if(!username || !field || !fieldName) { 
      throw new CostumeExption(ERRORS.REQUIRED.msg, ERRORS.REQUIRED.statusCode);
    }
    const update = await User.findOneAndUpdate({username}, {$set: {...field},  $currentDate: { lastModified: true }}, {new: true})
    
    if(!update){ 
      throw new CostumeExption(ERRORS.SERVER_ERROR.msg, ERRORS.SERVER_ERROR.statusCode);
    }
    
    return {
     ...update._doc?.[fieldName]?._doc
    };
  }
}

module.exports = new UserService();

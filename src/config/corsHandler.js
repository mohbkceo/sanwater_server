
const {allowedOrigin} = require('./data_controle')
const corsOptions = {
        origin:function(origin, callback){
            if(allowedOrigin.indexOf(origin) !== -1 || !origin) callback(null, true)
            else callback(new Error("Not allowed by CORS"))
        },
        credentials:true,
} 


    module.exports = corsOptions


class CostumeExption extends Error  {
    constructor(message, statusCode, key, meta = {}){
        super(message)
        this.statusCode = statusCode
        this.key = key;
        this.meta = meta
    }
}

module.exports =  CostumeExption;
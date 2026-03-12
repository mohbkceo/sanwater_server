const JOI = require("joi");

const productValidatorSchema = JOI.object({
    name: JOI.string().min(3).max(100).optional(),
    family: JOI.string().max(50).optional(),
    tags: JOI.array().max(20).optional(),
    productVariants: JOI.array().items({
    
    })
})



const errorHandler = (res,err) => {

  try {
    console.error('Caught error: ', err.stack || err.message);

    const duplicate = err?.code === 11000;
    const skuConflict = duplicate && err.keyPattern?.['commerce.variants.sku'];
    const fields = skuConflict ? { variantsV2: `SKU ${err.keyValue?.['commerce.variants.sku'] || ''} already exists on another product.` } : err.fields;
    const message = skuConflict ? fields.variantsV2 : duplicate ? 'Resource already exists' : (err.message || 'Something went wrong');
    const errorCode = duplicate || err.name === 'VersionError' ? 409 : (err.statusCode || (err.name === 'ValidationError' ? 422 : 500))
    
    console.error(message, errorCode, err?.meta?.message);
    return res.status(errorCode).json({ message , errorCode, ...(skuConflict ? { code: 'DUPLICATE_SKU' } : err.key ? { code: err.key } : {}), ...(fields ? { fields } : {}) });
  } catch (error) {
         console.error(error);
  }
    
  };
  
  module.exports = errorHandler;

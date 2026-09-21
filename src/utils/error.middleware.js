


const errorHandler = (res,err) => {

  try {
    console.error('Caught error: ', err.stack || err.message);

    const duplicate = err?.code === 11000;
    const message = duplicate ? 'Resource already exists' : (err.message || 'Something went wrong');
    const errorCode = duplicate ? 409 : (err.statusCode || 500)
    
    console.error(message, errorCode, err?.meta?.message);
    return res.status(errorCode).json({ message , errorCode });
  } catch (error) {
         console.error(error);
  }
    
  };
  
  module.exports = errorHandler;

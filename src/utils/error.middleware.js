


const errorHandler = (res,err) => {

  try {
    console.error('Caught error: ', err.stack || err.message);

    const message = err.message || 'Something went wrong';
    const errorCode = err.statusCode || 500
    
    console.error(message, errorCode, err?.meta?.message);
    return res.status(errorCode).json({ message , errorCode });
  } catch (error) {
         console.error(error);
  }
    
  };
  
  module.exports = errorHandler;
  
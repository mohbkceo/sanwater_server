module.exports = (req, res, next) => {
    res.status(404).json({
      success: false,
      message: 'The requested resource was not found.',
      path: req.originalUrl
    });
  };
  
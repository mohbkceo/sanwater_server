
module.exports = async (res, respondObject, data) => {
    return res.status(respondObject?.statusCode).json({ success: true, message:respondObject?.msg, data });
}
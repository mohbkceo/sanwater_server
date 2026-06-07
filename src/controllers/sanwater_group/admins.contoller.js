const { ERRORS, SUCCESS } = require("../../config/messages");
const { errorHandler } = require("../../middlewares");
const UserServices = require("../../services/user.services");
const CostumeExption = require("../../utils/CostumeException");
const returnResponse  = require("../../utils/responseHandler");



async function fetchAdmins(req, res){
    try {
        const { role } = req.query;
        const filter = { $or: [
            { role: 'manager' },
            { role: 'admin'   },
            { role: 'super_admin' },
        ]}
        const fetchedAdmins = await UserServices.getUsers(filter);
        return returnResponse(res, SUCCESS.RESOURCES_FOUND, fetchedAdmins);
    } catch (error) {
        errorHandler(res, error);
    }
}

const managingPermessions = {
    super_admin: ['admin', 'manager'],
    admin: ['manager']
}
async function deleteAdmins(req, res){
    try {
        const { role } = req.user;
        const { user } = req.body;
        const range = managingPermessions?.[role];
        if(!range || !range.includes(user?.role)) {
            throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key, {
                message: `You don't have permissions to tack this action`
            })
        }
        const actionTaken = await UserServices.deleteUserById(user._id);
        return returnResponse(res, SUCCESS.RESOURCES_DELETED, actionTaken);
    } catch (error) {
        errorHandler(res, error);
    }
}

module.exports = { fetchAdmins, deleteAdmins }
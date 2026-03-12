const ERRORS = {
    REQUIRED: { key: 'REQUIRED', msg: 'Field is required', statusCode: 402 },
    NOT_FOUND: { key: 'NOT_FOUND', msg: 'Resource not found', statusCode: 404 },
    DUPLICATE: { key: 'DUPLICATE', msg: 'Resource already exists', statusCode: 409 },
    INVALID: { key: 'INVALID', msg: 'Resource Invalid', statusCode: 422 },
    UNAUTHORIZED: { key: 'UNAUTHORIZED', msg: 'Unauthorized Access', statusCode: 401 },
    CONFLICT : {key: 'CONFLICT', msg: 'Conflict Resources', statusCode: 409},
    SERVER_ERROR : {key: 'SERVER_ERROR', msg: 'Somthing went wrong on the server', statusCode: 500},
  };
  
  const SUCCESS = {
    RESOURCES_CREATED: { key: 'RESOURCE_CREATED', msg: 'Resource managed created successfully', statusCode: 201 },
    RESOURCES_FOUND: { key: 'RESOURCE_FOUND', msg: 'Resources founded successfully', statusCode: 200 },
    RESOURCES_UPDATED: { key: 'RESOURCE_FOUND', msg: 'Resources Updated successfully', statusCode: 200 },
    RESOURCES_DELETED: { key: 'RESOURCE_DELETED', msg: 'Resources deleted successfully', statusCode: 200 },
    PASSWORD_CHANGED: {key :'PASSWORD_CHANGED', msg: 'Password updated successfully.', statusCode: 200}
  };
  
  module.exports = { ERRORS, SUCCESS };
  
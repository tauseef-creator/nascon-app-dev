'use strict';

// Standard error body (spec 5.2): { error: { code, message, details } }
class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details || {};
  }
}

const validation = (fields, message = 'Request validation failed.') =>
  new ApiError(400, 'VALIDATION_ERROR', message, { fields: [...new Set(fields)] });
const badRequest = (code, message, details) => new ApiError(400, code, message, details);
const notFound = (code, message, details) => new ApiError(404, code, message, details);
const conflict = (code, message, details) => new ApiError(409, code, message, details);
const forbidden = (message = 'You are not allowed to perform this action.') =>
  new ApiError(403, 'FORBIDDEN', message, {});
const unauthenticated = (message = 'Missing or invalid token.') =>
  new ApiError(401, 'UNAUTHENTICATED', message, {});

function errorBody(err) {
  return { error: { code: err.code, message: err.message, details: err.details || {} } };
}

// Express error middleware (must keep 4 args).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) return res.status(err.status).json(errorBody(err));
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json(errorBody(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.')));
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json(errorBody(validation(['body'], 'Malformed JSON body.')));
  }
  console.error('[unhandled]', err);
  return res.status(500).json(errorBody(new ApiError(500, 'INTERNAL_ERROR', 'Unexpected server error.')));
}

module.exports = { ApiError, validation, badRequest, notFound, conflict, forbidden, unauthenticated, errorBody, errorHandler };

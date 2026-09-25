/**
 * Shared API error handler.
 *
 * Transforms raw axios errors into enriched Error objects with consistent
 * user-facing messages and metadata fields:
 *   - message        : developer-facing description
 *   - userMessage    : safe string to display in the UI
 *   - type           : error type constant (e.g. 'NETWORK', 'NOT_FOUND')
 *   - statusCode     : HTTP status code, or 0 for network/connection errors
 *   - isRecoverable  : whether the user can retry without logging out
 *   - validationErrors: (422 only) field-level validation detail from the server
 *   - originalError  : the raw axios error
 *   - action         : the action string passed by the caller
 *
 * @param {Error} error - The error thrown by axios
 * @param {string} action - Short description of what was being attempted
 * @returns {Error} Enhanced error object
 */
export function handleApiError(error, action = 'completing the request') {
  const enhancedError = new Error()

  // Network / connection errors (no HTTP response received)
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      enhancedError.message = `Request timeout while ${action}. The server took too long to respond.`
      enhancedError.userMessage = 'The request timed out. Please try again.'
      enhancedError.type = 'TIMEOUT'
    } else if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
      enhancedError.message = `Network error while ${action}. Unable to connect to the server.`
      enhancedError.userMessage = 'Unable to connect to the server. Please check your internet connection and ensure the backend server is running.'
      enhancedError.type = 'NETWORK'
    } else {
      enhancedError.message = `Connection failed while ${action}. ${error.message}`
      enhancedError.userMessage = 'Connection failed. Please verify the backend server is running and accessible.'
      enhancedError.type = 'CONNECTION'
    }
    enhancedError.statusCode = 0
    enhancedError.isRecoverable = true
    enhancedError.originalError = error
    enhancedError.action = action
    return enhancedError
  }

  // HTTP error responses
  const status = error.response.status
  const responseData = error.response.data

  enhancedError.statusCode = status
  enhancedError.response = error.response

  switch (status) {
    case 400:
      enhancedError.message = `Bad request while ${action}: ${responseData.error || responseData.message || 'Invalid data provided'}`
      enhancedError.userMessage = responseData.error || 'The request contains invalid data. Please check your input.'
      enhancedError.type = 'BAD_REQUEST'
      enhancedError.isRecoverable = true
      break

    case 401:
      enhancedError.message = `Unauthorized while ${action}. Please log in again.`
      enhancedError.userMessage = 'Your session has expired. Please log in again.'
      enhancedError.type = 'UNAUTHORIZED'
      enhancedError.isRecoverable = false
      break

    case 403:
      enhancedError.message = `Access forbidden while ${action}. Insufficient permissions.`
      enhancedError.userMessage = 'You do not have permission to perform this action.'
      enhancedError.type = 'FORBIDDEN'
      enhancedError.isRecoverable = false
      break

    case 404:
      enhancedError.message = `Resource not found while ${action}.`
      enhancedError.userMessage = responseData.error || 'The requested resource was not found.'
      enhancedError.type = 'NOT_FOUND'
      enhancedError.isRecoverable = true
      break

    case 409:
      enhancedError.message = `Conflict while ${action}: ${responseData.error || 'Resource already exists'}`
      enhancedError.userMessage = responseData.error || 'A conflict occurred. This resource may already exist.'
      enhancedError.type = 'CONFLICT'
      enhancedError.isRecoverable = true
      break

    case 422:
      enhancedError.message = `Validation error while ${action}: ${responseData.error || 'Invalid data'}`
      enhancedError.userMessage = responseData.error || 'The data provided failed validation.'
      enhancedError.type = 'VALIDATION_ERROR'
      enhancedError.isRecoverable = true
      enhancedError.validationErrors = responseData.errors
      break

    case 429:
      enhancedError.message = `Rate limit exceeded while ${action}.`
      enhancedError.userMessage = 'Too many requests. Please wait a moment and try again.'
      enhancedError.type = 'RATE_LIMIT'
      enhancedError.isRecoverable = true
      break

    case 500:
    case 502:
    case 503:
    case 504:
      enhancedError.message = `Server error while ${action}: ${responseData.error || 'Internal server error'}`
      enhancedError.userMessage = responseData.error || 'A server error occurred. Please try again later or contact support if the issue persists.'
      enhancedError.type = 'SERVER_ERROR'
      enhancedError.isRecoverable = true
      break

    default:
      enhancedError.message = `Error while ${action}: ${responseData.error || responseData.message || 'Unknown error'}`
      enhancedError.userMessage = responseData.error || responseData.message || 'An unexpected error occurred.'
      enhancedError.type = 'UNKNOWN'
      enhancedError.isRecoverable = true
  }

  enhancedError.originalError = error
  enhancedError.action = action

  return enhancedError
}

/**
 * The most specific message to show for a failed request: the server's own
 * error, else its first validation message (express-validator's
 * `{ errors: [{ msg }] }`), else the enriched/axios message.
 * @param {Error} error - raw axios error or one returned by handleApiError
 * @returns {string}
 */
export function apiErrorMessage(error) {
  const data = error?.response?.data || error?.originalError?.response?.data
  return data?.error
    || data?.errors?.[0]?.msg
    || error?.userMessage
    || error?.message
    || 'Request failed'
}

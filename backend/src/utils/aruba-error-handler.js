/**
 * Aruba Central Error Handler
 * Provides user-friendly error messages and troubleshooting guidance
 */

const { debugLog, Services } = require('./debug-logger');
const logger = debugLog.createLogger(Services.ARUBA_CENTRAL);

// Common Aruba Central error patterns and their user-friendly translations
const ERROR_TRANSLATIONS = {
  // OAuth2 Errors
  'unsupported_grant_type': {
    type: 'AUTH_CONFIG',
    message: 'OAuth2 authentication method not supported',
    explanation: 'Your Aruba Central application is not configured for client credentials flow',
    actions: [
      'Check your Aruba Central application configuration',
      'Ensure your app supports "client_credentials" grant type',
      'Consider using authorization_code flow instead',
      'Verify you have the correct API permissions'
    ],
    documentation: 'https://developer.arubanetworks.com/aruba-central/docs/api-oauth-access-token'
  },
  'invalid_client': {
    type: 'AUTH_CREDENTIALS',
    message: 'Invalid client credentials',
    explanation: 'Your client ID or client secret is incorrect',
    actions: [
      'Verify the Client ID and Client Secret in Settings → Cloud Integrations',
      'Check for extra spaces or special characters',
      'Regenerate credentials in Aruba Central if needed'
    ]
  },
  'invalid_scope': {
    type: 'AUTH_PERMISSIONS',
    message: 'Insufficient API permissions',
    explanation: 'Your application lacks the required API scope permissions',
    actions: [
      'Review your Aruba Central application scope settings',
      'Request additional API permissions if needed',
      'Contact your Aruba Central administrator'
    ]
  },
  'access_denied': {
    type: 'AUTH_ACCESS',
    message: 'Access denied to Aruba Central API',
    explanation: 'Your credentials are valid but access is not permitted',
    actions: [
      'Verify your account has API access enabled',
      'Check if your account is properly licensed',
      'Contact your Aruba Central administrator'
    ]
  },
  
  // API Errors
  'insufficient_privileges': {
    type: 'API_PERMISSIONS',
    message: 'Insufficient privileges for this operation',
    explanation: 'Your account lacks the required permissions for this API call',
    actions: [
      'Review your Aruba Central role permissions',
      'Contact your administrator to upgrade your access level'
    ]
  },
  'rate_limit_exceeded': {
    type: 'API_RATE_LIMIT',
    message: 'API rate limit exceeded',
    explanation: 'Too many requests have been made in a short time period',
    actions: [
      'Wait before retrying the request',
      'Implement exponential backoff in your requests',
      'Consider reducing the frequency of API calls'
    ]
  },
  'invalid_customer_id': {
    type: 'CONFIG_ERROR',
    message: 'Invalid customer ID',
    explanation: 'The customer_id parameter is incorrect or missing',
    actions: [
      'Verify the Customer ID in Settings → Cloud Integrations',
      'Check your Aruba Central account settings for the correct customer ID'
    ]
  }
};

// HTTP status code patterns
const STATUS_CODE_PATTERNS = {
  400: {
    type: 'BAD_REQUEST',
    category: 'client_error',
    message: 'Bad request - check your request parameters'
  },
  401: {
    type: 'UNAUTHORIZED',
    category: 'auth_error',
    message: 'Authentication failed - check your credentials'
  },
  403: {
    type: 'FORBIDDEN',
    category: 'permission_error',
    message: 'Access forbidden - insufficient permissions'
  },
  404: {
    type: 'NOT_FOUND',
    category: 'client_error',
    message: 'Resource not found - check your endpoint URL'
  },
  429: {
    type: 'RATE_LIMITED',
    category: 'rate_limit',
    message: 'Rate limit exceeded - too many requests'
  },
  500: {
    type: 'SERVER_ERROR',
    category: 'server_error',
    message: 'Aruba Central server error - try again later'
  },
  502: {
    type: 'BAD_GATEWAY',
    category: 'server_error',
    message: 'Aruba Central gateway error - service may be down'
  },
  503: {
    type: 'SERVICE_UNAVAILABLE',
    category: 'server_error',
    message: 'Aruba Central service unavailable - try again later'
  }
};

class ArubaErrorHandler {
  /**
   * Parse and enhance Aruba Central API errors
   * @param {Error} error - The original error from Axios/API call
   * @param {string} context - Additional context (e.g., 'authentication', 'device_sync')
   * @returns {Object} Enhanced error information
   */
  static parseError(error, context = 'api_call') {
    const enhancedError = {
      originalError: error,
      context,
      timestamp: new Date().toISOString(),
      isArubaError: false,
      userMessage: 'An unexpected error occurred',
      technicalMessage: error.message,
      type: 'UNKNOWN_ERROR',
      category: 'unknown',
      actions: ['Contact support if the problem persists'],
      details: {}
    };

    // Network/Connection errors
    if (!error.response) {
      enhancedError.type = 'NETWORK_ERROR';
      enhancedError.category = 'connection_error';
      enhancedError.userMessage = 'Unable to connect to Aruba Central';
      enhancedError.actions = [
        'Check your internet connection',
        'Verify the Aruba Central service URL',
        'Check if Aruba Central is experiencing outages',
        'Verify firewall/proxy settings'
      ];
      enhancedError.details = {
        isNetworkError: true,
        endpoint: error.config?.url,
        timeout: error.code === 'ECONNABORTED'
      };
      return enhancedError;
    }

    // HTTP Response errors from Aruba Central
    enhancedError.isArubaError = true;
    enhancedError.details = {
      statusCode: error.response.status,
      statusText: error.response.statusText,
      endpoint: error.config?.url,
      method: error.config?.method?.toUpperCase(),
      responseData: error.response.data,
      headers: error.response.headers
    };

    // Parse Aruba Central error response
    const responseData = error.response.data;
    let errorCode = null;
    let errorDescription = null;

    if (responseData && typeof responseData === 'object') {
      // OAuth2 error format: {"error": "code", "error_description": "desc"}
      if (responseData.error) {
        errorCode = responseData.error;
        errorDescription = responseData.error_description;
      }
      // API error format: {"message": "desc", "error_code": "code"}
      else if (responseData.message) {
        errorDescription = responseData.message;
        errorCode = responseData.error_code || responseData.code;
      }
      // Generic error format
      else if (responseData.description) {
        errorDescription = responseData.description;
      }
    }

    // Look up known error patterns
    if (errorCode && ERROR_TRANSLATIONS[errorCode]) {
      const translation = ERROR_TRANSLATIONS[errorCode];
      enhancedError.type = translation.type;
      enhancedError.userMessage = translation.message;
      enhancedError.explanation = translation.explanation;
      enhancedError.actions = translation.actions;
      enhancedError.documentation = translation.documentation;
      enhancedError.category = this.getCategoryFromType(translation.type);
    }
    // Fall back to HTTP status code patterns
    else if (STATUS_CODE_PATTERNS[error.response.status]) {
      const pattern = STATUS_CODE_PATTERNS[error.response.status];
      enhancedError.type = pattern.type;
      enhancedError.category = pattern.category;
      enhancedError.userMessage = pattern.message;
    }

    // Use error description from Aruba if available
    if (errorDescription) {
      enhancedError.technicalMessage = errorDescription;
    }

    // Add context-specific guidance
    enhancedError.actions = this.addContextualActions(enhancedError, context);

    return enhancedError;
  }

  /**
   * Get error category from error type
   */
  static getCategoryFromType(type) {
    const categoryMap = {
      'AUTH_CONFIG': 'auth_error',
      'AUTH_CREDENTIALS': 'auth_error',
      'AUTH_PERMISSIONS': 'auth_error',
      'AUTH_ACCESS': 'auth_error',
      'API_PERMISSIONS': 'permission_error',
      'API_RATE_LIMIT': 'rate_limit',
      'CONFIG_ERROR': 'config_error'
    };
    return categoryMap[type] || 'unknown';
  }

  /**
   * Add context-specific troubleshooting actions
   */
  static addContextualActions(enhancedError, context) {
    const actions = [...(enhancedError.actions || [])];

    if (context === 'authentication' && enhancedError.category === 'auth_error') {
      actions.push('Check your .env file configuration');
      actions.push('Verify your Aruba Central application settings');
    }

    if (context === 'device_sync' && enhancedError.category === 'permission_error') {
      actions.push('Ensure your API application has device read permissions');
      actions.push('Verify your account can access the monitoring APIs');
    }

    return actions;
  }

  /**
   * Log error with appropriate level and format
   */
  static logError(enhancedError, requestId = null) {
    const logData = {
      type: enhancedError.type,
      category: enhancedError.category,
      userMessage: enhancedError.userMessage,
      context: enhancedError.context,
      ...(enhancedError.details.statusCode && { statusCode: enhancedError.details.statusCode }),
      ...(enhancedError.details.endpoint && { endpoint: enhancedError.details.endpoint }),
      ...(enhancedError.isArubaError && { isArubaError: true })
    };

    // Log technical details at debug level
    logger.debug('Error details', {
      technicalMessage: enhancedError.technicalMessage,
      responseData: enhancedError.details.responseData,
      headers: enhancedError.details.headers
    }, requestId);

    // Log user-friendly error at appropriate level
    if (enhancedError.category === 'server_error') {
      logger.warn('Aruba Central service error', logData, requestId);
    } else {
      logger.error('Aruba Central API error', logData, requestId);
    }
  }

  /**
   * Create a user-friendly error response
   */
  static createErrorResponse(enhancedError) {
    return {
      success: false,
      error: {
        type: enhancedError.type,
        message: enhancedError.userMessage,
        ...(enhancedError.explanation && { explanation: enhancedError.explanation }),
        actions: enhancedError.actions,
        ...(enhancedError.documentation && { documentation: enhancedError.documentation }),
        context: enhancedError.context
      },
      details: {
        statusCode: enhancedError.details.statusCode,
        timestamp: enhancedError.timestamp
      }
    };
  }
}

module.exports = ArubaErrorHandler;
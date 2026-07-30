# Backend Requirements for Settings Feature

This document outlines the required backend API endpoints and database schema changes needed to support the Settings feature, particularly the API Credentials management functionality.

## Database Schema

### API Credentials Table

Create a new table `api_credentials` with the following schema:

```sql
CREATE TABLE api_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'switch', 'ap', 'gateway', 'controller', 'other'
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL, -- Optional link to device
  username VARCHAR(255),
  password TEXT, -- Should be encrypted
  api_key TEXT, -- Should be encrypted
  api_secret TEXT, -- Should be encrypted
  notes TEXT,
  last_tested TIMESTAMP,
  last_test_status VARCHAR(50), -- 'success', 'failed', null
  metadata JSONB, -- For additional flexible data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_credentials_device_id ON api_credentials(device_id);
CREATE INDEX idx_api_credentials_type ON api_credentials(type);
CREATE INDEX idx_api_credentials_user_id ON api_credentials(user_id);
```

## Required API Endpoints

### Base URL: `/api/v1/settings`

All endpoints require authentication. Credentials should be scoped to the authenticated user.

### API Credentials Endpoints

#### 1. Get All API Credentials
```
GET /api/v1/settings/api-credentials
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Main Switch Credentials",
      "type": "switch",
      "deviceId": "uuid-or-null",
      "username": "admin",
      "apiKey": "***", // Masked for security
      "notes": "Credentials for accessing switch management API",
      "lastTested": "2024-01-15T10:30:00Z",
      "lastTestStatus": "success",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Note:** Password and apiSecret should never be returned in GET requests. Only return masked values (e.g., "***") or omit them entirely.

#### 2. Get Single API Credential
```
GET /api/v1/settings/api-credentials/:id
```

**Response:** Same structure as single item from list

#### 3. Create API Credential
```
POST /api/v1/settings/api-credentials
```

**Request Body:**
```json
{
  "name": "Main Switch Credentials",
  "type": "switch",
  "deviceId": "uuid-or-null",
  "username": "admin",
  "password": "encrypted-password",
  "apiKey": "api-key-value",
  "apiSecret": "api-secret-value",
  "notes": "Optional notes"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Main Switch Credentials",
    "type": "switch",
    "deviceId": "uuid-or-null",
    "username": "admin",
    "notes": "Optional notes",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Validation:**
- `name`: required, string, max 255 chars
- `type`: required, one of ['switch', 'ap', 'gateway', 'controller', 'other']
- `deviceId`: optional, valid UUID that exists in devices table
- `username`: optional, string
- `password`: optional, string (must be encrypted before storage)
- `apiKey`: optional, string (must be encrypted before storage)
- `apiSecret`: optional, string (must be encrypted before storage)
- At least one of (username/password) or (apiKey/apiSecret) should be provided

#### 4. Update API Credential
```
PUT /api/v1/settings/api-credentials/:id
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "type": "switch",
  "deviceId": "uuid-or-null",
  "username": "admin",
  "password": "new-password", // Only include if changing
  "apiKey": "new-api-key", // Only include if changing
  "apiSecret": "new-api-secret", // Only include if changing
  "notes": "Updated notes"
}
```

**Response:** Same as create

**Note:** Only update password/apiKey/apiSecret if provided in request. If omitted, keep existing values.

#### 5. Delete API Credential
```
DELETE /api/v1/settings/api-credentials/:id
```

**Response:**
```json
{
  "success": true,
  "message": "API credential deleted successfully"
}
```

#### 6. Test API Credential
```
POST /api/v1/settings/api-credentials/:id/test
```

This endpoint should attempt to connect to the device using the stored credentials and verify they work.

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Connection successful",
    "testedAt": "2024-01-15T10:30:00Z",
    "responseTime": 250,
    "deviceInfo": {
      "model": "Switch Model",
      "version": "1.2.3"
    }
  }
}
```

**On Failure:**
```json
{
  "success": true,
  "data": {
    "success": false,
    "message": "Authentication failed: Invalid credentials",
    "testedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Implementation Notes:**
- Update `last_tested` and `last_test_status` fields in database
- Test timeout should be reasonable (e.g., 10 seconds)
- Should support different device types (switches, APs, gateways)

#### 7. Get Credentials by Device
```
GET /api/v1/settings/api-credentials/device/:deviceId
```

Returns all credentials associated with a specific device.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Main Switch Credentials",
      "type": "switch",
      ...
    }
  ]
}
```

### General Settings Endpoints (Future Expansion)

These are placeholder endpoints for future settings features:

#### Get All Settings
```
GET /api/v1/settings
```

#### Update Settings
```
PUT /api/v1/settings
```

#### Get Single Setting
```
GET /api/v1/settings/:key
```

#### Update Single Setting
```
PUT /api/v1/settings/:key
```

## Security Requirements

### Encryption
1. **Password Encryption**: All passwords, API keys, and API secrets must be encrypted before storage using a strong encryption algorithm (e.g., AES-256)
2. **Encryption Key Management**: Store encryption keys securely (environment variables, secret management service)
3. **Never Return Secrets**: Never return unencrypted passwords/secrets in API responses

### Authorization
1. **User Scoping**: Each credential should belong to a user. Users should only access their own credentials
2. **Role-Based Access**: Consider implementing admin roles that can view all credentials
3. **Audit Logging**: Log all credential operations (create, update, delete, test) for security auditing

### Validation
1. **Input Sanitization**: Sanitize all inputs to prevent SQL injection and XSS
2. **Rate Limiting**: Implement rate limiting on credential testing to prevent abuse
3. **HTTPS Only**: Ensure all credential endpoints are only accessible over HTTPS

## Implementation Checklist

### Database
- [ ] Create `api_credentials` table with proper schema
- [ ] Add indexes for performance
- [ ] Set up encryption functions for sensitive fields

### Backend Routes
- [ ] Create `/routes/settings.routes.js` or `/routes/credentials.routes.js`
- [ ] Implement authentication middleware
- [ ] Implement authorization checks

### Backend Controllers
- [ ] Create `settings.controller.js` or `credentials.controller.js`
- [ ] Implement all CRUD operations
- [ ] Implement credential testing logic

### Backend Services
- [ ] Create `settings.service.js` or `credentials.service.js`
- [ ] Implement encryption/decryption utilities
- [ ] Implement device connection testing for different device types

### Backend Validation
- [ ] Create validation middleware for credential operations
- [ ] Implement input sanitization

### Backend Testing
- [ ] Unit tests for credential operations
- [ ] Integration tests for API endpoints
- [ ] Security tests for encryption/authorization

## Usage in Device Polling

When the backend needs to poll a device for information:

1. Query the `api_credentials` table for credentials associated with the device
2. If multiple credentials exist, try them in order or use the most recently successful one
3. Decrypt the credentials before use
4. Make the API call to the device
5. Update `last_tested` and `last_test_status` based on the result

Example service method:
```javascript
async function getDeviceCredentials(deviceId) {
  const credentials = await db.query(
    'SELECT * FROM api_credentials WHERE device_id = $1 AND last_test_status = $2 ORDER BY last_tested DESC LIMIT 1',
    [deviceId, 'success']
  );

  if (credentials.length > 0) {
    return {
      username: decrypt(credentials[0].username),
      password: decrypt(credentials[0].password),
      apiKey: decrypt(credentials[0].api_key),
      apiSecret: decrypt(credentials[0].api_secret)
    };
  }

  return null;
}
```

## Future Enhancements

1. **Credential Templates**: Allow users to create credential templates for common device types
2. **Bulk Testing**: Test multiple credentials at once
3. **Credential Sharing**: Allow credentials to be shared across multiple devices of the same type
4. **Credential Rotation**: Automatic credential rotation with notifications
5. **Two-Factor Authentication**: Support for devices that require 2FA
6. **Certificate-based Auth**: Support for certificate-based authentication
7. **Credential Health Monitoring**: Regular automated testing of credentials with alerts on failures

# Aruba CX Switch API Integration Test Plan

## Overview

This document provides a test plan for validating the backend API integration with Aruba CX switches. The implementation supports cookie-based authentication with CSRF token support as required by AOS-CX firmware v10.09+.

## Prerequisites

### Switch Configuration

Before testing, ensure your CX switch is properly configured:

1. **Create Admin User**
   ```
   configure terminal
   user admin group administrators password plaintext YOUR_PASSWORD
   ```

2. **Enable HTTPS REST API**
   ```
   https-server rest access-mode read-write
   ```

3. **Enable HTTPS on VRFs**
   ```
   https-server vrf default
   https-server vrf mgmt
   ```

4. **Verify Configuration**
   ```
   show https-server
   show running-config user
   ```

### Test Environment

- **Backend Server**: Running and accessible
- **CX Switch**: Accessible via IP address
- **Authentication**: Valid admin credentials
- **Network**: Backend can reach switch IP (no firewall blocking)

## Architecture Overview

### Device Type Support

The system is designed to support multiple device types:

- **CX Switches** (implemented) - AOS-CX switches with REST API
- **AOS Switches** (future) - Legacy AOS-Switch devices
- **Instant APs** (future) - Aruba Instant Access Points
- **Controllers** (future) - Aruba wireless controllers
- **Gateways** (future) - Aruba gateways

Device type detection is automatic based on:
1. Credential type hint
2. Device model information
3. Device metadata

### Key Components

1. **BaseDeviceAPI** (`src/services/device-api/base-device-api.js`)
   - Abstract interface for all device APIs
   - Ensures consistent behavior across device types

2. **CXSwitchAPI** (`src/services/device-api/cx-switch-api.js`)
   - CX-specific implementation
   - Handles cookie-based auth with CSRF tokens
   - Implements login, logout, device info, firmware info

3. **DeviceAPIFactory** (`src/services/device-api/device-api-factory.js`)
   - Factory pattern for creating device API instances
   - Automatic device type detection
   - Extensible for future device types

4. **Test Controller** (`src/controllers/device-api-test.controller.js`)
   - Provides endpoints for testing device connectivity
   - Supports both stored and manual credentials

## Test Scenarios

### Test 1: Manual Connection Test (Quick Validation)

**Purpose**: Quickly test connectivity without storing credentials or device info.

**Endpoint**: `POST /api/v1/device-api/test-manual`

**Request Body**:
```json
{
  "deviceIp": "192.168.1.1",
  "username": "admin",
  "password": "your_password",
  "deviceType": "cx_switch"
}
```

**Expected Success Response**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Connection successful",
    "testedAt": "2024-10-04T01:30:00.000Z",
    "responseTime": 250,
    "deviceInfo": {
      "hostname": "switch-hostname",
      "model": "Aruba 6300",
      "version": "10.10.1010"
    }
  }
}
```

**cURL Example**:
```bash
curl -X POST "http://localhost:3000/api/v1/device-api/test-manual" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "deviceIp": "192.168.1.1",
    "username": "admin",
    "password": "your_password",
    "deviceType": "cx_switch"
  }'
```

**What This Tests**:
- ✓ Network connectivity to switch
- ✓ HTTPS/SSL connection handling
- ✓ Cookie-based authentication
- ✓ CSRF token handling
- ✓ Login/logout flow
- ✓ Device info retrieval
- ✓ Session cleanup

---

### Test 2: Stored Credential Test

**Purpose**: Test with credentials stored in the database.

**Prerequisites**:
1. Device exists in database (via `/api/v1/devices` endpoint)
2. Credentials stored via `/api/v1/settings/api-credentials`

**Step 1: Create Device** (if not exists)
```bash
POST /api/v1/devices
{
  "serial": "SG1234567890",
  "name": "Core Switch 1",
  "type": "switch",
  "model": "Aruba 6300",
  "ipAddress": "192.168.1.1",
  "location": "Data Center"
}
```

**Step 2: Store Credentials**
```bash
POST /api/v1/settings/api-credentials
{
  "name": "Core Switch 1 Admin",
  "type": "switch",
  "deviceId": "device-uuid-from-step-1",
  "username": "admin",
  "password": "your_password",
  "notes": "Primary admin credentials"
}
```

**Step 3: Test Connection**
```bash
POST /api/v1/device-api/test/{deviceId}
```

**Expected Success Response**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Connection successful",
    "testedAt": "2024-10-04T01:30:00.000Z",
    "responseTime": 250,
    "deviceInfo": {
      "hostname": "switch-hostname",
      "model": "Aruba 6300",
      "version": "10.10.1010"
    }
  }
}
```

---

### Test 3: Get Device Information

**Purpose**: Retrieve detailed device information from the switch.

**Endpoint**: `GET /api/v1/device-api/{deviceId}/info`

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "hostname": "core-switch-01",
    "model": "Aruba 6300M",
    "version": "10.10.1010",
    "serialNumber": "SG1234567890",
    "macAddress": "00:11:22:33:44:55",
    "uptime": "2024-09-01T10:00:00Z",
    "timezone": "UTC",
    "fullData": { /* complete API response */ }
  }
}
```

---

### Test 4: Get Firmware Information

**Purpose**: Retrieve firmware/software image information.

**Endpoint**: `GET /api/v1/device-api/{deviceId}/firmware`

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "currentVersion": "10.10.1010",
    "primaryVersion": "10.10.1010",
    "secondaryVersion": "10.09.1000",
    "bootedImage": "primary",
    "fullData": { /* complete API response */ }
  }
}
```

---

### Test 5: Device Type Detection

**Purpose**: Verify automatic device type detection works correctly.

**Test Cases**:

1. **CX Switch with Model Number**
   - Device model: "Aruba 6300M"
   - Expected: `cx_switch` API used

2. **CX Switch with Metadata**
   - Device metadata: `{ "operatingSystem": "AOS-CX" }`
   - Expected: `cx_switch` API used

3. **Explicit Type Override**
   - Request with `deviceType: "cx_switch"`
   - Expected: Specified type used regardless of detection

---

## Common Error Scenarios

### Error 1: Connection Refused

**Symptom**:
```json
{
  "success": false,
  "error": "CX login failed: connect ECONNREFUSED 192.168.1.1:443"
}
```

**Possible Causes**:
- Switch not reachable from backend server
- HTTPS server not enabled on switch
- Firewall blocking port 443
- Wrong IP address

**Resolution**:
1. Verify network connectivity: `ping 192.168.1.1`
2. Check HTTPS is enabled: `show https-server`
3. Test from backend server: `curl -k https://192.168.1.1`

---

### Error 2: Authentication Failed

**Symptom**:
```json
{
  "success": false,
  "message": "Connection failed: Login failed with status 401: Unauthorized"
}
```

**Possible Causes**:
- Invalid username or password
- User not in administrators group
- Account locked or disabled

**Resolution**:
1. Verify credentials on switch
2. Check user group: `show running-config user`
3. Ensure user has password set

---

### Error 3: SSL Certificate Error

**Symptom**:
```json
{
  "success": false,
  "error": "self signed certificate"
}
```

**Resolution**:
- The implementation already handles self-signed certificates
- This error should not occur with current implementation
- If it does, verify `httpsAgent` configuration

---

### Error 4: No Credentials Found

**Symptom**:
```json
{
  "success": false,
  "error": "No credentials configured for this device",
  "message": "Please add API credentials for this device in Settings > API Credentials"
}
```

**Resolution**:
1. Create credentials via `/api/v1/settings/api-credentials`
2. Ensure `deviceId` matches the device being tested
3. Verify credentials belong to authenticated user

---

### Error 5: Unsupported Device Type

**Symptom**:
```json
{
  "success": false,
  "error": "Device type not supported",
  "message": "Unsupported device API type: aos_switch"
}
```

**Resolution**:
- Only `cx_switch` is currently implemented
- Other device types are planned for future releases
- Use CX switches for testing

---

## Testing Workflow

### Recommended Test Sequence

1. **Setup Phase**
   ```
   1. Configure CX switch with admin user and HTTPS
   2. Verify switch is reachable from backend server
   3. Start backend server
   4. Authenticate to get JWT token
   ```

2. **Quick Validation**
   ```
   1. Use Test 1 (Manual Connection Test)
   2. Verify successful connection
   3. Review response times
   ```

3. **Full Integration Test**
   ```
   1. Create device in database (Test 2, Step 1)
   2. Store credentials (Test 2, Step 2)
   3. Test stored credentials (Test 2, Step 3)
   4. Get device info (Test 3)
   5. Get firmware info (Test 4)
   ```

4. **Error Handling Test**
   ```
   1. Test with wrong password
   2. Test with unreachable IP
   3. Test with missing credentials
   4. Test with unsupported device type
   ```

---

## API Endpoint Reference

### Device API Test Endpoints

| Method | Endpoint | Purpose | Auth Required |
|--------|----------|---------|---------------|
| GET | `/api/v1/device-api/supported-types` | List supported device types | Yes |
| POST | `/api/v1/device-api/test-manual` | Test with manual credentials | Yes (Admin/Operator) |
| POST | `/api/v1/device-api/test/:deviceId` | Test with stored credentials | Yes (Admin/Operator) |
| GET | `/api/v1/device-api/:deviceId/info` | Get device information | Yes |
| GET | `/api/v1/device-api/:deviceId/firmware` | Get firmware information | Yes |

### Settings Endpoints (Credentials)

| Method | Endpoint | Purpose | Auth Required |
|--------|----------|---------|---------------|
| GET | `/api/v1/settings/api-credentials` | List all credentials | Yes |
| POST | `/api/v1/settings/api-credentials` | Create credential | Yes (Admin/Operator) |
| GET | `/api/v1/settings/api-credentials/:id` | Get single credential | Yes |
| PUT | `/api/v1/settings/api-credentials/:id` | Update credential | Yes (Admin/Operator) |
| DELETE | `/api/v1/settings/api-credentials/:id` | Delete credential | Yes (Admin/Operator) |
| POST | `/api/v1/settings/api-credentials/:id/test` | Test credential | Yes (Admin/Operator) |

---

## Future Enhancements

### Planned Device Types

1. **AOS Switch** (`aos_switch`)
   - Legacy Aruba switches
   - Different authentication mechanism
   - Different API endpoints

2. **Instant AP** (`instant_ap`)
   - Aruba Instant Access Points
   - Virtual controller API
   - Cluster management

3. **Aruba Controller** (`aruba_controller`)
   - Mobility Master/Controllers
   - API v1 endpoints
   - Hierarchical architecture

### Planned Features

1. **Connection Pooling**
   - Reuse sessions across requests
   - Session timeout handling
   - Automatic re-authentication

2. **Bulk Operations**
   - Test multiple devices simultaneously
   - Parallel credential testing
   - Batch information retrieval

3. **Advanced Features**
   - Configuration backup/restore
   - Firmware upgrade via device API
   - Port configuration
   - VLAN management
   - Interface statistics

---

## Security Considerations

### Credential Storage

- All credentials encrypted using AES-256-GCM
- Passwords never returned in API responses
- User-scoped credential access
- Audit logging for all credential operations

### Network Security

- HTTPS enforced for switch communication
- Self-signed certificates accepted (typical for network devices)
- No credential caching in memory beyond request lifecycle
- Session cookies cleared after operations

### Authentication Flow

```
1. Backend receives API request with JWT
2. Backend retrieves encrypted credentials from database
3. Backend decrypts credentials for single request
4. Backend logs into switch (session cookie received)
5. Backend performs requested operation
6. Backend logs out from switch (session cookie destroyed)
7. Backend returns result to client
```

---

## Troubleshooting Guide

### Debug Logging

Enable debug logging to see detailed API communication:

```bash
# In .env file
LOG_LEVEL=debug
SERVICE_LOG_LEVELS=DEVICE_API:debug
```

### Common Issues

1. **Timeout Errors**
   - Increase timeout in axios config
   - Check network latency
   - Verify switch is not overloaded

2. **Session Expiry**
   - Sessions automatically renewed
   - Check switch session timeout settings
   - Review switch logs for session info

3. **API Version Mismatch**
   - Default API version: 10.10
   - Adjust in CXSwitchAPI constructor if needed
   - Check switch API version: `show version`

---

## Testing Checklist

- [ ] Switch configured with admin user
- [ ] HTTPS REST API enabled
- [ ] Backend can reach switch IP
- [ ] Test manual connection (Test 1)
- [ ] Device created in database
- [ ] Credentials stored in database
- [ ] Test with stored credentials (Test 2)
- [ ] Retrieve device info (Test 3)
- [ ] Retrieve firmware info (Test 4)
- [ ] Test error scenarios
- [ ] Verify credential encryption
- [ ] Verify session cleanup
- [ ] Review audit logs

---

## Support

For issues or questions:
1. Check logs: `logs/error.log` and `logs/combined.log`
2. Review switch logs: `show event-log`
3. Verify configuration: `show https-server`
4. Test switch API manually using cURL (see Aruba CX documentation)

## References

- [Aruba CX REST API Documentation](https://developer.arubanetworks.com/aoscx/docs/introduction)
- [AOS-CX REST API Reference](https://developer.arubanetworks.com/aoscx/docs/rest-api-reference)

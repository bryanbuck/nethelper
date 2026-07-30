# Aruba CX Switch API Integration - Implementation Summary

## Overview

This document summarizes the implementation of device-specific API integration for Aruba CX switches. The architecture is designed to be extensible, supporting multiple device types now and in the future.

## Key Features

### ✅ Cookie-Based Authentication
- Session cookies for state management
- CSRF token support (firmware v10.09+)
- Automatic login/logout handling
- Session cleanup

### ✅ Device Type Architecture
- Abstract base interface for all device types
- Factory pattern for device API instantiation
- Automatic device type detection
- Easily extensible for future device types

### ✅ Security
- AES-256-GCM encryption for stored credentials
- Credentials never exposed in API responses
- User-scoped credential access
- HTTPS communication with switches
- Self-signed certificate handling

### ✅ Testing Infrastructure
- Manual connection testing (no storage required)
- Stored credential testing
- Device information retrieval
- Firmware information retrieval
- Automated test script

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Application                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend API Layer                        │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   Settings     │  │  Device API  │  │    Devices      │ │
│  │  Controller    │  │  Controller  │  │   Controller    │ │
│  └────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  ┌────────────────┐  ┌─────────────────────────────────┐   │
│  │   Settings     │  │    Device API Factory           │   │
│  │   Service      │  │  (Device Type Detection)         │   │
│  └────────────────┘  └─────────────────────────────────┘   │
│         │                         │                          │
│         │              ┌──────────┴──────────┐              │
│         │              ▼                     ▼              │
│         │     ┌──────────────┐     ┌──────────────┐        │
│         │     │ BaseDeviceAPI│     │  [Future]    │        │
│         │     │  (Abstract)  │     │  AOS Switch  │        │
│         │     └──────────────┘     │  Instant AP  │        │
│         │              │            │  Controller  │        │
│         │              ▼            └──────────────┘        │
│         │     ┌──────────────┐                              │
│         │     │  CXSwitchAPI │                              │
│         │     │ (Implemented)│                              │
│         │     └──────────────┘                              │
│         │              │                                     │
└─────────┼──────────────┼─────────────────────────────────────┘
          │              │
          ▼              ▼
┌─────────────────┐  ┌────────────────┐
│    Database     │  │  CX Switch     │
│  (Encrypted     │  │  (REST API)    │
│  Credentials)   │  │                │
└─────────────────┘  └────────────────┘
```

### File Structure

```
backend/
├── src/
│   ├── controllers/
│   │   ├── settings.controller.js          # Credential management
│   │   └── device-api-test.controller.js   # Device API testing
│   │
│   ├── services/
│   │   ├── settings.service.js             # Credential operations
│   │   └── device-api/
│   │       ├── base-device-api.js          # Abstract interface
│   │       ├── cx-switch-api.js            # CX implementation
│   │       └── device-api-factory.js       # Factory pattern
│   │
│   ├── routes/
│   │   ├── settings.routes.js              # Settings endpoints
│   │   └── device-api-test.routes.js       # Test endpoints
│   │
│   ├── utils/
│   │   └── encryption.js                   # AES-256-GCM encryption
│   │
│   └── app.js                               # Route registration
│
├── docs/
│   ├── CX_API_TEST_PLAN.md                 # Comprehensive test plan
│   └── CX_API_INTEGRATION_SUMMARY.md       # This document
│
├── scripts/
│   └── test-cx-api.js                      # Automated test script
│
└── prisma/
    └── schema.prisma                        # ApiCredential model
```

## API Endpoints

### Settings - API Credentials

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/settings/api-credentials` | List all credentials |
| POST | `/api/v1/settings/api-credentials` | Create new credential |
| GET | `/api/v1/settings/api-credentials/:id` | Get single credential |
| PUT | `/api/v1/settings/api-credentials/:id` | Update credential |
| DELETE | `/api/v1/settings/api-credentials/:id` | Delete credential |
| POST | `/api/v1/settings/api-credentials/:id/test` | Test credential |
| GET | `/api/v1/settings/api-credentials/device/:deviceId` | Get by device |

### Device API Testing

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/device-api/supported-types` | List supported types |
| POST | `/api/v1/device-api/test-manual` | Test manual connection |
| POST | `/api/v1/device-api/test/:deviceId` | Test stored connection |
| GET | `/api/v1/device-api/:deviceId/info` | Get device info |
| GET | `/api/v1/device-api/:deviceId/firmware` | Get firmware info |

## Database Schema

### ApiCredential Model

```prisma
model ApiCredential {
  id              String              @id @default(uuid())
  name            String
  type            ApiCredentialType   // switch, ap, gateway, controller, other
  device          Device?             @relation(fields: [deviceId])
  deviceId        String?
  username        String?
  password        String?             // AES-256-GCM encrypted
  apiKey          String?             // AES-256-GCM encrypted
  apiSecret       String?             // AES-256-GCM encrypted
  notes           String?
  lastTested      DateTime?
  lastTestStatus  TestStatus?         // success, failed
  metadata        Json?
  createdBy       User                @relation(fields: [userId])
  userId          String
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  @@index([deviceId])
  @@index([type])
  @@index([userId])
}
```

## Device Type Support

### Currently Implemented

| Device Type | Status | API Class | Features |
|------------|--------|-----------|----------|
| CX Switch | ✅ Implemented | `CXSwitchAPI` | Login, device info, firmware info |

### Planned for Future

| Device Type | Status | Notes |
|------------|--------|-------|
| AOS Switch | 📋 Planned | Legacy Aruba switches with different API |
| Instant AP | 📋 Planned | Virtual controller API |
| Controller | 📋 Planned | Mobility Master/Controllers |
| Gateway | 📋 Planned | Aruba gateways |

### Adding New Device Types

To add a new device type:

1. **Create device API class**
   ```javascript
   // src/services/device-api/new-device-api.js
   const BaseDeviceAPI = require('./base-device-api');

   class NewDeviceAPI extends BaseDeviceAPI {
     constructor(device, credentials) {
       super('new_device_type', device, credentials);
     }

     async login() { /* implementation */ }
     async logout() { /* implementation */ }
     async testConnection() { /* implementation */ }
     async getDeviceInfo() { /* implementation */ }
   }
   ```

2. **Register in factory**
   ```javascript
   // src/services/device-api/device-api-factory.js
   case 'new_device_type':
     return new NewDeviceAPI(device, credentials);
   ```

3. **Update Prisma enum**
   ```prisma
   enum ApiCredentialType {
     switch
     ap
     gateway
     controller
     new_type  // Add here
     other
   }
   ```

4. **Run migration**
   ```bash
   npm run db:migrate
   ```

## CX Switch API Details

### Authentication Flow

```
1. POST /rest/v10.10/login?username=X&password=Y
   Headers: x-use-csrf-token: true

   ← Set-Cookie: session=XXXXX
   ← X-CSRF-Token: YYYYY

2. GET /rest/v10.10/system
   Headers:
     Cookie: session=XXXXX
     X-CSRF-Token: YYYYY

   ← Device information JSON

3. POST /rest/v10.04/logout
   Headers:
     Cookie: session=XXXXX
     X-CSRF-Token: YYYYY

   ← Session terminated
```

### Supported Operations

- ✅ Login with username/password
- ✅ CSRF token handling
- ✅ Session cookie management
- ✅ Get system information
- ✅ Get firmware information
- ✅ Logout and session cleanup
- 📋 Get interfaces (implemented, needs testing)
- 📋 Get VLANs (implemented, needs testing)
- 📋 Configuration backup (future)
- 📋 Configuration push (future)

## Quick Start Testing

### Method 1: Using Test Script

```bash
# Set environment variables
export SWITCH_IP=192.168.1.1
export SWITCH_USERNAME=admin
export SWITCH_PASSWORD=your_password
export JWT_TOKEN=your_jwt_token

# Run test
node scripts/test-cx-api.js
```

### Method 2: Using cURL

```bash
# Get JWT token (if needed)
JWT=$(curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  | jq -r '.data.token')

# Test manual connection
curl -X POST http://localhost:3000/api/v1/device-api/test-manual \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceIp": "192.168.1.1",
    "username": "admin",
    "password": "your_password",
    "deviceType": "cx_switch"
  }' | jq
```

### Method 3: Using Frontend

1. Navigate to Settings > API Credentials
2. Click "Add Credential"
3. Fill in device details and credentials
4. Click "Test Connection"
5. View results

## Switch Configuration Requirements

Before testing, configure your CX switch:

```
# SSH into switch
ssh admin@192.168.1.1

# Enter configuration mode
configure terminal

# Create admin user (if needed)
user admin group administrators password plaintext YOUR_PASSWORD

# Enable HTTPS REST API
https-server rest access-mode read-write

# Enable HTTPS on VRFs
https-server vrf default
https-server vrf mgmt

# Verify configuration
show https-server
show running-config user

# Exit
exit
```

## Security Considerations

### Credential Storage

- **Encryption**: AES-256-GCM with PBKDF2 key derivation
- **Salt**: Unique 64-byte salt per credential
- **IV**: Unique 16-byte IV per encryption
- **Iterations**: 100,000 PBKDF2 iterations
- **Tag**: 16-byte authentication tag for integrity

### API Security

- **Authentication**: JWT required for all endpoints
- **Authorization**: Role-based (admin/operator for write operations)
- **HTTPS**: All switch communication over HTTPS
- **Certificates**: Self-signed certificates accepted (typical for network devices)
- **Session Cleanup**: Automatic logout after operations
- **Audit Logging**: All credential operations logged

### Network Security

- **Firewall**: Ensure backend can reach switch management IP
- **VRF**: Configure appropriate VRF for management
- **Credentials**: Use unique credentials per device
- **Rotation**: Implement credential rotation policy

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Verify switch is reachable: `ping 192.168.1.1`
   - Check HTTPS enabled: `show https-server`
   - Test connectivity: `curl -k https://192.168.1.1`

2. **Authentication Failed**
   - Verify username: `show running-config user`
   - Check user group: Must be in "administrators"
   - Verify password is set

3. **SSL Errors**
   - Should be handled automatically
   - Check `httpsAgent` configuration if issues persist

4. **No Credentials Found**
   - Create credentials via Settings API
   - Verify `deviceId` matches
   - Check user owns credentials

### Debug Logging

Enable detailed logging:

```env
# .env file
LOG_LEVEL=debug
```

View logs:
```bash
tail -f logs/combined.log
tail -f logs/error.log
```

## Next Steps

### Immediate Testing

1. ✅ Configure CX switch (see above)
2. ✅ Run test script: `node scripts/test-cx-api.js`
3. ✅ Test via API endpoints
4. ✅ Integrate with frontend

### Future Development

1. 📋 Add AOS Switch support
2. 📋 Add Instant AP support
3. 📋 Add Controller support
4. 📋 Implement configuration backup/restore
5. 📋 Add port configuration
6. 📋 Add VLAN management
7. 📋 Implement connection pooling
8. 📋 Add bulk operations

## Documentation

- **Test Plan**: `docs/CX_API_TEST_PLAN.md` - Comprehensive testing guide
- **This Summary**: `docs/CX_API_INTEGRATION_SUMMARY.md`
- **Aruba Docs**: https://developer.arubanetworks.com/aoscx/docs/introduction

## Support

For issues or questions:

1. Check logs in `logs/` directory
2. Review switch logs: `show event-log`
3. Consult test plan: `docs/CX_API_TEST_PLAN.md`
4. Test manually: `curl -k https://SWITCH_IP/rest/v10.10/login?username=X&password=Y`

## Version History

- **v1.0.0** (2024-10-04): Initial CX switch API implementation
  - Cookie-based authentication with CSRF token
  - Device information retrieval
  - Firmware information retrieval
  - Extensible architecture for future device types
  - Comprehensive testing infrastructure

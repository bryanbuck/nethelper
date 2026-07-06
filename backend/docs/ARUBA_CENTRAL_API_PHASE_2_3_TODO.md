# Aruba Central API - Phase 2 & 3 Implementation TODO

## Phase 2: Troubleshooting APIs (High Priority) 🔧

### Backend Implementation

#### 1. Add Troubleshooting Methods to `aruba-central.service.js`

**CX Switch Troubleshooting Endpoints:**
- [ ] `pingDevice(serial, target)` - Network connectivity test
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/ping`
  - Poll status: `GET /network-troubleshooting/v1alpha1/cx/{serial}/ping/async-operations/{task-id}`

- [ ] `tracerouteDevice(serial, target)` - Network path trace
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/traceroute`
  - Poll status: `GET /network-troubleshooting/v1alpha1/cx/{serial}/traceroute/async-operations/{task-id}`

- [ ] `rebootDevice(serial)` - Remote device reboot
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/reboot`

- [ ] `bouncePort(serial, portNumber)` - Port bounce for troubleshooting
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/portBounce`
  - Poll status: `GET /network-troubleshooting/v1alpha1/cx/{serial}/portBounce/async-operations/{task-id}`

- [ ] `bouncePoe(serial, portNumber)` - PoE power cycle
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/poeBounce`
  - Poll status: `GET /network-troubleshooting/v1alpha1/cx/{serial}/poeBounce/async-operations/{task-id}`

- [ ] `cableTest(serial, portNumber)` - Cable diagnostics
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/cableTest`
  - Poll status: `GET /network-troubleshooting/v1alpha1/cx/{serial}/cableTest/async-operations/{task-id}`

- [ ] `locateDevice(serial, duration)` - Blink LEDs to locate device physically
  - Endpoint: `POST /network-troubleshooting/v1alpha1/cx/{serial}/locate`

#### 2. Add Async Task Tracking Service

- [ ] Create `async-task.service.js` for managing long-running operations
  - Track task status in database or Redis
  - Poll Aruba Central API for task completion
  - Emit WebSocket events for real-time UI updates
  - Store task history for audit trail

#### 3. Add Troubleshooting Controller & Routes

- [ ] Create `troubleshooting.controller.js`
  - Implement methods for each troubleshooting command
  - Add role-based access control (admin + operator only)
  - Return task IDs for async operations

- [ ] Create `troubleshooting.routes.js`
  - `POST /api/v1/troubleshooting/devices/:serial/ping`
  - `POST /api/v1/troubleshooting/devices/:serial/traceroute`
  - `POST /api/v1/troubleshooting/devices/:serial/reboot`
  - `POST /api/v1/troubleshooting/devices/:serial/ports/:port/bounce`
  - `POST /api/v1/troubleshooting/devices/:serial/ports/:port/poe-bounce`
  - `POST /api/v1/troubleshooting/devices/:serial/ports/:port/cable-test`
  - `POST /api/v1/troubleshooting/devices/:serial/locate`
  - `GET /api/v1/troubleshooting/tasks/:taskId/status`

#### 4. Add Role-Based Authorization Middleware

- [ ] Update auth middleware to check user roles
  - Allow: `admin`, `operator`
  - Deny: `viewer`
- [ ] Add to troubleshooting routes

### Frontend Implementation

- [ ] Add troubleshooting section to Device Detail page
- [ ] Create troubleshooting action buttons/dialogs
- [ ] Implement real-time task status updates via WebSocket
- [ ] Add task history display
- [ ] Show role-based UI (hide actions for viewers)

---

## Phase 3: Enhanced Monitoring (Medium Priority) 📈

### Backend Implementation

#### 1. Add Switch Monitoring Methods to `aruba-central.service.js`

- [ ] `getSwitchInterfaces(serial)` - Get all interface details
  - Endpoint: `GET /network-monitoring/v1alpha1/switch/{serial}/interfaces`

- [ ] `getSwitchVlans(serial)` - Get VLAN configuration
  - Endpoint: `GET /network-monitoring/v1alpha1/switch/{serial}/vlans`

- [ ] `getSwitchLag(serial)` - Get Link Aggregation Groups
  - Endpoint: `GET /network-monitoring/v1alpha1/switch/{serial}/lag`

- [ ] `getSwitchHardware(serial)` - Get hardware component details
  - Endpoint: `GET /network-monitoring/v1alpha1/switch/{serial}/hardware-categories`

- [ ] `getStackMembers(stackId)` - Get switch stack member details
  - Endpoint: `GET /network-monitoring/v1alpha1/stack/{stack-id}/members`

#### 2. Add Access Point Performance Monitoring Methods

- [ ] `getApRadios(serial)` - Get radio details
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/radios/{radio}/...`

- [ ] `getApChannelUtilization(serial, radioNumber, timeRange)` - Channel utilization trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/radios/{radio}/channel-utilization-trends`

- [ ] `getApChannelQuality(serial, radioNumber, timeRange)` - Channel quality trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/radios/{radio}/channel-quality-trends`

- [ ] `getApNoiseFloor(serial, radioNumber, timeRange)` - Noise floor trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/radios/{radio}/noise-floor-trends`

- [ ] `getApCpuUtilization(serial, timeRange)` - CPU utilization trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/cpu-utilization-trends`

- [ ] `getApMemoryUtilization(serial, timeRange)` - Memory utilization trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/memory-utilization-trends`

- [ ] `getApPowerConsumption(serial, timeRange)` - Power consumption trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/power-consumption-trends`

- [ ] `getApThroughput(serial, timeRange)` - Throughput trends
  - Endpoint: `GET /network-monitoring/v1alpha1/aps/{serial}/throughput-trends`

#### 3. Add Device Inventory & Location Methods

- [ ] `getDeviceInventory(filters)` - Get device inventory list
  - Endpoint: `GET /network-monitoring/v1alpha1/device-inventory`

- [ ] `getDeviceLocations(siteId)` - Get devices with location info
  - Endpoint: `GET /network-monitoring/v1alpha1/sites/{site-id}/device-locations`

#### 4. Add Monitoring Controller & Routes

- [ ] Create `monitoring.controller.js` or extend `device.controller.js`
  - Add methods for switch interfaces, VLANs, LAG info
  - Add methods for AP performance metrics
  - Add time-range parameter support for trends

- [ ] Create monitoring routes
  - `GET /api/v1/devices/:serial/interfaces`
  - `GET /api/v1/devices/:serial/vlans`
  - `GET /api/v1/devices/:serial/lag`
  - `GET /api/v1/devices/:serial/performance/cpu`
  - `GET /api/v1/devices/:serial/performance/memory`
  - `GET /api/v1/devices/:serial/performance/throughput`
  - `GET /api/v1/devices/:serial/radios/:radio/channel-utilization`

#### 5. Database Schema Updates (Optional)

- [ ] Consider storing performance metrics for historical analysis
- [ ] Add tables for interface/VLAN snapshots if needed

### Frontend Implementation

- [ ] Add "Interfaces" tab to Switch Detail page
- [ ] Add "VLANs" tab to Switch Detail page
- [ ] Add "Performance" section with charts (CPU, memory, throughput)
- [ ] Add "Radio Performance" section for APs
- [ ] Implement time-range selector for trend data
- [ ] Add real-time performance monitoring dashboard

---

## Implementation Priority Order

### Immediate (Phase 2 Core)
1. Role-based authorization middleware
2. Reboot device functionality
3. Port bounce functionality
4. PoE bounce functionality

### High Priority (Phase 2 Async)
5. Async task tracking service
6. Ping/traceroute functionality
7. WebSocket integration for task status

### Medium Priority (Phase 3 Core)
8. Switch interfaces/VLANs read-only views
9. Basic performance metrics (CPU, memory)
10. AP radio performance monitoring

### Lower Priority (Phase 3 Enhanced)
11. Cable test functionality
12. Historical performance data storage
13. Advanced performance dashboards
14. Device inventory management

---

## Notes

- All troubleshooting commands should be restricted to **admin** and **operator** roles only
- Async operations need proper task tracking and WebSocket updates
- Consider rate limiting for troubleshooting commands to prevent abuse
- Add audit logging for all troubleshooting actions
- Performance metrics should support configurable time ranges (1h, 3h, 24h, 7d)
- Consider caching strategy for frequently accessed monitoring data

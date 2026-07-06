# NetHelper Platform - Long Term TODOs

This document tracks features and improvements that are planned for future implementation but are not currently prioritized for immediate development.

---

## 🔮 Future Enhancements

### 1. WebSocket Real-time Updates from Aruba Central

**Priority**: Medium
**Status**: Not Started
**Estimated Effort**: 2-3 weeks

#### Description
Integrate with Aruba Central's webhook/event notification system to receive real-time device status updates directly from Aruba Central, rather than relying solely on periodic sync operations.

#### Benefits
- **Real-time visibility**: Instant notification when devices go online/offline in Aruba Central
- **Reduced polling**: Less need for frequent API calls to check device status
- **Better accuracy**: Central Status would reflect changes immediately
- **Event-driven architecture**: More efficient use of resources

#### Technical Requirements

##### Backend Changes
1. **Webhook Endpoint**: Create endpoint to receive Aruba Central webhook events
   - `POST /api/webhooks/aruba-central`
   - Handle authentication/verification from Aruba Central
   - Process event types: device status changes, alerts, configuration changes

2. **Webhook Registration**: Automate webhook registration with Aruba Central
   - Register webhook URL during initial setup
   - Handle webhook lifecycle (create, update, delete, verify)
   - Store webhook IDs and secrets

3. **Event Processing Service**:
   - Parse Aruba Central event payloads
   - Map events to internal device updates
   - Update database with new device status
   - Emit WebSocket events to connected frontend clients

4. **Security**:
   - Validate webhook signatures from Aruba Central
   - Implement IP whitelist for Aruba Central webhook sources
   - Rate limiting on webhook endpoint

##### Frontend Changes
1. **Real-time Status Display**:
   - Already handled via existing WebSocket infrastructure
   - No additional changes needed (events flow through existing `device:update` handlers)

2. **Connection Indicator**:
   - Show webhook connection status in UI
   - Display last received webhook event timestamp

#### Prerequisites
- [ ] Aruba Central account must support webhooks (check subscription tier)
- [ ] Public-facing webhook endpoint (requires proper domain/SSL)
- [ ] Understand Aruba Central webhook payload formats
- [ ] Test webhook reliability and rate limits

#### Implementation Steps
1. Research Aruba Central webhook documentation
2. Set up test environment with ngrok or similar for webhook testing
3. Implement webhook endpoint and event processing
4. Add webhook management UI in Settings page
5. Test with various device event types
6. Deploy to production with proper SSL and domain
7. Monitor webhook reliability and performance

#### Related Documentation
- [Aruba Central API Webhooks Documentation](https://developer.arubanetworks.com/aruba-central/)
- WebSocket service: `frontend/src/services/websocket.service.js`
- Device service: `backend/src/services/device.service.js`

#### Notes
- This complements the ICMP ping monitoring (Item 1) rather than replaces it
- Webhooks from Aruba Central show their view of device status
- ICMP ping provides our on-prem view of reachability
- Having both sources creates a comprehensive status picture

---

## 📋 Additional Future Items

### 2. Advanced Device Alerting System
**Priority**: Low
**Status**: Not Started

Create a flexible alerting system that can trigger notifications based on:
- Device status changes (online → offline transitions)
- Consecutive ping failures exceeding threshold
- API communication failures
- Custom alert rules (e.g., specific devices, locations, times)

**Notification Channels**: Email, SMS, Slack, Microsoft Teams, PagerDuty

---

### 3. Device Performance Dashboards
**Priority**: Low
**Status**: Not Started

Enhanced visualization for device performance metrics:
- Historical ping response times (graphs/charts)
- API communication success rate trends
- Device uptime percentage (SLA tracking)
- Comparative performance across device groups

---

### 4. Automated Device Discovery
**Priority**: Medium
**Status**: Not Started

Automatically discover devices on the local network:
- Network scanning for Aruba devices
- Auto-detection of device types
- Suggestion to add discovered devices
- Conflict resolution with existing devices

---

### 5. Configuration Backup Scheduling
**Priority**: Medium
**Status**: Not Started

Scheduled configuration backups with:
- Automated backup on cron schedule
- Configuration diff detection
- Rollback capability
- Backup retention policies
- Export to external storage (S3, NFS, etc.)

---

### 6. Multi-tenancy Support
**Priority**: Low
**Status**: Not Started

Support for multiple organizations/customers:
- Tenant isolation
- Per-tenant API credentials
- Role-based access control per tenant
- Tenant-specific dashboards and reports

---

### 7. Mobile Application
**Priority**: Low
**Status**: Not Started

Native mobile apps for iOS/Android:
- Real-time device monitoring
- Push notifications for alerts
- Quick actions (reboot, test connectivity)
- Offline mode with cached data

---

### 8. API Rate Limiting & Throttling Dashboard
**Priority**: Low
**Status**: Not Started

Visual dashboard showing:
- Current API usage against Aruba Central limits
- Rate limit warnings
- Request queuing status
- Optimization suggestions

---

### 9. Device Grouping & Tagging Enhancements
**Priority**: Medium
**Status**: Not Started

Advanced device organization:
- Custom tags and labels
- Hierarchical grouping (region > site > building > floor)
- Bulk operations on groups
- Group-based access control

---

### 10. Audit Log & Compliance Reporting
**Priority**: Low
**Status**: Not Started

Comprehensive audit trail:
- User action logging
- Device configuration change history
- API credential access logs
- Exportable compliance reports
- Retention policies

---

## 🎯 How to Use This File

### Adding New Items
When adding new long-term TODO items, include:
- Clear title and description
- Priority (Low, Medium, High, Critical)
- Status (Not Started, In Progress, On Hold, Completed)
- Estimated effort
- Benefits and use cases
- Technical requirements (if known)
- Prerequisites
- Related files/documentation

### Moving Items to Active Development
When an item is ready to be worked on:
1. Update status to "In Progress"
2. Create detailed implementation plan
3. Break down into smaller tasks
4. Add to sprint/project board
5. Assign owner

### Archiving Completed Items
When an item is completed:
1. Update status to "Completed"
2. Add completion date
3. Move to "Completed" section at bottom of file
4. Link to relevant PRs/commits

---

## ✅ Completed Items

_(Items will be moved here once completed)_

---

**Last Updated**: 2025-10-15
**Maintained By**: Development Team

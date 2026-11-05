/**
 * What a Devices-page view (a saved filter) may hold. Mirrored by
 * frontend/src/models/device-view.js (parity-tested); SORT_KEYS also matches
 * device.service.js SORT_FIELDS (tested).
 */
const FILTER_KEYS = ['status', 'type', 'location', 'platform', 'credential', 'group'];

const SORT_KEYS = ['name', 'type', 'managementMode', 'ipAddress', 'location', 'cloudStatus', 'lastSeen', 'status'];

const MAX_SAVED_FILTERS = 50;
const MAX_NAME_LENGTH = 60;
const MAX_VALUE_LENGTH = 200;

module.exports = { FILTER_KEYS, SORT_KEYS, MAX_SAVED_FILTERS, MAX_NAME_LENGTH, MAX_VALUE_LENGTH };

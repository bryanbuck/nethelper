/**
 * Activity feed categories (services/activity.service.js), mirrored by
 * frontend/src/models/activity.js. `port` (port link/PoE/live-monitor
 * changes) is raw and chatty, so it is off unless asked for.
 */
const ACTIVITY_CATEGORIES = ['status', 'restart', 'config', 'alert', 'port'];
const DEFAULT_ACTIVITY_CATEGORIES = ['status', 'restart', 'config', 'alert'];

module.exports = { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES };

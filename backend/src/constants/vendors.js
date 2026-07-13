/**
 * Vendor / platform / cloud-provider taxonomy — single source of truth.
 *
 * Mirrored (labels, ids) in frontend/src/models/vendors.js; keep the two in
 * sync when adding a vendor, platform, or cloud provider.
 *
 * Vocabulary:
 *   vendor    - manufacturer, stored on Device.vendor (Prisma enum Vendor)
 *   platform  - OS family, stored on Device.platform (validated string)
 *   provider  - cloud management plane (Prisma enum CloudProviderType); one
 *               CloudIntegration row per tenant/org, multiple rows may be
 *               active at once, including several of the same provider
 */

const VENDORS = {
  aruba: {
    id: 'aruba',
    label: 'Aruba (HPE)',
    platforms: ['aos-cx', 'aos-s'],
  },
  juniper: {
    id: 'juniper',
    label: 'Juniper',
    platforms: ['junos'],
  },
  cisco: {
    id: 'cisco',
    label: 'Cisco',
    platforms: ['ios-xe', 'meraki'],
  },
  other: {
    id: 'other',
    label: 'Other',
    platforms: [],
  },
};

const PLATFORMS = {
  'aos-cx': { id: 'aos-cx', vendor: 'aruba', label: 'AOS-CX', deviceApiType: 'cx_switch', sshProfile: 'aos-cx' },
  'aos-s': { id: 'aos-s', vendor: 'aruba', label: 'AOS-S (AOS-Switch)', deviceApiType: null, sshProfile: 'aos-s' },
  junos: { id: 'junos', vendor: 'juniper', label: 'Junos', deviceApiType: 'junos', sshProfile: 'junos' },
  'ios-xe': { id: 'ios-xe', vendor: 'cisco', label: 'IOS / IOS-XE', deviceApiType: null, sshProfile: 'cisco-ios' },
  meraki: { id: 'meraki', vendor: 'cisco', label: 'Meraki (cloud-managed)', deviceApiType: null, sshProfile: null },
};

// Juniper Mist regional clouds (juniper.net "API Endpoints and Global Regions").
const MIST_REGIONS = [
  { id: 'global01', label: 'Global 01 (api.mist.com)', baseUrl: 'https://api.mist.com' },
  { id: 'global02', label: 'Global 02 (api.gc1.mist.com)', baseUrl: 'https://api.gc1.mist.com' },
  { id: 'global03', label: 'Global 03 (api.ac2.mist.com)', baseUrl: 'https://api.ac2.mist.com' },
  { id: 'global04', label: 'Global 04 (api.gc2.mist.com)', baseUrl: 'https://api.gc2.mist.com' },
  { id: 'global05', label: 'Global 05 (api.gc4.mist.com)', baseUrl: 'https://api.gc4.mist.com' },
  { id: 'emea01', label: 'EMEA 01 (api.eu.mist.com)', baseUrl: 'https://api.eu.mist.com' },
  { id: 'emea02', label: 'EMEA 02 (api.gc3.mist.com)', baseUrl: 'https://api.gc3.mist.com' },
  { id: 'emea03', label: 'EMEA 03 (api.ac6.mist.com)', baseUrl: 'https://api.ac6.mist.com' },
  { id: 'emea04', label: 'EMEA 04 (api.gc6.mist.com)', baseUrl: 'https://api.gc6.mist.com' },
  { id: 'apac01', label: 'APAC 01 (api.ac5.mist.com)', baseUrl: 'https://api.ac5.mist.com' },
  { id: 'apac02', label: 'APAC 02 (api.gc5.mist.com)', baseUrl: 'https://api.gc5.mist.com' },
  { id: 'apac03', label: 'APAC 03 (api.gc7.mist.com)', baseUrl: 'https://api.gc7.mist.com' },
];

const CLOUD_PROVIDERS = {
  aruba_central: {
    id: 'aruba_central',
    label: 'Aruba Central',
    vendor: 'aruba',
    defaultBaseUrl: 'https://apigw-prod2.central.arubanetworks.com',
    // Field definitions drive the settings form and credential validation.
    // secret: true fields are encrypted at rest inside CloudIntegration.credentials.
    credentialFields: [
      { key: 'clientId', label: 'Client ID', secret: false },
      { key: 'clientSecret', label: 'Client Secret', secret: true },
      { key: 'customerId', label: 'Customer ID', secret: false },
    ],
    implemented: true,
  },
  juniper_mist: {
    id: 'juniper_mist',
    label: 'Juniper Mist',
    vendor: 'juniper',
    defaultBaseUrl: 'https://api.mist.com',
    credentialFields: [
      { key: 'apiToken', label: 'API Token', secret: true },
      { key: 'orgId', label: 'Organization ID', secret: false },
    ],
    // A Mist org lives in exactly one regional cloud; the wrong host 401s, so
    // the base URL is part of the integration config and the UI offers a picker.
    regions: MIST_REGIONS,
    implemented: true,
  },
  cisco_meraki: {
    id: 'cisco_meraki',
    label: 'Cisco Meraki',
    vendor: 'cisco',
    defaultBaseUrl: 'https://api.meraki.com/api/v1',
    credentialFields: [
      { key: 'apiKey', label: 'API Key', secret: true },
      { key: 'orgId', label: 'Organization ID', secret: false },
    ],
    implemented: false, // Phase 3 of docs/MULTI_VENDOR_ROADMAP.md
  },
};

/**
 * Transport routing matrix: `${vendor}/${platform}` -> operation -> ordered
 * transports to try ('cloud' | 'device-rest' | 'ssh').
 *
 * Phase 0 note: rows encode TODAY'S behavior exactly, including the legacy
 * quirk that an unclassified switch is kept on REST for connection tests
 * (the original "default unknown switches to CX" behavior) while config and
 * polling for it go over SSH. managementMode === 'cloud' overrides all rows
 * (handled in transport-router.js), subject to the provider's capabilities.
 *
 * Operations: config (backup pull), test (connection test), poll (firmware /
 * system pollers).
 */
const TRANSPORT_MATRIX = {
  'aruba/aos-cx': { config: ['device-rest'], test: ['device-rest'], poll: ['device-rest'] },
  'aruba/aos-s': { config: ['ssh'], test: ['ssh'], poll: ['ssh'] },
  // Junos: NETCONF (the 'device-rest' slot, served by JunosAPI) is preferred —
  // framed, structured, no CLI screen-scraping. It is NOT enabled by default on
  // Junos, so SSH follows as a fallback: a device without
  // `set system services netconf ssh` authenticates and then refuses the
  // subsystem, and the router retries over the CLI rather than failing.
  'juniper/junos': { config: ['device-rest', 'ssh'], test: ['device-rest', 'ssh'], poll: ['device-rest', 'ssh'] },
  // Cisco Catalyst — Phase 4 (harmless now: no device rows carry this platform).
  'cisco/ios-xe': { config: ['ssh'], test: ['ssh'], poll: ['ssh'] },
};

// Fallback rows for devices without a matrix entry (legacy/unclassified).
const TRANSPORT_FALLBACKS = {
  // Unclassified switch: REST for tests (legacy CX default), SSH otherwise.
  'unknown-switch': { config: ['ssh'], test: ['device-rest'], poll: ['ssh'] },
  // APs, gateways, everything else without a device REST API.
  default: { config: ['ssh'], test: ['ssh'], poll: ['ssh'] },
};

module.exports = {
  VENDORS,
  PLATFORMS,
  CLOUD_PROVIDERS,
  TRANSPORT_MATRIX,
  TRANSPORT_FALLBACKS,
};

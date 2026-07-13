/**
 * Vendor / platform / cloud-provider taxonomy (frontend mirror).
 *
 * Kept in sync with backend/src/constants/vendors.js — when you add a vendor,
 * platform, or cloud provider, update both.
 *
 * The provider catalog (labels, credential fields) is also returned by
 * GET /settings/cloud-integrations, so components that render credential
 * forms should prefer the server's list; these constants are the fallback
 * and the source for device-form dropdowns.
 */

export const Vendor = {
  ARUBA: 'aruba',
  JUNIPER: 'juniper',
  CISCO: 'cisco',
  OTHER: 'other',
}

export const VendorInfo = {
  [Vendor.ARUBA]: { label: 'Aruba (HPE)', icon: 'mdi-alpha-a-box', color: 'orange' },
  [Vendor.JUNIPER]: { label: 'Juniper', icon: 'mdi-alpha-j-box', color: 'teal' },
  [Vendor.CISCO]: { label: 'Cisco', icon: 'mdi-alpha-c-box', color: 'blue' },
  [Vendor.OTHER]: { label: 'Other', icon: 'mdi-help-box', color: 'grey' },
}

/** Platform (OS family) options, grouped by vendor. */
export const PlatformInfo = {
  'aos-cx': { label: 'AOS-CX', vendor: Vendor.ARUBA },
  'aos-s': { label: 'AOS-S (AOS-Switch)', vendor: Vendor.ARUBA },
  junos: { label: 'Junos', vendor: Vendor.JUNIPER },
  'ios-xe': { label: 'IOS / IOS-XE', vendor: Vendor.CISCO },
  meraki: { label: 'Meraki (cloud-managed)', vendor: Vendor.CISCO },
}

export const CloudProvider = {
  ARUBA_CENTRAL: 'aruba_central',
  JUNIPER_MIST: 'juniper_mist',
  CISCO_MERAKI: 'cisco_meraki',
}

export const CloudProviderInfo = {
  [CloudProvider.ARUBA_CENTRAL]: { label: 'Aruba Central', shortLabel: 'Central', vendor: Vendor.ARUBA, color: 'orange' },
  [CloudProvider.JUNIPER_MIST]: { label: 'Juniper Mist', shortLabel: 'Mist', vendor: Vendor.JUNIPER, color: 'teal' },
  [CloudProvider.CISCO_MERAKI]: { label: 'Cisco Meraki', shortLabel: 'Meraki', vendor: Vendor.CISCO, color: 'blue' },
}

/** Vendor select options for forms. */
export const vendorOptions = Object.entries(VendorInfo).map(([value, info]) => ({
  value,
  title: info.label,
}))

/** Platform select options, optionally filtered to one vendor. */
export function platformOptions(vendor = null) {
  return Object.entries(PlatformInfo)
    .filter(([, info]) => !vendor || info.vendor === vendor)
    .map(([value, info]) => ({ value, title: info.label }))
}

/** Human label for a device's cloud plane, e.g. "Central" / "Mist". */
export function cloudProviderLabel(provider, { short = true } = {}) {
  const info = CloudProviderInfo[provider]
  if (!info) return 'Cloud'
  return short ? info.shortLabel : info.label
}

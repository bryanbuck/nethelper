/**
 * MAC address helpers shared by discovery and topology.
 *
 * Network gear prints MACs in several shapes: `14:ab:ec:c2:0e:00` (AOS-CX,
 * Junos), `001a1e-000000` and `00 1a 1e 00 00 00` (AOS-S), `0011.2233.4455`
 * (Cisco). They all normalize to lower-case colon form.
 */

/** Lower-case `aa:bb:cc:dd:ee:ff`, or null when the input isn't a MAC. */
function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  // Reject things that only become 12 hex digits after stripping, such as an
  // IPv4 address used as an LLDP chassis id ("192.168.18.140" is 11 digits,
  // but "10.100.200.250" is 12). A real MAC uses at most these separators.
  if (/[^0-9a-fA-F:.\-\s]/.test(mac) || /\d+\.\d+\.\d+\.\d+/.test(mac)) return null;
  return hex.match(/.{2}/g).join(':');
}

module.exports = { normalizeMac };

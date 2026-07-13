/**
 * Thrown when a cloud provider is asked for an operation it does not support
 * (or whose endpoint is quarantined as broken/unverified). Callers can catch
 * this specifically to fall back to another transport or report an honest
 * "not supported" instead of a generic failure.
 */
class CapabilityError extends Error {
  constructor(message, { provider, capability } = {}) {
    super(message);
    this.name = 'CapabilityError';
    this.statusCode = 501;
    this.provider = provider;
    this.capability = capability;
  }
}

module.exports = { CapabilityError };

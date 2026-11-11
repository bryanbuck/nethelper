/**
 * Update check: is there a newer NetHelper release than the one running?
 *
 * One anonymous GET of the project's public release list on GitHub, a minute
 * after start and then once a day (UPDATE_CHECK_ENABLED=false turns it off).
 * Nothing about this install is sent. The answer is kept in memory and shown
 * to admins (System Status, the status bar's version indicator) with the
 * command to run on the host: NetHelper never updates itself.
 *
 * A pre-release is offered only to an install that runs a pre-release. A
 * failed check keeps the last answer and records the error (a host without
 * internet access just shows that it couldn't check).
 */
const axios = require('axios');
const logger = require('../utils/logger');
const { compareVersions, isPrerelease, normalizeVersion } = require('../utils/version');
const { version: APP_VERSION } = require('../../package.json');

const REPOSITORY = 'bryanbuck/nethelper';
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`;
const RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases`;
const REQUEST_TIMEOUT_MS = 5000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// GitHub allows 60 anonymous requests an hour per address; "Check now" can't spend them.
const MIN_RECHECK_MS = 60 * 1000;

/** The newest release an install running `current` should be offered, or null. */
function pickLatest(releases, current) {
  const wantPrereleases = isPrerelease(current);
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft) continue;
    const version = normalizeVersion(release.tag_name);
    if (!version) continue;
    if (!wantPrereleases && (release.prerelease || isPrerelease(version))) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    const url = typeof release.html_url === 'string' && release.html_url.startsWith(`${RELEASE_PAGE}/`)
      ? release.html_url
      : `${RELEASE_PAGE}/tag/v${version}`;
    best = { version, url, publishedAt: release.published_at || null };
  }
  return best;
}

class UpdateCheckService {
  constructor() {
    this.current = APP_VERSION;
    this.latest = null;
    this.checkedAt = null;
    this.error = null;
    this.lastAttempt = 0;
    this.inFlight = null;
    this.firstTimer = null;
    this.interval = null;
  }

  get enabled() {
    return process.env.UPDATE_CHECK_ENABLED !== 'false';
  }

  status() {
    const newer = this.latest ? compareVersions(this.latest.version, this.current) : null;
    return {
      enabled: this.enabled,
      current: this.current,
      latest: this.latest,
      updateAvailable: this.enabled && newer === 1,
      checkedAt: this.checkedAt,
      error: this.error,
    };
  }

  /** Ask GitHub now. Never throws; concurrent callers share one request. */
  async check({ force = false } = {}) {
    if (!this.enabled) return this.status();
    if (this.inFlight) return this.inFlight;
    if (!force && Date.now() - this.lastAttempt < MIN_RECHECK_MS) return this.status();
    this.lastAttempt = Date.now();
    this.inFlight = this.fetchLatest().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async fetchLatest() {
    try {
      const response = await axios.get(RELEASES_URL, {
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 2,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NetHelper' },
      });
      this.latest = pickLatest(response.data, this.current);
      this.checkedAt = new Date().toISOString();
      this.error = null;
    } catch (error) {
      const status = error.response?.status;
      this.error = status === 403 || status === 429
        ? 'GitHub is rate-limiting this address; try again later'
        : `Couldn't reach GitHub (${status ? `HTTP ${status}` : error.code || error.message})`;
      logger.debug(`Update check failed: ${this.error}`);
    }
    return this.status();
  }

  start() {
    if (!this.enabled || this.interval) return;
    this.firstTimer = setTimeout(() => this.check({ force: true }), FIRST_CHECK_DELAY_MS);
    this.firstTimer.unref?.();
    this.interval = setInterval(() => this.check({ force: true }), CHECK_INTERVAL_MS);
    this.interval.unref?.();
  }

  stop() {
    clearTimeout(this.firstTimer);
    clearInterval(this.interval);
    this.firstTimer = null;
    this.interval = null;
  }
}

module.exports = new UpdateCheckService();
module.exports.pickLatest = pickLatest;
module.exports.MIN_RECHECK_MS = MIN_RECHECK_MS;

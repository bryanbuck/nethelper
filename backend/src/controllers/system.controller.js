const systemStatusService = require('../services/system-status.service');
const updateCheckService = require('../services/update-check.service');

class SystemController {
  async status(req, res, next) {
    try {
      res.json({ success: true, data: await systemStatusService.snapshot() });
    } catch (error) {
      next(error);
    }
  }

  /** The last update check's answer (no request to GitHub). */
  update(req, res) {
    res.json({ success: true, data: updateCheckService.status() });
  }

  /** Check for a newer release now (at most once a minute). */
  async checkUpdate(req, res, next) {
    try {
      res.json({ success: true, data: await updateCheckService.check() });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SystemController();

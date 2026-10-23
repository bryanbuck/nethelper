const systemStatusService = require('../services/system-status.service');

class SystemController {
  async status(req, res, next) {
    try {
      res.json({ success: true, data: await systemStatusService.snapshot() });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SystemController();

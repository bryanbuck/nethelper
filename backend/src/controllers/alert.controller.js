const alertService = require('../services/alert.service');

const toList = (value) => {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(',')).map((s) => s.trim()).filter(Boolean);
};

class AlertController {
  async list(req, res, next) {
    try {
      const result = await alertService.list({
        status: req.query.status,
        severity: toList(req.query.severity),
        rule: req.query.rule || null,
        deviceId: req.query.deviceId || null,
        q: req.query.q || null,
        page: req.query.page,
        limit: req.query.limit,
      });
      res.json({ success: true, data: result.items, total: result.total, page: result.page, limit: result.limit });
    } catch (error) {
      next(error);
    }
  }

  async summary(req, res, next) {
    try {
      res.json({ success: true, data: await alertService.summary() });
    } catch (error) {
      next(error);
    }
  }

  async getRules(req, res, next) {
    try {
      res.json({ success: true, data: await alertService.getRules() });
    } catch (error) {
      next(error);
    }
  }

  async updateRule(req, res, next) {
    try {
      const { enabled, severity, settleSeconds } = req.body;
      const rule = await alertService.updateRule(req.params.key, { enabled, severity, settleSeconds });
      if (!rule) return res.status(404).json({ success: false, error: 'Unknown alert rule' });
      res.json({ success: true, data: rule });
    } catch (error) {
      next(error);
    }
  }

  async acknowledge(req, res, next) {
    try {
      res.json({ success: true, data: await alertService.acknowledge(req.body.ids, req.user) });
    } catch (error) {
      next(error);
    }
  }

  async resolve(req, res, next) {
    try {
      res.json({ success: true, data: await alertService.resolve(req.body.ids, req.user) });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AlertController();

const activityService = require('../services/activity.service');

const toList = (value) => {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(',')).map((s) => s.trim()).filter(Boolean);
};

class ActivityController {
  async list(req, res, next) {
    try {
      const result = await activityService.list({
        categories: toList(req.query.categories),
        deviceId: req.query.deviceId || null,
        vendor: req.query.vendor || null,
        before: req.query.before || null,
        limit: req.query.limit,
      });
      res.json({ success: true, data: result.items, nextBefore: result.nextBefore, categories: result.categories });
    } catch (error) {
      if (error instanceof activityService.ActivityError) {
        return res.status(400).json({ success: false, error: error.message });
      }
      next(error);
    }
  }
}

module.exports = new ActivityController();

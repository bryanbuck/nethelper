const notificationChannels = require('../services/notification-channel.service');
const notifier = require('../services/notification.service');

// Settings → Notifications (routes/settings.routes.js, admin only).
const notificationChannelController = {
  async list(req, res, next) {
    try {
      // emailConfigured: whether SMTP is set up, so the UI can warn on email channels
      res.json({ success: true, data: await notificationChannels.list(), emailConfigured: notifier.emailConfigured() });
    } catch (error) {
      next(error);
    }
  },

  /** Alarm names the dialog offers for a channel's cloud alarm filter. */
  async cloudAlarmNames(req, res, next) {
    try {
      res.json({ success: true, data: await notificationChannels.cloudAlarmNames() });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      res.status(201).json({ success: true, data: await notificationChannels.create(req.user.id, req.body || {}) });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await notificationChannels.update(req.params.id, req.body || {}) });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      await notificationChannels.remove(req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  /** Send a sample now; `data.success` says whether it was delivered. */
  async test(req, res, next) {
    try {
      res.json({ success: true, data: await notificationChannels.test(req.params.id) });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = notificationChannelController;

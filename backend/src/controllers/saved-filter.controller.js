const savedFilters = require('../services/saved-filter.service');

// Every handler acts on the signed-in user's own saved filters only.
module.exports = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await savedFilters.list(req.user.id) });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await savedFilters.create(req.user.id, req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await savedFilters.update(req.user.id, req.params.filterId, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      await savedFilters.remove(req.user.id, req.params.filterId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
};

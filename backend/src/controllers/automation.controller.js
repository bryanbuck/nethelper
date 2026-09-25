const automationService = require('../services/automation.service');
const { getQueue } = require('../config/bull');

class AutomationController {
  async createAutomation(req, res, next) {
    try {
      const { name, description, type, workflow, deviceGroupIds } = req.body;
      const userId = req.user.id;

      const automation = await automationService.createAutomation({
        name,
        description,
        type,
        workflow,
        userId,
        deviceGroupIds,
      });

      res.status(201).json({
        success: true,
        data: automation,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAutomations(req, res, next) {
    try {
      const { type, active, page = 1, limit = 20 } = req.query;
      
      const automations = await automationService.getAutomations({
        type,
        active: active === 'true',
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.json({
        success: true,
        data: automations.data,
        pagination: automations.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAutomation(req, res, next) {
    try {
      const { automationId } = req.params;
      
      const automation = await automationService.getAutomation(automationId);
      
      if (!automation) {
        return res.status(404).json({
          success: false,
          error: 'Automation not found',
        });
      }

      res.json({
        success: true,
        data: automation,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAutomation(req, res, next) {
    try {
      const { automationId } = req.params;
      const updates = req.body;

      const automation = await automationService.updateAutomation(automationId, updates);

      res.json({
        success: true,
        data: automation,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteAutomation(req, res, next) {
    try {
      const { automationId } = req.params;

      await automationService.deleteAutomation(automationId);

      res.json({
        success: true,
        message: 'Automation deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async executeAutomation(req, res, next) {
    try {
      const { automationId } = req.params;
      const { deviceIds, parameters } = req.body;
      const userId = req.user.id;

      // Queue automation execution
      const automationQueue = getQueue('automation');
      const job = await automationQueue.add('execute', {
        automationId,
        deviceIds,
        parameters,
        userId,
      }, {
        priority: req.body.priority || 0,
      });

      res.json({
        success: true,
        message: 'Automation execution queued',
        jobId: job.id,
      });
    } catch (error) {
      next(error);
    }
  }

  async testAutomation(req, res, next) {
    try {
      const { automationId } = req.params;
      const { deviceId } = req.body;

      const result = await automationService.testAutomation(automationId, deviceId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AutomationController();

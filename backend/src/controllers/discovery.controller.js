const discoveryService = require('../services/discovery.service');
const { getQueue } = require('../config/bull');

class DiscoveryController {
  async startScan(req, res, next) {
    try {
      const { subnets } = req.body;
      const scan = await discoveryService.createScan(subnets, req.user.id);

      // A failed scan should not re-run automatically (rescanning is user-driven)
      await getQueue('discovery').add(
        'runScan',
        { scanId: scan.id, triggeredBy: req.user.id },
        { attempts: 1 }
      );

      res.status(202).json({ success: true, data: scan });
    } catch (error) {
      next(error);
    }
  }

  async getScans(req, res, next) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const scans = await discoveryService.getScans(limit);
      res.json({ success: true, data: scans, count: scans.length });
    } catch (error) {
      next(error);
    }
  }

  async getScan(req, res, next) {
    try {
      const scan = await discoveryService.getScan(req.params.scanId);
      res.json({ success: true, data: scan });
    } catch (error) {
      next(error);
    }
  }

  async deleteScan(req, res, next) {
    try {
      await discoveryService.deleteScan(req.params.scanId);
      res.json({ success: true, message: 'Scan deleted' });
    } catch (error) {
      next(error);
    }
  }

  async getSubnets(req, res, next) {
    try {
      res.json({ success: true, data: discoveryService.getLocalSubnets() });
    } catch (error) {
      next(error);
    }
  }

  async importDevice(req, res, next) {
    try {
      const result = await discoveryService.importDevice(
        req.params.discoveredId,
        req.body,
        req.user.id
      );
      res.status(201).json({
        success: true,
        data: result.device,
        merged: result.merged,
        message: result.merged
          ? 'Scan data merged into existing device'
          : 'Device imported successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async ignoreDevice(req, res, next) {
    try {
      const discovered = await discoveryService.ignoreDevice(req.params.discoveredId);
      res.json({ success: true, data: discovered, message: 'Device ignored' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DiscoveryController();

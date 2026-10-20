const topologyService = require('../services/topology/topology.service');
const { getQueue } = require('../config/bull');

class TopologyController {
  async getGraph(req, res, next) {
    try {
      const graph = await topologyService.getGraph({
        site: req.query.site || null,
        includeDiscovered: req.query.includeDiscovered === true || req.query.includeDiscovered === 'true',
      });
      res.json({ success: true, data: graph });
    } catch (error) {
      next(error);
    }
  }

  async getChanges(req, res, next) {
    try {
      const changes = await topologyService.getChanges({
        since: req.query.since ? new Date(req.query.since) : null,
        deviceId: req.query.deviceId || null,
        limit: req.query.limit || 100,
      });
      res.json({ success: true, data: changes, count: changes.length });
    } catch (error) {
      next(error);
    }
  }

  async collect(req, res, next) {
    try {
      const deviceIds = Array.isArray(req.body?.deviceIds) && req.body.deviceIds.length ? req.body.deviceIds : null;
      // One manual run at a time: a second click while one runs is a no-op.
      const queue = getQueue('topology');
      const active = await queue.getActive();
      const waiting = await queue.getWaiting();
      const busy = [...active, ...waiting].some((job) => job.name === 'collect' && !job.opts?.repeat);
      if (busy) {
        return res.status(409).json({ success: false, error: 'A topology collection is already running' });
      }
      const job = await queue.add('collect', { deviceIds, triggeredBy: req.user.id }, { attempts: 1 });
      res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (error) {
      next(error);
    }
  }

  async getLayout(req, res, next) {
    try {
      res.json({ success: true, data: await topologyService.getLayout(req.params.scope) });
    } catch (error) {
      next(error);
    }
  }

  async saveLayout(req, res, next) {
    try {
      const layout = await topologyService.saveLayout(req.params.scope, req.body.positions, req.user.id);
      res.json({ success: true, data: layout });
    } catch (error) {
      next(error);
    }
  }

  async getDeviceNeighbors(req, res, next) {
    try {
      res.json({ success: true, data: await topologyService.getDeviceNeighbors(req.params.deviceId) });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TopologyController();

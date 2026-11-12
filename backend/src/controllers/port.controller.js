/**
 * Port Identity API: a switch's ports (sightings, notes, neighbors, VLANs),
 * port notes, read-now, and the fleet-wide client/note search.
 */
const portView = require('../services/ports/port-view.service');
const { getQueue } = require('../config/bull');

const { PortError } = portView;

function fail(res, next, error) {
  if (error instanceof PortError) return res.status(error.statusCode).json({ success: false, error: error.message });
  return next(error);
}

class PortController {
  async getPorts(req, res, next) {
    try {
      res.json({ success: true, data: await portView.getPorts(req.params.deviceId) });
    } catch (error) {
      fail(res, next, error);
    }
  }

  async getPort(req, res, next) {
    try {
      res.json({ success: true, data: await portView.getPort(req.params.deviceId, req.params.port) });
    } catch (error) {
      fail(res, next, error);
    }
  }

  async setNote(req, res, next) {
    try {
      const note = await portView.setNote(req.params.deviceId, req.params.port, req.body || {}, req.user.id);
      res.json({ success: true, data: note });
    } catch (error) {
      fail(res, next, error);
    }
  }

  async clearNote(req, res, next) {
    try {
      const cleared = await portView.clearNote(req.params.deviceId, req.params.port, req.user.id);
      res.json({ success: true, data: { cleared } });
    } catch (error) {
      fail(res, next, error);
    }
  }

  /** Queue a client read of this switch now (202). One manual read at a time per switch. */
  async readNow(req, res, next) {
    try {
      await portView.loadDevice(req.params.deviceId);
      const queue = getQueue('portClients');
      const pending = [...await queue.getActive(), ...await queue.getWaiting()];
      const busy = pending.some((job) => job.name === 'collect' && !job.opts?.repeat
        && (job.data?.deviceIds || []).includes(req.params.deviceId));
      if (busy) return res.status(409).json({ success: false, error: 'A read of this switch is already queued' });
      const job = await queue.add('collect', { deviceIds: [req.params.deviceId], triggeredBy: req.user.id }, { attempts: 1 });
      return res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (error) {
      return fail(res, next, error);
    }
  }

  async search(req, res, next) {
    try {
      res.json({ success: true, data: await portView.search(req.query.q) });
    } catch (error) {
      fail(res, next, error);
    }
  }
}

module.exports = new PortController();

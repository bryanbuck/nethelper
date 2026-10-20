const express = require('express');
const router = express.Router();
const topologyController = require('../controllers/topology.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validateTopology } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// The Network Map graph (devices, links, unmanaged neighbors, discovery subnets)
router.get('/graph', validateTopology.graph, topologyController.getGraph);

// Link added/removed/changed history
router.get('/changes', validateTopology.changes, topologyController.getChanges);

// Collect neighbor tables now (all devices, or the given ones)
router.post('/collect', authorize('admin', 'operator'), validateTopology.collect, topologyController.collect);

// Saved node positions per scope ("all" or "site:<location>")
router.get('/layouts/:scope', validateTopology.layoutScope, topologyController.getLayout);
router.put(
  '/layouts/:scope',
  authorize('admin', 'operator'),
  validateTopology.saveLayout,
  topologyController.saveLayout
);

module.exports = router;

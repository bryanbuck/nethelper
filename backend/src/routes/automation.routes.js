const express = require('express');
const { body, validationResult } = require('express-validator');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all automations with optional filtering
router.get('/', async (req, res) => {
  try {
    const { category, active, enabled, priority } = req.query;
    const prisma = getPrisma();
    
    const where = {};
    if (category) where.category = category;
    if (active !== undefined) where.active = active === 'true';
    if (enabled !== undefined) where.enabled = enabled === 'true';
    if (priority) where.priority = priority;

    const automations = await prisma.automation.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        schedules: true,
        _count: {
          select: { executions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Format response to match frontend expectations
    res.json({
      data: automations,
    });
  } catch (error) {
    logger.error('Get automations error:', error);
    res.status(500).json({
      error: 'Failed to fetch automations',
      message: error.message,
    });
  }
});

// Get automation by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    const automation = await prisma.automation.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        schedules: true,
        executions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            device: {
              select: { id: true, name: true, serial: true },
            },
          },
        },
        deviceGroups: true,
      },
    });

    if (!automation) {
      return res.status(404).json({
        error: 'Automation not found',
      });
    }

    res.json({
      data: automation,
    });
  } catch (error) {
    logger.error('Get automation error:', error);
    res.status(500).json({
      error: 'Failed to fetch automation',
      message: error.message,
    });
  }
});

// Create automation
router.post('/', authorize('admin', 'operator'), [
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
  body('category').isIn(['network', 'security', 'monitoring', 'maintenance', 'compliance']).withMessage('Invalid category'),
  body('priority').isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority'),
  body('elements').isArray().withMessage('Elements must be an array'),
  body('description').optional().trim(),
  body('active').optional().isBoolean(),
  body('enabled').optional().isBoolean(),
  body('metadata').optional().isObject(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { 
      name, 
      description, 
      category, 
      priority, 
      elements, 
      active = false, 
      enabled = true, 
      metadata,
      deviceGroupIds = [] 
    } = req.body;
    const prisma = getPrisma();

    const automation = await prisma.automation.create({
      data: {
        name,
        description,
        category,
        priority,
        elements,
        active,
        enabled,
        metadata,
        userId: req.user.id,
        deviceGroups: {
          connect: deviceGroupIds.map(id => ({ id })),
        },
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        deviceGroups: true,
      },
    });

    logger.info('Automation created', { automationId: automation.id, userId: req.user.id });

    res.status(201).json({
      data: automation,
    });
  } catch (error) {
    logger.error('Create automation error:', error);
    res.status(500).json({
      error: 'Failed to create automation',
      message: error.message,
    });
  }
});

// Update automation
router.put('/:id', authorize('admin', 'operator'), [
  body('name').optional().trim().isLength({ min: 1 }),
  body('category').optional().isIn(['network', 'security', 'monitoring', 'maintenance', 'compliance']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('elements').optional().isArray(),
  body('description').optional().trim(),
  body('active').optional().isBoolean(),
  body('enabled').optional().isBoolean(),
  body('metadata').optional().isObject(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { id } = req.params;
    const { 
      name, 
      description, 
      category, 
      priority, 
      elements, 
      active, 
      enabled, 
      metadata, 
      deviceGroupIds 
    } = req.body;
    const prisma = getPrisma();

    // Check if automation exists
    const existingAutomation = await prisma.automation.findUnique({
      where: { id },
    });

    if (!existingAutomation) {
      return res.status(404).json({
        error: 'Automation not found',
      });
    }

    // Update automation
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (priority !== undefined) updateData.priority = priority;
    if (elements !== undefined) updateData.elements = elements;
    if (active !== undefined) updateData.active = active;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (metadata !== undefined) updateData.metadata = metadata;

    if (deviceGroupIds !== undefined) {
      updateData.deviceGroups = {
        set: deviceGroupIds.map(id => ({ id })),
      };
    }

    const automation = await prisma.automation.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        deviceGroups: true,
      },
    });

    logger.info('Automation updated', { automationId: id, userId: req.user.id });

    res.json({
      data: automation,
    });
  } catch (error) {
    logger.error('Update automation error:', error);
    res.status(500).json({
      error: 'Failed to update automation',
      message: error.message,
    });
  }
});

// Delete automation
router.delete('/:id', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    // Check if automation exists
    const automation = await prisma.automation.findUnique({
      where: { id },
    });

    if (!automation) {
      return res.status(404).json({
        error: 'Automation not found',
      });
    }

    // Delete automation (cascades to schedules and executions)
    await prisma.automation.delete({
      where: { id },
    });

    logger.info('Automation deleted', { automationId: id, userId: req.user.id });

    res.json({
      data: {
        message: 'Automation deleted successfully',
      },
    });
  } catch (error) {
    logger.error('Delete automation error:', error);
    res.status(500).json({
      error: 'Failed to delete automation',
      message: error.message,
    });
  }
});

// Execute automation
router.post('/:id/execute', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceIds = [] } = req.body;
    const prisma = getPrisma();

    // Check if automation exists and is enabled
    const automation = await prisma.automation.findUnique({
      where: { id },
      include: {
        deviceGroups: {
          include: {
            devices: true,
          },
        },
      },
    });

    if (!automation) {
      return res.status(404).json({
        error: 'Automation not found',
      });
    }

    if (!automation.enabled) {
      return res.status(400).json({
        error: 'Automation is not enabled',
      });
    }

    // Determine target devices
    let targetDevices = [];
    if (deviceIds.length > 0) {
      // Use specified device IDs
      const devices = await prisma.device.findMany({
        where: { id: { in: deviceIds } },
      });
      targetDevices = devices;
    } else {
      // Use devices from associated device groups
      targetDevices = automation.deviceGroups.flatMap(group => group.devices);
    }

    if (targetDevices.length === 0) {
      return res.status(400).json({
        error: 'No target devices specified',
      });
    }

    // Update lastRun timestamp
    await prisma.automation.update({
      where: { id },
      data: { lastRun: new Date() },
    });

    // Create execution records
    const executions = await Promise.all(
      targetDevices.map(device =>
        prisma.execution.create({
          data: {
            automationId: id,
            deviceId: device.id,
            userId: req.user.id,
            status: 'pending',
          },
          include: {
            device: {
              select: { id: true, name: true, serial: true },
            },
          },
        })
      )
    );

    logger.info('Automation execution started', {
      automationId: id,
      deviceCount: targetDevices.length,
      userId: req.user.id,
    });

    res.json({
      data: {
        executions,
        message: `Automation queued for ${targetDevices.length} device(s)`,
      },
    });

    // TODO: Add to job queue for background processing
  } catch (error) {
    logger.error('Execute automation error:', error);
    res.status(500).json({
      error: 'Failed to execute automation',
      message: error.message,
    });
  }
});

// Toggle automation active status
router.patch('/:id/toggle', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    // Check if automation exists
    const existingAutomation = await prisma.automation.findUnique({
      where: { id },
    });

    if (!existingAutomation) {
      return res.status(404).json({
        error: 'Automation not found',
      });
    }

    // Toggle active status
    const automation = await prisma.automation.update({
      where: { id },
      data: { active: !existingAutomation.active },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        deviceGroups: true,
      },
    });

    logger.info('Automation active status toggled', { 
      automationId: id, 
      newStatus: automation.active,
      userId: req.user.id 
    });

    res.json({
      data: automation,
    });
  } catch (error) {
    logger.error('Toggle automation error:', error);
    res.status(500).json({
      error: 'Failed to toggle automation',
      message: error.message,
    });
  }
});

module.exports = router;
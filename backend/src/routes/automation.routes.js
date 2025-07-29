const express = require('express');
const { body, validationResult } = require('express-validator');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all automations
router.get('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    const automations = await prisma.automation.findMany({
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

    res.json({
      success: true,
      data: automations,
    });
  } catch (error) {
    logger.error('Get automations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch automations',
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
        success: false,
        error: 'Automation not found',
      });
    }

    res.json({
      success: true,
      data: automation,
    });
  } catch (error) {
    logger.error('Get automation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch automation',
    });
  }
});

// Create automation
router.post('/', authorize('admin', 'operator'), [
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required'),
  body('type').isIn(['configuration_backup', 'firmware_update', 'compliance_check', 'custom_script', 'monitoring_alert']),
  body('workflow').isObject().withMessage('Workflow must be an object'),
  body('description').optional().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { name, description, type, workflow, deviceGroupIds = [] } = req.body;
    const prisma = getPrisma();

    const automation = await prisma.automation.create({
      data: {
        name,
        description,
        type,
        workflow,
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
      success: true,
      data: automation,
    });
  } catch (error) {
    logger.error('Create automation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create automation',
    });
  }
});

// Update automation
router.put('/:id', authorize('admin', 'operator'), [
  body('name').optional().trim().isLength({ min: 1 }),
  body('type').optional().isIn(['configuration_backup', 'firmware_update', 'compliance_check', 'custom_script', 'monitoring_alert']),
  body('workflow').optional().isObject(),
  body('description').optional().trim(),
  body('active').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const { name, description, type, workflow, active, deviceGroupIds } = req.body;
    const prisma = getPrisma();

    // Check if automation exists
    const existingAutomation = await prisma.automation.findUnique({
      where: { id },
    });

    if (!existingAutomation) {
      return res.status(404).json({
        success: false,
        error: 'Automation not found',
      });
    }

    // Update automation
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (workflow !== undefined) updateData.workflow = workflow;
    if (active !== undefined) updateData.active = active;

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
      success: true,
      data: automation,
    });
  } catch (error) {
    logger.error('Update automation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update automation',
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
        success: false,
        error: 'Automation not found',
      });
    }

    // Delete automation (cascades to schedules and executions)
    await prisma.automation.delete({
      where: { id },
    });

    logger.info('Automation deleted', { automationId: id, userId: req.user.id });

    res.json({
      success: true,
      message: 'Automation deleted successfully',
    });
  } catch (error) {
    logger.error('Delete automation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete automation',
    });
  }
});

// Execute automation
router.post('/:id/execute', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceIds = [] } = req.body;
    const prisma = getPrisma();

    // Check if automation exists and is active
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
        success: false,
        error: 'Automation not found',
      });
    }

    if (!automation.active) {
      return res.status(400).json({
        success: false,
        error: 'Automation is not active',
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
        success: false,
        error: 'No target devices specified',
      });
    }

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
      success: true,
      data: {
        executions,
        message: `Automation queued for ${targetDevices.length} device(s)`,
      },
    });

    // TODO: Add to job queue for background processing
  } catch (error) {
    logger.error('Execute automation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute automation',
    });
  }
});

module.exports = router;
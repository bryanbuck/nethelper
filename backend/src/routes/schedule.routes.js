const express = require('express');
const { body, validationResult } = require('express-validator');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all schedules
router.get('/', async (req, res) => {
  try {
    const prisma = getPrisma();
    const schedules = await prisma.schedule.findMany({
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
            active: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    logger.error('Get schedules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedules',
    });
  }
});

// Get schedule by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    const schedule = await prisma.schedule.findUnique({
      where: { id },
      include: {
        automation: {
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error('Get schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule',
    });
  }
});

// Create schedule
router.post('/', authorize('admin', 'operator'), [
  body('automationId').isUUID().withMessage('Valid automation ID is required'),
  body('cronExpression').trim().isLength({ min: 1 }).withMessage('Cron expression is required'),
  body('timezone').optional().trim().isLength({ min: 1 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { automationId, cronExpression, timezone = 'UTC' } = req.body;
    const prisma = getPrisma();

    // Check if automation exists
    const automation = await prisma.automation.findUnique({
      where: { id: automationId },
    });

    if (!automation) {
      return res.status(404).json({
        success: false,
        error: 'Automation not found',
      });
    }

    // Validate cron expression (basic validation)
    const cronParts = cronExpression.trim().split(/\s+/);
    if (cronParts.length !== 5 && cronParts.length !== 6) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cron expression format',
      });
    }

    const schedule = await prisma.schedule.create({
      data: {
        automationId,
        cronExpression,
        timezone,
      },
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
            active: true,
          },
        },
      },
    });

    logger.info('Schedule created', { scheduleId: schedule.id, userId: req.user.id });

    res.status(201).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error('Create schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create schedule',
    });
  }
});

// Update schedule
router.put('/:id', authorize('admin', 'operator'), [
  body('cronExpression').optional().trim().isLength({ min: 1 }),
  body('timezone').optional().trim().isLength({ min: 1 }),
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
    const { cronExpression, timezone, active } = req.body;
    const prisma = getPrisma();

    // Check if schedule exists
    const existingSchedule = await prisma.schedule.findUnique({
      where: { id },
    });

    if (!existingSchedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    // Validate cron expression if provided
    if (cronExpression) {
      const cronParts = cronExpression.trim().split(/\s+/);
      if (cronParts.length !== 5 && cronParts.length !== 6) {
        return res.status(400).json({
          success: false,
          error: 'Invalid cron expression format',
        });
      }
    }

    // Update schedule
    const updateData = {};
    if (cronExpression !== undefined) updateData.cronExpression = cronExpression;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (active !== undefined) updateData.active = active;

    const schedule = await prisma.schedule.update({
      where: { id },
      data: updateData,
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
            active: true,
          },
        },
      },
    });

    logger.info('Schedule updated', { scheduleId: id, userId: req.user.id });

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error('Update schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update schedule',
    });
  }
});

// Delete schedule
router.delete('/:id', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    // Check if schedule exists
    const schedule = await prisma.schedule.findUnique({
      where: { id },
    });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    // Delete schedule
    await prisma.schedule.delete({
      where: { id },
    });

    logger.info('Schedule deleted', { scheduleId: id, userId: req.user.id });

    res.json({
      success: true,
      message: 'Schedule deleted successfully',
    });
  } catch (error) {
    logger.error('Delete schedule error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete schedule',
    });
  }
});

// Get schedules for a specific automation
router.get('/automation/:automationId', async (req, res) => {
  try {
    const { automationId } = req.params;
    const prisma = getPrisma();

    const schedules = await prisma.schedule.findMany({
      where: { automationId },
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
            active: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    logger.error('Get automation schedules error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch automation schedules',
    });
  }
});

module.exports = router;
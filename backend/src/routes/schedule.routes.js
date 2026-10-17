/**
 * Automation schedules, read-only. Each schedule is derived from its
 * automation's Schedule trigger (services/automation/schedule.service.js):
 * change the cron expression in the builder, not here.
 */
const express = require('express');
const { getPrisma } = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');
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
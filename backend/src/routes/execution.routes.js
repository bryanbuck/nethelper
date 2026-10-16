const express = require('express');
const { query, validationResult } = require('express-validator');
const { getPrisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all executions with pagination and filtering
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['pending', 'running', 'success', 'failed', 'cancelled']),
  query('automationId').optional().isUUID(),
  query('deviceId').optional().isUUID(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const {
      page = 1,
      limit = 20,
      status,
      automationId,
      deviceId,
    } = req.query;

    const prisma = getPrisma();
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    if (status) where.status = status;
    if (automationId) where.automationId = automationId;
    if (deviceId) where.deviceId = deviceId;

    const [executions, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        skip,
        take: limit,
        include: {
          automation: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
          device: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
          triggeredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.execution.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        executions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('Get executions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch executions',
    });
  }
});

// Get execution by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    const execution = await prisma.execution.findUnique({
      where: { id },
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
            workflow: true,
          },
        },
        device: {
          select: {
            id: true,
            name: true,
            serial: true,
            type: true,
            model: true,
            ipAddress: true,
          },
        },
        triggeredBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Execution not found',
      });
    }

    res.json({
      success: true,
      data: execution,
    });
  } catch (error) {
    logger.error('Get execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch execution',
    });
  }
});

// Cancel execution
router.patch('/:id/cancel', authorize('admin', 'operator'), async (req, res) => {
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    // Check if execution exists and can be cancelled
    const execution = await prisma.execution.findUnique({
      where: { id },
    });

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Execution not found',
      });
    }

    if (!['pending', 'running'].includes(execution.status)) {
      return res.status(400).json({
        success: false,
        error: 'Execution cannot be cancelled',
      });
    }

    // Update execution status
    const updatedExecution = await prisma.execution.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        duration: execution.startedAt 
          ? Date.now() - execution.startedAt.getTime()
          : null,
      },
      include: {
        automation: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        device: {
          select: {
            id: true,
            name: true,
            serial: true,
          },
        },
      },
    });

    logger.info('Execution cancelled', { executionId: id, userId: req.user.id });

    res.json({
      success: true,
      data: updatedExecution,
    });
  } catch (error) {
    logger.error('Cancel execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel execution',
    });
  }
});

// Get execution statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const prisma = getPrisma();

    const [
      totalExecutions,
      runningExecutions,
      successfulExecutions,
      failedExecutions,
      recentExecutions,
    ] = await Promise.all([
      prisma.execution.count(),
      prisma.execution.count({ where: { status: 'running' } }),
      prisma.execution.count({ where: { status: 'success' } }),
      prisma.execution.count({ where: { status: 'failed' } }),
      prisma.execution.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      }),
    ]);

    const successRate = totalExecutions > 0 
      ? Math.round((successfulExecutions / totalExecutions) * 100)
      : 0;

    const stats = {
      total: totalExecutions,
      running: runningExecutions,
      successful: successfulExecutions,
      failed: failedExecutions,
      recent24h: recentExecutions,
      successRate,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get execution stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch execution statistics',
    });
  }
});

// Get executions for a specific automation
router.get('/automation/:automationId', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['pending', 'running', 'success', 'failed', 'cancelled']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { automationId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const prisma = getPrisma();
    const skip = (page - 1) * limit;

    // Build where clause
    const where = { automationId };
    if (status) where.status = status;

    const [executions, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        skip,
        take: limit,
        include: {
          device: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
          triggeredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.execution.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        executions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('Get automation executions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch automation executions',
    });
  }
});

// Get executions for a specific device
router.get('/device/:deviceId', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['pending', 'running', 'success', 'failed', 'cancelled']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { deviceId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const prisma = getPrisma();
    const skip = (page - 1) * limit;

    // Build where clause
    const where = { deviceId };
    if (status) where.status = status;

    const [executions, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        skip,
        take: limit,
        include: {
          automation: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
          triggeredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.execution.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        executions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('Get device executions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device executions',
    });
  }
});

module.exports = router;
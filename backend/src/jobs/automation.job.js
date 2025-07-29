const { getPrisma } = require('../config/database');
const automationService = require('../services/automation.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
const { getIO } = require('../websocket/socket.handler');

module.exports = (queue) => {
  queue.process('execute', async (job) => {
    const { automationId, deviceIds, parameters, userId } = job.data;
    const prisma = getPrisma();
    const io = getIO();

    let execution;

    try {
      // Create execution record
      execution = await prisma.execution.create({
        data: {
          automationId,
          userId,
          status: 'running',
          startedAt: new Date(),
        },
      });

      // Emit start event
      io.emit('automation:started', {
        executionId: execution.id,
        automationId,
        timestamp: new Date(),
      });

      // Get automation details
      const automation = await prisma.automation.findUnique({
        where: { id: automationId },
        include: {
          createdBy: true,
        },
      });

      if (!automation) {
        throw new Error('Automation not found');
      }

      // Execute the automation workflow
      const results = await automationService.executeWorkflow(
        automation,
        deviceIds,
        parameters
      );

      // Update execution record
      const endTime = new Date();
      const duration = endTime - execution.startedAt;

      execution = await prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: 'success',
          completedAt: endTime,
          duration,
          output: results,
        },
      });

      // Emit completion event
      io.emit('automation:completed', {
        executionId: execution.id,
        automationId,
        status: 'success',
        duration,
        timestamp: endTime,
      });

      // Send notification
      await notificationService.sendAutomationComplete(automation, execution);

      logger.info(`Automation ${automationId} completed successfully`);
      return results;

    } catch (error) {
      logger.error(`Automation ${automationId} failed:`, error);

      if (execution) {
        const endTime = new Date();
        const duration = endTime - execution.startedAt;

        await prisma.execution.update({
          where: { id: execution.id },
          data: {
            status: 'failed',
            completedAt: endTime,
            duration,
            error: error.message,
          },
        });

        io.emit('automation:failed', {
          executionId: execution.id,
          automationId,
          error: error.message,
          timestamp: endTime,
        });
      }

      throw error;
    }
  });

  // Process scheduled automations
  queue.process('scheduled', async (job) => {
    const { scheduleId } = job.data;
    const prisma = getPrisma();

    try {
      const schedule = await prisma.schedule.findUnique({
        where: { id: scheduleId },
        include: {
          automation: {
            include: {
              deviceGroups: {
                include: {
                  devices: true,
                },
              },
            },
          },
        },
      });

      if (!schedule || !schedule.active) {
        logger.warn(`Schedule ${scheduleId} not found or inactive`);
        return;
      }

      // Get all device IDs from device groups
      const deviceIds = schedule.automation.deviceGroups.flatMap(
        group => group.devices.map(device => device.serial)
      );

      // Queue the automation execution
      await queue.add('execute', {
        automationId: schedule.automationId,
        deviceIds,
        parameters: {},
        userId: schedule.automation.userId,
      });

      // Update last run time
      await prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRun: new Date(),
        },
      });

    } catch (error) {
      logger.error(`Failed to process scheduled automation:`, error);
      throw error;
    }
  });
};

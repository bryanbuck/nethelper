const { getPrisma } = require('../config/database');
const arubaCentralService = require('./aruba-central.service');
const logger = require('../utils/logger');

class AutomationService {
  async createAutomation(data) {
    const prisma = getPrisma();
    
    const automation = await prisma.automation.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        workflow: data.workflow,
        userId: data.userId,
        deviceGroups: {
          connect: data.deviceGroupIds?.map(id => ({ id })) || [],
        },
      },
      include: {
        deviceGroups: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    logger.info(`Automation created: ${automation.id}`);
    return automation;
  }

  async getAutomations(filters) {
    const prisma = getPrisma();
    const { type, active, page, limit } = filters;

    const where = {};
    if (type) where.type = type;
    if (active !== undefined) where.active = active;

    const [data, total] = await Promise.all([
      prisma.automation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              executions: true,
              schedules: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.automation.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async executeWorkflow(automation, deviceIds, parameters = {}) {
    const results = [];
    const workflow = automation.workflow;

    for (const step of workflow.steps) {
      try {
        const stepResult = await this.executeStep(step, deviceIds, parameters);
        results.push({
          step: step.name,
          success: true,
          result: stepResult,
        });

        // Check if we should continue based on step conditions
        if (step.continueOnError === false && stepResult.hasErrors) {
          break;
        }
      } catch (error) {
        logger.error(`Step ${step.name} failed:`, error);
        results.push({
          step: step.name,
          success: false,
          error: error.message,
        });

        if (step.continueOnError === false) {
          break;
        }
      }
    }

    return results;
  }

  async executeStep(step, deviceIds, parameters) {
    switch (step.type) {
      case 'backup_config':
        return await this.executeBackupConfig(deviceIds, step.parameters);
      
      case 'update_config':
        return await this.executeUpdateConfig(deviceIds, step.parameters, parameters);
      
      case 'execute_command':
        return await this.executeCommand(deviceIds, step.parameters);
      
      case 'check_compliance':
        return await this.executeComplianceCheck(deviceIds, step.parameters);
      
      case 'firmware_update':
        return await this.executeFirmwareUpdate(deviceIds, step.parameters);
      
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  async executeBackupConfig(deviceIds, parameters) {
    const results = [];

    for (const deviceId of deviceIds) {
      try {
        const backup = await arubaCentralService.backupConfiguration(deviceId);
        results.push({
          deviceId,
          success: true,
          backup,
        });
      } catch (error) {
        results.push({
          deviceId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  async executeUpdateConfig(deviceIds, stepParameters, runtimeParameters) {
    const results = [];
    const configuration = { ...stepParameters.template, ...runtimeParameters };

    for (const deviceId of deviceIds) {
      try {
        const result = await arubaCentralService.updateDeviceConfiguration(deviceId, configuration);
        results.push({
          deviceId,
          success: true,
          result,
        });
      } catch (error) {
        results.push({
          deviceId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  async executeCommand(deviceIds, parameters) {
    const results = [];

    for (const deviceId of deviceIds) {
      try {
        const output = await arubaCentralService.executeCommand(deviceId, parameters.command);
        results.push({
          deviceId,
          success: true,
          output,
        });
      } catch (error) {
        results.push({
          deviceId,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }
}

module.exports = new AutomationService();

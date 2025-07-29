const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.emailTransporter = null;
    this.initializeEmailTransporter();
  }

  initializeEmailTransporter() {
    try {
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        this.emailTransporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        logger.info('Email transporter initialized');
      } else {
        logger.warn('Email configuration not provided. Email notifications disabled.');
      }
    } catch (error) {
      logger.error('Failed to initialize email transporter:', error);
    }
  }

  async sendEmail(to, subject, text, html = null) {
    try {
      if (!this.emailTransporter) {
        logger.warn('Email transporter not available. Skipping email notification.');
        return false;
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@aruba-automation.com',
        to,
        subject,
        text,
        html: html || text,
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      logger.info('Email sent successfully', { to, subject, messageId: result.messageId });
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error, { to, subject });
      return false;
    }
  }

  async notifyAutomationComplete(automation, execution, user) {
    try {
      const subject = `Automation "${automation.name}" ${execution.status}`;
      const deviceInfo = execution.device ? ` on device ${execution.device.name}` : '';
      
      let text = `Hello ${user.name},\n\n`;
      text += `Your automation "${automation.name}" has ${execution.status}${deviceInfo}.\n\n`;
      
      if (execution.status === 'success') {
        text += 'The automation completed successfully.\n';
      } else if (execution.status === 'failed') {
        text += `The automation failed with error: ${execution.error || 'Unknown error'}\n`;
      }
      
      text += `\nExecution details:\n`;
      text += `- Started: ${execution.startedAt ? execution.startedAt.toISOString() : 'N/A'}\n`;
      text += `- Completed: ${execution.completedAt ? execution.completedAt.toISOString() : 'N/A'}\n`;
      text += `- Duration: ${execution.duration ? `${execution.duration}ms` : 'N/A'}\n`;
      
      text += '\nBest regards,\nAruba Automation Platform';

      return await this.sendEmail(user.email, subject, text);
    } catch (error) {
      logger.error('Failed to send automation notification:', error);
      return false;
    }
  }

  async notifyAutomationFailed(automation, execution, user, error) {
    try {
      const subject = `Automation "${automation.name}" Failed`;
      const deviceInfo = execution.device ? ` on device ${execution.device.name}` : '';
      
      let text = `Hello ${user.name},\n\n`;
      text += `Your automation "${automation.name}" has failed${deviceInfo}.\n\n`;
      text += `Error details:\n${error}\n\n`;
      
      if (execution.output) {
        text += `Output:\n${JSON.stringify(execution.output, null, 2)}\n\n`;
      }
      
      text += 'Please check the automation configuration and try again.\n\n';
      text += 'Best regards,\nAruba Automation Platform';

      return await this.sendEmail(user.email, subject, text);
    } catch (error) {
      logger.error('Failed to send automation failure notification:', error);
      return false;
    }
  }

  async notifyDeviceOffline(device, users = []) {
    try {
      if (users.length === 0) {
        logger.warn('No users to notify about device offline status');
        return false;
      }

      const subject = `Device Alert: ${device.name} is Offline`;
      
      let text = `Device Alert\n\n`;
      text += `Device "${device.name}" (${device.serial}) has gone offline.\n\n`;
      text += `Device details:\n`;
      text += `- Type: ${device.type}\n`;
      text += `- Model: ${device.model}\n`;
      text += `- IP Address: ${device.ipAddress || 'N/A'}\n`;
      text += `- Location: ${device.location || 'N/A'}\n`;
      text += `- Last seen: ${device.lastSeen ? device.lastSeen.toISOString() : 'N/A'}\n\n`;
      text += 'Please check the device connectivity and resolve any issues.\n\n';
      text += 'Best regards,\nAruba Automation Platform';

      const emailPromises = users.map(user => 
        this.sendEmail(user.email, subject, text)
      );

      const results = await Promise.allSettled(emailPromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      
      logger.info('Device offline notifications sent', { 
        device: device.name, 
        total: users.length, 
        success: successCount 
      });

      return successCount > 0;
    } catch (error) {
      logger.error('Failed to send device offline notifications:', error);
      return false;
    }
  }

  async notifyScheduledAutomationFailed(automation, schedule, error) {
    try {
      // For scheduled automations, we don't have a specific user context
      // So we might want to notify admins or automation owners
      logger.error('Scheduled automation failed', {
        automationId: automation.id,
        automationName: automation.name,
        scheduleId: schedule.id,
        error: error.message,
      });

      // TODO: Implement admin notification logic
      // This could send to all admin users or the automation creator
      
      return true;
    } catch (notificationError) {
      logger.error('Failed to send scheduled automation failure notification:', notificationError);
      return false;
    }
  }

  async sendSystemAlert(level, message, details = {}) {
    try {
      logger[level]('System alert', { message, ...details });

      // TODO: Implement system alert notifications
      // This could integrate with external monitoring systems
      // or send alerts to admin users

      return true;
    } catch (error) {
      logger.error('Failed to send system alert:', error);
      return false;
    }
  }

  // Webhook notifications (for future integration)
  async sendWebhook(url, payload) {
    try {
      const axios = require('axios');
      
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      logger.info('Webhook sent successfully', { url, status: response.status });
      return true;
    } catch (error) {
      logger.error('Failed to send webhook:', error, { url });
      return false;
    }
  }

  // Slack notifications (for future integration)
  async sendSlackNotification(channel, message, webhookUrl = null) {
    try {
      if (!webhookUrl && !process.env.SLACK_WEBHOOK_URL) {
        logger.warn('Slack webhook URL not configured');
        return false;
      }

      const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
      const payload = {
        channel,
        text: message,
        username: 'Aruba Automation',
        icon_emoji: ':robot_face:',
      };

      return await this.sendWebhook(url, payload);
    } catch (error) {
      logger.error('Failed to send Slack notification:', error);
      return false;
    }
  }

  // Test notification connectivity
  async testEmailConnection() {
    try {
      if (!this.emailTransporter) {
        throw new Error('Email transporter not configured');
      }

      const result = await this.emailTransporter.verify();
      logger.info('Email connection test successful');
      return result;
    } catch (error) {
      logger.error('Email connection test failed:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();
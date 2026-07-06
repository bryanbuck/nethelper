# Aruba Central Network Automation Platform - Architectural Overview

## System Architecture

This is a **Node.js backend service** for an enterprise-grade Aruba Central network automation platform built with a **clean layered architecture** following **separation of concerns** principles.

## Core Technology Stack

### **Runtime & Framework**
- **Node.js 18+** - Server runtime with ES2022+ features
- **Express.js** - RESTful API framework with security middleware stack
- **TypeScript-style development** - Modern JavaScript with structured patterns

### **Data Layer**
- **PostgreSQL 15+** - Primary relational database
- **Prisma ORM** - Type-safe database access with migrations
- **Redis 7+** - Caching, session storage, and job queue backend

### **Background Processing**
- **Bull Queue** - Redis-backed job processing with retry mechanisms
- **Node-cron** - Scheduled automation execution

### **Real-time Communication**
- **Socket.io** - WebSocket connections for live updates
- **JWT Authentication** - Secure token-based auth with refresh tokens

## Database Schema & Models

### **User Management** (`User` model)
**Capabilities:**
- Role-based access control (admin/operator/viewer)
- JWT authentication with refresh tokens
- Session tracking and audit logging

**Features Enabled:**
- Multi-tenancy support
- Granular permission control
- User activity monitoring

### **Device Management** (`Device`, `DeviceGroup` models)
**Capabilities:**
- Multi-vendor device support (APs, switches, gateways)
- Real-time status tracking and monitoring
- Logical grouping for bulk operations
- Metadata storage for custom attributes

**Features Enabled:**
- Device discovery and synchronization
- Health monitoring and alerting
- Configuration management
- Firmware update orchestration

### **Automation Engine** (`Automation`, `Execution` models)
**Capabilities:**
- JSON-based workflow definitions
- Multi-step automation sequences
- Conditional execution logic
- Parameter templating and runtime substitution

**Features Enabled:**
- Configuration backup/restore
- Bulk configuration updates
- Compliance checking
- Custom command execution
- Firmware update automation

### **Scheduling System** (`Schedule` model)
**Capabilities:**
- Cron-based scheduling with timezone support
- Next/last run tracking
- Schedule activation/deactivation
- Cascade deletion with automations

**Features Enabled:**
- Recurring automation execution
- Maintenance window scheduling
- Time-based compliance checks

### **Audit & Compliance** (`AuditLog` model)
**Capabilities:**
- Comprehensive action logging
- Change tracking with before/after states
- IP address and user agent capture
- Multi-entity audit trail

**Features Enabled:**
- Regulatory compliance reporting
- Security incident investigation
- Change management tracking

## Service Layer Architecture

### **Aruba Central Service** (`src/services/aruba-central.service.js`)
**Core Integration Service**

**Capabilities:**
- OAuth2 token management with automatic refresh
- Token caching with Redis for performance
- Centralized API error handling and logging
- Request/response transformation

**Specific Features:**
- **Device Management**: Discovery, monitoring, status tracking
- **Configuration Management**: CRUD operations, backup/restore
- **Command Execution**: CLI command dispatch to devices  
- **Monitoring & Stats**: Performance metrics, health data
- **Firmware Management**: Version checking, upgrade orchestration

**Interdependencies:**
- **Redis**: Token caching and rate limiting
- **Logger**: Comprehensive API interaction logging
- **Error Handling**: Standardized exception management

### **Automation Service** (`src/services/automation.service.js`)
**Workflow Execution Engine**

**Capabilities:**
- Multi-step workflow processing
- Conditional execution with error handling
- Parameter injection and templating
- Step-by-step result tracking

**Specific Features:**
- **Configuration Backup**: Automated device config preservation
- **Configuration Updates**: Template-based bulk updates
- **Command Execution**: Remote CLI command orchestration
- **Compliance Checking**: Policy validation workflows
- **Firmware Updates**: Coordinated upgrade processes

**Interdependencies:**
- **Aruba Central Service**: All device operations
- **Database**: Automation definitions and execution tracking
- **WebSocket**: Real-time progress updates

### **Device Service** (`src/services/device.service.js`)
**Device Lifecycle Management**

**Capabilities:**
- CRUD operations for devices and groups
- Aruba Central synchronization
- Status mapping and transformation
- Background sync job queuing

**Specific Features:**
- **Device Discovery**: Automatic detection from Aruba Central
- **Status Synchronization**: Real-time status updates
- **Group Management**: Logical device organization
- **Metadata Management**: Custom attribute storage

**Interdependencies:**
- **Aruba Central Service**: Device data synchronization
- **Bull Queue**: Background sync operations
- **Database**: Device state persistence

### **Notification Service** (`src/services/notification.service.js`)
**Multi-Channel Communication**

**Capabilities:**
- Email notifications via SMTP
- Template-based messaging
- Multi-recipient support
- Connection health monitoring

**Specific Features:**
- **Automation Alerts**: Success/failure notifications
- **Device Alerts**: Offline/status change notifications
- **System Alerts**: Health and error notifications
- **Webhook Integration**: External system notifications (planned)
- **Slack Integration**: Team communication (planned)

**Interdependencies:**
- **Nodemailer**: Email transport
- **Logger**: Notification tracking
- **User Management**: Recipient resolution

## API Layer Architecture

### **Route Structure** (`/api/v1/`)
**RESTful API Design with Role-Based Access**

**Authentication Routes** (`/auth`)
- Login/logout with JWT tokens
- Token refresh mechanisms
- Password management

**Device Routes** (`/devices`)
- CRUD operations with filtering
- Real-time statistics retrieval
- Configuration management endpoints
- Command execution interfaces
- Group management APIs

**Automation Routes** (`/automations`)
- Workflow CRUD operations
- Execution triggering
- Template management
- History and reporting

**Schedule Routes** (`/schedules`)
- Cron-based scheduling
- Activation/deactivation
- Next run calculations

**Execution Routes** (`/executions`)
- Run history and status
- Output and error details
- Performance metrics

### **Security & Middleware Stack**

**Authentication Middleware** (`src/middleware/auth.middleware.js`)
**Capabilities:**
- JWT token validation
- User session management
- Role-based authorization
- Request context injection

**Security Middleware Stack:**
- **Helmet**: Security headers and XSS protection
- **CORS**: Cross-origin request management  
- **Rate Limiting**: API abuse prevention
- **Request Validation**: Input sanitization
- **Error Handling**: Standardized error responses

## Background Processing Architecture

### **Job Queue System** (Bull + Redis)

**Automation Queue** (`automation`)
**Capabilities:**
- Workflow execution with real-time progress
- Error handling and retry logic
- WebSocket progress broadcasting
- Execution history tracking

**Device Sync Queue** (`device-sync`)
**Capabilities:**
- Scheduled Aruba Central synchronization
- Batch device status updates
- Error recovery and logging

**Notification Queue** (`notification`)
**Capabilities:**
- Asynchronous message delivery
- Multi-channel notification dispatch
- Delivery confirmation tracking

### **Job Processing Features**
- **Retry Logic**: Exponential backoff for failed jobs
- **Error Handling**: Comprehensive logging and alerting
- **Concurrency Control**: Configurable parallel processing
- **Job Persistence**: Redis-backed job state management

## Real-time Communication

### **WebSocket Integration** (`src/websocket/socket.handler.js`)
**Bidirectional Real-time Updates**

**Authentication:**
- JWT-based connection authentication
- User-specific room management
- Subscription-based event filtering

**Event Channels:**
- **Device Updates**: Status changes, health alerts
- **Automation Progress**: Step-by-step execution updates
- **User Notifications**: Personal alerts and messages
- **System Events**: Global status and health updates

**Features Enabled:**
- Live automation execution monitoring
- Real-time device status dashboards
- Instant notification delivery
- Multi-user collaboration support

## Configuration & Infrastructure

### **Environment Management**
- **Database**: PostgreSQL connection with SSL support
- **Redis**: Caching and queue backend configuration
- **Aruba Central**: API credentials and endpoint configuration
- **SMTP**: Email notification transport setup
- **JWT**: Token signing and validation secrets

### **Logging & Monitoring** (`src/utils/logger.js`)
- **Winston-based**: Structured logging with multiple transports
- **Log Levels**: Debug, info, warn, error with environment-based filtering
- **Audit Trail**: API access logging and error tracking
- **Performance Metrics**: Request timing and resource usage

## Key Interdependencies & Data Flow

### **Authentication Flow**
1. **Client** → **Auth Routes** → **JWT Middleware** → **Database User Lookup**
2. **WebSocket** connections use same JWT validation
3. **All API routes** protected by authentication middleware

### **Device Management Flow**
1. **Aruba Central Service** ← **Device Sync Job** ← **Bull Queue**
2. **Device Service** → **Database** → **WebSocket Updates**
3. **Real-time Status** → **Notification Service** → **Email/Alerts**

### **Automation Execution Flow**
1. **API Request** → **Automation Queue** → **Background Job**
2. **Workflow Engine** → **Aruba Central API** → **Device Operations**
3. **Progress Updates** → **WebSocket** → **Real-time UI**
4. **Completion** → **Database** → **Notification Service**

### **Scheduling Flow**
1. **Cron Scheduler** → **Schedule Queue** → **Automation Execution**
2. **Schedule Management** → **Database** → **Next Run Calculation**

## Security Features

- **Role-Based Access Control**: Admin/Operator/Viewer permissions
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Comprehensive request validation
- **Rate Limiting**: API abuse prevention
- **Audit Logging**: Comprehensive action tracking
- **Secure Headers**: Helmet.js security middleware
- **CORS Protection**: Cross-origin request management

## Scalability & Performance

- **Redis Caching**: Token and session caching
- **Background Jobs**: Asynchronous processing with Bull
- **Database Indexing**: Optimized query performance
- **Connection Pooling**: Efficient database connections
- **Horizontal Scaling**: Stateless API design
- **WebSocket Scaling**: Room-based event distribution

This architecture provides a robust, scalable, and secure foundation for enterprise network automation with comprehensive device management, workflow automation, and real-time monitoring capabilities.

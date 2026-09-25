# NetHelper — Backend

Node.js backend for NetHelper, a **multi-vendor** network automation and monitoring platform. Provides REST APIs and WebSocket connections for device management, config backup, discovery, and automation across Aruba, Juniper, and Cisco — via cloud providers (Aruba Central, Juniper Mist, Cisco Meraki) or direct device access (REST / NETCONF / SSH).

> Architecture, conventions, and the multi-vendor design live in [`../CLAUDE.md`](../CLAUDE.md) and [`../docs/MULTI_VENDOR_ROADMAP.md`](../docs/MULTI_VENDOR_ROADMAP.md). This README is setup/run only.

## Features

- JWT-based authentication with refresh tokens
- Multi-vendor cloud-provider integration (Aruba Central, Juniper Mist; Meraki planned) + direct device access
- Configuration backup (cloud / device-REST / NETCONF / SSH) with scheduling, diffing, retention
- Automated device discovery (nmap-based)
- Automation workflow engine + cron scheduling
- Real-time updates via WebSocket
- ICMP + API device monitoring
- Multi-channel notifications, comprehensive audit logging

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- `nmap` on the host (device discovery)
- Credentials for whatever you connect to: a cloud integration (Aruba Central / Mist / Meraki) and/or per-device SSH/REST credentials

## Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure
4. Run database migrations: `npm run db:migrate`
5. Create the first admin: `npm run user:manage`
6. Start development server: `npm run dev`

For production deployment (Docker Compose or systemd + nginx), see [`../deploy/README.md`](../deploy/README.md).

## API Documentation

API documentation is available at `/api-docs` when running in development mode.

## Project Structure

- `src/` - Source code
  - `config/` - Configuration files
  - `controllers/` - Request handlers
  - `services/` - Business logic
  - `models/` - Database models
  - `middleware/` - Express middleware
  - `routes/` - API routes
  - `jobs/` - Background job processors
  - `utils/` - Utility functions
  - `websocket/` - WebSocket handlers

## Development

Start development server with hot reload: `npm run dev`

The server will start on `http://localhost:3000` (or the port specified in `.env`)

## Testing

Run tests with: `npm test`
Run tests in watch mode: `npm run test:watch`

### Authentication Testing

Test login functionality: `npm run test:login user@example.com password`

For the (historical) login testing guide, see [../docs/archive/LOGIN_TESTING.md](../docs/archive/LOGIN_TESTING.md)

## Deployment

1. Build for production: `npm run build`
2. Start production server: `npm start`
3. User management interface: `npm run user:manage`

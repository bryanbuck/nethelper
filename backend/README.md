# NetHelper — Backend

Node.js backend for NetHelper, a **multi-vendor** network automation and monitoring platform. Provides REST APIs and WebSocket connections for device management, config backup, discovery, and automation across Aruba, Juniper, and Cisco — via cloud providers (Aruba Central, Juniper Mist, Cisco Meraki) or direct device access (REST / NETCONF / SSH).

> Architecture and the multi-vendor design: [`../docs/MULTI_VENDOR_ROADMAP.md`](../docs/MULTI_VENDOR_ROADMAP.md). Contributor workflow: [`../CONTRIBUTING.md`](../CONTRIBUTING.md). This README is setup/run only.

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

- Node.js 22+
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

## API

REST under `/api/v1` (routes in `src/routes/`); a Postman collection is in `NetHelper_API_Collection.postman_collection.json`, generated from the route tables by `npm run postman:generate` (a unit test fails when it is out of date; set its `email`/`password` variables, then run Login). Probes: `GET /health` (liveness) and `GET /health/ready` (database + Redis).

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

Run tests with: `npm test` (watch mode: `npm run test:watch`; lint + tests: `npm run ci`). The suite mocks Prisma, Redis, and every device transport, so it needs no database or network.

Account problems (locked out, forgotten password, wrong role): `npm run user:manage`.

## Deployment

Docker Compose or systemd + nginx: see [`../deploy/README.md`](../deploy/README.md). In short, production runs `npm run db:deploy` (apply migrations) then `npm start` with `NODE_ENV=production`; `npm run user:manage` administers users from the server.

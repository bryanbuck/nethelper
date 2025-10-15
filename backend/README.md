# Aruba Central Automation Platform - Backend

Node.js backend for the Aruba Central Automation Platform, providing REST APIs and WebSocket connections for network device management and automation.

## Features

- JWT-based authentication with refresh tokens
- Aruba Central API integration
- Automation workflow engine
- Cron-based scheduling
- Real-time updates via WebSocket
- Device monitoring and statistics
- Multi-channel notifications
- Comprehensive audit logging

## Prerequisites

- Node.js 18+ 
- PostgreSQL 15+
- Redis 7+
- Aruba Central API credentials

## Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure
4. Run database migrations: `npm run db:migrate`
5. Seed initial data: `npm run db:seed`
6. Start development server: `npm run dev`

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

For detailed login testing and troubleshooting guide, see [docs/LOGIN_TESTING.md](docs/LOGIN_TESTING.md)

## Deployment

1. Build for production: `npm run build`
2. Start production server: `npm start`
3. User management interface: `npm run user:manage`

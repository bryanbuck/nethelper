# Aruba Central Automation Platform - Frontend

Vue.js frontend for the Aruba Central Automation Platform, providing an intuitive web interface for network device management, automation workflows, and real-time monitoring.

## Features

- Responsive Material Design UI with Vuetify 3
- Real-time device monitoring and statistics
- Visual workflow automation builder
- Calendar-based automation scheduling
- Live execution history and logs
- WebSocket integration for real-time updates
- Interactive charts and dashboards
- Multi-device management interface

## Prerequisites

- Node.js 18+
- Backend API running (see ../backend/README.md)

## Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure
4. Start development server: `npm run dev`
5. Access the web UI at `http://localhost:5173` (or configured port)

## Accessing the Web UI

The frontend development server runs on port **5173** by default.

- **Local access**: `http://localhost:5173`
- **Network access**: `http://<your-ip>:5173`
- **Custom hosts**: Configured in `vite.config.js` (currently supports dev-nethelper.buck.local, buck.local)

The application will automatically proxy API requests to the backend server configured in your environment variables.

## Project Structure

- `src/` - Source code
  - `assets/` - Static assets and global styles
  - `components/` - Reusable Vue components
    - `common/` - Shared UI components
    - `dashboard/` - Dashboard widgets
    - `devices/` - Device management components
    - `automations/` - Workflow builder components
    - `schedule/` - Calendar and scheduling components
    - `executions/` - Execution history components
    - `settings/` - Settings and configuration components
  - `views/` - Page-level components
  - `stores/` - Pinia state management
  - `services/` - API service layer
  - `router/` - Vue Router configuration
  - `utils/` - Utility functions
  - `composables/` - Vue composables
  - `plugins/` - Vue plugins (Vuetify, etc.)

## Development

Start development server with hot reload: `npm run dev`

The server will start on `http://localhost:5173` by default (or the port specified by Vite).

### Development Features

- Hot module replacement (HMR)
- API proxy to backend (configured in `vite.config.js`)
- Source maps for debugging
- Vue DevTools support

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Backend API endpoint
VITE_API_URL=http://localhost:3000/api/v1

# WebSocket endpoint
VITE_WS_URL=ws://localhost:3000

# Application settings
VITE_APP_TITLE=Aruba Central Automation Platform
VITE_APP_VERSION=1.0.0

# Development settings
VITE_DEV_TOOLS=true
VITE_LOG_LEVEL=debug

# Authentication settings
VITE_TOKEN_REFRESH_THRESHOLD=300000  # 5 minutes in ms
VITE_SESSION_TIMEOUT=3600000          # 1 hour in ms
```

## Technology Stack

- **Framework**: Vue 3 (Composition API)
- **Build Tool**: Vite 6
- **State Management**: Pinia 3
- **Router**: Vue Router 4
- **UI Framework**: Vuetify 3 (Material Design)
- **HTTP Client**: Axios
- **WebSocket**: socket.io-client
- **Charts**: Chart.js with vue-chartjs
- **Workflow Designer**: Vue Flow
- **Calendar**: FullCalendar Vue
- **Form Validation**: VeeValidate + Yup
- **Date Handling**: date-fns
- **Icons**: Material Design Icons (@mdi/font)

## Testing

Run unit tests: `npm run test:unit`
Run E2E tests: `npm run test:e2e`

Unit tests use Vitest with jsdom environment.

## Building for Production

1. Build optimized bundle: `npm run build`
2. Preview production build: `npm run preview`

The build output will be in the `dist/` directory, ready for deployment to any static hosting service.

## Deployment

The frontend is a static SPA that can be deployed to:

- **Static hosting**: Nginx, Apache, Caddy
- **CDN**: Cloudflare Pages, Vercel, Netlify
- **Containers**: Docker with nginx base image

### Nginx Configuration Example

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/nethelper/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Key Features Guide

### Dashboard
- Real-time device statistics
- Network health monitoring
- Recent activity feed
- Quick action buttons

### Device Management
- Comprehensive device listing with filtering
- Real-time status updates via WebSocket
- Device detail views with statistics
- Bulk device operations
- Export to CSV

### Automation Builder
- Visual drag-and-drop workflow designer
- Custom node types (triggers, conditions, actions, notifications)
- Node configuration dialogs
- Workflow templates
- Test and deploy capabilities

### Scheduling
- Calendar view for scheduled automations
- Cron expression builder with visual helper
- Recurring automation support
- Timezone configuration
- Conflict detection

### Execution History
- Timeline visualization of automation runs
- Detailed execution logs
- Status tracking and filtering
- Re-run failed executions
- Export execution reports

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile browsers: iOS Safari, Chrome Android

## Performance Optimization

The application implements several performance optimizations:

- Lazy loading for route components
- Virtual scrolling for large device lists
- Debounced search inputs
- API response caching
- Code splitting and tree-shaking
- Optimized bundle size

## Troubleshooting

### Common Issues

**API connection errors:**
- Verify backend is running on the configured port
- Check VITE_API_URL in `.env` matches backend URL
- Ensure CORS is properly configured on backend

**WebSocket connection failures:**
- Verify VITE_WS_URL points to backend WebSocket endpoint
- Check firewall allows WebSocket connections
- Ensure backend WebSocket server is running

**Build errors:**
- Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm install`
- Check Node.js version meets requirements (18+)
- Verify all environment variables are set

For more detailed troubleshooting, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Contributing

1. Follow Vue 3 Composition API patterns
2. Use Vuetify components for UI consistency
3. Maintain responsive design across all breakpoints
4. Write unit tests for business logic
5. Follow ESLint configuration
6. Document complex components

## License

[Add your license information here]

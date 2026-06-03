const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// API Backend URL - use environment variable or default
const API_URL = process.env.API_URL || 'http://localhost:2785';

// Dashboard static files path - use env var or default to dashboard/dist relative to app root
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || path.join(__dirname, '../dashboard/dist');

console.log('=== Dashboard Server Starting ===');
console.log('Current directory:', __dirname);
console.log('API URL:', API_URL);
console.log('Dashboard path:', DASHBOARD_PATH);
console.log('Path exists:', fs.existsSync(DASHBOARD_PATH));

// Check if dashboard dist exists, if not try alternatives
if (!fs.existsSync(DASHBOARD_PATH)) {
  const alternatives = [
    path.join(__dirname, 'dashboard/dist'),
    path.join(process.cwd(), 'dashboard/dist'),
    path.join(process.cwd(), '../dashboard/dist'),
    '/app/dashboard/dist',
    '/app/dashboard-server/dashboard/dist'
  ];
  
  for (const alt of alternatives) {
    console.log(`Checking alternative path: ${alt} - exists: ${fs.existsSync(alt)}`);
    if (fs.existsSync(alt)) {
      console.log('Using alternative path:', alt);
      break;
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), dashboardPath: DASHBOARD_PATH });
});

// Serve static files from the dashboard build
app.use(express.static(DASHBOARD_PATH));

// Proxy API requests to backend
app.use('/api', createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  secure: true,
  pathRewrite: {
    '^/api': '/api', // Keep the /api prefix
  },
}));

// Proxy WebSocket connections
app.use('/socket.io', createProxyMiddleware({
  target: API_URL,
  changeOrigin: true,
  ws: true,
  secure: true,
}));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(DASHBOARD_PATH, 'index.html');
  console.log('Serving fallback for:', req.path, 'from:', indexPath);
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(404).json({ error: 'Dashboard not found', path: indexPath });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
  console.log(`API proxy target: ${API_URL}`);
  console.log('=== Dashboard Server Ready ===');
});
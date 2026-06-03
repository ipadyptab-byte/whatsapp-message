const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// API Backend URL - use environment variable or default
const API_URL = process.env.API_URL || 'http://localhost:2785';

// Dashboard static files path - use env var or default to ../dashboard/dist relative to server.js
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || path.join(__dirname, '../dashboard/dist');

console.log('Starting server...');
console.log('API URL:', API_URL);
console.log('Dashboard path:', DASHBOARD_PATH);
console.log('Serving static files from:', DASHBOARD_PATH);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
  res.sendFile(path.join(DASHBOARD_PATH, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
  console.log(`API proxy target: ${API_URL}`);
});
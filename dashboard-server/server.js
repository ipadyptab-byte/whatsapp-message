const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// API Backend URL - use environment variable or default
const API_URL = process.env.API_URL || 'https://whatsapp-message-api.onrender.com';

// Serve static files from the dashboard build
app.use(express.static(path.join(__dirname, '../dashboard/dist')));

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
  res.sendFile(path.join(__dirname, '../dashboard/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on port ${PORT}`);
  console.log(`API proxy target: ${API_URL}`);
});
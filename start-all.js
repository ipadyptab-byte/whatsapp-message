// Combined server for API + Dashboard
// This serves the NestJS API and the React dashboard together

const express = require('express');
const path = require('path');
const http = require('http');

// Load environment
require('dotenv').config();

const PORT = process.env.PORT || 10000;
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || 'dashboard/dist';

// Create Express app for static files
const app = express();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve dashboard static files
app.use(express.static(DASHBOARD_PATH));

// Proxy API requests to the NestJS server
app.use('/api', (req, res) => {
  const apiPort = parseInt(PORT) + 1;
  const options = {
    hostname: 'localhost',
    port: apiPort,
    path: req.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${apiPort}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);
});

// Proxy WebSocket
app.use('/socket.io', (req, res) => {
  const apiPort = parseInt(PORT) + 1;
  const options = {
    hostname: 'localhost',
    port: apiPort,
    path: req.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${apiPort}`
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(DASHBOARD_PATH, 'index.html'));
});

// Start static file server on PORT
app.listen(PORT, () => {
  console.log(`Dashboard/Static server running on port ${PORT}`);
  console.log(`Dashboard path: ${DASHBOARD_PATH}`);
});

// Start the NestJS API server
const { spawn } = require('child_process');
const apiProcess = spawn('node', ['dist/main'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(parseInt(PORT) + 1) }
});

apiProcess.on('error', (err) => {
  console.error('Failed to start API server:', err);
});

console.log(`API server starting on port ${parseInt(PORT) + 1}`);
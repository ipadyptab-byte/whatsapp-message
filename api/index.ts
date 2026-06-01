import express from 'express';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), mode: 'serverless' });
});

// Liveness probe
app.get('/api/health/live', (req, res) => {
  res.json({ status: 'live' });
});

// Readiness probe  
app.get('/api/health/ready', (req, res) => {
  res.json({ status: 'ready' });
});

// Root info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'OpenWA API',
    version: '0.1.6',
    mode: 'serverless',
    endpoints: {
      health: '/api/health',
      docs: '/api/docs',
      sessions: '/api/sessions'
    },
    message: 'OpenWA is running in serverless mode. For full functionality, use Docker deployment.'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Route ' + req.method + ' ' + req.path + ' not found',
    hint: 'Visit /api for available endpoints'
  });
});

export default app;

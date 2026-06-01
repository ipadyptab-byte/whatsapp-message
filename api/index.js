export default function handler(req, res) {
  const url = req.url || '';
  
  if (url === '/api/health' || url === '/api/health/') {
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      mode: 'serverless'
    });
  } else if (url === '/api/health/live') {
    res.status(200).json({ status: 'live' });
  } else if (url === '/api/health/ready') {
    res.status(200).json({ status: 'ready' });
  } else if (url === '/api' || url === '/api/') {
    res.status(200).json({
      name: 'OpenWA API',
      version: '0.1.6',
      mode: 'serverless',
      endpoints: ['/api/health', '/api'],
      message: 'For full functionality, use Docker deployment.'
    });
  } else {
    res.status(404).json({ 
      error: 'Not Found',
      message: 'Route not found'
    });
  }
}

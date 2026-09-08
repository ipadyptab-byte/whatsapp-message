// OpenWA Unified Server Runner
// OpenWA uses a unified server architecture where NestJS serves both the API
// and the React dashboard static files directly on PORT.
// This prevents port splitting, proxy timeouts (502 Bad Gateway), and WebSocket breakage.

const fs = require('fs');
const path = require('path');

const distMain = path.resolve(__dirname, 'dist', 'main.js');

if (!fs.existsSync(distMain)) {
  console.error('[OpenWA] ERROR: dist/main.js was not found.');
  console.error('[OpenWA] Please build the application first: npm run build');
  process.exit(1);
}

console.log('=== Starting OpenWA Unified Server via start-all.js ===');
require(distMain);

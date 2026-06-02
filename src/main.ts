import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ShutdownService } from './common/services/shutdown.service';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';

// Configuration loading order (later sources do NOT override earlier ones):
//   1. Process env (Docker, shell, systemd) — highest priority
//   2. .env (project-level overrides committed/managed by the user)
//   3. data/.env.generated (Dashboard-managed config; created on first run)
const generatedEnvPath = path.resolve(process.cwd(), 'data', '.env.generated');
const userEnvPath = path.resolve(process.cwd(), '.env');

const dataDir = path.dirname(generatedEnvPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (fs.existsSync(userEnvPath)) {
  dotenv.config({ path: userEnvPath, override: false });
}

if (fs.existsSync(generatedEnvPath)) {
  dotenv.config({ path: generatedEnvPath, override: false });
} else {
  const minimalConfig = `# OpenWA Configuration
DATABASE_TYPE=sqlite
POSTGRES_BUILTIN=false
REDIS_ENABLED=false
REDIS_BUILTIN=false
QUEUE_ENABLED=false
STORAGE_TYPE=local
MINIO_BUILTIN=false
STORAGE_PATH=./data/media
`;
  fs.writeFileSync(generatedEnvPath, minimalConfig);
  dotenv.config({ path: generatedEnvPath, override: false });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const shutdownService = app.get(ShutdownService);
  shutdownService.setShutdownCallback(async () => {
    await app.close();
  });

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", '*'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // CORS
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || ['*'];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
  });

  // Get Express app and add middleware BEFORE setGlobalPrefix
  const expressApp = app.getHttpAdapter().getInstance();
  const dashboardPath = path.join(process.cwd(), 'dashboard-dist');

  // Dashboard routes that should redirect to /dashboard prefix
  const dashboardRoutes = ['/sessions', '/contacts', '/messages', '/webhooks', '/hooks', '/api-keys', '/logs', '/infrastructure', '/plugins'];

  // SPA fallback middleware - redirect dashboard routes to /dashboard prefix
  expressApp.use((req: any, res: any, next: any) => {
    if (req.method === 'GET' && 
        !req.url.startsWith('/api') && 
        !req.url.startsWith('/socket.io') &&
        !req.url.startsWith('/dashboard')) {

      // Check if it's a dashboard route - redirect to /dashboard prefix
      const isDashboardRoute = dashboardRoutes.some(r => req.url === r || req.url.startsWith(r + '/'));

      if (isDashboardRoute) {
        return res.redirect(`/dashboard${req.url}`);
      }

      // For other routes, serve dashboard index
      const hasExtension = /\.\w+$/.test(req.url);
      if (!hasExtension) {
        const indexPath = path.join(dashboardPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          return res.sendFile(indexPath);
        }
      }
    }
    next();
  });

  // Serve dashboard static files
  expressApp.use('/dashboard', (req: any, res: any, next: any) => {
    req.url = req.url.replace(/^\/dashboard/, '');
    express.static(dashboardPath)(req, res, next);
  });

  // Root redirect
  expressApp.get('/', (req: any, res: any) => {
    res.redirect('/dashboard');
  });

  // NOW set global prefix (API routes will be /api/*)
  app.setGlobalPrefix('api');

  // Validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    disableErrorMessages: process.env.NODE_ENV === 'production',
  }));

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('OpenWA API')
    .setDescription('Open Source WhatsApp API Gateway')
    .setVersion('0.1.6')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .addTag('sessions', 'WhatsApp session management')
    .addTag('messages', 'Send and manage messages')
    .addTag('webhooks', 'Webhook configuration')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // API root info
  expressApp.get('/api', (req: any, res: any) => {
    res.json({
      name: 'OpenWA API',
      version: '0.1.6',
      endpoints: { health: '/api/health', docs: '/api/docs', sessions: '/api/sessions' },
      dashboard: '/dashboard'
    });
  });

  const port = process.env.PORT || 2785;
  await app.listen(port);
  console.log(`🚀 OpenWA is running on: http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
import { NestFactory } from '@nestjs/core';
import { INestApplication, Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { VercelRequest, VercelResponse } from '@vercel/node';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const logger = new Logger('VercelHandler');

let cachedApp: INestApplication | null = null;

// Vercel serverless environment bootstrap
function bootstrapEnvironment() {
  const generatedEnvPath = path.resolve(process.cwd(), 'data', '.env.generated');
  const userEnvPath = path.resolve(process.cwd(), '.env');

  // Ensure data directory exists
  const dataDir = path.dirname(generatedEnvPath);
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      // Directory may already exist or filesystem is read-only
    }
  }

  // Load user .env
  if (fs.existsSync(userEnvPath)) {
    logger.log('[Bootstrap] Loading .env from:', userEnvPath);
    dotenv.config({ path: userEnvPath, override: false });
  }

  // Load generated config
  if (fs.existsSync(generatedEnvPath)) {
    logger.log('[Bootstrap] Loading saved configuration from:', generatedEnvPath);
    dotenv.config({ path: generatedEnvPath, override: false });
  } else {
    logger.log('[Bootstrap] First run detected in serverless environment');
    // Create minimal config for serverless
    const minimalConfig = `# OpenWA Configuration (Serverless)
DATABASE_TYPE=sqlite
POSTGRES_BUILTIN=false
REDIS_ENABLED=false
REDIS_BUILTIN=false
QUEUE_ENABLED=false
STORAGE_TYPE=local
MINIO_BUILTIN=false
STORAGE_PATH=/tmp/openwa/media
`;
    try {
      fs.writeFileSync(generatedEnvPath, minimalConfig);
      dotenv.config({ path: generatedEnvPath, override: false });
    } catch (e) {
      // Write failed, continue anyway
    }
  }
}

async function createApp(): Promise<INestApplication> {
  // Bootstrap environment configuration
  bootstrapEnvironment();

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Configure for serverless (no shutdown hooks needed)
  // app.enableShutdownHooks();

  return app;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Initialize app lazily to handle cold starts
    if (!cachedApp) {
      cachedApp = await createApp();
      logger.log('NestJS app initialized for serverless');
    }

    const httpAdapter = cachedApp.getHttpAdapter();

    // Handle the request
    httpAdapter.handle(req, res);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Serverless handler error:', errorMessage);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      });
    }
  }
}
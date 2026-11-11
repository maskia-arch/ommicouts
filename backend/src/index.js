import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { ensureDatabaseInitialized, pool } from './db.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhook.js';
import { reloadSchedules, stopAllSchedules } from './scraper/scheduler.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blockiert Origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-admin-key', 'x-webhook-secret', 'Authorization'],
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api', publicRoutes);
app.use('/api', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpunkt nicht gefunden.' });
});

app.use((err, _req, res, _next) => {
  console.error('[Backend Error]', err.message);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

async function bootstrap() {
  await ensureDatabaseInitialized();
  await reloadSchedules();

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Backend] Läuft auf Port ${config.port} (${config.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    console.log(`[Backend] ${signal} empfangen, fahre sauber herunter...`);
    stopAllSchedules();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Backend] Start fehlgeschlagen:', err);
  process.exit(1);
});

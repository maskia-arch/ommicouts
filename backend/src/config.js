import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  adminSecretKey: process.env.ADMIN_SECRET_KEY || '',
  userSessionSecret:
    process.env.USER_SESSION_SECRET ||
    process.env.ADMIN_SECRET_KEY ||
    'jcimmo-local-dev-session-secret',
  sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || String(7 * 24 * 3600), 10),
  webhookSecret: process.env.WEBHOOK_SECRET || process.env.ADMIN_SECRET_KEY || '',
  proxyUrl: process.env.PROXY_URL || '',
  enableCron: process.env.ENABLE_CRON !== 'false',
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    'https://immo.autoacts.link,http://localhost:4000,http://127.0.0.1:4000,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import './db.js';
import { authRoutes } from './auth.js';
import { bootstrap } from './bootstrap.js';
import { agentRoutes } from './hub.js';
import { adminRoutes } from './routes/admin.js';
import { announcementRoutes } from './routes/announcements.js';
import { deviceRoutes } from './routes/devices.js';
import { emergencyRoutes } from './routes/emergencies.js';
import { startScheduler } from './scheduler.js';
import { publicKeyBase64 } from './security.js';

bootstrap();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, trustProxy: true, bodyLimit: 3 * 1024 * 1024 });

app.setErrorHandler((err: Error, req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return reply.code(400).send({ error: first ? `${first.path.join('.') || 'girdi'}: ${first.message}` : 'Geçersiz girdi' });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'Sunucu hatası' : err.message });
});

app.addHook('onSend', async (_req, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'same-origin');
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

await app.register(authRoutes);
await app.register(agentRoutes);
await app.register(announcementRoutes);
await app.register(emergencyRoutes);
await app.register(deviceRoutes);
await app.register(adminRoutes);

app.get('/api/health', async () => ({ ok: true, publicKey: publicKeyBase64 }));

// Yüklenen görseller (ajanlar ve kiosk buradan çeker)
await app.register(fastifyStatic, {
  root: path.join(config.dataDir, 'media'),
  prefix: '/media/',
  decorateReply: false,
  maxAge: '7d',
  immutable: true,
});

// Derlenmiş panel (npm run build). Geliştirmede panel Vite ile ayrıca çalışır.
if (fs.existsSync(config.panelDist)) {
  await app.register(fastifyStatic, { root: config.panelDist, prefix: '/', wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/') && !req.url.startsWith('/ws/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Bulunamadı' });
  });
}

const stopScheduler = startScheduler();
app.addHook('onClose', async () => stopScheduler());

await app.listen({ port: config.port, host: config.host });
console.log(`ErtePano sunucusu çalışıyor → http://localhost:${config.port}`);
console.log(`Ajan imza genel anahtarı: ${publicKeyBase64}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}

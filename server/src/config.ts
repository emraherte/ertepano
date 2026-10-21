import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export const config = {
  port: int(process.env.PORT, 4100),
  host: process.env.HOST ?? '0.0.0.0',
  /** Ajanların ve panelin bu sunucuya ulaştığı adres (görsel URL'leri ve agent.json için). */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, 'data')),
  panelDist: path.join(root, 'apps', 'panel', 'dist'),
  sessionHours: int(process.env.SESSION_HOURS, 12),
  /** Çerezleri yalnızca HTTPS'te gönder (üretimde reverse proxy arkasında true yapın). */
  secureCookies: process.env.SECURE_COOKIES === 'true',
  retention: {
    telemetryDays: int(process.env.RETENTION_TELEMETRY_DAYS, 30),
    deliveryDays: int(process.env.RETENTION_DELIVERY_DAYS, 365),
    complianceDays: int(process.env.RETENTION_COMPLIANCE_DAYS, 730),
  },
  /** Kutlama/özel gün otomatiğinin çalıştığı saat dilimi. */
  timeZone: process.env.TZ_NAME ?? 'Europe/Istanbul',
};

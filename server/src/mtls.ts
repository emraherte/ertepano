/**
 * Ajanlar için karşılıklı TLS (mTLS). Kurumun iç CA'sından cihaz sertifikası olmayan istemci, ajan uç noktalarına
 * (kayıt, /ws/agent, yedek duyuru listesi) bağlanamaz; cihaz sırrı çalınsa bile başka bilgisayardan kullanılamaz,
 * çünkü sertifikadaki bilgisayar adı cihaz kaydındaki adla eşleşmelidir.
 *
 * Panel (tarayıcılar) etkilenmez: sunucu sertifika ister ama zorunlu kılmaz; denetim yalnızca ajan uç noktalarındadır.
 *   TLS_CLIENT_CA_PATH   kurum iç CA sertifikası (PEM; birden fazla olabilir)
 *   MTLS                 required (varsayılan, CA verilmişse) | optional | off
 */
import type { FastifyRequest } from 'fastify';
import type { TLSSocket } from 'node:tls';
import { config } from './config.js';

export type MtlsMode = 'off' | 'optional' | 'required';

export function mtlsMode(): MtlsMode {
  if (!config.tlsPfx || !config.tlsClientCa) return 'off';
  return config.mtls;
}

export interface ClientCert {
  /** CA tarafından imzalı ve geçerli */
  authorized: boolean;
  /** Sertifikadaki bilgisayar adı (CN ya da ilk DNS SAN'ın ilk etiketi), küçük harf */
  host: string | null;
  subject: string | null;
  fingerprint: string | null;
  validTo: string | null;
  error: string | null;
}

const firstLabel = (s: string) => s.trim().toLowerCase().split('.')[0] || null;

export function clientCert(req: FastifyRequest): ClientCert | null {
  const sock = req.raw.socket as TLSSocket;
  if (typeof sock.getPeerCertificate !== 'function') return null;
  const c = sock.getPeerCertificate();
  if (!c || !Object.keys(c).length) return null;
  const cn = Array.isArray(c.subject?.CN) ? c.subject.CN[0] : c.subject?.CN;
  const dns = (c.subjectaltname ?? '')
    .split(',')
    .map((x) => x.trim())
    .find((x) => x.startsWith('DNS:'))
    ?.slice(4);
  return {
    authorized: sock.authorized === true,
    host: dns ? firstLabel(dns) : cn ? firstLabel(cn) : null,
    subject: cn ?? null,
    fingerprint: c.fingerprint256 ?? null,
    validTo: c.valid_to ? new Date(c.valid_to).toISOString() : null,
    error: sock.authorizationError ? String(sock.authorizationError) : null,
  };
}

/**
 * Ajan isteğini denetle. `hostname` verilirse sertifikadaki adla eşleşmeli.
 * Dönüş: null = kabul; metin = ret nedeni.
 */
export function checkAgentCert(req: FastifyRequest, hostname?: string): string | null {
  const mode = mtlsMode();
  if (mode === 'off') return null;
  const c = clientCert(req);
  if (!c || !c.authorized) {
    if (mode === 'optional') return null;
    return c ? `istemci sertifikası geçersiz (${c.error ?? 'güvenilmeyen CA'})` : 'istemci sertifikası yok';
  }
  if (hostname && c.host && c.host !== firstLabel(hostname)) {
    return `sertifika başka bilgisayara ait (${c.subject})`;
  }
  if (hostname && !c.host) return 'sertifikada bilgisayar adı yok';
  return null;
}

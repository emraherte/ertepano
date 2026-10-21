// Hesabım → İki faktörlü doğrulama: aç, kurtarma kodlarını yenile, kapat.
import { useState } from 'react';
import { KeyRound, LifeBuoy, ShieldCheck, ShieldOff, ShieldPlus } from 'lucide-react';
import { api, useApi } from '../api';
import type { User } from '../types';
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Modal, useAuth, useToast } from '../ui';
import { CodeInput } from '../ui/code-input';
import { MfaSetup, RecoveryCodes } from './MfaSetup';

export function MfaCard() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi<{ enabled: boolean; required: boolean; recoveryLeft: number }>('/api/auth/mfa');
  const [mode, setMode] = useState<null | 'setup' | 'disable' | 'codes'>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const close = () => {
    setMode(null);
    setCode('');
    setPassword('');
    setError(null);
    setNewCodes(null);
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/mfa/disable', { body: { code, password: password || undefined } });
      toast('İki faktörlü doğrulama kapatıldı');
      close();
      reload();
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery-codes', { body: { code } });
      setNewCodes(r.recoveryCodes);
      reload();
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const enabled = !!data?.enabled;
  return (
    <Card delay={0.08}>
      <CardHeader
        icon={ShieldCheck}
        title="İki faktörlü doğrulama"
        description="Parolanıza ek olarak telefonunuzdaki Authenticator kodu istenir"
        action={data && (enabled ? <Badge tone="success" dot>Açık</Badge> : <Badge tone="warning" dot>Kapalı</Badge>)}
      />
      <div className="space-y-4 px-6 pb-6">
        {!data ? null : enabled ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-slate-600 dark:text-slate-300">
              <LifeBuoy size={15} className="text-slate-400" />
              Kalan kurtarma kodu: <b className={data.recoveryLeft <= 2 ? 'text-rose-600' : ''}>{data.recoveryLeft}</b>
              {data.recoveryLeft <= 2 && <span className="text-rose-600">— yenilemeniz önerilir</span>}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button icon={KeyRound} onClick={() => setMode('codes')}>
                Kurtarma kodlarını yenile
              </Button>
              {!data.required && (
                <Button variant="ghost" icon={ShieldOff} className="text-rose-600 dark:text-rose-400" onClick={() => setMode('disable')}>
                  Kapat
                </Button>
              )}
            </div>
            {data.required && <p className="text-[12px] text-slate-400">Rolünüz için zorunlu olduğundan kapatılamaz.</p>}
          </>
        ) : (
          <>
            <Callout tone="warning">Hesabınız yalnızca parolayla korunuyor. Parola ele geçirilirse acil durum yayını dahil tüm yetkileriniz kullanılabilir.</Callout>
            <Button variant="primary" icon={ShieldPlus} onClick={() => setMode('setup')}>
              İki faktörlü doğrulamayı aç
            </Button>
          </>
        )}
      </div>

      <Modal open={mode === 'setup'} width={720} title="İki faktörlü doğrulamayı aç" onClose={close}>
        {mode === 'setup' && (
          <MfaSetup
            user={user}
            onCancel={close}
            onDone={(_u: User) => {
              toast('İki faktörlü doğrulama açıldı');
              close();
              reload();
            }}
          />
        )}
      </Modal>

      <Modal
        open={mode === 'disable'}
        width={460}
        title="İki faktörlü doğrulamayı kapat"
        description="Güvenliğiniz için parolanız ve güncel kodunuz istenir."
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Vazgeç
            </Button>
            <Button variant="danger" loading={busy} disabled={code.length < 6 || (user.authSource !== 'ldap' && !password)} onClick={disable}>
              Kapat
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {user.authSource !== 'ldap' && (
            <Field label="Parola">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Field label="Authenticator kodu">
            <CodeInput value={code} onChange={setCode} error={!!error} />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
        </div>
      </Modal>

      <Modal
        open={mode === 'codes'}
        width={520}
        title="Kurtarma kodlarını yenile"
        description={newCodes ? undefined : 'Eski kodların tamamı geçersiz olur.'}
        onClose={close}
        footer={
          newCodes ? (
            <Button variant="primary" onClick={close}>
              Kaydettim
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={regenerate}>
              Yeni kodlar üret
            </Button>
          )
        }
      >
        {newCodes ? (
          <div className="space-y-4">
            <Callout tone="success">Yeni kodlar bir daha gösterilmeyecek; şimdi kaydedin.</Callout>
            <RecoveryCodes codes={newCodes} username={user.username} />
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Authenticator kodu">
              <CodeInput value={code} onChange={setCode} onComplete={() => undefined} error={!!error} autoFocus />
            </Field>
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        )}
      </Modal>
    </Card>
  );
}

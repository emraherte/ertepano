import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, KeyRound, Plus, Power, ShieldCheck, UserCheck, Users as UsersIcon } from 'lucide-react';
import { ROLE_LABELS, ROLES, type Role } from '@ertepano/shared';
import { api, fmtAgo, useApi } from '../api';
import { Avatar, Badge, Button, Callout, Card, cn, Copy, EmptyState, Field, Input, listItem, Modal, PageHeader, Select, SkeletonCard, td, th, trCls, useAuth, useConfirm, useToast } from '../ui';

interface PanelUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  authSource?: 'local' | 'ldap';
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Her şey',
  it: 'Cihazlar, ajan kurulumu, IT duyuruları, siber olay uyarısı, IT talepleri',
  isg: 'İSG duyuruları, acil durum ve tatbikat, ramak kala bildirimleri',
  ik: 'İK duyuruları, anketler, özel günler, kutlamalar',
  viewer: 'Sadece görüntüleme',
};

export function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<{ items: PanelUser[] }>('/api/users');
  const [form, setForm] = useState<{ username: string; fullName: string; role: Role } | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const r = await api<{ password: string }>('/api/users', { body: form });
      setSecret({ username: form.username, password: r.password });
      setForm(null);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const patch = async (u: PanelUser, body: object) => {
    try {
      const r = await api<{ password?: string }>(`/api/users/${u.id}`, { method: 'PATCH', body });
      if (r.password) setSecret({ username: u.username, password: r.password });
      else toast('Güncellendi');
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const items = data?.items ?? [];
  const adCount = items.filter((u) => u.authSource === 'ldap').length;

  return (
    <>
      <PageHeader
        eyebrow={<><UsersIcon size={14} /> Erişim</>}
        title="Kullanıcılar"
        description={`Panel kullanıcıları ve rolleri.${adCount ? ` ${adCount} kullanıcı Active Directory'den geliyor.` : ''}`}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setForm({ username: '', fullName: '', role: 'ik' })}>
            Kullanıcı
          </Button>
        }
      />
      {!data ? (
        <SkeletonCard rows={5} />
      ) : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState icon={UsersIcon} title="Kullanıcı yok" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Kullanıcı</th>
                    <th className={th}>Kaynak</th>
                    <th className={cn(th, 'w-[300px]')}>Rol</th>
                    <th className={th}>Son giriş</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((u, i) => {
                    const ldap = u.authSource === 'ldap';
                    const self = u.id === me.id;
                    return (
                      <motion.tr key={u.id} variants={listItem} initial="hidden" animate="show" custom={i} className={cn(trCls, 'group', !u.isActive && 'opacity-50')}>
                        <td className={td}>
                          <div className="flex items-center gap-3">
                            <Avatar name={u.fullName} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                                {u.fullName}
                                {self && <Badge tone="success">Siz</Badge>}
                                {!u.isActive && <Badge tone="danger">Devre dışı</Badge>}
                              </div>
                              <div className="font-mono text-[12px] text-slate-400">{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className={td}>
                          {ldap ? (
                            <Badge tone="info" icon={Building2}>
                              Active Directory
                            </Badge>
                          ) : (
                            <Badge icon={KeyRound}>Yerel</Badge>
                          )}
                        </td>
                        <td className={td}>
                          <Select value={u.role} disabled={self || ldap} onChange={(e) => patch(u, { role: e.target.value })} className="w-44">
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </Select>
                          <div className="mt-1.5 text-[12px] text-slate-400">{ldap ? 'Rol AD grubundan gelir' : ROLE_HELP[u.role]}</div>
                        </td>
                        <td className={cn(td, 'text-[13px] whitespace-nowrap text-slate-500')}>{fmtAgo(u.lastLoginAt)}</td>
                        <td className={cn(td, 'text-right whitespace-nowrap')}>
                          <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                            {!ldap && (
                              <Button size="sm" variant="ghost" icon={KeyRound} onClick={async () => (await confirm({ title: 'Parola sıfırlansın mı?', description: `${u.fullName} için yeni geçici parola üretilir; açık oturumları kapanır.`, confirmLabel: 'Sıfırla' })) && patch(u, { resetPassword: true })}>
                                Parola sıfırla
                              </Button>
                            )}
                            {!self && (
                              <Button size="sm" variant="ghost" icon={u.isActive ? Power : UserCheck} className={u.isActive ? 'hover:text-rose-600' : ''} onClick={() => patch(u, { isActive: !u.isActive })}>
                                {u.isActive ? 'Devre dışı' : 'Etkinleştir'}
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={!!form}
        title="Kullanıcı ekle"
        description="Yerel panel hesabı; geçici parola bir kez gösterilir."
        onClose={() => setForm(null)}
        footer={
          <Button variant="primary" loading={busy} disabled={!form?.username || !form?.fullName} onClick={create}>
            Ekle
          </Button>
        }
      >
        {form && (
          <div className="space-y-5">
            <Callout tone="info" icon={Building2}>
              Active Directory açıksa AD kullanıcıları ilk girişte rol grubuna göre otomatik oluşur; buradan yalnızca yerel (yedek) hesap eklenir.
            </Callout>
            <Field label="Ad soyad">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="Kullanıcı adı">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} placeholder="ayse.demir" />
            </Field>
            <Field label="Rol" hint={ROLE_HELP[form.role]}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!secret}
        title="Geçici parola"
        description="Yalnızca şimdi gösterilir."
        onClose={() => setSecret(null)}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            Tamam
          </Button>
        }
      >
        {secret && (
          <div className="space-y-5">
            <p className="text-[14px] text-slate-600 dark:text-slate-300">
              <b className="text-slate-900 dark:text-white">{secret.username}</b> için parola:
            </p>
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-5 py-4">
              <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
              <code className="flex-1 font-mono text-lg font-semibold tracking-wide text-slate-900 dark:text-white">{secret.password}</code>
              <Copy text={secret.password} />
            </div>
            <p className="text-[13px] text-slate-500">Kullanıcıdan ilk girişte Hesabım sayfasından parolasını değiştirmesini isteyin.</p>
          </div>
        )}
      </Modal>
    </>
  );
}

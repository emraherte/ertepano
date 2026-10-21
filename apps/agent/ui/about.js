// Aydınlatma penceresi: bu bilgisayarın ajan durumunu göster.
invoke('status').then((s) => {
  document.getElementById('me').replaceChildren(
    el('div', { text: `Bilgisayar: ${s.hostname} · Kullanıcı: ${s.user}` }),
    el('div', { text: `Durum: ${s.text}` }),
    el('div', { text: `Sunucu: ${s.serverUrl || '—'} · Cihaz kimliği: ${s.deviceId || '—'}` }),
    el('div', { text: `Ajan sürümü: ${s.version} · İmza anahtarı: ${s.keyPinned ? 'kurulumda sabitlendi' : 'ilk kayıtta sabitlendi'}` }),
  );
});

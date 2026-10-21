// Tepsi → "Duyurularım": son gelen duyurular ve bağlantı durumu.
const listEl = document.getElementById('list');
const KIND = { badge: 'Rozet', toast: 'Duyuru', banner: 'Şerit', fullscreen: 'Acil durum', survey: 'Anket', countdown: 'Geri sayım' };

async function loadStatus() {
  const s = await invoke('status');
  document.getElementById('status').textContent = `${s.text} · ${s.hostname}${s.pending ? ` · ${s.pending} mesaj gönderilmeyi bekliyor` : ''}`;
  document.getElementById('dot').className = `dot ${s.code}`;
}

async function loadList() {
  const rows = await invoke('recent');
  listEl.replaceChildren();
  if (!rows.length) {
    listEl.append(el('div', { class: 'empty' }, el('div', { style: 'font-size:36px', text: '📭' }), 'Henüz duyuru yok.'));
    return;
  }
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  for (const r of rows) {
    const a = r.item;
    const c = category(a);
    wrap.append(el('div', { class: 'list-item', style: `--accent:${accentOf(a)}` },
      el('div', { class: 'row' },
        el('span', { class: 'chip', text: `${c.name} · ${KIND[a.kind] || a.kind}` }),
        el('span', { class: 'muted', style: 'font-size:12px', text: (r.active ? 'Yayında · ' : '') + fmtDate(a.startsAt || a.issuedAt) }),
      ),
      el('div', { class: 'title', text: `${a.emoji ? a.emoji + ' ' : ''}${a.title}` }),
      a.body ? el('div', { class: 'body-text', text: a.body }) : null,
    ));
  }
  listEl.append(wrap);
}

loadStatus();
loadList();
TAURI.event.listen('status', loadStatus);
TAURI.event.listen('items', loadList);
setInterval(loadStatus, 5000);

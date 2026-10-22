// "IT'ye bildir" formu — bilgisayar adı, IP ve sistem durumu bildirime otomatik eklenir.
const root = document.getElementById('root');
document.documentElement.style.setProperty('--accent', CATEGORIES.it.color);

const text = el('textarea', {
  class: 'input',
  maxlength: '2000',
  placeholder: 'Sorununuzu kısaca yazın (ör. "Yazıcı çıktı vermiyor", "Outlook açılmıyor")',
});
const err = el('div', { class: 'error' });
const send = el('button', { class: 'btn-primary', text: 'Gönder' });

root.append(
  el('h1', { text: '🛠️ IT\'ye bildir' }),
  el('div', { class: 'hint', text: 'Bilgisayar adınız, IP adresiniz ve sistem durumu (disk, bellek) bildirime otomatik eklenir.' }),
  text,
  err,
  el('div', { style: 'display:flex;gap:8px;justify-content:flex-end' },
    el('button', { class: 'btn-ghost', text: 'Vazgeç', onclick: () => invoke('close_window') }),
    send,
  ),
);
text.focus();

send.addEventListener('click', async () => {
  err.textContent = '';
  send.disabled = true;
  try {
    const online = await invoke('send_report', { kind: 'it_help', text: text.value });
    root.replaceChildren(el('div', { class: 'success' },
      el('div', { class: 'big', text: '✅' }),
      el('h1', { text: 'Bildiriminiz alındı. Teşekkürler!' }),
      online ? null : el('div', { class: 'muted', text: 'Şu an sunucuya bağlı değilsiniz; bağlantı kurulunca iletilecek.' }),
    ));
    setTimeout(() => invoke('close_window'), 2500);
  } catch (e) {
    err.textContent = String(e);
    send.disabled = false;
  }
});

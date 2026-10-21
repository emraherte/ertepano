// "IT'ye bildir" ve "Ramak kala bildir" formu — tür pencere etiketinden gelir (report-it / report-nm).
const root = document.getElementById('root');
const nearMiss = MY_LABEL === 'report-nm';
const kind = nearMiss ? 'near_miss' : 'it_help';
root.style.setProperty('--accent', nearMiss ? CATEGORIES.isg.color : CATEGORIES.it.color);
document.documentElement.style.setProperty('--accent', nearMiss ? CATEGORIES.isg.color : CATEGORIES.it.color);

const text = el('textarea', {
  class: 'input',
  maxlength: '2000',
  placeholder: nearMiss
    ? 'Ne oldu? Nerede? Ne zaman? (ör. "B blok merdiveninde yağ birikintisi, kayma tehlikesi var")'
    : 'Sorununuzu kısaca yazın (ör. "Yazıcı çıktı vermiyor", "Outlook açılmıyor")',
});
const anon = el('input', { type: 'checkbox', id: 'anon' });
const err = el('div', { class: 'error' });
const send = el('button', { class: 'btn-primary', text: 'Gönder' });

root.append(
  el('h1', { text: nearMiss ? '⚠️ Ramak kala bildir' : '🛠️ IT\'ye bildir' }),
  el('div', { class: 'hint', text: nearMiss
    ? 'Kaza olmadan önce fark ettiğiniz tehlikeyi bildirin. Bildiriminiz İSG ekibine iletilir.'
    : 'Bilgisayar adınız, IP adresiniz ve sistem durumu (disk, bellek) bildirime otomatik eklenir.' }),
  text,
  nearMiss ? el('label', { class: 'check', for: 'anon' }, anon, 'Anonim gönder (adım ve kullanıcı adım eklenmesin)') : null,
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
    const online = await invoke('send_report', { kind, text: text.value, anonymous: anon.checked });
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

// Üst şerit: duyuru şeridi (banner), geri sayım (countdown) ve yanıt verilmiş acil durum şeridi (strip).
const root = document.getElementById('root');
let timer = null;

function two(n) {
  return String(n).padStart(2, '0');
}

function remainingText(to) {
  const ms = new Date(to).getTime() - Date.now();
  if (isNaN(ms)) return '';
  if (ms <= 0) return 'Başladı';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

onView((v) => {
  const a = v.item;
  clearInterval(timer);
  root.replaceChildren();

  if (v.mode === 'strip') {
    const answer = v.answer === 'safe' ? 'Güvendeyim ✓' : v.answer === 'help' ? 'Yardım istendi — ekipler bilgilendirildi' : 'Okundu ✓';
    root.append(el('div', { class: 'banner strip' },
      a.drill ? el('span', { class: 'tag', text: 'TATBİKAT' }) : el('span', { class: 'tag', text: 'ACİL DURUM' }),
      el('span', { class: 'emoji', text: a.emoji || '🚨' }),
      el('div', { class: 'text' }, el('b', { text: a.title }), el('span', { text: `Yanıtınız: ${answer}` })),
    ));
    return;
  }

  root.style.setProperty('--accent', accentOf(a));
  const clock = a.kind === 'countdown' && a.countdownTo ? el('span', { class: 'clock', text: remainingText(a.countdownTo) }) : null;
  const firstLine = (a.body || '').split('\n')[0];
  root.append(el('div', { class: 'banner' },
    a.emoji ? el('span', { class: 'emoji', text: a.emoji }) : null,
    el('div', { class: 'text', title: a.body || a.title }, el('b', { text: a.title }), el('span', { text: firstLine })),
    clock,
    el('button', { class: 'x', title: 'Kapat', 'aria-label': 'Kapat', text: '×', onclick: () => act(a.id, 'dismissed') }),
  ));
  if (clock) timer = setInterval(() => (clock.textContent = remainingText(a.countdownTo)), 1000);
});

// Acil durum tam ekranı: tüm monitörlerde. Yoklama varsa "Güvendeyim / Yardım lazım".
const root = document.getElementById('root');
let alarm = null;

/** WebAudio ile döngüsel siren (iki ton). Yalnızca birincil monitördeki pencere çalar. */
function startAlarm() {
  if (alarm) return;
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.connect(gain);
    osc.start();
    let hi = false;
    const iv = setInterval(() => {
      hi = !hi;
      osc.frequency.setValueAtTime(hi ? 880 : 660, ctx.currentTime);
    }, 500);
    alarm = { ctx, iv };
  } catch (_) { /* ses yoksa görsel uyarı yeter */ }
}

function stopAlarm() {
  if (!alarm) return;
  clearInterval(alarm.iv);
  alarm.ctx.close().catch(() => {});
  alarm = null;
}

function sendSafety(a, status, note) {
  stopAlarm();
  return invoke('safety', { emergencyId: a.emergencyId, status, note: note || null });
}

function helpForm(a, actions) {
  const ta = el('textarea', { placeholder: 'Neredesiniz, ne oldu? (isteğe bağlı)', maxlength: '500' });
  const form = el('div', { class: 'alert-note' },
    ta,
    el('div', { class: 'alert-actions' },
      el('button', { class: 'btn-help', text: '🆘 Yardım iste', onclick: () => sendSafety(a, 'help', ta.value) }),
    ),
  );
  actions.replaceWith(form);
  ta.focus();
}

onView((v) => {
  const a = v.item;
  root.replaceChildren();
  const wrap = el('div', { class: 'alert-wrap' + (a.drill ? '' : ' pulse') });

  if (a.drill) wrap.append(el('div', { class: 'alert-tag', text: 'TATBİKAT' }));
  wrap.append(el('div', { class: 'alert-emoji', text: a.emoji || '🚨' }));
  wrap.append(el('div', { class: 'alert-title', text: a.title }));
  if (a.body) wrap.append(el('div', { class: 'alert-body', text: a.body }));

  let actions;
  if (a.emergencyId) {
    actions = el('div', { class: 'alert-actions' },
      el('button', { class: 'btn-safe', text: '✅ Güvendeyim', onclick: () => sendSafety(a, 'safe') }),
      el('button', { class: 'btn-help', text: '🆘 Yardım lazım', onclick: () => helpForm(a, actions) }),
    );
  } else {
    actions = el('div', { class: 'alert-actions' },
      el('button', { class: 'btn-safe', text: a.ackLabel || 'Anladım', onclick: () => { stopAlarm(); act(a.id, 'acked'); } }),
    );
  }
  wrap.append(actions);
  root.append(wrap);

  const clock = el('div', { class: 'alert-foot' });
  const tickClock = () => (clock.textContent = `ErtePano · ${new Date().toLocaleTimeString('tr-TR')} · Bu ekran yanıt verdiğinizde kapanır`);
  tickClock();
  setInterval(tickClock, 1000);
  root.append(clock);

  if (a.sound && v.primary) startAlarm();
});

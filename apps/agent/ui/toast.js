// Sağ alt kart: duyuru (toast) ve mikro anket (survey).
const root = document.getElementById('root');
let busy = false;

function fit() {
  requestAnimationFrame(() => invoke('fit_height', { h: root.offsetHeight + 4 }).catch(() => {}));
}

function done(id, action, answer) {
  if (busy) return;
  busy = true;
  act(id, action, answer).finally(() => (busy = false));
}

onView((v) => {
  const a = v.item;
  const c = category(a);
  root.style.setProperty('--accent', accentOf(a));
  root.replaceChildren();

  const head = el('div', { class: 'card-head' },
    el('span', { class: 'chip', text: a.kind === 'survey' ? `${c.name} · Anket` : c.name }),
    el('div', { style: 'display:flex;align-items:center;gap:6px' },
      v.queued > 0 ? el('span', { class: 'queued', text: `+${v.queued} duyuru daha` }) : null,
      a.requireAck ? null : el('button', { class: 'x', title: 'Kapat', 'aria-label': 'Kapat', text: '×', onclick: () => done(a.id, 'dismissed') }),
    ),
  );

  const title = el('div', { class: 'card-title' },
    a.emoji ? el('span', { class: 'emoji', text: a.emoji }) : null,
    el('span', { text: a.title }),
  );

  const img = safeImage(a.imageUrl);
  const media = img ? el('img', { class: 'media', src: img, alt: '', onload: fit, onerror: (e) => { e.target.remove(); fit(); } }) : null;
  const body = a.body ? el('div', { class: 'body-text', text: a.body }) : null;

  let actions;
  if (a.kind === 'survey' && Array.isArray(a.options) && a.options.length) {
    actions = el('div', { class: 'options' },
      a.options.map((o) => el('button', { class: 'btn-option', text: o, onclick: () => done(a.id, 'answered', o) })),
    );
  } else if (a.requireAck) {
    actions = el('div', { class: 'actions' },
      el('button', { class: 'btn-primary', text: a.ackLabel || 'Okudum, anladım', onclick: () => done(a.id, 'acked') }),
    );
  } else {
    actions = el('div', { class: 'actions' },
      el('button', { class: 'btn-ghost', text: 'Kapat', onclick: () => done(a.id, 'dismissed') }),
      el('button', { class: 'btn-primary', text: a.ackLabel || 'Okudum', onclick: () => done(a.id, 'read') }),
    );
  }

  root.append(el('div', { class: 'card' }, el('div', { class: 'card-inner' }, head, title, media, body, actions)));
  fit();
});

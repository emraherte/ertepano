// Ortak yardımcılar — tüm ajan sayfaları. Sunucudan gelen metin asla innerHTML ile basılmaz.
const TAURI = window.__TAURI__;
const invoke = (cmd, args) => TAURI.core.invoke(cmd, args || {});
const MY_LABEL = TAURI.webviewWindow.getCurrentWebviewWindow().label;

const CATEGORIES = {
  ik: { name: 'İK', color: '#7c3aed' },
  isg: { name: 'İSG', color: '#d92d20' },
  it: { name: 'IT', color: '#2563eb' },
  genel: { name: 'Genel', color: '#0f766e' },
};

function category(a) {
  return CATEGORIES[a && a.category] || CATEGORIES.genel;
}

/** Sunucu rengi yalnızca #hex ise kullanılır (CSS enjeksiyonuna karşı). */
function accentOf(a) {
  if (a && typeof a.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.color)) return a.color;
  return category(a).color;
}

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.setAttribute('style', v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** Güvenli görsel adresi ya da null. */
function safeImage(url) {
  // yalnızca ajanın sunucudan indirip verdiği data: URL'ler (CSP dış adreslere kapalı, bkz. images.rs)
  return typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url) ? url : null;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Bu pencerenin içeriğini al ve değiştikçe güncelle. */
function onView(render) {
  let last = null;
  const apply = (v) => {
    const key = JSON.stringify(v);
    if (!v || key === last) return;
    last = key;
    render(v);
  };
  invoke('get_view').then(apply).catch(() => {});
  TAURI.event.listen('view', (e) => {
    if (e.payload && e.payload.label === MY_LABEL) apply(e.payload.view);
  });
}

function act(id, action, answer) {
  return invoke('act', { id, action, answer: answer == null ? null : String(answer) });
}

// sağ tık menüsünü kapat (bindirme pencerelerinde gereksiz)
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('textarea')) e.preventDefault();
});

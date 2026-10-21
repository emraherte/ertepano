// Rozet (özel günler, logo). Pencere click-through: fare altındaki uygulamaya geçer; imleç üstündeyken soluklaşır.
// Konum ve boyutu ajan belirler; burada yalnızca içerik ve opaklık (view.opacity, 0.2–1).
const root = document.getElementById('root');
let baseOpacity = 1;

onView((v) => {
  const a = v.item;
  baseOpacity = Math.min(1, Math.max(0.2, Number(v.opacity) || 1));
  root.style.opacity = String(baseOpacity);
  root.replaceChildren();
  const img = safeImage(a.imageUrl);
  if (img) root.append(el('img', { src: img, alt: a.title || '' }));
  else root.append(el('span', { class: 'emoji', text: a.emoji || '🎉' }));
  // küçük rozette yazı sığmaz; görsel kendini anlatır
  if (a.title && window.innerWidth >= 120) root.append(el('span', { class: 'cap', text: a.title }));
});

TAURI.event.listen('hover', (e) => {
  if (!e.payload || e.payload.label !== MY_LABEL) return;
  root.style.opacity = e.payload.hover ? String(Math.min(0.15, baseOpacity)) : String(baseOpacity);
});

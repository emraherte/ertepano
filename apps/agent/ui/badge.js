// Köşe rozeti (özel günler). Pencere click-through: fare altındaki uygulamaya geçer; imleç üstündeyken soluklaşır.
const root = document.getElementById('root');

onView((v) => {
  const a = v.item;
  root.replaceChildren();
  const img = safeImage(a.imageUrl);
  if (img) root.append(el('img', { src: img, alt: a.title }));
  else root.append(el('span', { class: 'emoji', text: a.emoji || '🎉' }));
  if (a.title) root.append(el('span', { class: 'cap', text: a.title }));
});

TAURI.event.listen('hover', (e) => {
  if (e.payload && e.payload.label === MY_LABEL) root.classList.toggle('faded', !!e.payload.hover);
});

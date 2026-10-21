import type { Category, EmergencyType, Kind } from '@ertepano/shared';

export interface Template {
  id: string;
  category: Category;
  kind: Kind;
  name: string;
  title: string;
  body: string;
  emoji: string;
  requireAck?: boolean;
  ackLabel?: string;
  options?: string[];
  sound?: boolean;
  /** Geri sayım şablonları için: şu andan kaç dakika sonrası. */
  countdownMinutes?: number;
}

/** Boş form yerine şablonla başla. Metinlerdeki [köşeli parantez] alanları kullanıcı doldurur. */
export const TEMPLATES: Template[] = [
  // İK
  { id: 'ik-servis', category: 'ik', kind: 'toast', name: 'Servis güzergâhı değişti', emoji: '🚌', title: 'Servis güzergâhları güncellendi',
    body: '[Tarih] itibarıyla servis güzergâhlarında değişiklik yapılmıştır. Güncel liste İK panosunda ve intranette.' },
  { id: 'ik-tatil', category: 'ik', kind: 'toast', name: 'Bayram / resmî tatil', emoji: '🎉', title: '[Bayram adı] tatili',
    body: '[Başlangıç] – [Bitiş] tarihleri arasında şirketimiz tatildir. İyi bayramlar dileriz!' },
  { id: 'ik-menu', category: 'ik', kind: 'banner', name: 'Günün menüsü', emoji: '🍽️', title: 'Bugünün menüsü',
    body: 'Mercimek çorbası · Tavuk sote · Pilav · Ayran' },
  { id: 'ik-egitim', category: 'ik', kind: 'toast', name: 'Eğitim daveti', emoji: '🎓', title: '[Eğitim adı] eğitimi',
    body: '[Tarih, saat] — [Salon]. Katılım zorunludur, lütfen takviminize ekleyin.', requireAck: true, ackLabel: 'Katılacağım' },
  { id: 'ik-hosgeldin', category: 'ik', kind: 'toast', name: 'Aramıza katılan arkadaşımız', emoji: '👋', title: 'Aramıza hoş geldin [Ad Soyad]!',
    body: '[Departman] ekibimize katılan [Ad Soyad]\'a hoş geldin diyoruz.' },
  { id: 'ik-anket', category: 'ik', kind: 'survey', name: 'Mini anket', emoji: '📊', title: 'Bugünkü yemeği nasıl buldunuz?',
    body: 'Tek tıkla oy verin, sonuçlar anonimdir.', options: ['😍 Çok iyi', '🙂 İyi', '😐 Orta', '🙁 Kötü'] },
  { id: 'ik-piknik', category: 'ik', kind: 'survey', name: 'Etkinlik tarihi oylaması', emoji: '🧺', title: 'Şirket pikniği hangi gün olsun?',
    body: 'En çok oyu alan tarih seçilecek.', options: ['[Tarih 1]', '[Tarih 2]', '[Tarih 3]'] },

  // İSG
  { id: 'isg-tatbikat', category: 'isg', kind: 'toast', name: 'Tatbikat duyurusu', emoji: '🧯', title: 'Yangın tatbikatı — [saat]',
    body: 'Bugün [saat]\'te yangın tatbikatı yapılacaktır. Alarm çaldığında en yakın çıkışı kullanarak [toplanma alanı]\'na gidiniz.',
    requireAck: true, ackLabel: 'Okudum, anladım' },
  { id: 'isg-talimat', category: 'isg', kind: 'toast', name: 'İSG talimatı (zorunlu okuma)', emoji: '📋', title: '[Talimat adı] güncellendi',
    body: '[Kısa özet]. Tam metin İSG klasöründe. Okuduğunuzu onaylamanız gerekmektedir.', requireAck: true, ackLabel: 'Okudum, anladım' },
  { id: 'isg-kkd', category: 'isg', kind: 'banner', name: 'KKD hatırlatma', emoji: '⛑️', title: 'Kişisel koruyucu donanım',
    body: 'Üretim alanına baret, gözlük ve iş ayakkabısı olmadan girmeyiniz.' },
  { id: 'isg-sicak', category: 'isg', kind: 'banner', name: 'Sıcak hava uyarısı', emoji: '🌡️', title: 'Aşırı sıcak uyarısı',
    body: 'Bol su için, saat başı gölgede mola verin. Baş dönmesinde ilk yardım ekibine haber verin.' },
  { id: 'isg-ramakkala', category: 'isg', kind: 'toast', name: 'Ramak kala farkındalığı', emoji: '⚠️', title: 'Ramak kala gördün mü? Bildir!',
    body: 'Kazaya dönüşmeden önce bildir: sağ alttaki ErtePano simgesi → "Ramak kala bildir". İstersen anonim.' },

  // IT
  { id: 'it-bakim', category: 'it', kind: 'countdown', name: 'Planlı bakım geri sayımı', emoji: '🛠️', title: 'Planlı sistem bakımı',
    body: '[Sistem adı] bakım süresince erişilemeyecek. Lütfen çalışmalarınızı kaydedin.', countdownMinutes: 30 },
  { id: 'it-oltalama', category: 'it', kind: 'toast', name: 'Oltalama (phishing) uyarısı', emoji: '🎣', title: 'Sahte e-posta uyarısı',
    body: '"[Konu]" başlıklı e-postadaki bağlantıya tıklamayın, eki açmayın. Şüpheli e-postaları IT\'ye iletin.', requireAck: true, ackLabel: 'Anladım' },
  { id: 'it-sifre', category: 'it', kind: 'toast', name: 'Parola değişim hatırlatma', emoji: '🔑', title: 'Parolanızı yenileme zamanı',
    body: 'Domain parolanızın süresi [tarih] tarihinde doluyor. Ctrl+Alt+Del → Parola değiştir.' },
  { id: 'it-yeniden', category: 'it', kind: 'toast', name: 'Yeniden başlatma isteği', emoji: '🔄', title: 'Güncellemeler için bilgisayarınızı yeniden başlatın',
    body: 'Güvenlik güncellemelerinin tamamlanması için bugün mesai bitiminde bilgisayarınızı yeniden başlatın.' },

  // Genel
  { id: 'genel-duyuru', category: 'genel', kind: 'toast', name: 'Genel duyuru', emoji: '📢', title: '[Başlık]', body: '[Duyuru metni]' },
  { id: 'genel-logo', category: 'genel', kind: 'badge', name: 'Köşe rozeti (logo/görsel)', emoji: '🏢', title: '[Rozet adı]', body: '' },
];

export interface EmergencyTemplate {
  type: EmergencyType;
  label: string;
  emoji: string;
  color: string;
  title: string;
  body: string;
}

/** Önceden onaylı acil durum metinleri — acil anda yazı yazılmaz, butona basılır. */
export const EMERGENCY_TEMPLATES: EmergencyTemplate[] = [
  { type: 'yangin', label: 'Yangın', emoji: '🔥', color: '#d92d20', title: 'YANGIN — BİNAYI TAHLİYE EDİN',
    body: 'Asansör kullanmayın. En yakın acil çıkıştan çıkın ve toplanma alanına gidin. Toplanma alanında "Güvendeyim" butonuna basın.' },
  { type: 'deprem', label: 'Deprem', emoji: '🌍', color: '#b42318', title: 'DEPREM — ÇÖK, KAPAN, TUTUN',
    body: 'Sarsıntı bitene kadar masa altında kalın. Sarsıntı bitince merdivenleri kullanarak toplanma alanına gidin.' },
  { type: 'tahliye', label: 'Tahliye', emoji: '🚪', color: '#c4320a', title: 'ACİL TAHLİYE',
    body: 'Çalışmanızı bırakın, sakin şekilde en yakın çıkıştan binayı terk edin. Toplanma alanında yoklamaya katılın.' },
  { type: 'gaz', label: 'Gaz kaçağı', emoji: '💨', color: '#b54708', title: 'GAZ KAÇAĞI — ELEKTRİK ANAHTARLARINA DOKUNMAYIN',
    body: 'Kıvılcım çıkarabilecek hiçbir cihazı açıp kapatmayın. Pencereleri açın ve binayı terk edin.' },
  { type: 'kimyasal', label: 'Kimyasal sızıntı', emoji: '☣️', color: '#7a2e0e', title: 'KİMYASAL SIZINTI',
    body: 'Etkilenen alandan uzaklaşın, rüzgâr yönünün tersine hareket edin. İSG ekibinin talimatlarını bekleyin.' },
  { type: 'siber', label: 'Siber saldırı', emoji: '🛡️', color: '#1d2939', title: 'SİBER SALDIRI — AĞ KABLONUZU ÇIKARIN',
    body: 'Bilgisayarınızın ağ kablosunu çıkarın ve Wi-Fi bağlantısını kapatın. Bilgisayarı KAPATMAYIN. IT ekibinin talimatını bekleyin.' },
  { type: 'diger', label: 'Diğer', emoji: '🚨', color: '#d92d20', title: 'ACİL DURUM', body: '' },
];

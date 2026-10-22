# ErtePano — Kurum kurulum rehberi

Bu rehber bir kuruma ErtePano kurarken **kurumun IT ekibiyle birlikte** izlenecek adımlardır. Hedef: yarım günde, kurumun
güvenlik ve KVKK ekibinin de gönlü rahat olacak şekilde canlıya almak.

---

## 1. Kurumun içi rahat olsun diye — bir sayfada güvenceler

| Soru | Cevap |
|---|---|
| Veri nerede durur? | Yalnızca kurumun kendi sunucusunda. **İnternete hiçbir veri gönderilmez**; lisans çevrimdışı doğrulanır. |
| Çalışan bilgisayarlarından ne toplanır? | Bilgisayar adı, IP/MAC, oturumdaki kullanıcı adı, işletim sistemi, CPU/RAM/disk, açık kalma süresi. **Ekran görüntüsü, pencere başlığı, klavye/fare, tarayıcı geçmişi, dosya, kamera/mikrofon toplanmaz** — kodda yoktur. |
| Çalışanın ekranı izlenebilir mi? | **Hayır.** Ajanda ekran görüntüsü alma, uzaktan bağlanma ya da klavye/fare izleme yoktur. |
| Panel girişi ne kadar güvenli? | Active Directory ile tek oturum (LDAPS), yöneticilerde ve acil durum yetkililerinde **iki faktörlü doğrulama zorunlu**, kaba kuvvet sınırları, 2 saat hareketsizlikte oturum düşer. |
| Sahte "yangın" uyarısı gönderilebilir mi? | Ajanlar yalnızca sunucunun Ed25519 anahtarıyla imzalı uyarıyı gösterir; anahtar GPO ile sabitlenir. Acil durumu yalnızca İSG/yönetici başlatır, basılı tutarak onay ister, her biri kayıt altındadır. |
| Kim ne yaptı izlenebilir mi? | Her işlem **silinemez, zincirli** denetim kaydına yazılır; panelden bütünlük doğrulanabilir. |
| Yedek? | Sunucu her gün veritabanı + anahtarları yedekler (14 gün). Yedek klasörünü kurumun yedekleme sistemine ekleyin. |

---

## 2. Kurumdan istenecekler (kurulumdan önce)

### Sunucu
| Kalem | Değer |
|---|---|
| İşletim sistemi | Windows Server 2019/2022 (etki alanına üye) — ya da Linux |
| Kaynak | 2 vCPU, 4 GB RAM, 20 GB disk (3.000 bilgisayara kadar) |
| Yazılım | Node.js 20 LTS (çevrimdışı MSI). Başka bir şey gerekmez (veritabanı gömülüdür). |
| DNS | `pano.sirket.local` → sunucu IP'si |
| Sertifika | Kurumun iç CA'sından, SAN: `pano.sirket.local`, **.pfx** (özel anahtarlı) |

### Hesaplar
| Hesap | Kim oluşturur | Yetki | Not |
|---|---|---|---|
| `svc-ertepano` (AD) | Kurum AD yöneticisi — `deploy/ad/New-ErtePanoAdObjects.ps1` | **Hiçbir ayrıcalık yok**, yalnızca dizini okur | Parolası panelde şifreli saklanır; GPO ile etkileşimli oturum reddedilir |
| ErtePano-Yonetici / IT / ISG / IK / Izleyici (AD grupları) | Aynı betik | Panel rolleri | Kişiler bu gruplara eklenir; rol her girişte AD'den okunur |
| Sunucu hizmet hesabı | Kurulum betiği | `NT AUTHORITY\NETWORK SERVICE` (yerleşik, ayrıcalıksız) | Ek hesap açılmaz |
| `admin` (yerel, panel) | Sunucu ilk açılışta | Cam kırma hesabı: AD erişilemezse yönetici girebilsin | İlk girişte parola + 2FA zorunlu |
| GPO yöneticisi | Kurum | MSI ve ADMX dağıtımı | Mevcut yetkili kişi |

### Ağ
| Yön | Kaynak → Hedef | Port |
|---|---|---|
| Gelen | Çalışan VLAN'ları → ErtePano sunucusu | TCP 443 (HTTPS + WSS) |
| Giden | ErtePano sunucusu → Etki alanı denetleyicileri | TCP 636 (LDAPS) |
| İnternet | — | **Gerekmez** |

---

## 3. Kurulum (yaklaşık 2 saat)

1. **AD nesneleri (10 dk)** — AD yöneticisi bir DC'de:
   ```powershell
   .\deploy\ad\New-ErtePanoAdObjects.ps1
   ```
   Ekrana yazılan servis hesabı DN'ini ve parolasını not alın (bir kez gösterilir). Kişileri gruplara ekleyin.

2. **Sunucu (15 dk)** — sunucuda yönetici PowerShell:
   ```powershell
   .\deploy\server\Install-ErtePanoServer.ps1 -PublicUrl https://pano.sirket.local -PfxPath C:\certs\pano.pfx
   ```
   Betik dosyaları `C:\ErtePano`'ya kopyalar, HTTPS'i açar, NETWORK SERVICE ile otomatik başlayan görev kurar, veri klasörünü
   kilitler, güvenlik duvarında yalnızca etki alanı ağına 443'ü açar.

3. **Kurulum sihirbazı (20 dk)** — `https://pano.sirket.local/kurulum`
   - `admin` + `ILK-YONETICI-PAROLASI.txt` içindeki parola → parolayı değiştirin → telefonla 2FA kurun
   - Kurum adı
   - Güvenlik: 2FA'nın zorunlu olduğu roller (öneri: Yönetici, İSG, IT)
   - Active Directory: 1. adımdaki değerler → **Bağlantıyı dene** → **Kaydet**
   - Lisans dosyası (.lic) — yoksa 30 gün deneme
   - Ajan: kayıt anahtarı oluştur → değerleri kopyalayın
   - **Kontrol listesi**: tüm kalemler yeşil/mavi olana kadar düzeltin → *Kurulumu tamamla*

4. **Ajan dağıtımı (30 dk + bir yeniden başlatma)** — `deploy/gpo/README.md`
   - İmzalı MSI'ı paylaşıma koyun; GPO → Software Installation (Assigned)
   - `ErtePano.admx`'i Central Store'a kopyalayın; GPO'da sunucu adresi, kayıt anahtarı, imza anahtarı (ve OU başına lokasyon)
   - Önce **bir pilot OU** ile başlayın; Cihazlar → Onay bekleyen → toplu onay

5. **Kabul testi (15 dk)**
   - Pilot bilgisayara test duyurusu (yalnızca o cihaz) → ekranda göründü, "görüldü" panelde
   - Tatbikat modunda acil durum → yoklama sayıldı → sessizce bitir
   - Sistem & güvenlik → kontrol listesi yeşil; Denetim kaydı → *Bütünlüğü doğrula*

---

## 4. KVKK için kuruma bırakılacaklar

- **Aydınlatma metnine eklenecek madde (örnek):** "Bilgi güvenliği ve BT envanteri yönetimi amacıyla, şirket bilgisayarlarınızın
  adı, ağ adresi, oturum açan kullanıcı adı, işletim sistemi ve donanım kullanım bilgileri (işlemci, bellek, disk) meşru menfaat
  kapsamında işlenmekte ve 30 gün saklanmaktadır. Duyuru okundu/onay bilgileri 1 yıl, İSG zorunlu onay ve acil durum yoklama
  kayıtları 2 yıl saklanır. Ekran görüntüsü alınmaz."
- **VERBİS / veri işleme envanteri:** yukarıdaki kategoriler, saklama süreleri (Sistem → `RETENTION_*`), alıcı: kurum BT ve İSG birimleri.
- **Doğum günü kutlamaları:** yalnızca gün/ay; çalışan istemezse Takvim → kutlama kapatılır.
- **Ramak kala:** anonim gönderilebilir; anonim kayıtta kişi ve cihaz saklanmaz.

---

## 4.1 İsteğe bağlı: ajan sertifikası (mTLS)

Kurumun AD CS'si varsa ajanlar bilgisayar sertifikasıyla da doğrulanır (`deploy/gpo/README.md` → *mTLS*). Önce
`-Mtls optional` ile açın; Cihazlar → cihaz → *İstemci sertifikası* tüm bilgisayarlarda görünür olunca `-Mtls required`.
Zorunlu modda sertifikası olmayan, kurum CA'sı dışından ya da başka bilgisayara verilmiş sertifikayla gelen ajan bağlanamaz
ve denetim kaydına `device_cert_rejected` düşer. Panel (tarayıcı) etkilenmez. Sertifikanın bitişine 14 gün kala cihaz uyarı verir.

## 5. İşletim

| İş | Nerede |
|---|---|
| Güvenlik durumu | Sistem & güvenlik → kontrol listesi |
| Yedek | `C:\ErtePano\data\backups` (günlük). Geri yükleme: hizmeti durdur → `ertepano.db` ve `keys` klasörünü `data`'ya kopyala → başlat |
| Güncelleme | Yeni sürüm klasöründen `Install-ErtePanoServer.ps1`'i aynı parametrelerle yeniden çalıştırın (veri korunur) |
| Kaldırma | `Install-ErtePanoServer.ps1 -Uninstall` (veri silinmez) |
| Sorun | Görev Zamanlayıcı → "ErtePano Sunucu" geçmişi; panel → Denetim kaydı |

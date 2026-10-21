# ErtePano Ajan — Grup İlkesi (GPO) ile dağıtım

Bu klasör: yönetim şablonu (`ErtePano.admx` + `tr-TR`/`en-US` dil dosyaları), istemci denetim betiği ve etki alanı
olmadan tek makinede GPO'yu taklit eden test betikleri.

Kurulan bileşenler (MSI):

| Dosya | Ne |
|---|---|
| `%ProgramFiles%\ErtePano\ertepano-service.exe` | Windows hizmeti **ErtePanoAgent** (LocalSystem, otomatik, çökerse 10 sn sonra yeniden başlar). Sunucu bağlantısı, telemetri, imza doğrulama. |
| `%ProgramFiles%\ErtePano\ertepano_agent.exe` | Kullanıcı arayüzü. Hizmet her oturum açılışında başlatır; kapatılırsa ≤10 sn içinde yeniden açar. |
| `%ProgramData%\ErtePano\service\` | Cihaz kimliği, önbellek, `service.log` — yalnız SYSTEM + Yöneticiler erişir. |

## 1. Hazırlık

1. **MSI'ı üretin ve imzalayın** — `apps/agent/scripts/build-msi.ps1` (bkz. `apps/agent/README.md`).
   Üretimde kurumsal PKI'dan (AD CS "Code Signing") ya da ticari CA'dan kod imzalama sertifikası kullanın.
2. **Paylaşıma koyun:** `\\dosya-sunucusu\Yazilim$\ErtePano\ErtePano-Ajan-0.2.0-x64.msi`
   Paylaşım + NTFS izni: **Domain Computers → Okuma** (GPO yazılım kurulumu bilgisayar hesabıyla, oturum açılmadan çalışır).
   Yolu her zaman UNC olarak verin (`\\…`), sürücü harfiyle değil.
3. **Yönetim şablonunu Central Store'a kopyalayın:**
   ```
   ErtePano.admx        → \\<etki-alanı>\SYSVOL\<etki-alanı>\Policies\PolicyDefinitions\
   tr-TR\ErtePano.adml  → …\PolicyDefinitions\tr-TR\
   en-US\ErtePano.adml  → …\PolicyDefinitions\en-US\
   ```
4. **Panelden kayıt anahtarı ve genel anahtar** — Panel → *Ajan kurulumu*. Toplu dağıtımda "otomatik onay" açık anahtar
   kullanabilir ya da cihazları sonra *Cihazlar → Onay bekleyen* sekmesinden topluca onaylayabilirsiniz.

## 2. GPO

*Group Policy Management* → hedef OU'ya (ör. `Bilgisayarlar\Gebze`) yeni GPO bağlayın: **ErtePano Ajan – Gebze**.

**Computer Configuration → Policies → Software Settings → Software installation**
- *New → Package…* → UNC yolundaki MSI → **Assigned**.
- Yeni sürüm: yeni MSI'ı aynı GPO'ya ekleyin → *Properties → Upgrades → Add* → eski paket →
  **"Package can upgrade over the existing package"** (MSI kendi `MajorUpgrade` kuralıyla eskisini kaldırır).
  Ayarlar ve cihaz kimliği korunur; hizmet durunca arayüzler kapanır, böylece dosyalar kilitli kalmaz.

**Computer Configuration → Policies → Administrative Templates → ErtePano Ajan**

| İlke | Değer | Not |
|---|---|---|
| Sunucu adresi | `https://pano.sirket.local` | Zorunlu |
| Kayıt anahtarı | `EK-XXXX-XXXX-XXXX` | Zorunlu (yalnızca ilk kayıtta kullanılır) |
| Sunucu imza anahtarı | panel → agent.json → `publicKey` | **Üretimde zorunlu** — sahte duyuru/acil durumu engeller |
| Lokasyon | `Gebze Fabrika` | OU başına; cihaz ilk kayıtta etiketlenir, acil durum yoklaması lokasyon bazlı görünür |
| Departman | `Üretim` | İsteğe bağlı |

İlke değerleri `HKLM\SOFTWARE\Policies\ErtePano` altına yazılır ve MSI özelliklerini / `agent.json`'ı ezer.
Hizmet yapılandırma bulamazsa dakikada bir yeniden dener — ilke yazılımdan sonra gelse de sorun olmaz.

**Test sertifikası kullanıyorsanız** (yalnız test OU'sunda):
*Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies*
- **Trusted Root Certification Authorities** → *Import* → `apps/agent/certs/test-codesign.cer`
- **Trusted Publishers** → *Import* → aynı dosya

Ağ ve güvenlik duvarı: istemciden sunucuya yalnız HTTPS/WSS (443 ya da yapılandırdığınız port) yeterlidir; istemcide
gelen bağlantı portu açılmaz. Antivirüs/EDR: `%ProgramFiles%\ErtePano\*.exe` imzalı yayımcı olarak izin listesine.

## 3. İstemcide doğrulama

```powershell
gpupdate /force          # yazılım kurulumu için çoğu zaman yeniden başlatma gerekir
shutdown /r /t 0
```
Açılıştan sonra:
```powershell
powershell -ExecutionPolicy Bypass -File \\…\ErtePano\Test-ErtePanoClient.ps1
gpresult /r /scope computer          # GPO uygulandı mı?
```
Panelde cihaz *Cihazlar* sayfasında görünür (lokasyonuyla); yalnızca o cihaza bir test kartı gönderin
(*Yeni duyuru* → hedefte cihaz) ve kullanıcının ekranında göründüğünü, okunma raporunda "gördü" düştüğünü kontrol edin.

## 4. Sorun giderme

| Belirti | Bakılacak yer |
|---|---|
| MSI kurulmadı | *Olay Görüntüleyicisi → Windows Günlükleri → Uygulama*, kaynak **Application Management** ve **MsiInstaller**; paylaşım izinleri (Domain Computers) |
| Kurulumu elle deneme | `msiexec /i \\…\ErtePano-Ajan-0.2.0-x64.msi /qn /l*v %TEMP%\ertepano.log` |
| Hizmet çalışmıyor | `sc query ErtePanoAgent`, `%ProgramData%\ErtePano\service\service.log` |
| "Yapılandırma bulunamadı" | `reg query HKLM\SOFTWARE\Policies\ErtePano` — GPO yönetim şablonu bağlı mı? |
| "Kayıt anahtarı geçersiz" | Panelde anahtar iptal edilmiş olabilir → yenisini ilkeyle dağıtın |
| Duyurular görünmüyor | Cihaz onaylı mı (*Cihazlar*)? `service.log`'da "duyuru reddedildi: imza geçersiz" → ilkedeki genel anahtar sunucununkiyle aynı mı? |
| Arayüz açılmıyor | WebView2 Runtime kurulu mu (Windows 10 21H2+/11'de hazır); `%APPDATA%\ErtePano\agent.log` |

## 5. Etki alanı olmadan test (tek bilgisayar)

Yönetici PowerShell'de:
```powershell
cd deploy\gpo
.\Simulate-GpoInstall.ps1 -Msi ..\..\apps\agent\dist\ErtePano-Ajan-0.2.0-x64.msi `
  -ServerUrl http://<sunucu>:4100 -EnrollKey EK-XXXX-XXXX-XXXX -PublicKey '<base64>' -Location 'Test'
# … dene …
.\Simulate-GpoUninstall.ps1
```
`Simulate-GpoInstall.ps1`, GPO'nun yaptığı gibi önce ilke değerlerini yazar, sonra MSI'ı sessiz kurar ve
`Test-ErtePanoClient.ps1` ile sonucu denetler.

### MSI özellikleriyle kurulum (GPO dışı: SCCM, Intune, elle)
```
msiexec /i ErtePano-Ajan-0.2.0-x64.msi /qn SERVERURL=https://pano.sirket.local ENROLLKEY=EK-XXXX-XXXX-XXXX PUBLICKEY=<base64> LOCATION="Gebze Fabrika"
```
Değerler `HKLM\SOFTWARE\ErtePano` altına yazılır; sonraki yükseltmelerde tekrar verilmesi gerekmez.

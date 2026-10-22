<#
.SYNOPSIS
  Bilgisayarın kurum CA'sından aldığı istemci sertifikasını ErtePano Ajanına tanıtır (mTLS).

.DESCRIPTION
  GPO → Bilgisayar Yapılandırması → Windows Ayarları → Komut Dosyaları → Başlangıç olarak çalıştırılır (SYSTEM).
  - Cert:\LocalMachine\My içinde bu bilgisayarın adına (CN ya da DNS SAN) verilmiş, "İstemci Kimlik Doğrulaması"
    amaçlı, süresi geçmemiş ve özel anahtarı olan en yeni sertifikayı bulur (AD CS otomatik kayıt).
  - Rastgele parolayla %ProgramData%\ErtePano\service\client.pfx olarak dışa aktarır; parola yanındaki
    client.pfx.password dosyasına yazılır. Klasör yalnızca SYSTEM ve Yöneticilere açıktır (hizmet bunu zorlar).
  - Sertifika değişmediyse hiçbir şey yapmaz; değiştiyse ajan hizmetini yeniden başlatır.
  Gereksinim: sertifika şablonunda "Özel anahtarın dışa aktarılmasına izin ver" açık olmalı (ör. "ErtePano Bilgisayar"
  şablonu, Computer şablonunun kopyası; Konu adı: DNS adı).

.EXAMPLE
  .\Install-ErtePanoClientCert.ps1
  .\Install-ErtePanoClientCert.ps1 -Template "ErtePano Bilgisayar"
#>
[CmdletBinding()]
param(
  # Yalnızca bu şablondan verilmiş sertifikalar (boşsa amaç ve ad yeterli)
  [string]$Template
)
$ErrorActionPreference = 'Stop'
$ClientAuth = '1.3.6.1.5.5.7.3.2'
$dir = Join-Path $env:ProgramData 'ErtePano\service'
$pfx = Join-Path $dir 'client.pfx'
$passFile = Join-Path $dir 'client.pfx.password'
$stamp = Join-Path $dir 'client.pfx.thumbprint'
$name = $env:COMPUTERNAME.ToLowerInvariant()

function HostOf([System.Security.Cryptography.X509Certificates.X509Certificate2]$c) {
  $dns = $c.DnsNameList | Select-Object -First 1
  $n = if ($dns) { $dns.Unicode } else { $c.GetNameInfo('SimpleName', $false) }
  if ($n) { $n.ToLowerInvariant().Split('.')[0] }
}

$now = Get-Date
$cert = Get-ChildItem Cert:\LocalMachine\My |
  Where-Object {
    $_.HasPrivateKey -and $_.NotAfter -gt $now -and $_.NotBefore -le $now -and
    ($_.EnhancedKeyUsageList.ObjectId -contains $ClientAuth) -and (HostOf $_) -eq $name -and
    (-not $Template -or ($_.Extensions | Where-Object { $_.Oid.Value -in '1.3.6.1.4.1.311.21.7', '1.3.6.1.4.1.311.20.2' } |
      ForEach-Object { $_.Format($false) }) -match [regex]::Escape($Template))
  } |
  Sort-Object NotAfter -Descending | Select-Object -First 1

if (-not $cert) {
  Write-Warning "Bu bilgisayar ($name) için istemci kimlik doğrulama sertifikası bulunamadı. AD CS otomatik kaydını ve şablonu kontrol edin."
  exit 1
}
if ((Test-Path $pfx) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $cert.Thumbprint)) {
  Write-Host "Sertifika güncel: $($cert.Subject) (bitiş $($cert.NotAfter.ToString('yyyy-MM-dd')))"
  exit 0
}

New-Item -ItemType Directory -Force $dir | Out-Null
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$plain = [Convert]::ToBase64String($bytes)
$secure = ConvertTo-SecureString $plain -AsPlainText -Force
try {
  Export-PfxCertificate -Cert $cert -FilePath "$pfx.tmp" -Password $secure -ChainOption EndEntityCertOnly | Out-Null
} catch {
  Write-Warning "Sertifika dışa aktarılamadı (şablonda özel anahtar dışa aktarımı kapalı olabilir): $_"
  exit 2
}
Set-Content -Path "$passFile.tmp" -Value $plain -NoNewline -Encoding ASCII
foreach ($f in "$pfx.tmp", "$passFile.tmp") {
  icacls $f /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
}
Move-Item -Force "$pfx.tmp" $pfx
Move-Item -Force "$passFile.tmp" $passFile
Set-Content -Path $stamp -Value $cert.Thumbprint -Encoding ASCII
Write-Host "İstemci sertifikası kuruldu: $($cert.Subject) (bitiş $($cert.NotAfter.ToString('yyyy-MM-dd')))"

if (Get-Service ErtePanoAgent -ErrorAction SilentlyContinue) {
  Restart-Service ErtePanoAgent -Force
  Write-Host 'ErtePano Ajan hizmeti yeniden başlatıldı.'
}

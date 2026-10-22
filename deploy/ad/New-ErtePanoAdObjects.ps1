<#
.SYNOPSIS
  ErtePano için Active Directory nesnelerini oluşturur: rol grupları ve salt-okur servis hesabı.

.DESCRIPTION
  Kurumun AD yöneticisi bir kez çalıştırır (Domain Admins ya da OU'da yetkili hesap, RSAT ActiveDirectory modülü).
  - OU: ErtePano (isteğe bağlı, -OuPath ile var olan OU verilebilir)
  - Gruplar: ErtePano-Yonetici, ErtePano-IT, ErtePano-ISG, ErtePano-IK, ErtePano-Izleyici (Global Security)
  - Servis hesabı: svc-ertepano — HİÇBİR ayrıcalıklı gruba üye değil; yalnızca dizini okur (Domain Users varsayılan okuma hakkı yeter)
  Betik parola üretir ve YALNIZCA EKRANA bir kez yazar; kurulum sihirbazındaki Active Directory adımına girilir.
  Hiçbir şeyi silmez; var olan nesneyi atlar.

.EXAMPLE
  .\New-ErtePanoAdObjects.ps1
  .\New-ErtePanoAdObjects.ps1 -OuPath "OU=Uygulamalar,DC=sirket,DC=local" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$OuPath,
  [string]$ServiceAccount = 'svc-ertepano'
)
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$domain = Get-ADDomain
if (-not $OuPath) {
  $OuPath = "OU=ErtePano,$($domain.DistinguishedName)"
  if (-not (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$OuPath'" -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess($OuPath, 'OU oluştur')) {
      New-ADOrganizationalUnit -Name 'ErtePano' -Path $domain.DistinguishedName -ProtectedFromAccidentalDeletion $true
      Write-Host "OU oluşturuldu: $OuPath" -ForegroundColor Green
    }
  }
}

$groups = [ordered]@{
  'ErtePano-Yonetici' = 'ErtePano: tüm ayarlar, kullanıcılar, lisans (en az kişi)'
  'ErtePano-IT'       = 'ErtePano: cihazlar, ajan kurulumu, IT duyuruları, uzaktan destek, siber olay'
  'ErtePano-ISG'      = 'ErtePano: İSG duyuruları, acil durum, tatbikat, ramak kala'
  'ErtePano-IK'       = 'ErtePano: İK duyuruları, anketler, kutlamalar'
  'ErtePano-Izleyici' = 'ErtePano: yalnızca görüntüleme'
}
foreach ($g in $groups.Keys) {
  if (Get-ADGroup -Filter "Name -eq '$g'" -ErrorAction SilentlyContinue) { Write-Host "Var: $g"; continue }
  if ($PSCmdlet.ShouldProcess($g, 'Grup oluştur')) {
    New-ADGroup -Name $g -GroupScope Global -GroupCategory Security -Path $OuPath -Description $groups[$g]
    Write-Host "Grup oluşturuldu: $g" -ForegroundColor Green
  }
}

$existing = Get-ADUser -Filter "SamAccountName -eq '$ServiceAccount'" -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Servis hesabı zaten var: $($existing.DistinguishedName) — parolasını AD'den sıfırlayıp sihirbaza girin." -ForegroundColor Yellow
} elseif ($PSCmdlet.ShouldProcess($ServiceAccount, 'Servis hesabı oluştur')) {
  # 32 karakter, karışık — ekrana bir kez yazılır, hiçbir yere kaydedilmez
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+=?'
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $plain = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  New-ADUser -Name $ServiceAccount -SamAccountName $ServiceAccount -UserPrincipalName "$ServiceAccount@$($domain.DNSRoot)" `
    -Path $OuPath -Description 'ErtePano LDAP okuma hesabı (etkileşimli oturum açmaz)' `
    -AccountPassword (ConvertTo-SecureString $plain -AsPlainText -Force) -Enabled $true `
    -CannotChangePassword $true -PasswordNeverExpires $true
  $dn = (Get-ADUser $ServiceAccount).DistinguishedName
  Write-Host ''
  Write-Host '=== Kurulum sihirbazı → Active Directory adımına girin ===' -ForegroundColor Cyan
  Write-Host "Etki alanı denetleyicisi : ldaps://$((Get-ADDomainController).HostName):636"
  Write-Host "Temel DN                 : $($domain.DistinguishedName)"
  Write-Host "Servis hesabı            : $dn"
  Write-Host "Parola                   : $plain"
  Write-Host 'Bu parola bir daha gösterilmez. Panel onu şifreli saklar.' -ForegroundColor Yellow
  Write-Host 'Öneri: GPO ile bu hesaba "Yerel olarak oturum açmayı reddet" ve "Uzak masaüstü ile oturum açmayı reddet" atayın.'
}

Write-Host ''
Write-Host 'Sonraki adım: kişileri gruplara ekleyin, örn.:' -ForegroundColor Cyan
Write-Host "  Add-ADGroupMember ErtePano-IK -Members ayse.demir"

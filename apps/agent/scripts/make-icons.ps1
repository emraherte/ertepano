# Yer tutucu (placeholder) ikonları üretir: teal yuvarlak kare + "P" harfi.
# Kullanım: powershell -ExecutionPolicy Bypass -File apps\agent\scripts\make-icons.ps1
# Gerçek marka ikonu hazır olduğunda `npx @tauri-apps/cli icon logo.png` ile değiştirilmelidir.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\src-tauri\icons"
New-Item -ItemType Directory -Force $out | Out-Null

function New-IconPng([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    $r = [int]($size * 0.22)
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $m = [int]($size * 0.04)
    $w = $size - 2 * $m
    $gp.AddArc($m, $m, $d, $d, 180, 90)
    $gp.AddArc($m + $w - $d, $m, $d, $d, 270, 90)
    $gp.AddArc($m + $w - $d, $m + $w - $d, $d, $d, 0, 90)
    $gp.AddArc($m, $m + $w - $d, $d, $d, 90, 90)
    $gp.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $size, $size), ([System.Drawing.Color]::FromArgb(255, 20, 184, 166)), ([System.Drawing.Color]::FromArgb(255, 15, 118, 110))
    $g.FillPath($brush, $gp)
    $font = New-Object System.Drawing.Font "Segoe UI", ([float]($size * 0.52)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
    $g.DrawString("P", $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, ([float]($size * 0.02)), $size, $size), $sf)
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

New-IconPng 32 (Join-Path $out "32x32.png")
New-IconPng 128 (Join-Path $out "128x128.png")
New-IconPng 256 (Join-Path $out "128x128@2x.png")
New-IconPng 512 (Join-Path $out "icon.png")

# ICO: PNG gömülü girişler (16, 32, 48, 256)
$sizes = 16, 32, 48, 256
$pngs = @()
foreach ($s in $sizes) {
    $tmp = Join-Path $env:TEMP "ertepano-ico-$s.png"
    New-IconPng $s $tmp
    $pngs += , [System.IO.File]::ReadAllBytes($tmp)
    Remove-Item $tmp
}
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $pngs[$i].Length
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
    $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out "icon.ico"), $ms.ToArray())
"ikonlar üretildi: $out"

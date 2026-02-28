param(
  [string]$LogoUrl = "https://cdn.apifox.com/app/project-icon/custom/20231116/e416b172-004f-452f-8090-8e85991f422c.png",
  [string]$ResDir = "android/app/src/main/res"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$tmp = Join-Path $ResDir "tmp_rainyun_logo.png"
Invoke-WebRequest -Uri $LogoUrl -OutFile $tmp
$src = [System.Drawing.Image]::FromFile($tmp)

function New-Bitmap([int]$size, [bool]$transparent = $true) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($transparent) { $g.Clear([System.Drawing.Color]::Transparent) } else { $g.Clear([System.Drawing.Color]::White) }
  return @{ bmp = $bmp; g = $g }
}

function Save-Legacy([int]$size, [string]$path, [bool]$round = $false) {
  $obj = New-Bitmap -size $size -transparent $false
  $bmp = $obj.bmp
  $g = $obj.g
  if ($round) {
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddEllipse(0, 0, $size, $size)
    $g.SetClip($clip)
  }
  $padding = [int][Math]::Round($size * 0.1)
  $wh = $size - 2 * $padding
  $draw = New-Object System.Drawing.Rectangle($padding, $padding, $wh, $wh)
  $g.DrawImage($src, $draw)
  if ($round) { $g.ResetClip() }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Save-Adaptive([int]$size, [string]$path) {
  $obj = New-Bitmap -size $size -transparent $true
  $bmp = $obj.bmp
  $g = $obj.g
  $padding = [int][Math]::Round($size * 0.18)
  $wh = $size - 2 * $padding
  $draw = New-Object System.Drawing.Rectangle($padding, $padding, $wh, $wh)
  $g.DrawImage($src, $draw)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

$legacy = @{
  "mipmap-mdpi" = 48
  "mipmap-hdpi" = 72
  "mipmap-xhdpi" = 96
  "mipmap-xxhdpi" = 144
  "mipmap-xxxhdpi" = 192
}
$adaptive = @{
  "mipmap-mdpi" = 108
  "mipmap-hdpi" = 162
  "mipmap-xhdpi" = 216
  "mipmap-xxhdpi" = 324
  "mipmap-xxxhdpi" = 432
}

foreach ($pair in $legacy.GetEnumerator()) {
  $dir = Join-Path $ResDir $pair.Key
  Save-Legacy -size ([int]$pair.Value) -path (Join-Path $dir "ic_launcher.png") -round:$false
  Save-Legacy -size ([int]$pair.Value) -path (Join-Path $dir "ic_launcher_round.png") -round:$true
}
foreach ($pair in $adaptive.GetEnumerator()) {
  $dir = Join-Path $ResDir $pair.Key
  Save-Adaptive -size ([int]$pair.Value) -path (Join-Path $dir "ic_launcher_foreground.png")
}

$src.Dispose()
Remove-Item $tmp -Force
Write-Output "Android launcher icons regenerated from RainYun logo."

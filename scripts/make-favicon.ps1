# Builds server/public/assets/favicon.png from app_icon.png.
# The source has painted black corners, so the tile is cropped and given a transparent rounded mask.
# Run from the repository root:  powershell -ExecutionPolicy Bypass -File scripts\make-favicon.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'app_icon.png'
$target = Join-Path $root 'server\public\assets\favicon.png'
$size = 64
# Tile bounds measured in the 1254 px source (x 119..1132).
$crop = New-Object System.Drawing.Rectangle 119, 119, 1013, 1013

$img = [System.Drawing.Image]::FromFile($source)
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'

$r = [int]($size * 0.23)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
$path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
$path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
$path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
$path.CloseFigure()
$g.SetClip($path)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), $crop, [System.Drawing.GraphicsUnit]::Pixel)

$bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
Write-Output "Wrote $target ($((Get-Item $target).Length) bytes)"

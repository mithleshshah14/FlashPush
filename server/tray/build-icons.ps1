# Regenerates the three tray icons (flashpush-running/degraded/stopped.ico) next to this script.
# Run from the repository: powershell -NoProfile -File server\tray\build-icons.ps1
# The full app icon turns to mush at 16 px, so the tray uses a simplified glyph (see glyph.svg):
# two arrows circling a dot, drawn at 16/24/32/48/256 px and stored as PNG-compressed .ico entries.
Add-Type -AssemblyName System.Drawing

$sizes = 16, 24, 32, 48, 256
$tints = @{
    running  = @{ Arrows = '#1CA2FD'; Dot = '#16F9CB' }
    degraded = @{ Arrows = '#F5A524'; Dot = '#F5A524' }
    stopped  = @{ Arrows = '#8B93A7'; Dot = '#8B93A7' }
}

function New-Glyph([int]$Size, [string]$ArrowColor, [string]$DotColor) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $center = $Size / 2.0
    $radius = 0.36 * $Size
    $arrow = [System.Drawing.ColorTranslator]::FromHtml($ArrowColor)
    $pen = New-Object System.Drawing.Pen $arrow, ([Math]::Max(1.6, 0.1 * $Size))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $brush = New-Object System.Drawing.SolidBrush $arrow
    $box = New-Object System.Drawing.RectangleF ($center - $radius), ($center - $radius), (2 * $radius), (2 * $radius)

    # Two clockwise arcs (GDI+ angles run clockwise), each ending in an arrowhead.
    foreach ($start in 200, 20) {
        $sweep = 130
        $g.DrawArc($pen, $box, $start, $sweep)
        $theta = ($start + $sweep) * [Math]::PI / 180
        $tipLength = 0.16 * $Size
        $half = 0.11 * $Size
        $px = $center + $radius * [Math]::Cos($theta)
        $py = $center + $radius * [Math]::Sin($theta)
        $tx = -[Math]::Sin($theta); $ty = [Math]::Cos($theta)      # direction of travel
        $nx = [Math]::Cos($theta);  $ny = [Math]::Sin($theta)      # across the arc
        $points = [System.Drawing.PointF[]]@(
            (New-Object System.Drawing.PointF ($px + $tx * $tipLength), ($py + $ty * $tipLength)),
            (New-Object System.Drawing.PointF ($px + $nx * $half), ($py + $ny * $half)),
            (New-Object System.Drawing.PointF ($px - $nx * $half), ($py - $ny * $half))
        )
        $g.FillPolygon($brush, $points)
    }

    $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($DotColor))
    $dotRadius = 0.09 * $Size
    $g.FillEllipse($dot, ($center - $dotRadius), ($center - $dotRadius), (2 * $dotRadius), (2 * $dotRadius))
    $g.Dispose()
    return $bitmap
}

function Write-Ico([string]$Path, [byte[][]]$Images, [int[]]$ImageSizes) {
    $stream = [System.IO.File]::Create($Path)
    $writer = New-Object System.IO.BinaryWriter $stream
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$Images.Count)
    $offset = 6 + 16 * $Images.Count
    for ($i = 0; $i -lt $Images.Count; $i++) {
        $dimension = if ($ImageSizes[$i] -ge 256) { 0 } else { $ImageSizes[$i] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$Images[$i].Length); $writer.Write([uint32]$offset)
        $offset += $Images[$i].Length
    }
    foreach ($image in $Images) { $writer.Write($image) }
    $writer.Dispose()
    $stream.Dispose()
}

foreach ($name in $tints.Keys) {
    $pngs = New-Object 'System.Collections.Generic.List[byte[]]'
    foreach ($size in $sizes) {
        $bitmap = New-Glyph $size $tints[$name].Arrows $tints[$name].Dot
        $memory = New-Object System.IO.MemoryStream
        $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngs.Add($memory.ToArray())
        $bitmap.Dispose(); $memory.Dispose()
    }
    $target = Join-Path $PSScriptRoot "flashpush-$name.ico"
    Write-Ico $target $pngs.ToArray() $sizes
    Write-Output "Wrote $target"
}

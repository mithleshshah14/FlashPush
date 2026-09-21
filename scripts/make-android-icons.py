"""Builds the Android launcher icons from app_icon.png (the brand artwork). Needs Pillow: pip install pillow.

Run from the repository root:   python scripts/make-android-icons.py

Writes into app/android/app/src/main/res:
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png             rounded tile, for Android older than 8
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png  adaptive-icon foreground (art inside the safe zone)
  mipmap-anydpi-v26/ic_launcher.xml                       the adaptive icon
  drawable/ic_launcher_background.xml                     navy gradient behind the foreground

app_icon.png has painted black corners, so the tile is cropped and given transparent rounded corners.
Pure image processing: no scripts are executed and nothing outside the repository is touched.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'app_icon.png'
RES = ROOT / 'app' / 'android' / 'app' / 'src' / 'main' / 'res'

# Measured in the 1254 px source: the navy tile spans x and y 119..1132.
TILE = (119, 119, 1133, 1133)
CORNER = 0.23  # tile corner radius as a fraction of its width
# The artwork (phone, arrows, laptop) spans about x 215..1075, y 285..930 inside the tile.
ART_HALF_DIAGONAL = 537  # px in the source: distance from the tile centre to the art's far corners

LEGACY_SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
ADAPTIVE_SIZES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
SAFE_RADIUS_DP = 38  # the launcher mask always shows at least a 66 dp circle of the 108 dp canvas
KEY_LOW, KEY_HIGH = 95, 175  # brightness range over which the navy background turns into the artwork

BACKGROUND_XML = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient
        android:angle="300"
        android:startColor="#112B58"
        android:endColor="#030C1E"
        android:type="linear" />
</shape>
"""

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""


def rounded_mask(size, radius, scale=4):
    """An anti-aliased rounded-rectangle mask (drawn large, then reduced)."""
    big = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=radius * scale, fill=255)
    return big.resize((size, size), Image.LANCZOS)


def legacy_icon(source, size):
    tile = source.crop(TILE).convert('RGBA').resize((size, size), Image.LANCZOS)
    tile.putalpha(rounded_mask(size, round(size * CORNER)))
    return tile


def adaptive_foreground(source, size):
    """The tile art on a transparent canvas, small enough for the safe zone, with softly faded edges."""
    cx = cy = (TILE[0] + TILE[2]) // 2
    half = 490  # crop a little inside the tile so the rim and the black corners fall outside
    crop = source.crop((cx - half, cy - half, cx + half, cy + half)).convert('RGBA')

    # Remove the tile's navy so only the artwork stays: the brightest channel of the background is at most
    # about 90, the artwork and its glow are brighter. The glow keeps partial transparency.
    red, green, blue, _ = crop.split()
    peak = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    keyed = peak.point(lambda v: 0 if v <= KEY_LOW else min(255, (v - KEY_LOW) * 255 // (KEY_HIGH - KEY_LOW)))

    # Also fade the crop out near its edges (rim of the tile, black corners) before it meets the gradient.
    inner = Image.new('L', crop.size, 0)
    margin = 60
    ImageDraw.Draw(inner).rounded_rectangle((margin, margin, crop.width - margin, crop.height - margin), radius=170, fill=255)
    crop.putalpha(ImageChops.multiply(keyed, inner.filter(ImageFilter.GaussianBlur(28))))

    # Scale so the art's far corners land on the safe-zone circle.
    scale = (SAFE_RADIUS_DP / 108 * size) / ART_HALF_DIAGONAL
    side = round(crop.width * scale)
    crop = crop.resize((side, side), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(crop, ((size - side) // 2, (size - side) // 2), crop)
    return canvas


def preview(source, path):
    """A composite of the adaptive icon under three launcher masks, for eyeballing (docs/design/implemented)."""
    size = 432
    gradient = Image.new('RGBA', (size, size))
    top, bottom = (0x11, 0x2B, 0x58), (0x03, 0x0C, 0x1E)
    for y in range(size):
        t = y / (size - 1)
        gradient.paste(tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,), (0, y, size, y + 1))
    icon = Image.alpha_composite(gradient, adaptive_foreground(source, size))
    sheet = Image.new('RGBA', (size * 3 + 80, size + 40), (235, 238, 245, 255))
    shapes = [
        Image.new('L', (size, size), 0),
        Image.new('L', (size, size), 0),
        Image.new('L', (size, size), 0),
    ]
    ImageDraw.Draw(shapes[0]).ellipse((size * 0.083, size * 0.083, size * 0.917, size * 0.917), fill=255)  # circle, 72/108
    shapes[1] = rounded_mask(size, round(size * 0.22))                                                      # rounded square
    ImageDraw.Draw(shapes[2]).rounded_rectangle((size * 0.083, size * 0.083, size * 0.917, size * 0.917), radius=size * 0.28, fill=255)  # squircle-ish
    for i, mask in enumerate(shapes):
        sheet.paste(icon, (20 + i * (size + 20), 20), ImageChops.multiply(icon.getchannel('A'), mask))
    sheet.convert('RGB').save(path)


def main():
    source = Image.open(SOURCE).convert('RGB')
    for density, size in LEGACY_SIZES.items():
        target = RES / f'mipmap-{density}'
        target.mkdir(parents=True, exist_ok=True)
        legacy_icon(source, size).save(target / 'ic_launcher.png', optimize=True)
    for density, size in ADAPTIVE_SIZES.items():
        adaptive_foreground(source, size).save(RES / f'mipmap-{density}' / 'ic_launcher_foreground.png', optimize=True)
    (RES / 'mipmap-anydpi-v26').mkdir(parents=True, exist_ok=True)
    (RES / 'mipmap-anydpi-v26' / 'ic_launcher.xml').write_text(ADAPTIVE_XML, encoding='utf-8')
    (RES / 'drawable' / 'ic_launcher_background.xml').write_text(BACKGROUND_XML, encoding='utf-8')
    out = ROOT / 'docs' / 'design' / 'implemented'
    out.mkdir(parents=True, exist_ok=True)
    preview(source, out / 'android-launcher-icon.png')
    print('launcher icons written; preview: docs/design/implemented/android-launcher-icon.png')


if __name__ == '__main__':
    main()

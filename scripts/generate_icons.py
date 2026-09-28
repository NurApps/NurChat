"""Генерация растровых иконок NurChat из единой плоской геометрии.

Знак: сплошной баббл + буква N (та же геометрия, что в Logo.tsx,
frontend/public/favicon.svg, assets/logo/*.svg). Никаких градиентов.

Вариант A (transparent): синий баббл + белая N на прозрачном фоне —
  оконные/трей иконки Tauri, logo.png.
Вариант B (tile): белый баббл + синяя N на сплошном синем фоне —
  Windows-тайлы, apple-touch-icon, PWA, store, mobile.

Запуск: .venv\\Scripts\\python.exe scripts/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = (42, 171, 238, 255)
WHITE = (255, 255, 255, 255)

# Геометрия знака в сетке 64x64 (как в SVG).
BUBBLE_BOX = (6, 6, 58, 49)  # rounded rect
BUBBLE_RADIUS = 11
TAIL = [(30, 46), (19, 60), (35, 46)]
N_LINES = [((24, 20), (24, 44)), ((24, 20), (40, 44)), ((40, 44), (40, 20))]
N_WIDTH = 5.5


def draw_mark(draw: ImageDraw.ImageDraw, scale: float, bubble, n_color) -> None:
    def s(v: float) -> float:
        return v * scale
    x0, y0, x1, y1 = (s(v) for v in BUBBLE_BOX)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=s(BUBBLE_RADIUS), fill=bubble)
    draw.polygon([(s(x), s(y)) for x, y in TAIL], fill=bubble)
    for (ax, ay), (bx, by) in N_LINES:
        draw.line([s(ax), s(ay), s(bx), s(by)], fill=n_color, width=max(1, int(round(s(N_WIDTH)))), joint="curve")


_RESAMPLE = Image.Resampling.LANCZOS


def variant_a(size: int) -> Image.Image:
    """Синий знак на прозрачном фоне."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(ImageDraw.Draw(img), size / 64, BLUE, WHITE)
    return img


def variant_b(size: int, pad_ratio: float = 0.0) -> Image.Image:
    """Белый знак на сплошном синем фоне (для тайлов/маскируемых иконок).

    pad_ratio — отступ знака от краёв в долях стороны (0.12 для maskable safe zone).
    """
    img = Image.new("RGBA", (size, size), BLUE)
    d = ImageDraw.Draw(img)
    if pad_ratio:
        pad = int(size * pad_ratio)
        # рисуем знак в уменьшенном боксе через временный слой
        inner = int(size - 2 * pad)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_mark(ImageDraw.Draw(layer), size / 64, WHITE, BLUE)
        # сжимаем слой к inner и центрируем
        small = layer.resize((inner, inner), _RESAMPLE)
        img.paste(small, (pad, pad), small)
    else:
        draw_mark(d, size / 64, WHITE, BLUE)
    return img


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"  {path.relative_to(ROOT)}")


def main() -> None:
    print("NurChat icons:")
    tauri = ROOT / "src-tauri" / "icons"
    # Оконные иконки — прозрачный вариант A.
    master_a = variant_a(1024)
    save(master_a, tauri / "icon.png")
    for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
        save(master_a.resize((size, size), _RESAMPLE), tauri / name)
    # ICO multi-size.
    ico_sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
    master_a.save(tauri / "icon.ico", sizes=ico_sizes)
    print("  src-tauri/icons/icon.ico")
    # ICNS (macOS).
    master_a.save(tauri / "icon.icns")
    print("  src-tauri/icons/icon.icns")
    # Windows-тайлы — вариант B full-bleed.
    for name, size in [
        ("StoreLogo.png", 256),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
    ]:
        save(variant_b(size), tauri / name)

    # assets/logo: свежий PNG из той же геометрии; старый JPG (ИИ-артефакт) удаляем.
    assets_logo = ROOT / "assets" / "logo"
    save(variant_a(1024), assets_logo / "logo.png")
    legacy_jpg = assets_logo / "logo.jpg"
    if legacy_jpg.exists():
        legacy_jpg.unlink()
        print(f"  удалён {legacy_jpg.relative_to(ROOT)}")

    # PWA / web: apple-touch + manifest-иконки на сплошном фоне.
    public = ROOT / "frontend" / "public"
    save(variant_b(180), public / "apple-touch-icon.png")
    save(variant_b(192), public / "icon-192.png")
    save(variant_b(512), public / "icon-512.png")
    save(variant_b(512, pad_ratio=0.12), public / "icon-512-maskable.png")

    # Mobile: adaptive foreground (белый знак на прозрачном) + store/iOS.
    mobile = ROOT / "mobile" / "assets"
    fg = Image.new("RGBA", (1080, 1080), (0, 0, 0, 0))
    mark = variant_a(648)  # 60% центральной зоны — safe zone adaptive icon
    fg.paste(mark, ((1080 - 648) // 2, (1080 - 648) // 2), mark)
    save(fg, mobile / "ic_launcher_foreground.png")
    (mobile / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<color xmlns:android="http://schemas.android.com/apk/res/android">#2AABEE</color>\n',
        encoding="utf-8",
    )
    print("  mobile/assets/ic_launcher_background.xml")
    save(variant_b(512), mobile / "store-icon-512.png")
    save(variant_b(1024), mobile / "ios-appicon-1024.png")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
產生 LINE 圖文選單：assets/richmenu.jpg（2500×1686，<1MB）與 assets/richmenu.json（按鈕範圍與指令）。
用法：python scraper/make_richmenu.py [底圖路徑]      （預設用專案根目錄的封面原圖）
想換成 AI 生成的選單圖：直接把新圖放到 assets/richmenu.jpg（2500×1686、≤1MB），按鈕範圍在 assets/richmenu.json。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "assets" / "richmenu.jpg"
OUT_JSON = ROOT / "assets" / "richmenu.json"
W, H = 2500, 1686
GOLD, ORANGE, GREEN, BLUE, PURPLE, RED = (245, 197, 66), (255, 138, 61), (61, 220, 151), (90, 169, 255), (180, 140, 255), (255, 93, 115)

FONT_B = [r"C:\Windows\Fonts\msjhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"]
FONT_R = [r"C:\Windows\Fonts\msjh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"]

TILES = [  # (標題, 英文, 指令, 顏色, 圖示)
    ("熱門配置", "HOT COMBOS", "熱門配置", GOLD, "flame"),
    ("T 表", "TIER LIST", "T表", ORANGE, "tier"),
    ("雙北賽事", "TOURNAMENTS", "本週賽事", GREEN, "calendar"),
    ("零件解釋", "PARTS GUIDE", "零件解釋", BLUE, "book"),
    ("新品發售", "NEW RELEASES", "新品發售", PURPLE, "star"),
    ("使用說明", "HELP", "指令", (220, 228, 245), "help"),
]


def font(paths, size):
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    raise SystemExit("找不到中文字型")


def cover_bg(art: Path) -> Image.Image:
    im = Image.open(art).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((x, y, x + W, y + H))
    im = im.filter(ImageFilter.GaussianBlur(6))
    dark = Image.new("RGB", (W, H), (8, 12, 28))
    im = Image.blend(im, dark, 0.62)
    # 暗角
    vig = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(vig)
    d.ellipse([-W * 0.25, -H * 0.3, W * 1.25, H * 1.3], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(220))
    return Image.composite(im, Image.new("RGB", (W, H), (5, 8, 20)), vig)


def glass(base: Image.Image, box, color, radius=56):
    x0, y0, x1, y1 = box
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle(box, radius=radius, fill=(10, 16, 34, 190))
    # 上緣高光
    d.rounded_rectangle((x0 + 3, y0 + 3, x1 - 3, y0 + (y1 - y0) // 2), radius=radius - 3, fill=(255, 255, 255, 14))
    base.paste(Image.alpha_composite(base.convert("RGBA"), ov).convert("RGB"))
    # 彩色邊框 + 光暈
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(box, radius=radius, outline=color + (255,), width=6)
    halo = glow.filter(ImageFilter.GaussianBlur(14))
    out = Image.alpha_composite(base.convert("RGBA"), halo)
    out = Image.alpha_composite(out, glow)
    base.paste(out.convert("RGB"))


def icon(kind: str, color, size=330) -> Image.Image:
    """以 2 倍解析度畫向量圖示再縮小，邊緣才平滑"""
    S = size * 2
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = color + (255,)
    soft = color + (120,)
    cx = cy = S // 2
    if kind == "flame":
        def blob(scale, col, dy=0):
            pts = []
            for i in range(0, 361, 6):
                t = math.radians(i)
                r = 1 - 0.18 * math.cos(t) ** 2
                x = math.sin(t) * 0.62 * r
                y = -math.cos(t) * 0.95 + 0.22 * math.cos(t) ** 3 * (1 if math.cos(t) < 0 else 0.0)
                if math.cos(t) > 0:  # 上半：尖
                    x *= (1 - 0.88 * math.cos(t) ** 1.6)
                pts.append((cx + x * S * 0.36 * scale, cy + dy + y * S * 0.36 * scale))
            d.polygon(pts, fill=col)
        blob(1.0, c, S * 0.04)
        blob(0.62, (255, 236, 160, 255), S * 0.10)
        blob(0.30, (255, 255, 255, 235), S * 0.16)
    elif kind == "tier":
        rows = [(0.50, RED, 0.38), (0.72, ORANGE, 0.55), (0.88, GOLD, 0.72), (0.62, GREEN, 0.89)]
        for w_, col, ty in rows:
            y0 = int(S * (ty - 0.19)); y1 = int(S * (ty - 0.04))
            d.rounded_rectangle((S * 0.08, y0, S * 0.08 + S * 0.84 * w_, y1), radius=S * 0.04, fill=col + (255,))
            d.rounded_rectangle((S * 0.08, y0, S * 0.08 + S * 0.13, y1), radius=S * 0.04, fill=tuple(min(255, v + 90) for v in col) + (255,))
    elif kind == "calendar":
        d.rounded_rectangle((S * 0.10, S * 0.18, S * 0.90, S * 0.90), radius=S * 0.09, outline=c, width=int(S * 0.045))
        d.rounded_rectangle((S * 0.10, S * 0.18, S * 0.90, S * 0.40), radius=S * 0.09, fill=c)
        for x in (0.30, 0.70):
            d.rounded_rectangle((S * (x - 0.035), S * 0.07, S * (x + 0.035), S * 0.28), radius=S * 0.03, fill=(255, 255, 255, 255))
        for r_ in range(2):
            for c_ in range(4):
                d.rounded_rectangle((S * (0.19 + c_ * 0.17), S * (0.50 + r_ * 0.19), S * (0.27 + c_ * 0.17), S * (0.58 + r_ * 0.19)), radius=S * 0.02, fill=c if (r_, c_) != (1, 2) else (255, 255, 255, 255))
    elif kind == "book":
        left = [(S * 0.50, S * 0.24), (S * 0.12, S * 0.18), (S * 0.12, S * 0.78), (S * 0.50, S * 0.84)]
        right = [(S * 0.50, S * 0.24), (S * 0.88, S * 0.18), (S * 0.88, S * 0.78), (S * 0.50, S * 0.84)]
        d.polygon(left, fill=color + (230,)); d.polygon(right, fill=color + (170,))
        for i in range(4):
            y = S * (0.34 + i * 0.1)
            d.line((S * 0.20, y - S * 0.01, S * 0.43, y + S * 0.015), fill=(255, 255, 255, 220), width=int(S * 0.025))
            d.line((S * 0.57, y + S * 0.015, S * 0.80, y - S * 0.01), fill=(255, 255, 255, 200), width=int(S * 0.025))
        d.line((S * 0.50, S * 0.24, S * 0.50, S * 0.84), fill=(255, 255, 255, 255), width=int(S * 0.02))
    elif kind == "star":
        pts = []
        for i in range(10):
            r_ = S * (0.44 if i % 2 == 0 else 0.19)
            a = -math.pi / 2 + i * math.pi / 5
            pts.append((cx + r_ * math.cos(a), cy + S * 0.02 + r_ * math.sin(a)))
        d.polygon(pts, fill=c)
        pts2 = [(cx + (p[0] - cx) * 0.55, cy + S * 0.02 + (p[1] - cy - S * 0.02) * 0.55) for p in pts]
        d.polygon(pts2, fill=tuple(min(255, v + 75) for v in color) + (255,))
        for (x, y, r_) in ((0.88, 0.16, 0.06), (0.10, 0.72, 0.045), (0.90, 0.78, 0.035)):
            d.polygon([(S * x, S * (y - r_)), (S * (x + r_ * 0.35), S * (y - r_ * 0.35)), (S * (x + r_), S * y), (S * (x + r_ * 0.35), S * (y + r_ * 0.35)), (S * x, S * (y + r_)), (S * (x - r_ * 0.35), S * (y + r_ * 0.35)), (S * (x - r_), S * y), (S * (x - r_ * 0.35), S * (y - r_ * 0.35))], fill=(255, 255, 255, 255))
    elif kind == "help":
        d.ellipse((S * 0.08, S * 0.08, S * 0.92, S * 0.92), outline=c, width=int(S * 0.05))
        f = ImageFont.truetype(next(p for p in FONT_B if Path(p).exists()), int(S * 0.62))
        tw = d.textlength("?", font=f)
        d.text((cx - tw / 2, S * 0.08), "?", font=f, fill=c)
    return im.resize((size, size), Image.LANCZOS)


def build(art: Path):
    img = cover_bg(art)
    d = ImageDraw.Draw(img)
    f_brand, f_sub, f_hint = font(FONT_B, 128), font(FONT_R, 44), font(FONT_R, 42)
    # 標題列
    d.text((90, 52), "陀螺助理", font=f_brand, fill=GOLD)
    bw = d.textlength("陀螺助理", font=f_brand)
    d.text((90 + bw + 40, 112), "BEYBLADE X ASSISTANT", font=f_sub, fill=(190, 200, 225))
    hint = "點選下方功能"
    hx = W - 90 - d.textlength(hint, font=f_hint) - 56
    d.text((hx, 118), hint, font=f_hint, fill=(150, 165, 195))
    d.polygon([(W - 138, 134), (W - 90, 134), (W - 114, 170)], fill=GOLD)  # ▼
    d.line((90, 232, W - 90, 232), fill=GOLD + (255,), width=4)
    gap, top = 40, 270
    tw = (W - gap * 4) // 3
    th = (H - top - gap * 3) // 2
    areas = []
    f_title, f_en = font(FONT_B, 118), font(FONT_R, 44)
    for i, (title, en, cmd, col, ic) in enumerate(TILES):
        r, c = divmod(i, 3)
        x0 = gap + c * (tw + gap)
        y0 = top + gap + r * (th + gap) - gap
        box = (x0, y0, x0 + tw, y0 + th)
        glass(img, box, col)
        d = ImageDraw.Draw(img)
        icon_im = icon(ic, col, 300)
        img.paste(icon_im, (x0 + (tw - 300) // 2, y0 + 56), icon_im)
        tx = d.textlength(title, font=f_title)
        d.text((x0 + (tw - tx) / 2, y0 + 392), title, font=f_title, fill=(255, 255, 255))
        ex = d.textlength(en, font=f_en)
        d.text((x0 + (tw - ex) / 2, y0 + 530), en, font=f_en, fill=col)
        areas.append({"bounds": {"x": box[0], "y": box[1], "width": tw, "height": th}, "action": {"type": "message", "label": title.replace(" ", ""), "text": cmd}})
    return img, areas


def main() -> int:
    art = Path(sys.argv[1]) if len(sys.argv) > 1 else next(iter(sorted(ROOT.glob("a_dynamic*.png"))), None)
    if not art or not Path(art).exists():
        print("找不到底圖，請指定：python scraper/make_richmenu.py 圖片路徑", file=sys.stderr)
        return 1
    img, areas = build(Path(art))
    OUT_IMG.parent.mkdir(exist_ok=True)
    for q in (88, 82, 76, 70, 62):
        img.save(OUT_IMG, "JPEG", quality=q, optimize=True)
        if OUT_IMG.stat().st_size < 980_000:
            break
    OUT_JSON.write_text(json.dumps({"name": "陀螺助理主選單", "chatBarText": "☰ 主選單", "image": "richmenu.jpg", "size": {"width": W, "height": H}, "areas": areas}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"richmenu.jpg {W}x{H} {OUT_IMG.stat().st_size // 1024}KB (q={q}), {len(areas)} 個按鈕")
    return 0


if __name__ == "__main__":
    sys.exit(main())

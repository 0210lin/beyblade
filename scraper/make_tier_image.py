#!/usr/bin/env python3
"""
把 data/tier_pro.json（高手 T 表：每級別的上蓋 + 推薦固鎖／軸心）畫成圖 → data/tier.jpg
版面仿 beybladehub.app 的 T 表：左側級別色塊、右側一排排「上蓋圖 + 固鎖／軸心小圖」。
需要：Pillow（含 WebP 支援）與一套中文字型
  Windows：微軟正黑體；Ubuntu（GitHub Actions）：sudo apt-get install -y fonts-noto-cjk
圖片會快取在 .cache/tier-img/（不進版控）。資料沒變就不重畫。找不到字型 / 沒資料 → 不動舊圖（exit 0）。
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "tier_pro.json"
OUT = ROOT / "data" / "tier.jpg"
HASH = ROOT / "data" / "tier.hash"
CACHE = ROOT / ".cache" / "tier-img"
UA = "Mozilla/5.0 (compatible; beyx-tier/1.0)"

FONTS_BOLD = [r"C:\Windows\Fonts\msjhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
              "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc"]
FONTS_REG = [r"C:\Windows\Fonts\msjh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
             "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"]

W, PAD = 1280, 12
BG = (15, 15, 35)
BLADE, CHIP_W, CHIP_H, LABEL_W, GAP = 90, 36, 45, 64, 6


def find_font(paths):
    return next((p for p in paths if Path(p).exists()), None)


def parse_rgba(s: str):
    import re
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)", s or "")
    if not m:
        return (40, 40, 60)
    r, g, b = (int(m.group(i)) for i in (1, 2, 3))
    a = float(m.group(4) or 1)
    return tuple(int(c * a + bg * (1 - a)) for c, bg in zip((r, g, b), BG))


def hex_rgb(h: str):
    h = (h or "#888888").lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def get_image(url: str):
    from PIL import Image
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest()[:20] + ".png")
    if f.exists():
        try:
            return Image.open(f).convert("RGBA")
        except Exception:
            pass
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=25).read()
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        im.save(f)
        time.sleep(0.03)
        return im
    except Exception as e:
        print(f"[warn] 圖片載入失敗 {url}: {e}", file=sys.stderr)
        return None


def fit(im, box):
    from PIL import Image
    im = im.copy()
    im.thumbnail((box, box), Image.LANCZOS)
    return im


def main() -> int:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("Pillow 未安裝，略過 T 表圖片", file=sys.stderr)
        return 0
    bold, reg = find_font(FONTS_BOLD), find_font(FONTS_REG)
    if not (bold and reg):
        print("找不到中文字型，略過 T 表圖片（保留舊圖）", file=sys.stderr)
        return 0
    if not SRC.exists():
        print("沒有 tier_pro.json，略過")
        return 0
    raw = SRC.read_bytes()
    digest = hashlib.sha1(raw).hexdigest()
    if OUT.exists() and HASH.exists() and HASH.read_text().strip() == digest:
        print("T 表資料沒變，沿用舊圖")
        return 0
    data = json.loads(raw.decode("utf-8"))
    rows = [r for r in data.get("rows", []) if r.get("cards")]
    if not rows:
        print("T 表沒有資料，略過")
        return 0

    F = lambda p, s: ImageFont.truetype(p, s)
    f_title, f_sub, f_tier, f_tier_s = F(bold, 34), F(reg, 18), F(bold, 26), F(bold, 17)
    f_name, f_code, f_note, f_foot = F(bold, 12), F(bold, 10), F(bold, 12), F(reg, 15)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))

    def unit_size(card):
        n = len(card["chips"])
        cols = 0 if n == 0 else (1 if n <= 2 else -(-n // 2))
        w = BLADE + cols * CHIP_W + (18 if card.get("note") else 0) + 4
        return w, cols

    area_w = W - PAD * 2 - LABEL_W - 16
    layout = []
    for r in rows:
        lines, cur, cw = [], [], 0
        for card in r["cards"]:
            w, cols = unit_size(card)
            if cur and cw + w + GAP > area_w:
                lines.append(cur)
                cur, cw = [], 0
            cur.append((card, w, cols))
            cw += w + GAP
        if cur:
            lines.append(cur)
        layout.append((r, lines))

    head_h = 112
    H = head_h + sum(len(lines) * (BLADE + GAP) + 18 for _, lines in layout) + 56
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, head_h - 10], fill=(31, 58, 95))
    d.text((PAD + 6, 16), f'戰鬥陀螺 T 表｜{data.get("title", "")}', font=f_title, fill=(255, 255, 255))
    views = f'・觀看 {data["views"]:,}' if data.get("views") else ""
    d.text((PAD + 6, 66), f'by {data.get("author", "高手")}・更新 {data.get("updated", "")}{views}', font=f_sub, fill=(184, 199, 221))

    y = head_h
    for r, lines in layout:
        rh = len(lines) * (BLADE + GAP) + 6
        col = hex_rgb(r.get("color"))
        d.rounded_rectangle([PAD, y, W - PAD, y + rh + 6], radius=8, fill=parse_rgba(r.get("bg")))
        tint = tuple(int(c * 0.22 + b * 0.78) for c, b in zip(col, BG))
        d.rounded_rectangle([PAD + 2, y + 2, PAD + LABEL_W, y + rh + 4], radius=6, fill=tint)
        big = f_tier if len(r["tier"]) <= 2 else f_tier_s
        tw = probe.textlength(r["tier"], font=big)
        d.text((PAD + 2 + (LABEL_W - 2 - tw) / 2, y + rh / 2 - 12), r["tier"], font=big, fill=col)
        cy = y + 5
        for line in lines:
            cx = PAD + LABEL_W + 10
            for card, w, cols in line:
                d.rounded_rectangle([cx, cy, cx + w - 4, cy + BLADE], radius=6, fill=(0, 0, 0, 0) if False else tuple(int(c * 0.6) for c in parse_rgba(r.get("bg"))), outline=(255, 255, 255))
                img = get_image(card["img"])
                if img:
                    t = fit(img, BLADE - 6)
                    im.paste(t, (cx + (BLADE - t.width) // 2, cy + 2 + (BLADE - 14 - t.height) // 2 + 2), t)
                label = card.get("label") or card.get("name") or ""
                while len(label) > 2 and probe.textlength(label, font=f_name) > BLADE - 4:
                    label = label[:-1]  # 太長就截短，避免蓋到右邊的固鎖／軸心
                d.rectangle([cx, cy + BLADE - 15, cx + BLADE, cy + BLADE], fill=(0, 0, 0))
                lw = probe.textlength(label, font=f_name)
                d.text((cx + max(2, (BLADE - lw) / 2), cy + BLADE - 15), label, font=f_name, fill=(255, 255, 255))
                # 固鎖 / 軸心
                chips = card["chips"]
                for i, ch in enumerate(chips):
                    colx = i // 2 if len(chips) > 2 else 0
                    rowy = i % 2 if len(chips) > 2 else i
                    px, py = cx + BLADE + 3 + colx * CHIP_W, cy + 1 + rowy * (CHIP_H + 1)
                    ci = get_image(ch["img"])
                    if ci:
                        tt = fit(ci, 30)
                        im.paste(tt, (px + (CHIP_W - tt.width) // 2, py + 1), tt)
                    cw_ = probe.textlength(ch["code"], font=f_code)
                    d.text((px + (CHIP_W - cw_) / 2, py + 31), ch["code"], font=f_code, fill=(230, 235, 245))
                if card.get("note"):
                    nt = card["note"][:8]
                    tw_ = int(probe.textlength(nt, font=f_note)) + 4
                    layer = Image.new("RGBA", (tw_, 16), (0, 0, 0, 0))
                    ImageDraw.Draw(layer).text((2, 0), nt, font=f_note, fill=(255, 224, 130))
                    layer = layer.rotate(270, expand=True)
                    im.paste(layer, (cx + w - 22, cy + 2), layer)
                cx += w + GAP
            cy += BLADE + GAP
        y += rh + 12
    d.text((PAD + 6, H - 34), "資料：beybladehub.app 高手 T 表（社群整理，非官方）　圖片版權屬 TAKARA TOMY 與原作者", font=f_foot, fill=(150, 160, 180))
    # JPEG 需 < 1MB（LINE 預覽圖限制），逐步降低品質
    for q in (86, 80, 74, 68, 60):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() < 950_000:
            break
    OUT.write_bytes(buf.getvalue())
    HASH.write_text(digest + "\n")
    print(f"tier.jpg {W}x{H} {OUT.stat().st_size // 1024}KB (q={q})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

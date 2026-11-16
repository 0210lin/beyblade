#!/usr/bin/env python3
"""
把 data/combos.json 裡的「高手 T 表」畫成一張圖 → data/tier.png
（LINE 機器人收到「T表」時直接回這張圖）。需要 Pillow 與一套中文字型：
  Windows：微軟正黑體；Ubuntu（GitHub Actions）：sudo apt-get install -y fonts-noto-cjk
找不到字型時不產圖、不動舊圖（exit 0）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "combos.json"
OUT = ROOT / "data" / "tier.png"

FONTS_BOLD = [
    r"C:\Windows\Fonts\msjhbd.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
]
FONTS_REG = [
    r"C:\Windows\Fonts\msjh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]
TIER_ORDER = ["X", "SS", "S", "T1", "T2", "A", "B", "C", "D"]
TIER_COLOR = {"X": "#E5484D", "SS": "#F76B15", "S": "#E5A50A", "T1": "#30A46C", "T2": "#3E8EDD", "A": "#8E4EC6", "B": "#6F7C8E", "C": "#6F7C8E", "D": "#6F7C8E"}
BG, PANEL, INK, SUB, NAVY = "#0F1722", "#18222F", "#F2F5F9", "#98A6BA", "#1F3A5F"


def find_font(paths):
    for p in paths:
        if Path(p).exists():
            return p
    return None


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
    doc = json.loads(SRC.read_text(encoding="utf-8"))
    tier = doc.get("tier") or {}
    if not any(tier.get(k) for k in ("blades", "ratchets", "bits")):
        print("沒有 T 表資料，略過")
        return 0

    F = lambda path, size: ImageFont.truetype(path, size)
    f_title, f_sec, f_tier, f_chip, f_small, f_foot = F(bold, 44), F(bold, 30), F(bold, 30), F(bold, 26), F(reg, 18), F(reg, 20)
    W, PAD, GAP = 1080, 36, 10
    LABEL_W = 96
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))

    def chip_size(item):
        name = item["name"]
        votes = f' ×{item["votes"]}' if item.get("votes", 1) > 1 else ""
        w = probe.textlength(name, font=f_chip) + (probe.textlength(votes, font=f_small) if votes else 0) + 28
        return int(w), 46, name, votes

    sections = []
    for key, title in (("blades", "上蓋 Blade"), ("ratchets", "固鎖 Ratchet"), ("bits", "軸心 Bit")):
        items = tier.get(key) or []
        if not items:
            continue
        rows = []
        for t in [x for x in TIER_ORDER if any(i["tier"] == x for i in items)] + sorted({i["tier"] for i in items} - set(TIER_ORDER)):
            chips = [chip_size(i) for i in items if i["tier"] == t]
            lines, cur, cw = [], [], 0
            maxw = W - PAD * 2 - 24 - LABEL_W - 12
            for c in chips:
                if cur and cw + c[0] + GAP > maxw:
                    lines.append(cur); cur, cw = [], 0
                cur.append(c); cw += c[0] + GAP
            if cur:
                lines.append(cur)
            rows.append((t, lines))
        sections.append((title, rows))

    # 高度計算
    H = 150
    for title, rows in sections:
        H += 64
        for t, lines in rows:
            H += max(1, len(lines)) * (46 + GAP) + 14
        H += 18
    H += 70
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 120], fill=NAVY)
    d.text((PAD, 22), "戰鬥陀螺 T 表", font=f_title, fill="#FFFFFF")
    sub = f'高手評級（{tier.get("experts") or "?"} 位高手）・{tier.get("updated") or ""}'
    d.text((PAD, 78), sub, font=f_foot, fill="#B8C7DD")
    y = 140
    for title, rows in sections:
        d.text((PAD, y), title, font=f_sec, fill=INK)
        y += 56
        for t, lines in rows:
            rh = max(1, len(lines)) * (46 + GAP)
            d.rounded_rectangle([PAD, y, W - PAD, y + rh + 4], radius=14, fill=PANEL)
            d.rounded_rectangle([PAD + 8, y + 8, PAD + 8 + LABEL_W - 16, y + 8 + 46], radius=10, fill=TIER_COLOR.get(t, "#6F7C8E"))
            tw = probe.textlength(t, font=f_tier)
            d.text((PAD + 8 + (LABEL_W - 16 - tw) / 2, y + 8 + 4), t, font=f_tier, fill="#FFFFFF")
            cy = y + 8
            for line in lines:
                cx = PAD + LABEL_W + 12
                for w, h, name, votes in line:
                    d.rounded_rectangle([cx, cy, cx + w, cy + h], radius=12, fill="#26364A")
                    d.text((cx + 14, cy + 6), name, font=f_chip, fill=INK)
                    if votes:
                        nw = probe.textlength(name, font=f_chip)
                        d.text((cx + 14 + nw, cy + 17), votes, font=f_small, fill=SUB)
                    cx += w + GAP
                cy += 46 + GAP
            y += rh + 14
        y += 18
    d.text((PAD, H - 52), "×N = N 位高手同時評選　資料：beybladehub.app（社群整理，非官方）", font=f_small, fill=SUB)
    im.save(OUT, optimize=True)
    print(f"tier.png {W}x{H} {OUT.stat().st_size // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
抓高手 T 表（scraper/hub_tier.py 的 SOURCES[0]）→ 寫 data/tier_pro.json，並把精簡版放進 combos.json["tier_pro"]。
抓失敗或解析結果異常少時保留舊資料。之後由 make_tier_image.py 畫成 data/tier.jpg。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hub_tier  # noqa: E402

ROOT = HERE.parent
FULL = ROOT / "data" / "tier_pro.json"
COMBOS = ROOT / "data" / "combos.json"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        data = hub_tier.fetch_all()
    except Exception as e:
        print(f"[fail] 高手 T 表抓取失敗：{e}（沿用舊資料）", file=sys.stderr)
        return 0
    n = sum(len(r["cards"]) for r in data.get("rows", []))
    if n < 20:
        print(f"[warn] 高手 T 表只解析到 {n} 張卡片，疑似頁面改版，沿用舊資料", file=sys.stderr)
        return 0
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if not FULL.exists() or FULL.read_text(encoding="utf-8") != text:
        FULL.write_text(text, encoding="utf-8")
        print(f"tier_pro.json 更新（{len(data['rows'])} 級、{n} 張卡片）")
    else:
        print(f"tier_pro.json 沒有變化（{n} 張卡片）")
    if COMBOS.exists():
        doc = json.loads(COMBOS.read_text(encoding="utf-8"))
        slim = hub_tier.slim(data)
        if doc.get("tier_pro") != slim:
            doc["tier_pro"] = slim
            COMBOS.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print("combos.json 的 tier_pro 已更新")
    return 0


if __name__ == "__main__":
    sys.exit(main())

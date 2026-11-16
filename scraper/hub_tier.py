#!/usr/bin/env python3
"""
解析 beybladehub.app 的「高手 T 表」分享頁（/s/<代碼>?t=<uuid> → /t/...，伺服器端輸出的 HTML）。
每個級別（T0、T0.5、T1…）下有多張卡片：上蓋（圖片、名稱、編號）＋ 高手附上的推薦固鎖／軸心 ＋ 備註。
輸出：
  data/tier_pro.json  完整資料（含圖片網址，給畫圖用）
  combos.json["tier_pro"]  精簡版（只有文字，給機器人的文字備援用）
只用標準函式庫。資料為台灣社群高手整理，非官方。
"""
from __future__ import annotations

import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "tier_pro.json"
UA = "Mozilla/5.0 (compatible; beyx-tier/1.0)"
BASE = "https://beybladehub.app"

# 預設用哪一份高手 T 表（可自行換成 beybladehub.app/tier 上「高手 T 表」列出的其他連結）
SOURCES = [
    "https://beybladehub.app/s/2hncQPPe?t=010e597f-e4cd-4a3e-a29c-f4b8a73b9894",  # 阿土｜9月 台北G1&G1最強陀螺天梯表
]


def fetch(url: str, timeout: int = 40) -> tuple[str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # urllib 會自動跟隨 307 轉址
        return r.read().decode("utf-8", errors="ignore"), r.geturl()


def clean(h: str) -> str:
    h = re.sub(r"<svg.*?</svg>", "", h, flags=re.S)
    return h.replace("<!-- -->", "")


def text(h: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", h)).strip()


def parse(page: str, url: str = "") -> dict:
    c = clean(page)
    title = re.search(r"<title>(.*?)</title>", c, re.S)
    title = text(title.group(1)).split("|")[0].strip() if title else ""
    meta = {"title": title, "source_url": url}
    m = re.search(r"最後更新\s*([^<]+)", c)
    if m:
        meta["updated"] = m.group(1).strip()
    m = re.search(r'name="description" content="([^"]+?) 製作的戰鬥陀螺強度 T 表', c)
    if m:
        meta["author"] = html.unescape(m.group(1)).strip()
    for key, label in (("views", "觀看"), ("likes", "讚"), ("remixes", "改編")):
        m = re.search(label + r"\s*(?:</[^>]+>\s*)*(?:<[^>]+>\s*)*([\d,]+)", c)
        if m:
            meta[key] = int(m.group(1).replace(",", ""))
    # 級別標籤：背景色 + <span>T0</span>
    labels = [(m.start(), m.group(3), m.group(2), m.group(1)) for m in re.finditer(
        r'background:(rgba\([^)]*\));border-radius:8px;min-height:102px"><div[^>]*style="[^"]*background:(#[0-9a-fA-F]{6})30;[^"]*"><span[^>]*>(T[\d.]+)</span>', c)]
    cards_pos = [m.start() for m in re.finditer(r'<div[^>]*class="tier-card', c)]
    rows = {}
    order = []
    for idx, pos in enumerate(cards_pos):
        end = cards_pos[idx + 1] if idx + 1 < len(cards_pos) else len(c)
        # 這張卡片所屬的級別 = 它前面最近的標籤；後面若先出現下一個標籤，卡片的附屬區塊到標籤前為止
        lab = [l for l in labels if l[0] < pos]
        nxt = [l[0] for l in labels if l[0] > pos]
        if nxt:
            end = min(end, nxt[0])
        if not lab:
            continue
        _, tier, color, bg = lab[-1]
        unit = c[pos:end]
        im = re.search(r'<img src="([^"]+/(?:blades-[a-z]+)/[^"]+)" alt="([^"]*)"[^>]*/?>(?:<div[^>]*>([^<]*)</div>)?', unit)
        if not im:
            continue
        info = re.search(r'<div[^>]*>([^<]+)</div><div[^>]*>([A-Z]{2}-[\w-]+)</div>', unit)
        weight = re.search(r"(\d+(?:\.\d+)?)g</div>", unit)
        chips = [{"kind": k, "code": code, "img": img}
                 for img, k, code in re.findall(r'<img src="(https://img\.beybladehub\.app/(bits|ratchets)/([^"/]+?)\.webp)"', unit)]
        # 去重並保持順序
        seen, uniq = set(), []
        for ch in chips:
            key = (ch["kind"], ch["code"])
            if key not in seen:
                seen.add(key)
                uniq.append(ch)
        note = re.search(r'data-instance-note="([^"]+)"', unit)
        card = {"img": im.group(1), "name": html.unescape(im.group(2)).strip(), "label": html.unescape(im.group(3) or "").strip(),
                "code": info.group(2) if info else "", "weight": weight.group(1) if weight else "",
                "chips": uniq, "note": html.unescape(note.group(1)).strip() if note else ""}
        if tier not in rows:
            rows[tier] = {"tier": tier, "color": color, "bg": bg, "cards": []}
            order.append(tier)
        rows[tier]["cards"].append(card)
    meta["rows"] = [rows[t] for t in order]
    return meta


def slim(data: dict) -> dict:
    """精簡版（只有文字）：給機器人的文字備援與標題說明用"""
    return {
        "title": data.get("title", ""), "author": data.get("author", ""), "updated": data.get("updated", ""),
        "views": data.get("views"), "source_url": data.get("source_url", ""),
        "rows": [{"tier": r["tier"], "cards": [{"name": c["name"], "code": c["code"], "note": c["note"],
                                                 "ratchets": [x["code"] for x in c["chips"] if x["kind"] == "ratchets"],
                                                 "bits": [x["code"] for x in c["chips"] if x["kind"] == "bits"]} for c in r["cards"]]}
                 for r in data.get("rows", [])],
    }


def fetch_all(url: str | None = None) -> dict:
    page, final = fetch(url or SOURCES[0])
    return parse(page, final)


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    d = fetch_all()
    print({k: v for k, v in d.items() if k != "rows"})
    for r in d["rows"]:
        print(r["tier"], r["color"], len(r["cards"]), [c["name"] + ":" + "/".join(x["code"] for x in c["chips"]) + (f"【{c['note']}】" if c["note"] else "") for c in r["cards"][:3]])

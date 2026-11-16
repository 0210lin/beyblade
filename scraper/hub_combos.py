#!/usr/bin/env python3
"""
解析 https://beybladehub.app/combos（伺服器端輸出的 HTML）：
  1. 賽場實戰配置：每顆上蓋的前四名配置（含賽事名稱、組別、日期、選手；同一配置多場會標 ×N 場）
  2. 社群推薦配置：固鎖 + 軸心 + 打法類型 + 說明，以及常用固鎖／軸心
  3. 高手 T 表：上蓋 / 固鎖 / 軸心的 X～S 級評級與評選人數
只用標準函式庫。資料為台灣社群整理，非官方。
"""
from __future__ import annotations

import html
import json
import re
import urllib.request

URL = "https://beybladehub.app/combos"
UA = "Mozilla/5.0 (compatible; beyx-combos/1.0)"
RANK = {"冠軍": 1, "亞軍": 2, "季軍": 3, "殿軍": 4}


def fetch(url: str = URL, timeout: int = 40) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def clean(h: str) -> str:
    h = re.sub(r"<svg.*?</svg>", "", h, flags=re.S)
    h = re.sub(r'\s(?:class|style|data-[a-z-]+|aria-[a-z-]+|translate|target|rel|width|height|viewBox|fill|stroke)="[^"]*"', "", h)
    return h.replace("<!-- -->", "")


def text(h: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", h)).strip()


# ───────────── T 表 ─────────────
def parse_tier(raw: str) -> dict:
    s = raw.find("高手零件評級速查")
    e = raw.find("搜尋上蓋名稱", s)
    if s < 0 or e < 0:
        return {}
    seg = raw[s:e].replace("<!-- -->", "")
    experts = re.search(r"(\d+)\s*</span>?\s*位高手評級|(\d+) 位高手評級", seg)
    n_exp = None
    m = re.search(r"(\d+)\s*(?:<!-- -->)?\s*位高手評級", seg)
    if m:
        n_exp = int(m.group(1))
    by = re.search(r"by\s*(?:<!-- -->)?\s*</?[^>]*>?\s*([^<]{3,200})", seg)
    out = {"experts": n_exp, "blades": [], "ratchets": [], "bits": []}
    parts = re.split(r"<h3[^>]*>", seg)
    for part in parts[1:]:
        head = text(part.split("</h3>")[0])
        key = "blades" if "Blade" in head else "ratchets" if "Ratchet" in head else "bits" if "Bit" in head else None
        if not key:
            continue
        for a in re.findall(r"<a [^>]*>.*?</a>", part, flags=re.S):
            tt = re.search(r'title="(\d+)/(\d+) 位高手評為 ([^ ]+) 級"', a)
            href = re.search(r'href="([^"]+)"', a)
            tier = re.search(r"<span[^>]*>([^<]+)</span>", a)
            name = text(re.sub(r"<span[^>]*>[^<]*</span>", "", a))
            if not (tt and tier and name):
                continue
            out[key].append({"name": name, "tier": tier.group(1).strip(), "votes": int(tt.group(1)), "of": int(tt.group(2)),
                             "href": href.group(1) if href else ""})
    return out


# ───────────── 配置卡片 ─────────────
CARD = re.compile(r"<div><span>(BX|UX|CX)</span><h3>([^<]+)</h3>(?:<span>([^<]*)</span>)?</div>")


def split_info(info: str):
    """'極限盃 G1 高雄站（高雄夢時代）・通常組 · 2026/07/25 · 選手：阿天' / '最近：月半公仔舖・NOVA平日杯 2026/06/10'"""
    info = info.strip()
    player = ""
    m = re.search(r"選手：(.+)$", info)
    if m:
        player = m.group(1).strip()
        info = info[: m.start()].rstrip(" ·")
    recent = info.startswith("最近：")
    info = info.replace("最近：", "", 1)
    date = ""
    m = re.search(r"(20\d\d)/(\d\d)/(\d\d)", info)
    if m:
        date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        info = (info[: m.start()] + info[m.end():]).strip(" ·")
    event, division = info, ""
    if "・" in info and not recent:  # 「最近：店名・賽事名」整段都是賽事名稱，不拆組別
        event, division = info.rsplit("・", 1)
    event = event.strip(" ·")
    return event, division.strip(), date, player, recent


def parse_cards(raw: str) -> list[dict]:
    c = clean(raw)
    heads = list(CARD.finditer(c))
    cards = []
    for i, m in enumerate(heads):
        body = c[m.end(): heads[i + 1].start() if i + 1 < len(heads) else len(c)]
        card = {"series": m.group(1), "zh": html.unescape(m.group(2)).strip(), "en": html.unescape(m.group(3) or "").strip(),
                "results": [], "tips": [], "common_ratchets": [], "common_bits": []}
        # 賽場配置（依 h5 分組）
        for grp in re.split(r"<h5>", body)[1:]:
            gname = text(grp.split("</h5>")[0])
            for it in re.finditer(
                r"<div><div><span>(冠軍|亞軍|季軍|殿軍)</span>(?:<span>(G\d|GP)</span>)?<div>(.*?)</div>(?:<span>×(\d+) 場</span>)?</div><p>(.*?)</p></div>",
                grp, flags=re.S):
                rank, lvl, combo, n, info = it.groups()
                ratchet = re.search(r'href="/parts/ratchets#ratchet-([^"]+)"', combo)
                bit = re.search(r'href="/parts/bits#bit-([^"]+)"', combo)
                name = text(re.sub(r"<a .*?</a>", "", combo))
                event, division, date, player, recent = split_info(text(info))
                if division and not division.endswith("組"):  # 「店名・賽事名」：後半不是組別，併回賽事名稱
                    event, division = f"{event}・{division}", ""
                card["results"].append({
                    "rank": RANK[rank], "level": lvl or "", "name": name, "ratchet": ratchet.group(1) if ratchet else "",
                    "bit": bit.group(1) if bit else "", "n": int(n) if n else 1, "event": event, "division": division,
                    "date": date, "player": player, "group": gname,
                })
        # 社群攻略
        for t in re.finditer(
            r'<div><a href="/parts/ratchets#ratchet-([^"]+)"><span>固鎖</span><span>[^<]*</span><span>↗</span></a>'
            r'<a href="/parts/bits#bit-([^"]+)"><span>軸心</span><span>[^<]*</span><span>↗</span></a><span>([^<]*)</span></div><p>(.*?)</p>',
            body, flags=re.S):
            card["tips"].append({"ratchet": t.group(1), "bit": t.group(2), "style": html.unescape(t.group(3)).strip(), "desc": text(t.group(4))})
        for label, key, pat in (("常用固鎖", "common_ratchets", r"ratchet-([^\"]+)"), ("常用軸心", "common_bits", r"bit-([^\"]+)")):
            m2 = re.search(label + r"</span><div>(.*?)</div></div>", body, flags=re.S)
            if m2:
                card[key] = re.findall(r'href="/parts/(?:ratchets|bits)#' + pat + '"', m2.group(1))
        cards.append(card)
    return cards


def parse(raw: str) -> dict:
    upd = re.search(r"最後更新：\s*(?:<!-- -->)?\s*(?:</[^>]+>)?\s*(?:<[^>]+>)?\s*(20\d\d/\d\d)", raw)
    return {"updated": upd.group(1) if upd else "", "tier": parse_tier(raw), "cards": parse_cards(raw)}


def fetch_all() -> dict:
    return parse(fetch())


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    d = fetch_all()
    print("updated", d["updated"], "cards", len(d["cards"]), "results", sum(len(c["results"]) for c in d["cards"]),
          "tips", sum(len(c["tips"]) for c in d["cards"]),
          "tier", {k: len(v) for k, v in d["tier"].items() if isinstance(v, list)})

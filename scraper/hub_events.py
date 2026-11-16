#!/usr/bin/env python3
"""
抓 https://beybladehub.app/events 的「比賽場次」行事曆（伺服器端輸出的 HTML，每個場館一張卡片）。
只保留台北市、新北市的場次；其他縣市一律丟棄。只用標準函式庫。
"""
from __future__ import annotations

import datetime as dt
import html
import re
import urllib.request
from urllib.parse import quote

URL = "https://beybladehub.app/events"
UA = "Mozilla/5.0 (compatible; beyx-events/1.0)"
DISTRICT = re.compile(r"(?:台北市|新北市)([^\d路街]{1,3}區)")


def fetch(url: str = URL, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def taipei_today() -> dt.date:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date()


def clean_address(a: str) -> str:
    a = html.unescape(a).strip()
    a = re.sub(r"^\d{3,6}", "", a)          # 郵遞區號
    a = a.replace("臺", "台")
    a = re.sub(r"(?<=區)[一-鿿]{1,4}里(?=[一-鿿\d])", "", a)  # 「…區新仁里忠孝東路」→ 去掉里名
    return re.sub(r"\s+", "", a)


def pick_year(mm: int, dd: int, today: dt.date) -> dt.date:
    d = dt.date(today.year, mm, dd)
    if d < today - dt.timedelta(days=180):
        d = dt.date(today.year + 1, mm, dd)
    elif d > today + dt.timedelta(days=250):
        d = dt.date(today.year - 1, mm, dd)
    return d


def parse_hub(page: str, today: dt.date | None = None) -> list[dict]:
    today = today or taipei_today()
    parts = re.split(r'(?=<div class="rounded-xl border)', page)
    events = []
    for card in parts:
        name_m = re.search(r"<p[^>]*>([^<]{1,60})</p>", card)
        addr_m = re.search(r'title="在 Google Maps 中開啟">.*?<span[^>]*>([^<]+)</span></a>', card, re.S)
        if not name_m or not addr_m:
            continue
        address = clean_address(addr_m.group(1))
        if address.startswith("台北市"):
            city = "台北市"
        elif address.startswith("新北市"):
            city = "新北市"
        else:
            continue  # 雙北以外一律略過
        name = html.unescape(name_m.group(1)).strip()
        dm = DISTRICT.search(address)
        district = dm.group(1) if dm else ("大同區" if "太原路" in address else "")
        reg_m = re.search(r'<div[^>]*data-reg-kind="([^"]*)"[^>]*>(.*?)</div>', card, re.S)
        reg = ""
        if reg_m:
            reg = re.sub(r"<[^>]+>", "", re.sub(r"<span[^>]*>先報名</span>|<span[^>]*>現場報名</span>", "", reg_m.group(2)))
            reg = html.unescape(reg).replace("・以門市公告為準", "").replace("・以主辦公告為準", "").strip("・ ")
        seen = set()
        for title, md in re.findall(r'<div[^>]*title="([^"]+)"[^>]*>\s*<span[^>]*>(\d{1,2}/\d{1,2})</span>', card):
            mm, dd = (int(x) for x in md.split("/"))
            date = pick_year(mm, dd, today)
            # 同一天可能有多個組別，各有自己的時間與上限：「公開 17:00 上限32人 | 通常 15:00 上限16人」
            for seg in title.split("|"):
                times = sorted(set(re.findall(r"\d{1,2}:\d{2}", seg)))
                cap = re.search(r"上限\s*(\d+)", seg)
                divs = [f"{d}組" for d in re.findall(r"公開|通常", re.split(r"\d", seg)[0])] or ["公開組"]
                key = (date, "/".join(divs), "/".join(times))
                if key in seen:
                    continue
                seen.add(key)
                events.append({
                    "date": date.isoformat(), "name": name, "venue": name, "address": address, "city": city,
                    "district": district, "time": "／".join(times) or "—", "checkin": "", "fee": "",
                    "cap": int(cap.group(1)) if cap else None, "divisions": divs, "reg": reg, "link": "", "note": "",
                    "kind": "store", "source": "beybladehub.app/events", "source_url": URL,
                    "map": "https://www.google.com/maps/search/?api=1&query=" + quote(f"{name} {address}"),
                })
    return events


def fetch_hub_events() -> list[dict]:
    return parse_hub(fetch())


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ev = fetch_hub_events()
    print(len(ev), "sessions;", len({e["venue"] for e in ev}), "venues")

#!/usr/bin/env python3
"""
Beyblade X 賽事配置爬蟲（GitHub Actions 每 6 小時執行）

流程：
  1. 讀 scraper/sources.json 內的來源（RSS / Reddit OAuth / 一般網頁）＋ data/manual_results.txt（手動貼的賽果）
  2. 從文字中以正規表達式抽出「戰刃 + 固鎖輪 + 軸心」並正規化（例：Wizard Rod 9-60B）
  3. 與舊資料合併、去重、淘汰過期資料
  4. 防呆：全部來源失敗或沒有抓到任何新配置 → 保留舊檔、不寫入

只用標準函式庫 + requests。
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import requests
except ImportError:  # 讓 parse 邏輯在沒有 requests 時也能被測試
    requests = None

ROOT = Path(__file__).resolve().parent.parent
DICT_PATH = ROOT / "data" / "dictionary.json"
COMBOS_PATH = ROOT / "data" / "combos.json"
MANUAL_PATH = ROOT / "data" / "manual_results.txt"
SOURCES_PATH = Path(__file__).resolve().parent / "sources.json"

KEEP_DAYS = 365          # 超過這天數的賽事從資料庫淘汰
MAX_COMBOS = 1500        # 資料庫上限
MIN_REAL_TO_DROP_SEED = 15  # 真實資料累積到這個數量就移除示範資料
UA = "Mozilla/5.0 (compatible; beyx-combo-scraper/1.0; +https://github.com/)"
TIMEOUT = 20

RESULT_HINT = re.compile(
    r"(result|results|top\s*cut|placing|placements|winner|champion|finals?|tournament|bracket|1st|2nd|3rd|"
    r"結果|賽果|優勝|冠軍|準優勝|亞軍|季軍|入賞|大会|大會)",
    re.I,
)
RANK_PATTERNS = [
    (1, re.compile(r"(\b1st\b|\bfirst\b|\bwinner\b|\bchampion\b|\b1位\b|優勝|冠軍|^\s*1[\.\):：]|🥇)", re.I)),
    (2, re.compile(r"(\b2nd\b|\bsecond\b|\brunner[- ]?up\b|準優勝|亞軍|^\s*2[\.\):：]|🥈)", re.I)),
    (3, re.compile(r"(\b3rd\b|\bthird\b|季軍|^\s*3[\.\):：]|🥉)", re.I)),
]
LOWER_RANK = re.compile(r"(\b[4-9](?:th)\b|\b1\d(?:th)\b|^\s*[4-9][\.\):：])", re.I)


# ───────────────────────── 字典 / 正規表達式 ─────────────────────────
class Matcher:
    def __init__(self, dictionary: dict):
        self.blades = dictionary["blades"]                       # id -> {zh,en,aliases}
        self.bit_full = {k.lower(): v for k, v in dictionary["bit_full_names"].items()}
        self.bit_abbr = {k.upper(): k for k in dictionary["bits"]}  # NR -> Nr
        # blade 名稱（英文、中文、3 字以上別名）→ id；空白可有可無
        pats, fused_pats = [], []
        self.blade_lookup: dict[str, str] = {}
        for bid, b in self.blades.items():
            names = [b["en"], b["zh"]] + [a for a in b.get("aliases", []) if len(a) >= 3 and re.search(r"[一-鿿]", a)]
            for nm in names:
                key = re.sub(r"\s+", "", nm).lower()
                self.blade_lookup.setdefault(key, bid)
                pat = r"\s*".join(re.escape(w) for w in nm.split())
                pats.append(pat)
                if b.get("fused"):
                    fused_pats.append(pat)
        pats.sort(key=len, reverse=True)
        fused_pats.sort(key=len, reverse=True)
        self.combo_re = re.compile(
            r"(?P<blade>" + "|".join(pats) + r")[\s:\-]*(?P<ratchet>\d|M)\s*[-–]\s*(?P<h>50|55|60|65|70|80|85)(?!\d)(?=(?P<rest>[^\n]{0,24}))",
            re.I,
        )
        # 戰刃與固鎖輪一體成型的戰刃（UX-19~22 等）：「榮耀武神 B」「榮耀戰神＋K」
        self.fused_re = re.compile(
            r"(?P<blade>" + "|".join(fused_pats) + r")\s*[＋+]?\s*(?=(?P<rest>[^\n]{0,24}))", re.I
        ) if fused_pats else None
        self.full_names_sorted = sorted(self.bit_full, key=len, reverse=True)

    def parse_bit(self, rest: str):
        """rest 是固鎖輪後面的字串；回傳 (bit_abbr, 吃掉的長度) 或 None"""
        sp = len(rest) - len(rest.lstrip(" \t"))
        body = rest[sp:]
        low = body.lower()
        for name in self.full_names_sorted:
            if low.startswith(name) and not (len(body) > len(name) and body[len(name)].isalpha()):
                return self.bit_full[name], sp + len(name)
        m = re.match(r"([A-Za-z]{1,2})(?![A-Za-z])", body)
        if m:
            tok = m.group(1)
            # 中間有空白時，縮寫必須大寫，避免把 "a"、"in" 等英文單字誤判成軸心
            if (sp == 0 or tok[0].isupper()) and tok.upper() in self.bit_abbr:
                return self.bit_abbr[tok.upper()], sp + len(tok)
        return None

    def _line(self, text, start, end):
        ls = text.rfind("\n", 0, start) + 1
        le = text.find("\n", end)
        return text[ls : le if le != -1 else len(text)]

    def find_combos(self, text: str):
        found = []
        for m in self.combo_re.finditer(text):
            r = self.parse_bit(m.group("rest"))
            if not r:
                continue
            bid = self.blade_lookup.get(re.sub(r"\s+", "", m.group("blade")).lower())
            if not bid:
                continue
            ratchet = f'{m.group("ratchet").upper()}-{m.group("h")}'
            found.append((bid, ratchet, r[0], self._line(text, m.start(), m.end()), m.start()))
        if self.fused_re:
            for m in self.fused_re.finditer(text):
                r = self.parse_bit(m.group("rest"))
                if not r:
                    continue
                bid = self.blade_lookup.get(re.sub(r"\s+", "", m.group("blade")).lower())
                if bid:
                    found.append((bid, "", r[0], self._line(text, m.start(), m.end()), m.start()))
        return found

    def combo_string(self, bid: str, ratchet: str, bit: str) -> str:
        return f'{self.blades[bid]["en"]} {ratchet}{bit}'


DIVISION_RE = re.compile(r"(成人組|通常組|公開組|加開賽|Adult|Normal|Open)", re.I)


def detect_division(line: str):
    m = DIVISION_RE.search(line)
    return m.group(1) if m else None


def detect_rank(line: str):
    """回傳 (rank|None, drop)；drop=True 表示明確是第 4 名以後 → 丟棄"""
    for rank, pat in RANK_PATTERNS:
        if pat.search(line):
            return rank, False
    if LOWER_RANK.search(line):
        return None, True
    return None, False


# ───────────────────────── 來源抓取 ─────────────────────────
def strip_html(s: str) -> str:
    s = re.sub(r"<(br|/p|/li|/tr|/div|/h\d)\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(s)


def http_get(url: str, **kw):
    if requests is None:
        raise RuntimeError("requests 未安裝")
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(kw.pop("headers", {}))
    r = requests.get(url, headers=headers, timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r


def parse_date(s: str) -> str:
    s = (s or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s  # 純日期不做時區轉換
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).astimezone(dt.timezone.utc).strftime("%Y-%m-%d")
        except ValueError:
            pass
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")


def fetch_feed(src: dict):
    """RSS / Atom → [{title,text,url,date}]"""
    root = ET.fromstring(http_get(src["url"]).content)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    posts = []
    for e in root.findall("a:entry", ns):
        link = e.find("a:link", ns)
        posts.append({
            "title": (e.findtext("a:title", "", ns) or "").strip(),
            "text": strip_html(e.findtext("a:content", "", ns) or e.findtext("a:summary", "", ns) or ""),
            "url": link.get("href") if link is not None else src["url"],
            "date": parse_date(e.findtext("a:updated", "", ns) or e.findtext("a:published", "", ns)),
        })
    for it in root.iter("item"):
        posts.append({
            "title": (it.findtext("title") or "").strip(),
            "text": strip_html(it.findtext("description") or it.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""),
            "url": (it.findtext("link") or src["url"]).strip(),
            "date": parse_date(it.findtext("pubDate") or ""),
        })
    return posts


def fetch_reddit_oauth(src: dict):
    """Reddit 官方免費 API（需在 GitHub Secrets 設 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET）。
    Reddit 常封鎖雲端 IP 的匿名請求，這是最穩的方式。"""
    cid, sec = os.environ.get("REDDIT_CLIENT_ID"), os.environ.get("REDDIT_CLIENT_SECRET")
    if not (cid and sec):
        raise RuntimeError("未設定 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET，略過")
    tok = requests.post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(cid, sec), data={"grant_type": "client_credentials"}, headers={"User-Agent": UA}, timeout=TIMEOUT,
    )
    tok.raise_for_status()
    h = {"Authorization": "bearer " + tok.json()["access_token"], "User-Agent": UA}
    out = []
    for q in src.get("queries", ["tournament results"]):
        r = requests.get(
            f"https://oauth.reddit.com/r/{src['subreddit']}/search",
            params={"q": q, "restrict_sr": 1, "sort": "new", "limit": 50, "t": "month"}, headers=h, timeout=TIMEOUT,
        )
        r.raise_for_status()
        for c in r.json()["data"]["children"]:
            d = c["data"]
            out.append({
                "title": d.get("title", ""),
                "text": d.get("selftext", ""),
                "url": "https://www.reddit.com" + d.get("permalink", ""),
                "date": dt.datetime.fromtimestamp(d["created_utc"], dt.timezone.utc).strftime("%Y-%m-%d"),
            })
    return out


def fetch_html(src: dict):
    """單一網頁：整頁文字當作一篇賽果"""
    r = http_get(src["url"])
    r.encoding = r.apparent_encoding or r.encoding
    text = strip_html(r.text)
    title = re.search(r"<title>(.*?)</title>", r.text, re.S | re.I)
    return [{
        "title": html.unescape(title.group(1)).strip() if title else src["name"],
        "text": text, "url": src["url"], "date": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"),
    }]


FETCHERS = {"feed": fetch_feed, "reddit_oauth": fetch_reddit_oauth, "html": fetch_html}


def load_manual():
    """data/manual_results.txt：區塊以單獨一行 --- 分隔
        event: 台北盃 #12
        date: 2026-11-09
        url: https://...
        1st: Shark Edge 3-60LF
        2nd: Wizard Rod 9-60B
    """
    if not MANUAL_PATH.exists():
        return []
    posts = []
    for block in re.split(r"^\s*---+\s*$", MANUAL_PATH.read_text(encoding="utf-8"), flags=re.M):
        meta = dict(re.findall(r"^\s*(event|date|url|source)\s*[:：]\s*(.+?)\s*$", block, flags=re.M | re.I))
        meta = {k.lower(): v for k, v in meta.items()}
        if "event" not in meta:
            continue
        posts.append({
            "title": meta["event"], "text": block, "url": meta.get("url", ""),
            "date": parse_date(meta.get("date", "")), "manual": True, "source": meta.get("source"),
        })
    return posts


# ───────────────────────── 抽取 + 合併 ─────────────────────────
def extract(post: dict, matcher: Matcher, source_name: str):
    if not post.get("manual") and not RESULT_HINT.search(post["title"] + "\n" + post["text"][:600]):
        return []  # 不像賽果文章（避免閒聊討論污染資料）
    out, seen = [], set()
    full = post["text"]
    for bid, ratchet, bit, line, pos in matcher.find_combos(full):
        rank, drop = detect_rank(line)
        if drop:
            continue
        division = detect_division(line)
        key = (bid, ratchet, bit, rank, division)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "blade": bid, "ratchet": ratchet, "bit": bit,
            "combo": matcher.combo_string(bid, ratchet, bit),
            "rank": rank, "division": division, "event": post["title"][:60] or source_name,
            "date": post["date"], "source": post.get("source") or source_name, "url": post["url"],
        })
    return out


HUB_SOURCE = "beybladehub.app/combos"
HUB_URL = "https://beybladehub.app/combos"


def make_resolver(dictionary: dict):
    """零件名稱 → ('blade', id) / ('cx', id) / None。先比對完整名稱，再比對名稱中含有的最長別名。"""
    entries = []
    for bid, b in dictionary["blades"].items():
        for nm in [b["zh"], b["en"], *[a for a in b.get("aliases", []) if len(a) >= 3 and re.search(r"[一-鿿]", a)]]:
            entries.append((re.sub(r"\s+", "", nm).lower(), "blade", bid))
    for cid, c in dictionary.get("cx", {}).items():
        if c.get("role") == "product":
            entries.append((re.sub(r"\s+", "", c["zh"]).lower(), "cx", cid))
    exact = {}
    for k, kind, i in entries:
        exact.setdefault(k, (kind, i))
    entries.sort(key=lambda e: len(e[0]), reverse=True)

    def resolve(name: str):
        n = re.sub(r"\s+", "", name).lower()
        if n in exact:
            return exact[n]
        for k, kind, i in entries:
            if len(k) >= 3 and k in n:
                return kind, i
        return None
    return resolve


def hub_to_data(hub: dict, dictionary: dict, today: dt.date):
    """beybladehub.app/combos 的解析結果 → (賽事配置 list, 推薦配置 dict, T 表 dict)"""
    resolve = make_resolver(dictionary)
    fallback_date = (hub.get("updated") or "").replace("/", "-")
    fallback_date = f"{fallback_date}-01" if re.fullmatch(r"\d{4}-\d{2}", fallback_date) else today.isoformat()
    combos, recommended = [], {}
    for card in hub["cards"]:
        res = resolve(card["zh"])
        key = res[1] if res and res[0] == "blade" else ("cx:" + card["zh"] if card["series"] == "CX" else None)
        if key and (card["tips"] or card["common_ratchets"] or card["common_bits"]):
            recommended[key] = {"zh": card["zh"], "series": card["series"], "tips": card["tips"],
                                "common_ratchets": card["common_ratchets"], "common_bits": card["common_bits"]}
        for r in card["results"]:
            rr = resolve(r["name"])
            rb = r["ratchet"]
            label = dictionary["blades"][rr[1]]["en"] if rr and rr[0] == "blade" else (dictionary["cx"][rr[1]]["zh"] if rr and rr[0] == "cx" else r["name"])
            c = {
                "blade": rr[1] if rr and rr[0] == "blade" else None, "ratchet": rb, "bit": r["bit"],
                "combo": f"{label} {rb}{r['bit']}".replace("  ", " ").strip(),
                "rank": r["rank"], "division": r["division"] or None, "event": r["event"] or "（賽事名稱未載）",
                "date": r["date"] or fallback_date, "source": HUB_SOURCE, "url": HUB_URL,
            }
            if rr and rr[0] == "cx":
                c["cx"] = rr[1]
            if c["blade"] is None:
                c["cx_label"] = r["name"]
            if r["player"]:
                c["player"] = r["player"]
            if r["level"]:
                c["level"] = r["level"]
            if r["n"] > 1:
                c["n"] = r["n"]
            combos.append(c)
    tier = dict(hub.get("tier") or {})
    tier["updated"] = hub.get("updated", "")
    return combos, recommended, tier


def unify_events(items: list) -> None:
    """同一天、場地關鍵字相同的賽事，把 /combos 來源的賽事名稱與連結換成手動輸入那筆（連結較具體）。"""
    ev = {}
    for c in items:
        if c.get("source") != HUB_SOURCE:
            ev.setdefault(c["date"], {})[c["event"]] = c["url"]
    for c in items:
        if c.get("source") == HUB_SOURCE and c["date"] in ev:
            toks = [t for t in re.split(r"[（）()・\s·]+", c["event"]) if len(t) >= 3]
            for name, url in ev[c["date"]].items():
                if any(t in name for t in toks):
                    c["event"], c["url"] = name, url
                    break


def dedupe_cross_source(items: list) -> list:
    """同一場同名次同配置，若手動輸入／其他來源已有（連結較具體），就丟掉 beybladehub /combos 那筆。"""
    def key2(c):
        return (c.get("blade") or c.get("cx_label"), c.get("ratchet"), c.get("bit"), c.get("rank"), c.get("date"), c.get("division") or "")
    best = {}
    for c in items:
        k = key2(c)
        if k not in best or (best[k].get("source") == HUB_SOURCE and c.get("source") != HUB_SOURCE):
            best[k] = c
    keep = {id(c) for c in best.values()}
    return [c for c in items if id(c) in keep]


def ident(c: dict):
    return (c.get("blade") or c.get("cx_label"), c["ratchet"], c["bit"], c.get("rank"), c.get("division"), c.get("url") or c.get("event"), c["date"], c.get("event"))


def merge(old: list, new: list, today: dt.date):
    cutoff = (today - dt.timedelta(days=KEEP_DAYS)).isoformat()
    merged = {ident(c): c for c in old if c["date"] >= cutoff}
    added = 0
    for c in new:
        if ident(c) not in merged:
            added += 1
        merged[ident(c)] = c
    real = [c for c in merged.values() if not c.get("seed")]
    items = list(merged.values())
    if len(real) >= MIN_REAL_TO_DROP_SEED:
        items = real  # 真實資料夠了，移除示範資料
    unify_events(items)
    items = dedupe_cross_source(items)
    items.sort(key=lambda c: (c["date"], c["combo"]), reverse=True)
    return items[:MAX_COMBOS], added


def main() -> int:
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8")
        except Exception:
            pass
    dictionary = json.loads(DICT_PATH.read_text(encoding="utf-8"))
    matcher = Matcher(dictionary)
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))["sources"]

    posts, ok_sources, errors = [], 0, []
    for src in sources:
        if not src.get("enabled", True):
            continue
        try:
            got = FETCHERS[src["type"]](src)
            ok_sources += 1
            print(f"[ok]   {src['name']}: {len(got)} 篇")
            posts += [(p, src["name"]) for p in got]
        except Exception as e:  # 任一來源失敗都不能讓整個流程中止
            errors.append(f"{src['name']}: {e}")
            print(f"[fail] {src['name']}: {e}", file=sys.stderr)
    manual = load_manual()
    if manual:
        print(f"[ok]   manual_results.txt: {len(manual)} 場")
        posts += [(p, "手動輸入") for p in manual]

    new = []
    for p, name in posts:
        new += extract(p, matcher, name)
    print(f"抽出配置 {len(new)} 筆（來源成功 {ok_sources}，失敗 {len(errors)}）")

    old_doc = json.loads(COMBOS_PATH.read_text(encoding="utf-8")) if COMBOS_PATH.exists() else {"combos": []}
    today = dt.datetime.now(dt.timezone.utc).date()

    # beybladehub.app/combos：賽場配置 + 社群推薦 + 高手 T 表（每次整批重建；抓失敗就沿用舊的）
    recommended, tier = old_doc.get("recommended", {}), old_doc.get("tier", {})
    hub_items, hub_ok = [], False
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import hub_combos
        hub = hub_combos.fetch_all()
        hc, rec, tr = hub_to_data(hub, dictionary, today)
        if len(hc) >= 20 and rec:  # 防呆：解析結果太少 = 頁面改版，不採用
            hub_items, recommended, tier, hub_ok = hc, rec, tr, True
            print(f"[ok]   beybladehub.app/combos: 賽場配置 {len(hc)} 筆、推薦 {len(rec)} 顆、T 表 {sum(len(v) for v in tr.values() if isinstance(v, list))} 項")
        else:
            print(f"[warn] beybladehub.app/combos 解析結果異常少（{len(hc)} 筆），沿用舊資料", file=sys.stderr)
    except Exception as e:
        print(f"[fail] beybladehub.app/combos: {e}", file=sys.stderr)

    old_items = [c for c in old_doc.get("combos", []) if not (hub_ok and c.get("source") == HUB_SOURCE)]
    if not new and not hub_ok:
        print("沒有抓到新資料，保留舊的 combos.json，不做變更。")
        return 0  # 防呆：不清空

    items, added = merge(old_items, new + hub_items, today)
    doc = {"updated_at": old_doc.get("updated_at", ""), "count": len(items), "combos": items,
           "recommended": recommended, "tier": tier}
    changed = any(doc[k] != old_doc.get(k) for k in ("combos", "recommended", "tier"))
    if not changed:
        print(f"combos 沒有變化（{len(items)} 筆）")
        return 0
    doc["updated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    COMBOS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"寫入 {len(items)} 筆（新增 {added}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

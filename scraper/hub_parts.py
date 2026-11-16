#!/usr/bin/env python3
"""
同步 beybladehub.app 的零件圖鑑 → data/dictionary.json
  /parts/blades        戰刃（編號、類型、旋向、重量、英文名、是否一體成型）
  /parts/ratchets      固鎖輪（類型、凸點數、高度、重量級）
  /parts/bits          軸心（類型、英文名、形狀、高度、重量級）
  /parts/blades/assist 輔助戰刃（CX）
做法：對照現有字典，只更新「站上有給、且和現在不同」的欄位；站上新出現的零件自動新增；
手動維護的別名（aliases）、百科文字、預設別名都不會被動到。解析結果異常少（頁面改版）就整個略過。
只用標準函式庫。
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICT = ROOT / "data" / "dictionary.json"
BASE = "https://beybladehub.app"
UA = "Mozilla/5.0 (compatible; beyx-parts/1.0)"
TYPE_MAP = {"攻擊": "Attack", "防守": "Defense", "持久": "Stamina", "均衡": "Balance", "耐久": "Stamina",
            "攻擊型": "Attack", "防守型": "Defense", "持久型": "Stamina", "耐久型": "Stamina", "均衡型": "Balance"}
SHAPE_MAP = {"平坦軸": "Flat", "球形軸": "Ball", "尖鋭軸": "Spike", "尖銳軸": "Spike"}
BLADE_CODE = re.compile(r"^(BX|UX|BXG|BXA)-[\w-]+$")  # BXH 是 CX 零件（戰神紋章/伏特主刃）的編號，不當成戰刃


def fetch(path: str, timeout: int = 40) -> str:
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="ignore")


def clean(h: str) -> str:
    h = re.sub(r"<svg.*?</svg>", "", h, flags=re.S)
    h = re.sub(r'\s(?:class|style|data-[a-z-]+|aria-[a-z-]+|translate|target|rel|loading|decoding|draggable)="[^"]*"', "", h)
    return h.replace("<!-- -->", "")


def spans(h: str) -> list[str]:
    return [html.unescape(x).strip() for x in re.findall(r"<span>([^<]*)</span>", h)]


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


def spaced_en(en: str) -> str:
    """DranSword → Dran Sword；已有空白或符號的不動"""
    if " " in en:
        return en.strip()
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", en).strip()


def dmm(h: str) -> str:
    m = re.search(r"([\d.]+)", h or "")
    return f"{float(m.group(1)) / 10:g}mm" if m else ""


# ───────────── 解析 ─────────────
def parse_blades(raw: str) -> list[dict]:
    out = []
    for ch in re.split(r'(?=<div id="blade-)', clean(raw))[1:]:
        head = re.search(r"/></div><div><div>([^<]+)</div><div>((?:<span>[^<]*</span>)+)</div></div>", ch)
        if not head:
            continue
        zh, sp = html.unescape(head.group(1)).strip(), spans(head.group(2))
        rest = ch[head.end():]
        en = re.search(r"<div><div><span>([^<]+)</span>", rest)
        spin = re.search(r"<span>(右旋|左旋) ([RL])</span>(<span>Fused</span>)?", rest)
        out.append({
            "zh": zh, "type": TYPE_MAP.get(sp[0], ""), "code": next((s for s in sp[1:] if re.match(r"^[A-Z]{2,3}-", s)), ""),
            "weight": next((s for s in sp if re.match(r"^[\d.]+g$", s)), ""), "collab": "聯名" in sp or "復刻" in sp,
            "en": spaced_en(html.unescape(en.group(1))) if en else "", "spin": spin.group(2) if spin else "R",
            "fused": bool(spin and spin.group(3)),
        })
    return out


def parse_ratchets(raw: str) -> dict:
    out = {}
    for ch in re.split(r'(?=<div id="ratchet-)', clean(raw))[1:]:
        m = re.match(r'<div id="ratchet-([^"]+)"><div><img[^>]*/></div><div><div>([^<]+)</div><div>((?:<span>[^<]*</span>)+)</div></div>', ch)
        if not m:
            continue
        code, sp = m.group(2).strip(), spans(m.group(3))
        t = TYPE_MAP.get(sp[0], "")
        weight = re.search(r"<span>重量</span><span>([^<]+)</span>", ch)
        pegs = re.search(r"<span>凸點數</span><span>([^<]+)</span>", ch)
        height = re.search(r"<span>高度</span><span>([^<]+)</span>", ch)
        e = {"type": t, "pegs": (pegs.group(1).strip() if pegs else code.split("-")[0]), "height": dmm(height.group(1)) if height else dmm(code.split("-")[-1])}
        if weight:
            e["weight"] = weight.group(1).strip()
        out[code] = e
    return out


def parse_bits(raw: str) -> dict:
    out = {}
    for ch in re.split(r'(?=<div id="bit-)', clean(raw))[1:]:
        m = re.match(r'<div id="bit-([^"]+)"><div><img[^>]*/></div><div><div>([^<]+)</div><div>((?:<span>[^<]*</span>)+)</div></div><div><div><span>([^<]+)</span>', ch)
        if not m:
            continue
        code, sp, en = m.group(2).strip(), spans(m.group(3)), html.unescape(m.group(4)).strip()
        shape = re.search(r"</div><div><span>([^<]+軸)</span></div>", ch)
        weight = re.search(r"<span>重量</span><span>([^<]+)</span>", ch)
        height = re.search(r"<span>高度</span><span>([^<]+)</span>", ch)
        e = {"en": en, "type": TYPE_MAP.get(sp[0], "")}
        e["shape"] = "Composite" if "Fused" in sp else SHAPE_MAP.get(shape.group(1), "") if shape else ""
        if weight:
            e["weight"] = weight.group(1).strip()
        if height and "↔" not in height.group(1):
            e["height"] = dmm(height.group(1))
        out[code] = e
    return out


def parse_assists(raw: str) -> dict:
    out = {}
    c = clean(raw)
    for m in re.finditer(r'<img alt="輔助戰刃 ([A-Z]) [^"]*" src="[^"]*assist-[A-Z]\.webp"/></div><div><div>((?:<span>[^<]*</span>)+)</div><div>((?:<span>[^<]*</span>)+)</div><p>(.*?)</p>(.*?)(?=<div><div><img alt="輔助戰刃|$)', c, flags=re.S):
        letter, head, tags, desc, tail = m.groups()
        hs, ts = spans(head), spans(tags)
        weight = next((s.replace("≈", "") for s in hs if re.search(r"g$", s)), "")
        packs = re.findall(r'<a href="/parts/combos/([A-Z]{2}-\d+)', tail)
        out[letter] = {"zh": hs[1] if len(hs) > 1 else "", "en": hs[2] if len(hs) > 2 else "", "type": TYPE_MAP.get(ts[0], ""),
                       "weight": weight, "note": html.unescape(re.sub(r"<[^>]+>", "", desc)).strip(), "packs": list(dict.fromkeys(packs))}
    return out


def parse_products(raw: str) -> list[dict]:
    """/parts/combos：全部商品清單（代碼、名稱、發售日）"""
    out = []
    for m in re.finditer(r'<a href="/parts/combos/([^"]+)"><div><img[^>]*/></div><div>([^<]+)</div><div>([^<]+)</div><div>(\d{4}-\d{2}-\d{2})</div></a>', clean(raw)):
        out.append({"slug": m.group(1), "code": html.unescape(m.group(2)).strip(), "title": html.unescape(m.group(3)).strip(), "release": m.group(4)})
    return out


# ───────────── 同步 ─────────────
def slug(en: str, code: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", en.lower()).strip("_")
    return s or re.sub(r"[^a-z0-9]+", "_", code.lower()).strip("_")


def sync(D: dict, blades: list, ratchets: dict, bits: dict, assists: dict, products: list | None = None) -> dict:
    log = {"blades_new": [], "blades_upd": 0, "ratchets_new": [], "ratchets_upd": 0, "bits_new": [], "bits_upd": 0, "assist_new": [], "assist_upd": 0, "cx_new": [], "release_upd": 0}
    bl = D["blades"]
    by_zh_code = {(norm(b["zh"]), b.get("code", "")): i for i, b in bl.items()}
    by_zh = {}
    for i, b in bl.items():
        by_zh.setdefault(norm(b["zh"]), []).append(i)
    for c in blades:
        if c["code"].startswith(("CX", "BXH")) or not c["zh"]:
            continue  # CX 主刃／紋章等另有結構，這裡只管 BX/UX/BXG/BXA/BXH 與聯名
        key = (norm(c["zh"]), c["code"])
        bid = by_zh_code.get(key)
        if not bid:
            same = by_zh.get(norm(c["zh"]), [])
            if len(same) == 1:  # 站上同名只有一顆 → 視為同一顆（編號寫法不同不算新零件，如 BX-00 / BXG-00）
                bid = same[0]
        if bid:
            e, changed = bl[bid], False
            for k, v in (("type", c["type"]), ("spin", c["spin"]), ("weight", c["weight"]), ("code", c["code"])):
                if v and e.get(k) != v:
                    e[k], changed = v, True
            if c["fused"] and not e.get("fused"):
                e["fused"], changed = True, True
            if c["code"] and c["code"] not in e.get("aliases", []) and not c["code"].endswith("-00"):
                e.setdefault("aliases", []).append(c["code"]); changed = True
            log["blades_upd"] += int(changed)
        elif (BLADE_CODE.match(c["code"]) or (not c["code"] and c["collab"])) and c["en"]:
            nid = slug(c["en"], c["code"])
            while nid in bl:
                nid += "_2"
            e = {"zh": c["zh"], "en": c["en"], "aliases": [c["zh"]] + ([c["code"]] if c["code"] and not c["code"].endswith("-00") else []),
                 "type": c["type"], "spin": c["spin"]}
            if c["code"]:
                e["code"] = c["code"]
            if c["weight"]:
                e["weight"] = c["weight"]
            if c["fused"]:
                e["fused"] = True
            bl[nid] = e
            log["blades_new"].append(f'{c["code"] or "聯名"} {c["zh"]}')
    for code, e in ratchets.items():
        cur = D["ratchets"].get(code)
        if cur is None:
            D["ratchets"][code] = e
            log["ratchets_new"].append(code)
        elif any(v and cur.get(k) != v for k, v in e.items()):
            cur.update({k: v for k, v in e.items() if v})
            log["ratchets_upd"] += 1
    for code, e in bits.items():
        cur = D["bits"].get(code)
        if cur is None:
            D["bits"][code] = {"zh": f"{code} 軸", "en": e["en"], "aliases": [code.lower(), norm(e["en"])], **{k: v for k, v in e.items() if k != "en" and v}}
            D["bit_full_names"][e["en"]] = code
            log["bits_new"].append(f'{code} {e["en"]}')
        elif any(v and cur.get(k) != v for k, v in e.items() if k != "en"):
            cur.update({k: v for k, v in e.items() if v and k != "en"})
            log["bits_upd"] += 1
    cx = D.setdefault("cx", {})
    for letter, a in assists.items():
        cid = f"assist_{letter.lower()}"
        cur = cx.get(cid)
        if cur is None and a["zh"]:
            cx[cid] = {"role": "assist", "zh": a["zh"], "en": a["en"], "aliases": [f"{letter}輔助", f"輔助{letter}", f"assist{letter.lower()}", a["zh"], a["en"]],
                       "type": a["type"], **({"weight": a["weight"]} if a["weight"] else {}), "packs": a["packs"]}
            log["assist_new"].append(f'{letter} {a["zh"]}')
        elif cur is not None:
            changed = False
            for k in ("type", "weight"):
                if a[k] and cur.get(k) != a[k]:
                    cur[k], changed = a[k], True
            if a["packs"] and cur.get("packs") != a["packs"]:
                cur["packs"], changed = a["packs"], True
            log["assist_upd"] += int(changed)
    # 商品清單：新的 CX 整組商品自動建檔；有發售日的戰刃／商品補上 release
    for pr in products or []:
        code = pr["code"]
        for e in bl.values():
            if e.get("code") == code and pr["slug"] == code and e.get("release") != pr["release"]:
                e["release"] = pr["release"]
                log["release_upd"] += 1
        if code.startswith("CX-") and not code.endswith("-00") and pr["slug"] == code:
            cid = "cx_" + code.split("-")[1]
            name = re.sub(r"^" + re.escape(code) + r"\s*", "", pr["title"]).strip() or pr["title"]
            cur = cx.get(cid)
            if cur is None:
                cx[cid] = {"role": "product", "zh": name, "en": code, "aliases": [code, name], "code": code, "release": pr["release"],
                           "note": f"CX 整組商品；組成與詳細資料見 beybladehub.app/parts/combos/{code}"}
                log["cx_new"].append(f"{code} {name}")
            elif cur.get("release") != pr["release"]:
                cur["release"] = pr["release"]
                log["release_upd"] += 1
    return log


def dump(D: dict) -> str:
    line = lambda v: json.dumps(v, ensure_ascii=False)
    out, keys = ["{"], list(D.keys())
    for i, k in enumerate(keys):
        v, comma = D[k], "," if i < len(keys) - 1 else ""
        if isinstance(v, dict) and k in ("blades", "bits", "ratchets", "bit_full_names", "cx"):
            out.append(f"  {line(k)}: {{")
            ks = list(v.keys())
            for j, kk in enumerate(ks):
                out.append(f"    {line(kk)}: {line(v[kk])}{',' if j < len(ks) - 1 else ''}")
            out.append("  }" + comma)
        else:
            out.append(f"  {line(k)}: {line(v)}{comma}")
    out.append("}")
    return "\n".join(out) + "\n"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        blades = parse_blades(fetch("/parts/blades"))
        ratchets = parse_ratchets(fetch("/parts/ratchets"))
        bits = parse_bits(fetch("/parts/bits"))
        assists = parse_assists(fetch("/parts/blades/assist"))
        try:
            products = parse_products(fetch("/parts/combos"))
        except Exception as e:  # 商品清單抓失敗不影響其他零件
            print(f"[warn] 商品清單抓取失敗：{e}", file=sys.stderr)
            products = []
    except Exception as e:
        print(f"[fail] 零件圖鑑抓取失敗：{e}（沿用舊字典）", file=sys.stderr)
        return 0
    if len(blades) < 100 or len(ratchets) < 20 or len(bits) < 30:  # 防呆：解析結果異常少 = 頁面改版
        print(f"[warn] 零件圖鑑解析結果異常少（戰刃 {len(blades)}、固鎖 {len(ratchets)}、軸心 {len(bits)}），略過", file=sys.stderr)
        return 0
    D = json.loads(DICT.read_text(encoding="utf-8"))
    before = dump(D)
    log = sync(D, blades, ratchets, bits, assists, products)
    after = dump(D)
    if after == before:
        print(f"零件圖鑑沒有變化（戰刃 {len(blades)}、固鎖 {len(ratchets)}、軸心 {len(bits)}、輔助 {len(assists)}）")
        return 0
    DICT.write_text(after, encoding="utf-8")
    print("零件圖鑑已更新：" + json.dumps(log, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

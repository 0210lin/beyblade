#!/usr/bin/env python3
"""
產生 data/events.json（雙北賽事查詢用）。只收台北市、新北市，其他地區一律不收。

資料來源（皆為人工整理，非官方）：
  1. beybladehub.app/events 的「比賽場次」行事曆（店家/百貨例行賽，每個場館有固定時段與日期）
  2. FB 社團「台灣戰鬥陀螺賽事聚會交流平台」的賽事貼文（含海報圖片內容）

更新方式：編輯下面的 STORES / FB_EVENTS，執行  python scraper/build_events.py  後 commit。
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "events.json"
HUB = "https://beybladehub.app/events"
FB_GROUP = "https://www.facebook.com/groups/142568699573430/"

# 場館|地址|時間|上限|報名方式|日期:組別,...   （組別：公開/通常/公開通常）
STORES = """
中興巔峰對決|臺北市中正區中華路二段305巷9號|19:30|48|先聯絡主辦報名（私人辦賽）|11-18:通常,12-09:通常,12-30:公開
M.M小舖|台北市中山區松江路259巷36號一樓|14:00|16|先線上報名|11-21:公開,11-28:公開,12-12:公開,12-26:公開
玩具e哥忠順全聯店|台北市文山區忠順街二段22號1樓|13:00|24|先線上報名|11-21:公開,11-22:通常,12-12:公開,12-13:通常,12-19:公開,12-20:通常
遠東SOGO百貨忠孝館|台北市大安區忠孝東路四段45號10樓|14:00|32|現場報名|11-21:公開,12-05:公開
CardMaster|台北市中正區南昌路二段47號1樓|10:30|64|先在門市社群報名|11-21:通常,11-28:公開,12-05:通常,12-12:公開,12-19:通常,12-26:公開
遠東SOGO百貨大巨蛋店|台北市信義區忠孝東路四段505號5樓|14:00|32|先線上報名|11-29:公開
萬華 - 夾子園|臺北市萬華區艋舺大道101號|14:00／19:00|32|可先線上報名，現場有名額也收|11-21:通常,11-27:公開,12-05:通常,12-11:公開,12-18:公開
昇恆昌|台北市內湖區金莊路129號5樓|13:00|32|可先線上報名，現場有名額也收|11-29:公開,12-12:公開,12-19:公開
站前新光|台北市中正區忠孝西路一段66號8樓|14:00|32|現場報名|12-13:公開
蒙面加菲貓玩具店|台北市內湖區港華街89號一樓|14:00|32|先線上報名|11-22:通常,12-13:通常,12-25:公開
TTC小車工作室|台北市士林區承德路四段80巷45號|15:00|16|先線上報名|11-28:公開,11-29:公開,12-26:公開,12-27:公開
潤泰南港車站店|台北市南港區忠孝東路七段369號A棟3樓|14:00|32|現場報名|12-12:公開
三越南西|臺北市中山區南京西路12號|14:00|32|現場報名|12-12:公開
東東玩具城|台北市大同區太原路54號|11:00|64|先在門市社群報名|11-29:通常,12-06:公開
東奇百貨|台北市大同區太原路52號|11:00|64|先在門市社群報名|11-22:公開,12-13:通常,12-20:公開
FUN星球親子樂園|台北市松山區長春路357號|13:30|32|可先線上報名，現場有名額也收|11-29:公開,12-06:通常,12-13:公開,12-20:通常,12-27:公開
芃芃玩具店|台北市大同區太原路100號|15:00／17:00|32|現場報名|12-06:公開通常,12-20:公開通常
遠百信義A13|台北市信義區松仁路58號5樓|14:00|32|現場報名|11-29:通常
玩具超人|新北市永和區永利路132號|14:00／16:00|32|先線上報名|11-25:公開通常,12-09:公開通常,12-23:公開通常
玩具e哥新店建國店|新北市新店區建國路268號1樓|13:00|24|先線上報名|11-28:公開,12-05:公開,12-26:公開
玩具e哥新莊昌隆|新北市新莊區昌隆街83號1樓|14:00|16|現場報名|11-28:公開
玩巨帝國 八德店|新北市樹林區八德街321號|14:30|32|先線上報名|11-22:公開,11-29:公開,12-06:公開,12-13:公開,12-20:公開,12-27:公開
玩具e哥汐止龍安|新北市汐止區龍安路28巷6號B1|14:00|16|現場報名|12-06:公開
老虎歡樂世界-新莊店|新北市新莊區幸福路763號3樓|14:00|16|現場報名|12-12:公開
怪獸電玩|新北市永和區中山路一段146號|22:00|32|現場報名|11-24:公開,12-15:公開,12-29:公開
頑聚PLUS|新北市蘆洲區民權路6-1號|14:00|16|先在門市社群報名|11-22:公開,12-13:通常,12-20:公開
新莊佳瑪TOY WORLD|新北市新莊區幸福路763號3樓|13:00／19:00|16|現場報名|11-22:公開,11-24:通常,11-28:公開,12-05:通常,12-09:公開,12-14:通常,12-28:公開
優兒寶|新北市蘆洲區復興路266號|15:30|32|先線上報名|11-22:通常,11-29:公開,12-06:公開,12-13:通常,12-20:通常,12-27:公開
失控事務所|新北市泰山區仁愛路76號1樓|20:00|32|先線上報名|12-05:公開,12-12:公開
佳發玩具|新北市樹林區俊英街82-1號|10:00|32|先線上報名|11-22:公開,11-29:公開,12-06:公開,12-13:公開,12-20:公開,12-27:公開
夾子園-中和K霸|新北市中和區中山路二段369號|19:00|32|可先線上報名，現場有名額也收|11-19:公開,11-26:通常,12-02:公開,12-09:通常,12-16:公開,12-23:通常
卡咖王國|新北市林口區文化二路一段390號3樓之3|13:30|32|現場報名|11-22:公開,12-06:公開,12-20:公開
模Gu模Gu|新北市新莊區公園路106號|14:00|32|先在門市社群報名|11-21:公開,11-29:公開,12-05:公開,12-13:公開,12-19:公開,12-27:公開
樂寶|新北市蘆洲區中山一路339巷25號|14:30|32|先在門市社群報名|11-22:公開,12-06:公開,12-20:公開
ToyWorld新店碧潭|新北市新店區北宜路一段16號2樓|13:00|32|先線上報名|12-06:公開,12-20:公開
趣公園 玩具店|新北市三重區正義南路179號|16:00|16|先在門市社群報名|11-28:通常,11-29:公開,12-05:通常,12-06:公開,12-12:通常,12-20:公開
萬家福-新店店|新北市新店區中興路三段1號|15:00|16|可先線上報名，現場有名額也收|11-29:公開
王城玩具|新北市新莊區昌盛街19號|15:00／17:00|16|先在門市社群報名|11-21:公開通常,12-05:公開通常,12-19:公開通常
板橋遠東|新北市板橋區中山路一段152號8樓|14:00|32|現場報名|12-12:公開
玩具e哥新店中央店|新北市新店區中央路159號1樓104櫃|19:00|24|先線上報名|11-20:公開,12-18:公開
夾子園-中和|新北市中和區中正路305號|18:00|32|可先線上報名，現場有名額也收|11-20:公開,12-04:公開,12-11:通常,12-18:公開
玩具e哥土城裕民|新北市土城區裕民路116號B1|13:00|16|先線上報名|11-22:公開,12-06:公開,12-20:公開
夾子園-汐止|新北市汐止區大同路一段122號|19:00|32|可先線上報名，現場有名額也收|11-17:通常,11-18:公開,11-25:通常,12-08:公開,12-15:通常,12-22:公開,12-28:通常
孩子王玩具倉庫|新北市五股區自強路59號1樓|12:00／15:00|64|先線上報名|12-06:公開通常
蘆洲 - 夾子園|新北市蘆洲區中山二路290號|19:00|32|可先線上報名，現場有名額也收|11-19:公開,11-26:通常,12-03:通常,12-10:公開,12-17:通常,12-24:公開
森寶文具|新北市五股區新五路三段25號|13:30／14:30|16|先線上報名|11-22:通常公開,12-12:公開通常
"""

# FB 社團賽事貼文（2026-11-16 整理）。link = 報名連結（貼文有給才填，否則留空，機器人會改附社團連結）
FB_EVENTS = [
    dict(date="2026-11-21", name="野鳥突襲（三場連續賽）", venue="台北市基隆路（詳細地點見貼文）", address="台北市基隆路",
         time="18:40／20:30／22:20", checkin="18:00／20:00／21:40", fee="第一場 成人280・12歲以下250；第二場 成人250・12歲以下200；第三場 成人250",
         cap=None, divisions=["公開組"], reg="填表報名", link="https://forms.gle/kQ3r41MbohVrh95TA",
         note="禁止盜版陀螺；獎池含 BX-53 豪華對戰組、UX-03、UX-15 等"),
    dict(date="2026-11-21", name="中原盃 S5", venue="紅茶巴士中原站", address="新北市新莊區中原路241號",
         time="15:00", checkin="14:00", fee="12歲以下250・13歲以上300", cap=32, divisions=["公開組", "通常組"],
         reg="加入社群報名（社群置頂貼文）", link="",
         note="16人開賽、上限32人；依年齡分流；神杖/鯊魚/空力天馬/女武神最多擇一使用"),
    dict(date="2026-11-21", name="北投智仁里 x 空力盃", venue="智仁里里辦公處", address="臺北市北投區智仁里杏林二路74巷3號1樓",
         time="19:00", checkin="18:30", fee="250（現場繳費）", cap=48, divisions=["公開組"],
         reg="加入北投陀友會 LINE 報名", link="https://lurl.cc/PaXVNR",
         note="32人開賽、上限48人；賽後加賽「狂熱攻擊之夜」100元"),
    dict(date="2026-11-21", name="螺生門｜林佬盃", venue="盒作今酷", address="新北市蘆洲區中山一路74巷2號1樓",
         time="15:10", checkin="14:30", fee="350", cap=48, divisions=["公開組"],
         reg="填表報名／加入螺生門社群", link="",
         note="24人開賽、上限48人；獎池含 CX-20、UX-21、BX-52"),
    dict(date="2026-11-18", name="BINGO盃 第八屆", venue="樹林興仁花園夜市 攤位I33", address="新北市樹林區興仁花園夜市",
         time="19:30", checkin="19:00", fee="300（續命250，限一次）", cap=24, divisions=["公開組"],
         reg="填表報名", link="", note="滿16人開賽、上限24人"),
    # 東fun：海報圖片內容（11/18 三、11/20 五、11/21 六，每天三場）
    *[dict(date=d, name="東fun 11月賽事", venue="東fun", address="新北市板橋區雨農路8號",
           time="19:00／20:40／22:00", checkin="", fee="雙人賽1000/組・限定賽600・例行賽300", cap=None, divisions=["公開組"],
           reg="加入社群報名（群組記事本 +1）或現場報名", link="",
           note="19:00 雙人賽（24組開賽）、20:40 限定賽（48人開賽）、22:00 例行賽（24人開賽）；資料取自海報圖片")
      for d in ("2026-11-18", "2026-11-20", "2026-11-21")],
]

DIV = {"公開": ["公開組"], "通常": ["通常組"], "公開通常": ["公開組", "通常組"], "通常公開": ["公開組", "通常組"]}
DISTRICT = re.compile(r"(?:台北市|臺北市|新北市)([^\d路街]{1,3}區)")


def district_of(address: str) -> str:
    m = DISTRICT.search(address)
    return m.group(1) if m else ""


def city_of(address: str) -> str:
    return "新北市" if address.startswith("新北") else "台北市"


def map_url(venue: str, address: str) -> str:
    return "https://www.google.com/maps/search/?api=1&query=" + quote(f"{venue} {address}")


def static_store_events():
    events = []
    for line in STORES.strip().splitlines():
        name, addr, time, cap, reg, dates = line.split("|")
        for item in dates.split(","):
            md, div = item.split(":")
            events.append(dict(
                date=f"2026-{md}", name=name, venue=name, address=addr, city=city_of(addr), district=district_of(addr),
                time=time, checkin="", fee="", cap=int(cap), divisions=DIV[div], reg=reg, link="", note="",
                kind="store", source="beybladehub.app/events", source_url=HUB, map=map_url(name, addr),
            ))
    return events


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from hub_events import fetch_hub_events, taipei_today

    today = taipei_today().isoformat()
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"events": []}

    # 1) 店家／百貨例行賽：優先即時抓 beybladehub.app/events；失敗就沿用上一版，再不行用檔內靜態資料
    stores, how = None, ""
    try:
        scraped = [e for e in fetch_hub_events() if e["date"] >= today]
        if len(scraped) >= 20:  # 防呆：解析結果太少 = 頁面改版或抓壞，不採用
            stores, how = scraped, "即時抓取 beybladehub.app"
        else:
            print(f"[warn] 只解析到 {len(scraped)} 場，疑似頁面改版，沿用舊資料", file=sys.stderr)
    except Exception as e:
        print(f"[warn] 抓取 beybladehub.app 失敗：{e}", file=sys.stderr)
    if stores is None:
        prev = [e for e in old.get("events", []) if e.get("kind") == "store"]
        stores, how = (prev, "沿用上一版") if prev else (static_store_events(), "檔內靜態資料")

    # 2) FB 社團賽事（人工整理）
    tournaments = []
    for e in FB_EVENTS:
        e = dict(e)
        e.update(city=city_of(e["address"]), district=district_of(e["address"]), kind="tournament",
                 source="FB 台灣戰鬥陀螺賽事聚會交流平台", source_url=FB_GROUP, map=map_url(e["venue"], e["address"]))
        tournaments.append(e)

    events = [e for e in stores + tournaments if e["date"] >= today]  # 過期的直接移除
    events.sort(key=lambda e: (e["date"], e["time"], e["name"]))
    assert all(e["city"] in ("台北市", "新北市") for e in events), "只能收雙北"
    doc = {"updated_at": today, "note": "只收雙北（台北市、新北市）。店家例行賽取自 beybladehub.app/events；FB 賽事取自社團貼文與海報，皆非官方資料，實際以主辦公告為準。", "events": events}
    new_text = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
    # 內容沒變就不重寫（避免排程每次都產生 commit：只有 updated_at 變動不算）
    try:
        prev_doc = json.loads(OUT.read_text(encoding="utf-8"))
        if prev_doc.get("events") == events:
            print(f"events 沒有變化（{len(events)} 場，{how}）")
            return 0
    except Exception:
        pass
    OUT.write_text(new_text, encoding="utf-8")
    print(f"events: {len(events)}（FB 賽事 {len(tournaments)}；{how}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

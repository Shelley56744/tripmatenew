"""
把各平台抓回來的原始資料整合成「模組四」的大阪景點資料集。

輸入（有幾個用幾個，Google Maps 是必要的，因為它決定有哪些景點）：
    raw/google_places.json        ← fetch_google_places.py
    raw/ptt_posts.jsonl           ← fetch_ptt.py
    raw/threads_posts.jsonl       ← fetch_threads.py（選用）
    manual/social_posts_manual.csv ← Dcard／小紅書 人工收集（選用）

輸出：
    output/osaka_travel_dataset.csv   規格書的 16 個核心欄位 + 可回查的來源欄位
    output/osaka_spots.json           同一份資料，給 App 直接讀
    output/build_report.txt           統計摘要（每個來源貢獻多少、對到多少景點）

用法：
    python3 build_dataset.py
    python3 build_dataset.py --min-reviews 50     # 評論數太少的店家不收
"""
import argparse
import csv
import json
import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from config import (
    ALIASES, AREAS, CATEGORIES, CATEGORY_BY_NAME, CATEGORY_PERSONA_PRIOR, EXCLUDE_TYPES,
    FOOD_TYPES_SUFFIX, HIDDEN_GEM_MAX_COUNT, HIDDEN_GEM_MIN_RATING, KIX, MANUAL_DIR, NAMBA,
    OSAKA_CENTER, OUT_DIR, PAIN_RES, PERSONA_LABEL, PERSONA_RES, PRICE_LEVEL_JPY,
    PRIVATE_POSITIVE_RE, PRIVATE_WARN_RE, RAW_DIR, TYPE_TO_CATEGORY,
)

CORE_COLUMNS = [
    "spot_id", "spot_name", "location_area", "category",
    "cross_platform_sources", "avg_rating", "est_stay_mins",
    "budget_jpy", "mobility_fit", "newest_indicator",
    "popular_indicator", "private_indicator", "primary_persona_tag",
    "traveler_pain_point", "consensus_weight", "real_review_snippet",
]
EXTRA_COLUMNS = [
    "google_rating_count", "lat", "lng", "area_distance_km", "budget_source",
    "ptt_mentions", "threads_mentions", "manual_mentions", "latest_mention_date",
    "google_place_id", "google_maps_url", "source_urls", "fetched_at",
]

# 名稱比對時不能單獨當成景點名的字（太泛，會把整個區的文章都算進來）
GENERIC_KEYS = {
    "大阪", "難波", "梅田", "心齋橋", "心斎橋", "道頓堀", "新世界", "天王寺", "阿倍野", "中崎町", "日本",
    "osaka", "namba", "umeda", "japan", "咖啡", "カフェ", "cafe", "居酒屋", "神社", "商店街", "市場",
    "公園", "展望台", "本店", "餐廳", "拉麵", "ラーメン", "燒肉", "焼肉", "壽司", "寿司", "酒吧", "bar",
    "喫茶", "珈琲", "食堂", "酒場", "茶屋", "甘味", "串炸", "串カツ", "章魚燒", "たこ焼", "烏龍", "うどん", "そば",
    "環球影城", "usj", "通天閣", "大阪城",
    "大阪燒", "お好み焼", "お好み焼き", "沾麵", "つけ麺", "鰻魚飯", "炸豬排", "牛排", "和牛", "燒鳥", "焼鳥",
    "烤肉", "甜點", "麵包", "古著", "古着", "咖哩", "カレー", "天婦羅", "丼飯", "居酒", "燒肉店",
    "烏龍麵", "蕎麥麵", "壽喜燒", "串燒", "炸雞", "鬆餅", "拉麵店", "咖啡廳", "麵屋", "麺屋",
}
# 品牌名別名：店名裡出現就套用（不論分店）。其他別名都是地標，只有景點本身就是那個地標時才套用
BRAND_ALIAS = {"だるま", "わなか", "くくる", "551", "りくろー", "かに道楽"}
# 跟大阪以外的知名景點同名：貼文裡出現多半是在講別的城市（例如京都清水寺），不拿來比對
AMBIGUOUS_ELSEWHERE = {"清水寺", "金閣寺", "銀閣寺", "嵐山", "伏見稻荷", "伏見稲荷", "奈良公園", "東大寺", "八坂神社", "平等院"}
RECENT_DAYS = 90
SENTENCE_SPLIT = re.compile(r"[。！？!?\n]+")
CJK = re.compile(r"[぀-ヿ㐀-鿿]")


# ------------------------------------------------------------------ 工具
def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def parse_time(value):
    if not value:
        return None
    v = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        v = v.replace("Z", "+00:00")
        v = re.sub(r"\.(\d{6})\d+", r".\1", v)       # Google 的奈秒 → 微秒
        v = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", v)  # Threads 的 +0000 → +00:00
        dt = datetime.fromisoformat(v)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def to_int(v):
    try:
        return int(float(str(v).replace(",", "").strip() or 0))
    except ValueError:
        return 0


def specific_enough(key):
    k = key.strip()
    if not k or k.lower() in GENERIC_KEYS:
        return False
    if CJK.search(k):
        return len(k) >= 3 or (len(k) == 2 and k not in GENERIC_KEYS and not re.fullmatch(r"[぀-ゟ]{2}", k))
    return len(k) >= 5 or k.isdigit() and len(k) >= 3


def name_keys(name):
    """從 Google 名稱產生比對用的字串：去掉分店字尾、拆開空白與「・」、加上中文別名。"""
    keys = set()
    base = re.sub(r"[（(【\[].*?[）)】\]]", "", name).strip()
    base = re.sub(r"\s*(総本店|總本店|本店|分店|支店|[0-9０-９]+號店)$", "", base).strip()
    chunks = [c.strip() for c in re.split(r"[\s・/|｜\-–—:：]+", base) if c.strip()]
    # 店名多半是「品牌 分店地名」（金龍拉麵 道頓堀店、大戶屋 環球影城店）：
    # 只用整個名稱和第一段的品牌名比對，後面的分店地名不拿來比，不然會吃到整個區的文章
    for k in [base] + chunks[:1]:
        k = re.sub(r"(店)$", "", k) if len(k) > 3 else k
        if specific_enough(k) or (k == base and len(k) >= 3 and k.lower() in {"環球影城", "通天閣", "大阪城", "道頓堀", "中崎町", "新世界"}):
            keys.add(k)
    compact = base.replace(" ", "")
    for frag, aliases in ALIASES.items():
        group = [frag] + list(aliases)
        if frag in BRAND_ALIAS:
            hit = frag in name
        else:
            # 地標：名稱就是這個地標（或「地標＋公園」），才把整組別名拿來比對；
            # 「千房 道頓堀」「XX咖啡 阿倍野HARUKAS店」這種位在地標裡的店不算
            hit = any(compact == g.replace(" ", "") or compact == g.replace(" ", "") + "公園" for g in group)
        if hit:
            keys.update(a for a in group if a)
    return {k for k in keys if k not in AMBIGUOUS_ELSEWHERE}


def sentences_around(text, key, limit=6):
    """取出「提到這個景點的那一句」（以句號、驚嘆號、問號、換行切句），一篇最多取 limit 句。
    長文常常一路講好幾個地方，只看那一句，痛點和摘錄才不會張冠李戴。"""
    out = []
    start = 0
    while len(out) < limit:
        i = text.find(key, start)
        if i < 0:
            break
        left = max(text.rfind(c, 0, i) for c in "。！？!?\n")
        rights = [j for j in (text.find(c, i + len(key)) for c in "。！？!?\n") if j >= 0]
        right = min(rights) if rights else len(text)
        sent = text[left + 1: right].strip()
        if len(sent) > 160:
            sent = text[max(left + 1, i - 70): min(right, i + len(key) + 70)].strip()
        if sent and sent not in out:
            out.append(sent)
        start = i + len(key)
    return out


def best_sentence(texts, pattern=None, key=None, limit=70):
    for t in texts:
        for s in SENTENCE_SPLIT.split(t):
            s = s.strip(" 　\t-—~～*")
            if len(s) < 8:
                continue
            if pattern and not pattern.search(s):
                continue
            if key and key not in s:
                continue
            return s if len(s) <= limit else s[: limit - 1] + "…"
    return None


# ------------------------------------------------------------------ 讀資料
def load_google():
    path = RAW_DIR / "google_places.json"
    if not path.exists():
        raise SystemExit("找不到 raw/google_places.json，請先跑 fetch_google_places.py。")
    return json.loads(path.read_text(encoding="utf-8"))


def load_posts():
    posts = []
    ptt = RAW_DIR / "ptt_posts.jsonl"
    if ptt.exists():
        for line in ptt.read_text(encoding="utf-8").splitlines():
            try:
                p = json.loads(line)
            except ValueError:
                continue
            push_text = "\n".join(x["text"] for x in p.get("pushes", []))
            posts.append({
                "source": "PTT", "url": p["url"], "title": p.get("title", ""),
                "text": p.get("text", ""), "extra": push_text,
                "posted_at": parse_time(p.get("posted_at")),
                "engagement": p.get("push", 0) - p.get("boo", 0),
            })
    th = RAW_DIR / "threads_posts.jsonl"
    if th.exists():
        for line in th.read_text(encoding="utf-8").splitlines():
            try:
                p = json.loads(line)
            except ValueError:
                continue
            posts.append({
                "source": "Threads", "url": p.get("url"), "title": "", "text": p.get("text", ""), "extra": "",
                "posted_at": parse_time(p.get("posted_at")), "engagement": 0,
            })
    manual = MANUAL_DIR / "social_posts_manual.csv"
    if manual.exists():
        with manual.open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if not (row.get("url") or "").strip():
                    continue
                platform = (row.get("platform") or "manual").strip()
                posts.append({
                    "source": {"dcard": "Dcard", "xiaohongshu": "小紅書", "threads": "Threads"}.get(platform.lower(), platform),
                    "url": row["url"].strip(), "title": row.get("title", ""),
                    "text": row.get("text_excerpt", ""), "extra": "",
                    "spot_hint": (row.get("spot_hint") or "").strip(),
                    "posted_at": parse_time(row.get("post_date")),
                    "engagement": to_int(row.get("likes")) + to_int(row.get("saves")) + to_int(row.get("comments")),
                    "manual": True,
                })
    return posts


# ------------------------------------------------------------------ 分類
def pick_category(place):
    ptype = place.get("primaryType") or ""
    types = set(place.get("types") or [])
    if ptype in TYPE_TO_CATEGORY:
        return TYPE_TO_CATEGORY[ptype]
    if ptype.endswith(FOOD_TYPES_SUFFIX) or ptype in {"restaurant", "food", "meal_takeaway", "bakery", "dessert_shop"}:
        return "排隊名店/街頭美食"
    for t in types:
        if t in TYPE_TO_CATEGORY:
            return TYPE_TO_CATEGORY[t]
    queried = [q.split("|", 1)[1] for q in place.get("_queries", []) if "|" in q]
    return queried[0] if queried else CATEGORIES[0]["name"]


def nearest_area(lat, lng):
    best = min(AREAS, key=lambda a: haversine_km(lat, lng, a["lat"], a["lng"]))
    return best["name"], haversine_km(lat, lng, best["lat"], best["lng"])


def budget_of(place, category):
    pr = place.get("priceRange") or {}
    vals = []
    for k in ("startPrice", "endPrice"):
        p = pr.get(k) or {}
        if p.get("currencyCode") == "JPY" and p.get("units"):
            vals.append(to_int(p["units"]))
    if vals:
        return round(sum(vals) / len(vals)), "Google 價格區間"
    level = place.get("priceLevel")
    if level in PRICE_LEVEL_JPY:
        return PRICE_LEVEL_JPY[level], "Google 價位等級換算（估算）"
    return CATEGORY_BY_NAME[category]["jpy"], "類別預估"


def mobility_of(lat, lng):
    if haversine_km(lat, lng, KIX["lat"], KIX["lng"]) < 12:
        return "yoxi機場/短程接送"
    if haversine_km(lat, lng, NAMBA["lat"], NAMBA["lng"]) > 15:
        return "TOYOTA海外租車自駕"
    return "大阪Metro/步行直達"


def consensus_weight(rating, count, mentions):
    """1–10：評分（3.5→0、5.0→4 分）＋ 評論數（對數，5 萬則≈4 分）＋ 社群討論（10 篇以上滿 2 分）"""
    r = max(0.0, min(1.0, ((rating or 0) - 3.5) / 1.5)) * 4
    c = min(1.0, math.log10((count or 0) + 1) / math.log10(50000)) * 4
    m = min(mentions, 10) / 10 * 2
    return max(1, min(10, round(r + c + m)))


# ------------------------------------------------------------------ 主流程
def build(min_reviews=20):
    g = load_google()
    posts = load_posts()
    for p in posts:
        p["blob"] = f"{p['title']}\n{p['text']}\n{p['extra']}"
        p["blob_lower"] = p["blob"].lower()

    now = max([p["posted_at"] for p in posts if p.get("posted_at")] + [datetime.now(timezone.utc)])
    stats = Counter()
    spots = []

    for place in g["places"].values():
        name = (place.get("displayName") or {}).get("text") or ""
        loc = place.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        types = set(place.get("types") or [])
        count = place.get("userRatingCount") or 0
        if not name or lat is None:
            stats["略過：缺名稱或座標"] += 1
            continue
        if place.get("businessStatus") == "CLOSED_PERMANENTLY":
            stats["略過：已歇業"] += 1
            continue
        if types & EXCLUDE_TYPES and not (types & set(TYPE_TO_CATEGORY)):
            stats["略過：非景點類型（車站、飯店等）"] += 1
            continue
        if count < min_reviews:
            stats[f"略過：評論少於 {min_reviews} 則"] += 1
            continue
        if haversine_km(lat, lng, OSAKA_CENTER["lat"], OSAKA_CENTER["lng"]) > 60:
            stats["略過：不在大阪周邊"] += 1
            continue

        category = pick_category(place)
        area, area_km = nearest_area(lat, lng)
        rating = place.get("rating")
        reviews = place.get("reviews") or []
        review_texts = [((rv.get("text") or {}).get("text") or "") for rv in reviews]

        # ---- 對到哪些社群貼文
        keys = name_keys(name)
        matched, windows, post_snips = [], [], []
        for p in posts:
            hint = p.get("spot_hint")
            hit = None
            if hint and (hint in name or name in hint or hint in keys):
                hit = hint
            else:
                for k in keys:
                    if (k in p["blob"]) if CJK.search(k) else (k.lower() in p["blob_lower"]):
                        hit = k
                        break
            if hit:
                matched.append(p)
                near = sentences_around(p["blob"], hit) or [p["title"]]
                windows.extend(near)
                label = f"{p['source']}《{p['title'][:18]}》" if p.get("title") else p["source"]
                post_snips.extend((w, label, hit) for w in near[:2])

        by_src = Counter(p["source"] for p in matched)
        dated = [p for p in matched if p.get("posted_at")]
        latest = max(dated, key=lambda p: p["posted_at"]) if dated else None
        recent = [p for p in dated if p["posted_at"] >= now - timedelta(days=RECENT_DAYS)]
        review_times = [parse_time(rv.get("publishTime")) for rv in reviews]
        review_times = [t for t in review_times if t]

        # ---- Newest：最近一次被討論／評論是什麼時候
        newest = []
        if latest:
            newest.append(f"{latest['source']}最新提及 {latest['posted_at']:%Y-%m-%d}（近{RECENT_DAYS}天 {len(recent)} 篇）")
        if review_times:
            newest.append(f"Google最新評論 {max(review_times):%Y-%m-%d}")
        newest_indicator = "；".join(newest) or "近期無討論"

        # ---- Popular：評分、評論數、社群聲量
        popular = [f"Google {rating}★／{count:,} 則評論" if rating else f"Google {count:,} 則評論"]
        if by_src.get("PTT"):
            pushes = sum(p["engagement"] for p in matched if p["source"] == "PTT")
            popular.append(f"PTT {by_src['PTT']} 篇（淨推 {pushes}）")
        for src in ("Threads", "Dcard", "小紅書"):
            if by_src.get(src):
                eng = sum(p["engagement"] for p in matched if p["source"] == src)
                popular.append(f"{src} {by_src[src]} 篇" + (f"（互動 {eng:,}）" if eng else ""))
        popular_indicator = "；".join(popular)

        # ---- Private：小眾高分、私房／避雷提及
        corpus = review_texts + windows
        private = []
        if rating and rating >= HIDDEN_GEM_MIN_RATING and count <= HIDDEN_GEM_MAX_COUNT:
            private.append(f"小眾高分（{rating}★、{count:,} 則評論）")
        pos = sum(1 for t in corpus if PRIVATE_POSITIVE_RE.search(t))
        warn = sum(1 for t in corpus if PRIVATE_WARN_RE.search(t))
        if pos:
            private.append(f"私房／在地推薦提及 {pos} 次")
        if warn:
            private.append(f"避雷提及 {warn} 次")
        private_indicator = "；".join(private) or "非小眾常規點"

        # ---- 痛點與真實摘錄
        pain_hits = Counter()
        for t in corpus:
            for label, rx in PAIN_RES:
                if rx.search(t):
                    pain_hits[label] += 1
        pain_label, pain_n = (pain_hits.most_common(1)[0] if pain_hits else (None, 0))
        pain_rx = dict(PAIN_RES).get(pain_label) if pain_label else None

        snippet, snippet_src = None, None
        # 摘錄優先順序：Google 評論 → 社群貼文（貼文只取提到這個景點的那一句）
        sources_for_snippet = [(review_texts[i], f"Google評論・{(rv.get('authorAttribution') or {}).get('displayName', '匿名')}", None) for i, rv in enumerate(reviews)]
        sources_for_snippet += post_snips
        if pain_rx:
            for text, src, _ in sources_for_snippet:
                s = best_sentence([text], pattern=pain_rx)
                if s:
                    snippet, snippet_src = s, src
                    break
        if not snippet:
            for text, src, hit in sources_for_snippet:
                s = best_sentence([text], key=hit)
                if s:
                    snippet, snippet_src = s, src
                    break
        traveler_pain_point = f"{pain_label}（{pain_n} 則提及）" if pain_label else "未出現明顯痛點"
        real_review_snippet = f"「{snippet}」— {snippet_src}" if snippet else ""

        # ---- 人格標籤：類別起手分 + 評論／貼文關鍵字
        # 關鍵字用「命中的文字比例」計分，不然討論多的景點會被常見字灌爆
        score = Counter(CATEGORY_PERSONA_PRIOR.get(category, {}))
        if corpus:
            for k, rx in PERSONA_RES.items():
                score[k] += 4 * sum(1 for t in corpus if rx.search(t)) / len(corpus)
        persona = score.most_common(1)[0][0] if score else "explorer"

        # ---- 時間、花費、交通
        mins = CATEGORY_BY_NAME[category]["mins"]
        if "amusement_park" in types and count > 20000:
            mins = 480
        budget, budget_src = budget_of(place, category)

        sources = ["GoogleMaps"] + [s for s in ("PTT", "Threads", "Dcard", "小紅書") if by_src.get(s)]
        sources += [s for s in by_src if s not in sources]
        stats["收錄"] += 1
        for s in by_src:
            stats[f"有對到 {s} 的景點"] += 1

        spots.append({
            "spot_name": name, "location_area": area, "category": category,
            "cross_platform_sources": ";".join(sources),
            "avg_rating": rating if rating is not None else "",
            "est_stay_mins": mins, "budget_jpy": budget, "mobility_fit": mobility_of(lat, lng),
            "newest_indicator": newest_indicator, "popular_indicator": popular_indicator,
            "private_indicator": private_indicator,
            "primary_persona_tag": f"{persona}（{PERSONA_LABEL[persona]}）",
            "traveler_pain_point": traveler_pain_point,
            "consensus_weight": consensus_weight(rating, count, len(matched)),
            "real_review_snippet": real_review_snippet,
            "google_rating_count": count, "lat": round(lat, 6), "lng": round(lng, 6),
            "area_distance_km": round(area_km, 2), "budget_source": budget_src,
            "ptt_mentions": by_src.get("PTT", 0), "threads_mentions": by_src.get("Threads", 0),
            "manual_mentions": sum(1 for p in matched if p.get("manual")),
            "latest_mention_date": f"{latest['posted_at']:%Y-%m-%d}" if latest else "",
            "google_place_id": place.get("id"), "google_maps_url": place.get("googleMapsUri", ""),
            "source_urls": " ".join(sorted({p["url"] for p in matched if p.get("url")})[:5]),
            "fetched_at": place.get("_fetched_at", ""),
        })

    # 依熱門程度編號：JP_OSA_0001 是評論數最多的
    spots.sort(key=lambda s: (-s["google_rating_count"], s["spot_name"]))
    for i, s in enumerate(spots, 1):
        s["spot_id"] = f"JP_OSA_{i:04d}"

    return spots, posts, stats


def write_outputs(spots, posts, stats):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cols = CORE_COLUMNS + EXTRA_COLUMNS
    with (OUT_DIR / "osaka_travel_dataset.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for s in spots:
            w.writerow({c: s.get(c, "") for c in cols})
    (OUT_DIR / "osaka_spots.json").write_text(
        json.dumps([{c: s.get(c, "") for c in cols} for s in spots], ensure_ascii=False, indent=1), encoding="utf-8")

    src_count = Counter(p["source"] for p in posts)
    lines = [
        f"建置時間：{datetime.now():%Y-%m-%d %H:%M}",
        f"收錄景點：{len(spots)} 個",
        "社群貼文來源：" + ("、".join(f"{k} {v} 篇" for k, v in src_count.items()) or "無"),
        "",
        *[f"{k}：{v}" for k, v in sorted(stats.items())],
        "",
        "各區景點數：",
        *[f"  {k}：{v}" for k, v in Counter(s["location_area"] for s in spots).most_common()],
        "各類別景點數：",
        *[f"  {k}：{v}" for k, v in Counter(s["category"] for s in spots).most_common()],
    ]
    (OUT_DIR / "build_report.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n輸出：{OUT_DIR / 'osaka_travel_dataset.csv'}")


def main():
    ap = argparse.ArgumentParser(description="整合成模組四的大阪景點資料集")
    ap.add_argument("--min-reviews", type=int, default=20, help="Google 評論數少於這個的店家不收")
    args = ap.parse_args()
    spots, posts, stats = build(args.min_reviews)
    write_outputs(spots, posts, stats)


if __name__ == "__main__":
    main()

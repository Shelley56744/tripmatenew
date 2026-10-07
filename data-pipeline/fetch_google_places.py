"""
Google Maps 景點資料：用官方 Places API (New) 的 Text Search 抓。

為什麼不直接爬 Google Maps 網頁：Google Maps 服務條款禁止爬取，官方 API 是唯一合法的拿法。

用法：
    python3 fetch_google_places.py                # 9 區 × 7 類，共 63 組搜尋
    python3 fetch_google_places.py --pages 1      # 每組只拿第一頁（20 筆），最省
    python3 fetch_google_places.py --no-reviews   # 不抓評論（費用等級較低，但就沒有真實評論摘錄）

需要：data-pipeline/.env 裡的 GOOGLE_MAPS_API_KEY（見 README）。
可以中斷後再跑：已經抓過的搜尋組合會跳過。
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone

import requests

from config import AREAS, CATEGORIES, OSAKA_CENTER, RAW_DIR, load_env

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
BASE_FIELDS = [
    "places.id", "places.displayName", "places.formattedAddress", "places.location",
    "places.rating", "places.userRatingCount", "places.priceLevel", "places.priceRange",
    "places.types", "places.primaryType", "places.googleMapsUri",
    "places.regularOpeningHours.weekdayDescriptions", "places.businessStatus",
]
OUT_FILE = RAW_DIR / "google_places.json"


def field_mask(with_reviews, drop=()):
    fields = [f for f in BASE_FIELDS if f not in drop]
    if with_reviews:
        fields.append("places.reviews")
    return ",".join(fields + ["nextPageToken"])


def load_state():
    if OUT_FILE.exists():
        return json.loads(OUT_FILE.read_text(encoding="utf-8"))
    return {"source": "Google Places API (New) Text Search", "queries_done": [], "requests": 0, "places": {}}


def save_state(state):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUT_FILE)


def search(session, key, text, mask, page_token=None):
    body = {
        "textQuery": text,
        "languageCode": "zh-TW",
        "regionCode": "JP",
        "pageSize": 20,
        "locationBias": {
            "circle": {"center": {"latitude": OSAKA_CENTER["lat"], "longitude": OSAKA_CENTER["lng"]}, "radius": 50000.0}
        },
    }
    if page_token:
        body["pageToken"] = page_token
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, "Content-Type": "application/json"}
    for attempt in range(4):
        r = session.post(ENDPOINT, json=body, headers=headers, timeout=30)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 ** attempt * 2)
            continue
        return r
    return r


def main():
    ap = argparse.ArgumentParser(description="用 Google Places API 抓大阪景點")
    ap.add_argument("--pages", type=int, default=3, help="每組搜尋最多翻幾頁（每頁 20 筆，最多 3 頁）")
    ap.add_argument("--max-requests", type=int, default=400, help="這次最多打幾次 API（保護免費額度）")
    ap.add_argument("--no-reviews", action="store_true", help="不抓評論")
    args = ap.parse_args()

    load_env()
    import os
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        sys.exit("找不到 GOOGLE_MAPS_API_KEY。請先複製 .env.example 成 .env，把金鑰填進去（見 README）。")

    state = load_state()
    session = requests.Session()
    with_reviews = not args.no_reviews
    dropped = set()
    used = 0
    combos = [(a, c) for a in AREAS for c in CATEGORIES]
    print(f"共 {len(combos)} 組搜尋，已完成 {len(state['queries_done'])} 組。")

    for area, cat in combos:
        qid = f"{area['name']}|{cat['name']}"
        if qid in state["queries_done"]:
            continue
        text = f"大阪 {area['query']} {cat['query']}"
        token = None
        got = 0
        for page in range(args.pages):
            if used >= args.max_requests:
                save_state(state)
                print(f"已達這次的請求上限 {args.max_requests}，先停在這裡。再跑一次會從這裡接著抓。")
                return
            r = search(session, key, text, field_mask(with_reviews, dropped), token)
            used += 1
            state["requests"] = state.get("requests", 0) + 1
            if r.status_code == 400 and "priceRange" in r.text and "places.priceRange" not in dropped:
                # 舊專案或某些地區不支援 priceRange，拿掉重打一次
                dropped.add("places.priceRange")
                r = search(session, key, text, field_mask(with_reviews, dropped), token)
                used += 1
            if r.status_code != 200:
                save_state(state)
                sys.exit(f"API 回傳 {r.status_code}：{r.text[:400]}")
            data = r.json()
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            for p in data.get("places", []):
                pid = p.get("id")
                if not pid:
                    continue
                prev = state["places"].get(pid, {})
                hits = prev.get("_queries", [])
                if qid not in hits:
                    hits.append(qid)
                p["_queries"] = hits
                p["_fetched_at"] = now
                # 評論只在有拿到時覆蓋，避免 --no-reviews 重跑把舊評論洗掉
                if not p.get("reviews") and prev.get("reviews"):
                    p["reviews"] = prev["reviews"]
                state["places"][pid] = p
                got += 1
            token = data.get("nextPageToken")
            if not token:
                break
            time.sleep(1.2)
        state["queries_done"].append(qid)
        save_state(state)
        print(f"✓ {text}：{got} 筆（累計 {len(state['places'])} 個不重複景點，這次已用 {used} 次請求）")
        time.sleep(0.5)

    save_state(state)
    print(f"完成。共 {len(state['places'])} 個不重複景點，存在 {OUT_FILE}")


if __name__ == "__main__":
    main()

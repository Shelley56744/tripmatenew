"""
Threads（脆）：用 Meta 官方 Threads API 的 keyword_search 抓公開貼文。

注意：
- 需要在 Meta for Developers 建立 Threads App，拿到使用者存取權杖（THREADS_ACCESS_TOKEN）
- App 沒通過 threads_keyword_search 權限審核前，搜尋結果「只會有你自己帳號的貼文」。
  所以第一次跑如果全部是 0 筆，不是程式壞了，是權限還沒過。
- 一個使用者 24 小時內最多 2,200 次搜尋；這支腳本預設只打十幾次。

用法：
    python3 fetch_threads.py
    python3 fetch_threads.py --since 2025-01-01 --type RECENT
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

from config import RAW_DIR, THREADS_QUERIES, load_env

ENDPOINT = "https://graph.threads.net/v1.0/keyword_search"
OUT_FILE = RAW_DIR / "threads_posts.jsonl"


def main():
    ap = argparse.ArgumentParser(description="用 Threads 官方 API 搜尋大阪貼文")
    ap.add_argument("--since", default="2024-01-01", help="只要這天以後的貼文（YYYY-MM-DD）")
    ap.add_argument("--type", default="TOP", choices=["TOP", "RECENT"], help="熱門或最新")
    ap.add_argument("--queries", nargs="*", default=THREADS_QUERIES)
    args = ap.parse_args()

    load_env()
    token = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
    if not token:
        sys.exit("找不到 THREADS_ACCESS_TOKEN。沒有的話可以先跳過 Threads，其他來源照樣能整合（見 README）。")

    since = int(datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    seen = set()
    if OUT_FILE.exists():
        for line in OUT_FILE.read_text(encoding="utf-8").splitlines():
            try:
                seen.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                pass

    total = 0
    with OUT_FILE.open("a", encoding="utf-8") as f:
        for q in args.queries:
            params = {
                "q": q, "search_type": args.type, "since": since, "limit": 100,
                "fields": "id,text,media_type,permalink,timestamp",
                "access_token": token,
            }
            r = requests.get(ENDPOINT, params=params, timeout=30)
            if r.status_code != 200:
                print(f"✗「{q}」{r.status_code}：{r.text[:300]}")
                continue
            posts = r.json().get("data", [])
            new = 0
            for p in posts:
                if p.get("id") in seen or not p.get("text"):
                    continue
                seen.add(p["id"])
                f.write(json.dumps({
                    "source": "Threads", "id": p["id"], "url": p.get("permalink"),
                    "posted_at": p.get("timestamp"), "text": p["text"][:3000], "query": q,
                    "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                }, ensure_ascii=False) + "\n")
                new += 1
            total += new
            print(f"✓「{q}」{len(posts)} 筆，新增 {new}")
            time.sleep(1)

    if total == 0:
        print("一筆都沒有：多半是 App 還沒通過 threads_keyword_search 審核（只能搜到自己的貼文）。")
    print(f"完成，存在 {OUT_FILE}")


if __name__ == "__main__":
    main()

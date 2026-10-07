"""
PTT Japan_Travel 板：抓大阪相關文章（遊記、問題、心得）當作台灣旅人的真實討論。

PTT 網頁版是公開的、不用登入，也沒有 robots.txt 限制；這支腳本會：
- 每次請求之間隔 1～2 秒，一次只開一條連線，不會造成網站負擔
- 只存文章內文、推噓數與推文內容，不存推文者帳號
- 可以中斷後再跑：抓過的文章會跳過

用法：
    python3 fetch_ptt.py                              # 預設關鍵字、2020 年以後、每個關鍵字最多 30 頁
    python3 fetch_ptt.py --since 2024-01-01 --max-pages 10
"""
import argparse
import json
import random
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from config import PTT_BOARD, PTT_QUERIES, RAW_DIR

BASE = "https://www.ptt.cc"
OUT_FILE = RAW_DIR / "ptt_posts.jsonl"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
OSAKA_RE = re.compile(r"大阪|關西|関西|難波|梅田|心齋橋|心斎橋|道頓堀|USJ|環球影城|新世界|通天閣|天王寺|中崎町|箕面|勝尾寺|黑門")
ARTICLE_ID_RE = re.compile(r"/M\.(\d{9,11})\.A\.[0-9A-F]{3}\.html")


def polite_sleep():
    time.sleep(1.0 + random.random())


def get(session, url):
    for attempt in range(4):
        try:
            r = session.get(url, timeout=20)
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r.text
        if r.status_code == 404:
            return None
        time.sleep(3 * (attempt + 1))
    return None


def posted_at_from_url(url):
    m = ARTICLE_ID_RE.search(url)
    if not m:
        return None
    return datetime.fromtimestamp(int(m.group(1)), tz=timezone.utc)


def parse_nrec(text):
    """推文數欄位：數字、'爆'（≥100）、'X1'～'XX'（負評），空白代表 0"""
    t = (text or "").strip()
    if not t:
        return 0
    if t == "爆":
        return 100
    if t.startswith("X"):
        return -100 if t == "XX" else -10 * int(t[1:] or 1)
    try:
        return int(t)
    except ValueError:
        return 0


def parse_list(html):
    """搜尋結果頁 → [{url, title, nrec}]（已刪除的文章沒有連結，略過）"""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for ent in soup.select("div.r-ent"):
        a = ent.select_one("div.title a")
        if not a or not a.get("href"):
            continue
        nrec = ent.select_one("div.nrec")
        rows.append({
            "url": BASE + a["href"],
            "title": a.get_text(strip=True),
            "nrec": parse_nrec(nrec.get_text() if nrec else ""),
        })
    return rows


def parse_article(html, url):
    soup = BeautifulSoup(html, "html.parser")
    main = soup.select_one("#main-content")
    if main is None:
        return None
    meta = {}
    for line in main.select("div.article-metaline, div.article-metaline-right"):
        tag = line.select_one(".article-meta-tag")
        val = line.select_one(".article-meta-value")
        if tag and val:
            meta[tag.get_text(strip=True)] = val.get_text(strip=True)
        line.decompose()

    pushes = []
    counts = {"推": 0, "噓": 0, "→": 0}
    for p in main.select("div.push"):
        tag = (p.select_one(".push-tag").get_text(strip=True) if p.select_one(".push-tag") else "")
        content = p.select_one(".push-content")
        text = content.get_text(strip=True).lstrip(":").strip() if content else ""
        if tag in counts:
            counts[tag] += 1
        if text:
            pushes.append({"tag": tag, "text": text})   # 不存推文者帳號
        p.decompose()

    body = main.get_text("\n")
    body = body.split("※ 發信站")[0].strip()
    body = re.sub(r"\n{3,}", "\n\n", body)

    title = meta.get("標題", "")
    m = re.match(r"\s*(?:Re:\s*)?\[([^\]]+)\]", title)
    posted = posted_at_from_url(url)
    return {
        "source": "PTT",
        "board": PTT_BOARD,
        "url": url,
        "title": title,
        "tag": m.group(1) if m else "",
        "posted_at": posted.isoformat() if posted else None,
        "push": counts["推"],
        "boo": counts["噓"],
        "neutral": counts["→"],
        "text": body[:6000],
        "pushes": pushes[:80],
    }


def load_done():
    done = set()
    if OUT_FILE.exists():
        for line in OUT_FILE.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["url"])
            except (ValueError, KeyError):
                pass
    return done


def main():
    ap = argparse.ArgumentParser(description="抓 PTT Japan_Travel 的大阪文章")
    ap.add_argument("--since", default="2020-01-01", help="只要這天以後的文章（YYYY-MM-DD）")
    ap.add_argument("--max-pages", type=int, default=30, help="每個關鍵字最多翻幾頁搜尋結果（每頁約 20 篇）")
    ap.add_argument("--queries", nargs="*", default=PTT_QUERIES, help="搜尋關鍵字（標題搜尋）")
    args = ap.parse_args()
    since = datetime.strptime(args.since, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    done = load_done()
    session = requests.Session()
    session.headers["User-Agent"] = UA
    session.cookies.set("over18", "1", domain=".ptt.cc")
    print(f"已經有 {len(done)} 篇，這次從關鍵字 {args.queries} 繼續。")

    queue = []
    seen = set(done)
    for q in args.queries:
        for page in range(1, args.max_pages + 1):
            url = f"{BASE}/bbs/{PTT_BOARD}/search?page={page}&q={quote(q)}"
            html = get(session, url)
            polite_sleep()
            if not html:
                break
            rows = parse_list(html)
            if not rows:
                break
            fresh = [r for r in rows if (posted_at_from_url(r["url"]) or since) >= since]
            for r in fresh:
                if r["url"] not in seen and OSAKA_RE.search(r["title"]):
                    seen.add(r["url"])
                    queue.append(r)
            print(f"  搜尋「{q}」第 {page} 頁：{len(rows)} 篇，符合條件 {len(fresh)} 篇（待抓 {len(queue)}）")
            if len(fresh) < len(rows):   # 搜尋結果由新到舊，出現比 since 舊的就不用再往下翻
                break

    with OUT_FILE.open("a", encoding="utf-8") as f:
        for i, row in enumerate(queue, 1):
            html = get(session, row["url"])
            polite_sleep()
            if not html:
                continue
            art = parse_article(html, row["url"])
            if not art:
                continue
            art["nrec"] = row["nrec"]
            art["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            f.write(json.dumps(art, ensure_ascii=False) + "\n")
            f.flush()
            if i % 20 == 0 or i == len(queue):
                print(f"✓ 文章 {i}/{len(queue)}")
    print(f"完成，存在 {OUT_FILE}")


if __name__ == "__main__":
    main()

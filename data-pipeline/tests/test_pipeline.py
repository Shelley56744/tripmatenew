"""離線測試：用 fixtures 裡手寫的範例（照官方格式）驗證解析與整合，不連網路。
執行：cd data-pipeline && python3 -m unittest discover tests
"""
import csv
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import build_dataset
import fetch_ptt

FIX = Path(__file__).parent / "fixtures"


class PttParsing(unittest.TestCase):
    def test_list(self):
        rows = fetch_ptt.parse_list((FIX / "ptt_search.html").read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 2)                      # 被刪除的文章沒有連結，要略過
        self.assertEqual(rows[0]["nrec"], 35)
        self.assertEqual(rows[1]["nrec"], 100)              # 「爆」
        self.assertTrue(rows[0]["url"].startswith("https://www.ptt.cc/bbs/Japan_Travel/M."))

    def test_nrec(self):
        self.assertEqual(fetch_ptt.parse_nrec("X3"), -30)
        self.assertEqual(fetch_ptt.parse_nrec(""), 0)

    def test_article(self):
        url = "https://www.ptt.cc/bbs/Japan_Travel/M.1725926400.A.1A2.html"
        art = fetch_ptt.parse_article((FIX / "ptt_article.html").read_text(encoding="utf-8"), url)
        self.assertEqual(art["tag"], "遊記")
        self.assertEqual((art["push"], art["boo"], art["neutral"]), (1, 1, 1))
        self.assertIn("達摩串炸", art["text"])
        self.assertNotIn("發信站", art["text"])
        self.assertNotIn("作者", art["text"])
        self.assertTrue(art["posted_at"].startswith("2024-09-10"))
        self.assertNotIn("userA", json.dumps(art, ensure_ascii=False))   # 不存推文者帳號


class Build(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        raw, manual, out = self.tmp / "raw", self.tmp / "manual", self.tmp / "output"
        raw.mkdir(); manual.mkdir()
        shutil.copy(FIX / "google_places.json", raw / "google_places.json")
        url = "https://www.ptt.cc/bbs/Japan_Travel/M.1725926400.A.1A2.html"
        art = fetch_ptt.parse_article((FIX / "ptt_article.html").read_text(encoding="utf-8"), url)
        (raw / "ptt_posts.jsonl").write_text(json.dumps(art, ensure_ascii=False) + "\n", encoding="utf-8")
        with (manual / "social_posts_manual.csv").open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["platform", "url", "post_date", "title", "text_excerpt", "likes", "saves", "comments", "spot_hint"])
            w.writerow(["dcard", "https://www.dcard.tw/f/travel/p/0", "2026-09-20", "大阪咖啡", "中崎町這間很私房", "120", "30", "5", "測試喫茶"])
        self.patches = {"RAW_DIR": build_dataset.RAW_DIR, "MANUAL_DIR": build_dataset.MANUAL_DIR, "OUT_DIR": build_dataset.OUT_DIR}
        build_dataset.RAW_DIR, build_dataset.MANUAL_DIR, build_dataset.OUT_DIR = raw, manual, out

    def tearDown(self):
        for k, v in self.patches.items():
            setattr(build_dataset, k, v)
        shutil.rmtree(self.tmp)

    def test_build(self):
        spots, posts, stats = build_dataset.build(min_reviews=20)
        build_dataset.write_outputs(spots, posts, stats)
        names = [s["spot_name"] for s in spots]
        self.assertEqual(len(spots), 2)                       # 飯店、歇業的被排除
        self.assertEqual(spots[0]["spot_id"], "JP_OSA_0001")  # 評論數最多的排第一

        daruma = spots[0]
        self.assertIn("PTT", daruma["cross_platform_sources"])    # 日文店名靠別名「達摩」對到中文貼文
        self.assertEqual(daruma["location_area"], "新世界/通天閣")
        self.assertEqual(daruma["category"], "排隊名店/街頭美食")
        self.assertTrue(daruma["traveler_pain_point"].startswith("排隊時間長"))
        self.assertIn("排隊", daruma["real_review_snippet"])
        self.assertEqual(daruma["budget_source"], "Google 價位等級換算（估算）")

        cafe = spots[1]
        self.assertEqual(cafe["budget_jpy"], 1500)              # 價格區間取中間
        self.assertIn("小眾高分", cafe["private_indicator"])
        self.assertIn("Dcard", cafe["cross_platform_sources"])   # 人工收集表用 spot_hint 對到
        self.assertTrue(cafe["primary_persona_tag"].startswith("capybara"))

        with (self.tmp / "output" / "osaka_travel_dataset.csv").open(encoding="utf-8-sig") as f:
            header = next(csv.reader(f))
        self.assertEqual(header[:16], build_dataset.CORE_COLUMNS)   # 模組四要求的 16 個核心欄位


if __name__ == "__main__":
    unittest.main()


class FetchersOffline(unittest.TestCase):
    """把網路請求換成假的回應，確認抓取流程（翻頁、續跑、存檔）跑得通。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_google_fetch(self):
        import os
        import sys
        from unittest import mock
        import fetch_google_places as fg

        calls = []

        class Resp:
            def __init__(self, data, code=200):
                self.status_code, self._d, self.text = code, data, json.dumps(data)
            def json(self):
                return self._d

        def fake_search(session, key, text, mask, token=None):
            calls.append((text, token))
            if token is None:
                return Resp({"places": [{"id": f"P{len(calls)}", "displayName": {"text": "x"}}], "nextPageToken": "t2"})
            return Resp({"places": [{"id": "SHARED", "displayName": {"text": "y"}}]})

        with mock.patch.object(fg, "RAW_DIR", self.tmp), mock.patch.object(fg, "OUT_FILE", self.tmp / "g.json"), \
                mock.patch.object(fg, "search", fake_search), mock.patch.object(fg.time, "sleep", lambda s: None), \
                mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test"}), mock.patch.object(sys, "argv", ["x", "--max-requests", "6"]):
            fg.main()
            state = json.loads((self.tmp / "g.json").read_text(encoding="utf-8"))
            self.assertEqual(len(state["queries_done"]), 3)          # 6 次請求 = 3 組 × 2 頁
            self.assertIn("SHARED", state["places"])
            self.assertEqual(len(state["places"]["SHARED"]["_queries"]), 3)
            calls.clear()
            fg.main()                                                 # 續跑：從第 4 組接著打
            self.assertIn("娛樂", calls[0][0])
            state = json.loads((self.tmp / "g.json").read_text(encoding="utf-8"))
            self.assertEqual(len(state["queries_done"]), 6)

    def test_ptt_fetch(self):
        import sys
        from unittest import mock
        search_html = (FIX / "ptt_search.html").read_text(encoding="utf-8")
        art_html = (FIX / "ptt_article.html").read_text(encoding="utf-8")

        def fake_get(session, url):
            if "/search?" in url:
                return search_html if "page=1&" in url else None
            return art_html

        with mock.patch.object(fetch_ptt, "RAW_DIR", self.tmp), mock.patch.object(fetch_ptt, "OUT_FILE", self.tmp / "p.jsonl"), \
                mock.patch.object(fetch_ptt, "get", fake_get), mock.patch.object(fetch_ptt, "polite_sleep", lambda: None), \
                mock.patch.object(sys, "argv", ["x", "--queries", "大阪", "--since", "2020-01-01"]):
            fetch_ptt.main()
            lines = (self.tmp / "p.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)                           # 2019 年的舊文被濾掉
            fetch_ptt.main()                                          # 續跑不重複寫入
            self.assertEqual(len((self.tmp / "p.jsonl").read_text(encoding="utf-8").splitlines()), 1)

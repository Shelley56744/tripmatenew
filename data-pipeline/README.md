# 大阪景點真實資料管線（取代規格書「模組四」的假資料）

規格書模組四原本的 `generate_osaka_dataset.py` 是用 `random` 產生 1,000 筆資料，
「Threads 排隊回報」「Dcard 讚數」都是亂數。這個資料夾改成**真的去抓**，
每一筆都留下來源網址與抓取時間，評審可以逐筆點回去查。

## 四個平台怎麼處理

| 平台 | 做法 | 為什麼 |
| --- | --- | --- |
| **Google Maps** | 官方 Places API (New)，`fetch_google_places.py` | 決定「有哪些景點」：評分、評論數、價位、座標、營業時間、最多 5 則評論。Google 服務條款禁止爬網頁，API 是唯一合法管道 |
| **PTT Japan_Travel**（取代 Dcard 的台灣論壇角色） | 網頁爬蟲，`fetch_ptt.py` | 公開、免登入、沒有 robots.txt 限制。每次請求間隔 1～2 秒，不存推文者帳號 |
| **Threads（脆）** | Meta 官方 Threads API 的 `keyword_search`，`fetch_threads.py`（選用） | 需要開發者 App 和權杖；**權限審核通過前只搜得到自己的貼文** |
| **Dcard、小紅書** | 人工收集，填 `manual/social_posts_manual.csv` | Dcard 使用條款 6.1 禁止「以自動化登入及操作方式蒐集其他用戶的用戶內容」；小紅書有反爬蟲簽章機制，繞過它等於破解防護，這裡不做 |

人工收集不是偷懶：評審問「資料怎麼來的」時，「API＋公開論壇爬蟲＋人工標註」是站得住的答案；
「繞過反爬蟲」不是。

## 一次性準備

1. **Python 環境**（在 Mac 的「終端機」執行，不是在 Claude 裡）

   ```bash
   cd ~/Desktop/tripmatenew/data-pipeline
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   ```

2. **Google Maps API 金鑰**（必要）
   1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建一個專案
   2. 「API 和服務」→「程式庫」→ 搜尋並啟用 **Places API (New)**
   3. 「憑證」→「建立憑證」→「API 金鑰」，建議在金鑰設定裡把「API 限制」設成只能用 Places API (New)
   4. 需要綁帳單帳戶，但這支腳本的用量在免費額度內：
      含評論的 Text Search（Enterprise + Atmosphere 等級）每月前 1,000 次免費，
      預設 63 組搜尋 × 最多 3 頁 = 最多 189 次，腳本另外有 `--max-requests 400` 的上限保護
   5. 用文字編輯器打開 `.env`，貼在 `GOOGLE_MAPS_API_KEY=` 後面（`.env` 已經在 `.gitignore` 裡，不會被推上 GitHub）

3. **Threads 權杖**（選用）：在 [Meta for Developers](https://developers.facebook.com/) 建 Threads App，
   取得使用者存取權杖填進 `.env` 的 `THREADS_ACCESS_TOKEN`。沒有也沒關係，跳過這步。

## 執行

```bash
source .venv/bin/activate                        # 每次開新終端機都要先跑這行
python3 fetch_google_places.py                   # 約 5～10 分鐘，可中斷後再跑，會接著抓
python3 fetch_ptt.py --since 2020-01-01          # 約 30～60 分鐘（刻意放慢），同樣可續跑
python3 fetch_threads.py                         # 選用
python3 build_dataset.py                         # 整合，幾秒鐘
```

想先小量試跑：`python3 fetch_google_places.py --pages 1 --max-requests 10`、
`python3 fetch_ptt.py --since 2025-01-01 --max-pages 3 --queries 大阪`。

輸出在 `output/`：

- `osaka_travel_dataset.csv`：用 Excel 或 Numbers 直接開（UTF-8 BOM，中文不會亂碼）
- `osaka_spots.json`：同一份資料，之後要接進 App 用這個
- `build_report.txt`：收了幾個景點、每個來源對到幾個、各區各類別分布

景點數量看 Google 實際回傳多少，不會硬湊成 1,000 筆；預設設定通常會落在幾百筆。
想要更多，在 `config.py` 的 `AREAS`、`CATEGORIES` 加搜尋組合。

## 輸出欄位

前 16 欄就是規格書模組四要求的欄位，順序相同；後面多的欄位是讓人回查用的。

| 欄位 | 怎麼來的 |
| --- | --- |
| `spot_id` | `JP_OSA_0001` 起，依 Google 評論數由多到少編號 |
| `spot_name` | Google 名稱（優先繁中，沒有就是日文原名） |
| `location_area` | 依座標歸到最近的區（10 區，定義在 `config.py`） |
| `category` | 依 Google 的 `primaryType` 判斷，對不到才用當初的搜尋類別 |
| `cross_platform_sources` | **實際有資料**的來源，例如 `GoogleMaps;PTT;Dcard` |
| `avg_rating` | Google 評分 |
| `est_stay_mins` | 依類別的預估停留時間（估算值，不是抓來的） |
| `budget_jpy` | 有 Google 價格區間就取中間值；只有價位等級就換算；都沒有用類別預估。看 `budget_source` 欄 |
| `mobility_fit` | 離關西機場 12 公里內→yoxi；離難波超過 15 公里→租車自駕；其他→Metro／步行 |
| `newest_indicator` | 最近一次被討論的日期、近 90 天篇數、Google 最新評論日期 |
| `popular_indicator` | Google 評分／評論數、PTT 篇數與淨推文數、其他平台篇數與互動數 |
| `private_indicator` | 「小眾高分」（4.3★ 以上、評論 1,500 則以下）、私房／在地推薦提及次數、避雷提及次數 |
| `primary_persona_tag` | 對應 App 的 8 種人格：類別起手分＋評論與貼文裡的關鍵字（規則同 App 的 `KEYWORD_RULES`） |
| `traveler_pain_point` | 評論與貼文中最常出現的痛點（排隊、整理券、只收現金⋯⋯共 10 類）與提及次數 |
| `consensus_weight` | 1～10：評分（最多 4 分）＋評論數取對數（最多 4 分）＋社群討論篇數（最多 2 分） |
| `real_review_snippet` | 真實評論或貼文裡的一句話，附出處（Google 評論者名稱或 PTT 文章標題） |
| `google_place_id`、`google_maps_url`、`source_urls` | 回查用：Google 地點與最多 5 篇對到的貼文網址 |

**貼文怎麼對到景點**：Google 名稱常是日文（「串かつだるま」），PTT 寫中文（「達摩」），
所以 `config.py` 裡有一張 `ALIASES` 別名表。對不到的熱門景點，把別名加進這張表再跑一次 `build_dataset.py` 就好，不用重抓。

為了避免誤判，比對時有幾條規則（在 `build_dataset.py` 的 `name_keys()`）：

- 店名「品牌 分店地名」只用品牌比對，例如「金龍拉麵 道頓堀店」只找「金龍拉麵」，不會吃到所有講道頓堀的文章
- 地標別名（道頓堀、大阪城、HARUKAS⋯）只有景點本身就是那個地標時才套用；品牌別名（だるま、551⋯）則分店都套用
- 料理名（大阪燒、沾麵、烏龍麵⋯）和區名不單獨拿來比對；跟京都等地同名的景點（清水寺⋯）不比對
- 痛點、人格、摘錄只看貼文裡「提到這個景點的那一句」，不看整篇
- 已知限制：連鎖店（一蘭、大戶屋）會把各分店的討論都算進去

## 人工收集 Dcard／小紅書

正常瀏覽，看到有用的大阪貼文就記一行到 `manual/social_posts_manual.csv`：

| 欄位 | 填什麼 |
| --- | --- |
| `platform` | `dcard`、`xiaohongshu` 或 `threads` |
| `url`、`post_date`、`title` | 貼文網址、日期（YYYY-MM-DD）、標題 |
| `text_excerpt` | **一兩句**重點摘錄就好，不要整篇貼上（著作權） |
| `likes`、`saves`、`comments` | 看得到就填，看不到留空 |
| `spot_hint` | 這篇講的是哪個景點（填 Google 上的店名或其中幾個字），比對會更準 |

四個人分工，每人收 20～30 篇，一個晚上就有上百筆有效的社群訊號。

## 使用規範（Demo 前請看）

- **Google 內容**：Google Maps Platform 條款規定，除了 `place_id`，其他內容（評分、評論、座標）只能暫存最多 30 天，
  顯示時要標示「資料來源：Google Maps」，評論要附評論者名稱（`real_review_snippet` 已經附上）。
  所以 `raw/` 和 `output/` 都設成不進 git，**不要把它們推到公開的 GitHub repo**；比賽前一週重跑一次即可。
- **PTT**：只存文章文字與推噓數，不存帳號。Demo 引用時附上文章網址。
- **費用**：照預設跑一次不會超過 Google 免費額度；但不要把請求上限調很高後反覆重跑。

## 測試

```bash
python3 -m unittest discover tests
```

測試用 `tests/fixtures/` 裡手寫的範例（照官方回傳格式），不連網路，只驗證解析與整合邏輯；那些範例不是真實資料，也不會出現在輸出裡。

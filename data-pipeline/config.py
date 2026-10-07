"""
去趣 TripMate 大阪真實資料管線：共用設定

這份資料取代規格書「模組四」原本用 random 產生的假資料。
每一筆都來自真實來源，並保留來源網址與抓取時間，評審可以逐筆回查。
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw"          # 各平台原始抓取結果（不進 git）
OUT_DIR = ROOT / "output"       # 整合後的資料集（不進 git，見 README 的授權說明）
MANUAL_DIR = ROOT / "manual"    # Dcard / 小紅書 人工收集表


def load_env():
    """讀 data-pipeline/.env，不另外裝 python-dotenv。已經在環境變數裡的值優先。"""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


# ------------------------------------------------------------------
# 區域：名稱、Google 搜尋用字、中心座標（用來把景點歸到最近的區）
# ------------------------------------------------------------------
AREAS = [
    {"name": "難波/道頓堀",     "query": "難波 道頓堀",     "lat": 34.6687, "lng": 135.5013},
    {"name": "心齋橋/美國村",   "query": "心齋橋 美國村",   "lat": 34.6740, "lng": 135.4985},
    {"name": "梅田/北新地",     "query": "梅田 北新地",     "lat": 34.7025, "lng": 135.4959},
    {"name": "中崎町/天神橋",   "query": "中崎町 天神橋筋", "lat": 34.7065, "lng": 135.5070},
    {"name": "大阪城/京橋",     "query": "大阪城 京橋",     "lat": 34.6873, "lng": 135.5262},
    {"name": "新世界/通天閣",   "query": "新世界 通天閣",   "lat": 34.6525, "lng": 135.5063},
    {"name": "天王寺/阿倍野",   "query": "天王寺 阿倍野",   "lat": 34.6460, "lng": 135.5135},
    {"name": "此花/環球影城",   "query": "日本環球影城 周邊", "lat": 34.6654, "lng": 135.4323},
    {"name": "近郊/箕面勝尾寺", "query": "箕面 勝尾寺",     "lat": 34.8530, "lng": 135.4900},
    {"name": "近郊/堺市泉佐野", "query": "堺市 泉佐野",     "lat": 34.5000, "lng": 135.4000},
]

# ------------------------------------------------------------------
# 類別：名稱、Google 搜尋用字、預估停留分鐘、無價位資料時的預估花費（日圓）
# 停留時間與預估花費是「估算」，輸出時會標註 budget_source / 估算欄位
# ------------------------------------------------------------------
CATEGORIES = [
    {"name": "排隊名店/街頭美食",   "query": "人氣 美食",         "mins": 50,  "jpy": 1500},
    {"name": "特色古著/文創選物",   "query": "古著 選物店",       "mins": 60,  "jpy": 4000},
    {"name": "觀景地標/打卡天際線", "query": "展望台 景點",       "mins": 70,  "jpy": 1500},
    {"name": "主題樂園/娛樂體驗",   "query": "娛樂 體驗 遊樂",    "mins": 180, "jpy": 3000},
    {"name": "隱密老宅咖啡",        "query": "咖啡廳 喫茶店",     "mins": 60,  "jpy": 900},
    {"name": "神社寺廟/文化散策",   "query": "神社 寺廟",         "mins": 45,  "jpy": 300},
    {"name": "居酒屋/微醺夜生活",   "query": "居酒屋 酒吧",       "mins": 90,  "jpy": 3500},
]
CATEGORY_BY_NAME = {c["name"]: c for c in CATEGORIES}

# Google primaryType → 類別（比搜尋時用的類別更準，有對到就用這個）
TYPE_TO_CATEGORY = {
    "cafe": "隱密老宅咖啡", "coffee_shop": "隱密老宅咖啡", "tea_house": "隱密老宅咖啡",
    "shinto_shrine": "神社寺廟/文化散策", "buddhist_temple": "神社寺廟/文化散策",
    "place_of_worship": "神社寺廟/文化散策", "hindu_temple": "神社寺廟/文化散策",
    "historical_landmark": "神社寺廟/文化散策", "museum": "神社寺廟/文化散策",
    "bar": "居酒屋/微醺夜生活", "pub": "居酒屋/微醺夜生活", "night_club": "居酒屋/微醺夜生活",
    "wine_bar": "居酒屋/微醺夜生活", "izakaya_restaurant": "居酒屋/微醺夜生活",
    "observation_deck": "觀景地標/打卡天際線", "tourist_attraction": "觀景地標/打卡天際線",
    "amusement_park": "主題樂園/娛樂體驗", "amusement_center": "主題樂園/娛樂體驗",
    "aquarium": "主題樂園/娛樂體驗", "zoo": "主題樂園/娛樂體驗", "bowling_alley": "主題樂園/娛樂體驗",
    "clothing_store": "特色古著/文創選物", "store": "特色古著/文創選物", "gift_shop": "特色古著/文創選物",
    "book_store": "特色古著/文創選物", "shopping_mall": "特色古著/文創選物",
}
FOOD_TYPES_SUFFIX = "_restaurant"  # ramen_restaurant、sushi_restaurant… 一律算美食

# Google 回來但不是「景點」的類型，直接排除
EXCLUDE_TYPES = {
    "lodging", "hotel", "train_station", "subway_station", "transit_station", "bus_station",
    "parking", "atm", "bank", "real_estate_agency", "hospital", "pharmacy", "convenience_store",
}

# priceLevel → 每人預估花費（日圓）。只在沒有 priceRange 時使用，輸出會標「估算」
PRICE_LEVEL_JPY = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1000,
    "PRICE_LEVEL_MODERATE": 2500,
    "PRICE_LEVEL_EXPENSIVE": 6000,
    "PRICE_LEVEL_VERY_EXPENSIVE": 12000,
}

OSAKA_CENTER = {"lat": 34.6937, "lng": 135.5023}
NAMBA = {"lat": 34.6687, "lng": 135.5013}
KIX = {"lat": 34.4320, "lng": 135.2304}

# ------------------------------------------------------------------
# 痛點關鍵字：從真實評論／貼文裡找，命中最多的那個當這個景點的痛點
# 同時涵蓋中文、日文與 Google 翻譯後的中文
# ------------------------------------------------------------------
PAIN_RULES = [
    ("排隊時間長", r"排隊|排了|排超|排很久|等了.{0,4}(分|小時)|行列|大排長龍|要排"),
    ("要搶整理券或預約", r"整理券|預約|予約|抽選|搶票|訂位"),
    ("人潮擁擠", r"人潮|人很多|超多人|人超多|擁擠|人擠人|混雑|混んで|爆滿"),
    ("只收現金", r"只收現金|現金のみ|不能刷卡|不收信用卡|現金只"),
    ("價格偏高", r"偏貴|很貴|太貴|價格高|CP值低|cp值低|高い|觀光客價"),
    ("空間狹小、行李不好放", r"很小|狹窄|狹小|座位少|位子少|放不下|大行李|狭い"),
    ("交通不便", r"交通不便|很遠|轉車|轉乘|山路|坡|走很久|不好到"),
    ("服務態度不佳", r"態度差|不友善|服務差|很兇|臭臉|態度不好"),
    ("拍照光線或角度受限", r"逆光|光線|拍照.{0,4}(不好|很難|受限)|禁止攝影|不能拍"),
    ("天候影響大", r"下雨|雨天|很冷|太熱|颱風|風很大|曬"),
]
PAIN_RES = [(label, re.compile(rx)) for label, rx in PAIN_RULES]

# 私房／避雷 訊號
PRIVATE_RE = re.compile(r"私房|小眾|冷門|在地人|內行|巷弄|隱藏版|秘境|避雷|踩雷|雷店|不推|別去|聽勸")
PRIVATE_POSITIVE_RE = re.compile(r"私房|小眾|冷門|在地人|內行|巷弄|隱藏版|秘境")
PRIVATE_WARN_RE = re.compile(r"避雷|踩雷|雷店|不推|別去|聽勸")

# 「小眾高分」：評分高、但評論數還不多
HIDDEN_GEM_MIN_RATING = 4.3
HIDDEN_GEM_MAX_COUNT = 1500

# 人格：沿用 App.jsx 的 8 種人格與關鍵字規則（KEYWORD_RULES），讓資料直接對得上遊戲
PERSONA_LABEL = {
    "soldier": "行程特種兵", "capybara": "隨性慢活水豚", "camera": "移動打卡機", "shopper": "暴走購物狂",
    "accountant": "旅費精算師", "explorer": "靈魂探險家", "taxi": "尊榮計程車星人", "nanny": "全能旅行保母",
}
PERSONA_KEYWORDS = {
    # 只放有代表性的詞；「逛」「買」「拍」這種每篇都有的字會讓所有景點都變成同一型
    "soldier": r"早起|一早|準時|衝|趕行程|搶|效率|特種兵|一天跑",
    "capybara": r"放空|躺|發呆|悠閒|放鬆|慢慢|坐著|休息|chill",
    "camera": r"拍照|打卡|IG|ig|網美|出片|自拍|夜景|好拍|美照|機位",
    "shopper": r"掃貨|退稅|藥妝|戰利品|免稅|購物|血拼|伴手禮|爆買|商場",
    "accountant": r"便宜|划算|CP值|cp值|優惠券|折價|預算|比價|平價|省錢",
    "explorer": r"巷弄|巷子|散步|漫步|探險|在地|老街|古著|小酒館|美術館|私房",
    "taxi": r"計程車|叫車|[Uu]ber|taxi|不想走|走不動",
    "nanny": r"親子|小孩|長輩|家人|嬰兒車|無障礙|廁所",
}
PERSONA_RES = {k: re.compile(v) for k, v in PERSONA_KEYWORDS.items()}
# 類別本身的傾向（關鍵字之外再加一點起手分）
CATEGORY_PERSONA_PRIOR = {
    "排隊名店/街頭美食": {"accountant": 1.5, "soldier": 1},
    "特色古著/文創選物": {"shopper": 2, "explorer": 1},
    "觀景地標/打卡天際線": {"camera": 2.5},
    "主題樂園/娛樂體驗": {"soldier": 2, "camera": 1},
    "隱密老宅咖啡": {"capybara": 2, "camera": 1},
    "神社寺廟/文化散策": {"explorer": 2, "camera": 1},
    "居酒屋/微醺夜生活": {"explorer": 1.5, "accountant": 1},
}

# 常見景點的中文別名：Google 給的名稱常是日文，PTT 文章用中文，靠這張表對起來
# key 是 Google 名稱裡會出現的字串，value 是貼文裡常見的寫法
ALIASES = {
    "ユニバーサル・スタジオ・ジャパン": ["環球影城", "USJ", "日本環球影城"],
    "Universal Studios Japan": ["環球影城", "USJ"],
    "道頓堀": ["道頓堀"],
    "通天閣": ["通天閣"],
    "あべのハルカス": ["阿倍野HARUKAS", "HARUKAS", "阿倍野展望台"],
    "梅田スカイビル": ["梅田藍天大廈", "空中庭園", "梅田空中庭園"],
    "空中庭園": ["空中庭園"],
    "大阪城": ["大阪城"],
    "黒門市場": ["黑門市場"],
    "木津市場": ["木津市場"],
    "勝尾寺": ["勝尾寺"],
    "箕面": ["箕面"],
    "海遊館": ["海遊館"],
    "だるま": ["達摩", "DARUMA"],
    "わなか": ["和中", "わなか"],
    "くくる": ["くくる", "KUKURU"],
    "551": ["551", "蓬萊"],
    "りくろー": ["老爺爺起司蛋糕", "Rikuro", "りくろー"],
    "かに道楽": ["蟹道樂"],
    "中崎町": ["中崎町"],
    "アメリカ村": ["美國村"],
    "心斎橋": ["心齋橋"],
    "天神橋筋": ["天神橋筋", "天神橋"],
    "新世界": ["新世界"],
    "法善寺": ["法善寺"],
    "今宮戎": ["今宮戎"],
    "住吉大社": ["住吉大社"],
    "四天王寺": ["四天王寺"],
    "グランフロント": ["GRAND FRONT", "Grand Front"],
}

# PTT 搜尋關鍵字（Japan_Travel 板標題搜尋）
PTT_BOARD = "Japan_Travel"
PTT_QUERIES = ["大阪", "關西", "環球影城", "道頓堀", "心齋橋", "梅田", "難波", "新世界", "中崎町", "箕面"]

# Threads 官方 API 搜尋關鍵字（需要 threads_keyword_search 權限才搜得到別人的貼文）
THREADS_QUERIES = ["大阪 旅遊", "大阪 排隊", "大阪 私房", "大阪 避雷", "環球影城 整理券", "道頓堀", "心齋橋 藥妝", "中崎町 咖啡"]

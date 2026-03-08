"""
remap_all.py — 全面重新對應蝦皮訂單品項到商品主檔
1. 讀取所有蝦皮品項和商品主檔
2. 用改良的規則對應（區分不同商品 + 正確匹配顏色/尺寸）
3. 自動建立缺少的 variant
4. 寫回 sales_order_items.product_id

用法：cd youwu-erp && python scripts/remap_all.py
"""
import sys, json, re, time
sys.stdout.reconfigure(encoding='utf-8')
from urllib.request import Request, urlopen
from urllib.parse import quote

with open('.env.local', 'r') as f:
    lines = f.readlines()
url = key = ''
for line in lines:
    if 'NEXT_PUBLIC_SUPABASE_URL' in line: url = line.split('=',1)[1].strip()
    if 'NEXT_PUBLIC_SUPABASE_ANON_KEY' in line: key = line.split('=',1)[1].strip()

def fetch_all(table, select='*'):
    all_data, offset = [], 0
    while True:
        req_url = f'{url}/rest/v1/{table}?select={select}&offset={offset}&limit=1000'
        req = Request(req_url, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
        data = json.loads(urlopen(req).read())
        all_data.extend(data)
        if len(data) < 1000: break
        offset += 1000
    return all_data

def api_post(table, body):
    data = json.dumps(body).encode('utf-8')
    req = Request(f'{url}/rest/v1/{table}', data=data, headers={
        'apikey': key, 'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }, method='POST')
    return json.loads(urlopen(req).read())

def api_patch(table, filters, body):
    data = json.dumps(body).encode('utf-8')
    req = Request(f'{url}/rest/v1/{table}?{filters}', data=data, headers={
        'apikey': key, 'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }, method='PATCH')
    urlopen(req)

print('=== remap_all.py — 全面重新對應 ===\n')

# ── 1. 讀取資料 ──
prods = fetch_all('products', 'id,product_name,variant_name,sku,selling_price,unit_cost_ntd,category,platform_fee_rate,purchase_price_cny,weight_kg')
items = fetch_all('sales_order_items', 'id,product_name,variant_name,product_id,qty,unit_price')
print(f'商品主檔: {len(prods)} 筆')
print(f'訂單品項: {len(items)} 筆\n')

# Build product index: name -> {variant -> product}
prod_by_name = {}
for p in prods:
    name = p['product_name']
    var = (p.get('variant_name') or '').strip()
    if name not in prod_by_name:
        prod_by_name[name] = {}
    prod_by_name[name][var.lower()] = p

# ── 2. 對應規則 ──
# Each rule: (keywords_in_shopee_name, exclude_keywords, product_name_in_master)
PRODUCT_RULES = [
    # 百摺衛生紙套（必須排在棉麻之前，因為百摺商品名也含「衛生紙」）
    (['百摺', '百褶', '風琴摺'], [], '風琴摺衛生紙套'),
    # 棉麻衛生紙套（用複合關鍵字避免誤抓）
    (['棉麻'], [], '日式棉麻衛生紙套'),
    # 杯墊
    (['硅藻', '矽藻', '珪藻'], [], '硅藻泥异形杯垫'),
    (['聖誕樹', '隔熱墊'], [], '實木杯墊'),
    (['實木杯墊'], [], '實木杯墊'),
    (['日系實木杯墊'], [], '實木杯墊'),
    (['日系 實木杯墊'], [], '實木杯墊'),
    (['榉木', '櫸木'], ['收納盤', '飾品', '首飾'], '實木杯墊'),
    (['胡桃木'], ['掛勾', '掛鉤', '吸盤'], '實木杯墊'),
    # 化妝鏡
    (['化妝鏡', '梳妝鏡'], [], '雲朵化妝鏡'),
    # 飾品收納 — 金屬皮革雙層收納架
    (['金屬皮革', '雙層收納架', '雙層 收納架'], [], '金屬皮革雙層收納架'),
    # 飾品收納 — 實木收納置物架（三層展示架）
    (['實木 收納置物架', '木質 收納置物架', '日系實木收納', '日系 木質 收納'], [], '原木三層展示收納架｜桌面香氛／飾品／文具陳列架'),
    (['收納置物架'], ['鐵藝', '金屬'], '原木三層展示收納架｜桌面香氛／飾品／文具陳列架'),
    # 飾品收納 — 實木飾品收納盤
    (['實木飾品收納', '實木質感飾品'], [], '實木飾品收納盤'),
    # 鐵藝收納籃
    (['鐵藝收納籃', '鐵藝 收納籃', '日韓鐵藝'], [], '韓系金屬網格收納籃（大／小）'),
    (['金屬網格', '收納籃'], [], '韓系金屬網格收納籃（大／小）'),
    (['金屬收納籃'], [], '韓系金屬網格收納籃（大／小）'),
    # 擦手巾 — 法式/可愛風掛式擦手巾
    (['法式擦手巾', '法式 擦手巾', '奶油風掛式擦手巾'], [], '質感可愛奶油風掛式擦手巾'),
    (['擦手巾', '擦手毛巾'], ['猫咪', '貓咪'], '質感可愛奶油風掛式擦手巾'),
    (['猫咪擦手巾', '貓咪擦手巾'], [], '猫咪擦手巾'),
    (['抹布', '菠萝', '菠蘿'], [], '超細纖維菠萝格抹布'),
    # 陶瓷首飾盤（霧面陶瓷首飾盤 = 韓系不規則造型陶瓷飾品收納盤，蛋殼小缽是不同商品）
    (['蛋殼陶瓷', '陶瓷小缽'], [], '蛋殼陶瓷小缽'),
    (['陶瓷首飾盤', '陶瓷 首飾盤', '霧面陶瓷', '飾品收納盤'], ['蛋殼', '小缽', '實木', '鐵藝'], '韓系不規則造型陶瓷飾品收納盤'),
    (['戒指盘', '戒指盤', '首饰盒', '首飾盒'], [], '日式粗陶陶瓷戒指盘首饰盒小盘子小碟子'),
    # 燈具
    (['光雕', '玻璃燈'], ['蘑菇', '雲朵'], '極簡光雕玻璃氛圍燈｜USB充電觸控小夜燈（雙光型）'),
    (['磁吸', '夜燈', '氛圍'], ['雲朵'], '極簡光雕玻璃氛圍燈｜USB充電觸控小夜燈（雙光型）'),
    (['雲朵', '小夜燈'], [], '便攜量子小夜燈'),
    (['雲朵燈'], [], '便攜量子小夜燈'),
    (['漢堡燈'], [], '便攜量子小夜燈'),
    (['量子', '小夜燈'], [], '便攜量子小夜燈'),
    (['蘑菇', '花苞燈', '包豪斯'], [], '觸摸蘑菇檯燈'),
    (['蘑菇燈'], [], '觸摸蘑菇檯燈'),
    (['花苞燈'], [], '觸摸蘑菇檯燈'),
    (['包豪斯'], ['雲朵'], '觸摸蘑菇檯燈'),
    # 牙膏/浴廁
    (['擠牙膏', '牙膏器'], [], '金屬旋轉式擠牙膏器'),
    (['牙刷架', '幸運草', '彈簧'], [], '不鏽鋼幸運草造型牙刷架'),
    (['吸盤掛鉤', '吸盤掛勾', '吸盤式挂鈎', '吸盤 掛勾'], [], '吸盤掛鉤'),
    (['長尾夾', '不鏽鋼掛勾'], [], '吸盤掛鉤'),
    (['拖鞋架', '掛鞋架', '拖鞋掛'], [], '浴室拖鞋架免打孔壁掛架'),
    # 餐廚
    (['皺褶杯', '丹麥'], [], '丹麥皺褶杯'),
    # 拖鞋
    (['EVA', '拖鞋'], [], 'EVA拖鞋'),
    (['踩屎感', '拖鞋'], [], 'EVA拖鞋'),
    # 補寄
    (['補寄', '漏寄', '錯寄', '售後'], [], None),  # skip these
]

# Color/variant extraction from shopee variant string
COLOR_MAP = {
    '淡雅灰': '淡雅灰', '灰': '灰', '深灰': '深灰', '淺灰': '淺灰', '淺灰色': '淺灰色',
    '槍灰色': '槍灰色', '槍灰': '槍灰色',
    '白': '白', '奶油白': '奶油白', '白色': '白色',
    '霧面黑': '霧面黑', '霧感黑': '黑色', '黑': '黑', '黑色': '黑色',
    '黃色': '黃色', '黃': '黃色', '檸檬黃': '檸檬黃',
    '綠': '綠色', '綠色': '綠色', '酪梨綠': '酪梨綠',
    '焦糖': '焦糖色', '焦糖橙': '焦糖橙', '焦糖色': '焦糖色',
    '可可棕': '可可棕', '咖啡棕': '咖啡棕', '棕色': '棕色', '咖啡': '咖啡棕',
    '橘色': '橘色', '橘': '橘色',
    '藍色': '藍色', '藍': '藍色',
    '酒紅': '酒紅色', '酒紅色': '酒紅色',
    '銀灰': '銀灰色', '銀灰色': '銀灰色', '銀色': '銀色',
    '粉色': '粉色', '粉': '粉色',
    '紅色': '紅色', '紅': '紅色',
    '卡其': '卡其色', '卡其色': '卡其色',
    '伯爵奶茶': '伯爵奶茶', '巧克力牛奶': '巧克力牛奶',
    '抹茶拿鐵': '抹茶拿鐵', '活力柳橙': '活力柳橙', '美式咖啡': '美式咖啡',
    '奶油黃': '奶油黃',
    '胡桃木': '胡桃木色', '胡桃木色': '胡桃木色',
    '編織斜紋': '編織斜紋', '斜紋編織': '編織斜紋',
    '編織粗紋': '編織粗紋', '亞麻編織': '亞麻編織',
    '可愛櫻桃': '可愛櫻桃', '法式生活': '法式生活',
}

SIZE_PATTERNS = [
    (r'(\d{2})-(\d{2})\s*\(', lambda m: f'{m.group(1)}-{m.group(2)}'),
    (r'(\d{2})-(\d{2})', lambda m: f'{m.group(1)}-{m.group(2)}'),
    (r'大款', lambda m: '大'),
    (r'小款', lambda m: '小'),
    (r'大彈簧', lambda m: '大彈簧'),
    (r'小彈簧', lambda m: '小彈簧'),
    (r'幸運草造型', lambda m: '幸運草造型'),
    (r'三格', lambda m: '三格收納盤'),
    (r'方形', lambda m: '方形收納盤'),
    (r'長方形款', lambda m: '長方形'),
]

# Special variant patterns that should be kept as-is
SPECIAL_VARIANT_MAP = {
    '淺色櫸木 圓形凹槽杯墊': '淺色櫸木 圓形凹槽杯墊',
    '淺色櫸木收納盒（可裝6個）': '淺色櫸木收納盒（可裝6個）',
    '深色胡桃木收納盒（可裝6個）': '深色胡桃木收納盒（可裝6個）',
    '可折疊': '可折疊',
    '201不鏽鋼': '201不鏽鋼',
}

def clean_variant(variant_str):
    """Clean shopee variant: remove emoji prefixes, split on comma, take first meaningful part."""
    if not variant_str:
        return ''
    # Remove common prefixes
    v = re.sub(r'新色報到[✨❤️]*[｜|]?', '', variant_str)
    v = re.sub(r'新色出爐[✨❤️]*[｜|]?', '', v)
    v = v.strip()
    # Split on comma — first part is usually color/variant, rest is size info
    parts = v.split(',')
    return parts[0].strip()

def extract_color(variant_str):
    """Extract the primary color/style from cleaned variant string."""
    if not variant_str:
        return None
    # First check special variant map
    for key in SPECIAL_VARIANT_MAP:
        if key in variant_str:
            return SPECIAL_VARIANT_MAP[key]
    # Check longest color matches first
    for color_key in sorted(COLOR_MAP.keys(), key=len, reverse=True):
        if color_key in variant_str:
            return COLOR_MAP[color_key]
    return None

def extract_size(variant_str):
    """Extract size info from variant string."""
    if not variant_str:
        return None
    for pattern, extractor in SIZE_PATTERNS:
        m = re.search(pattern, variant_str)
        if m:
            return extractor(m)
    return None

def match_product_rule(shopee_name):
    """Match shopee product name to a product rule."""
    text = shopee_name.lower()
    for keywords, excludes, prod_name in PRODUCT_RULES:
        if any(kw.lower() in text for kw in keywords):
            if excludes and any(ex.lower() in text for ex in excludes):
                continue
            return prod_name  # None means skip (e.g. 補寄)
    return '__no_match__'

def find_best_product(prod_name, color, size, variant_str):
    """Find the best matching product in master, or return info to create one."""
    if prod_name not in prod_by_name:
        return None, None

    variants = prod_by_name[prod_name]

    # Try exact color match
    if color:
        for var_key, prod in variants.items():
            if color.lower() == var_key:
                return prod['id'], None
        for var_key, prod in variants.items():
            if color.lower() in var_key or var_key in color.lower():
                return prod['id'], None

    # Try size match
    if size:
        for var_key, prod in variants.items():
            if size.lower() in var_key:
                return prod['id'], None

    # Try variant string keywords
    if variant_str:
        vl = variant_str.lower()
        for var_key, prod in variants.items():
            if var_key and var_key in vl:
                return prod['id'], None
        # Reverse: check if any master variant key appears in shopee variant
        for var_key, prod in variants.items():
            if var_key and vl in var_key:
                return prod['id'], None

    # If only one variant exists, use it
    if len(variants) == 1:
        return list(variants.values())[0]['id'], None

    # No match - need to create new variant
    variant_label = color or size or (variant_str[:30] if variant_str else 'default')
    return None, variant_label

# ── 3. 對應所有品項 ──
print('開始對應...\n')

# Group items by (shopee_name, shopee_variant)
groups = {}
for i in items:
    k = (i.get('product_name') or '', i.get('variant_name') or '')
    if k not in groups:
        groups[k] = []
    groups[k].append(i['id'])

# First pass: determine all needed mappings (without creating yet)
mapping_plan = []  # (item_ids, product_id | None, prod_name, variant_label)
unmapped = []
skipped = []

for (shopee_name, shopee_var), item_ids in groups.items():
    # Step 1: Identify product
    prod_name = match_product_rule(shopee_name)

    if prod_name == '__no_match__':
        # No rule matched — keep existing mapping
        current_pid = None
        for i in items:
            if i.get('product_name') == shopee_name and i.get('variant_name') == shopee_var:
                current_pid = i.get('product_id')
                break
        if current_pid:
            mapping_plan.append((item_ids, current_pid, None, None, 'keep'))
        else:
            unmapped.append((shopee_name[:60], shopee_var[:40], len(item_ids)))
        continue

    if prod_name is None:
        # Explicitly skipped (e.g. 補寄)
        skipped.append((shopee_name[:40], len(item_ids)))
        continue

    # Step 2: Clean and extract color/size from variant
    cleaned_var = clean_variant(shopee_var)
    color = extract_color(cleaned_var)
    size = extract_size(cleaned_var)

    # Step 3: Find matching product
    pid, missing_variant = find_best_product(prod_name, color, size, cleaned_var)

    if pid:
        mapping_plan.append((item_ids, pid, None, None, 'matched'))
    else:
        mapping_plan.append((item_ids, None, prod_name, missing_variant, 'need_create'))

# ── 4. De-duplicate and create missing variants ──
# Group all need_create by (prod_name, variant_label)
create_groups = {}
for entry in mapping_plan:
    if entry[4] != 'need_create':
        continue
    item_ids, _, prod_name, variant_label, _ = entry
    ckey = (prod_name, variant_label)
    if ckey not in create_groups:
        create_groups[ckey] = []
    create_groups[ckey].append(item_ids)

print(f'需要建立 {len(create_groups)} 個新 variant:\n')

# Create each unique variant once
created_variants = {}  # (prod_name, variant_label) -> new_id
for (prod_name, variant_label), all_item_id_lists in create_groups.items():
    total_count = sum(len(ids) for ids in all_item_id_lists)

    base = None
    if prod_name in prod_by_name:
        base = list(prod_by_name[prod_name].values())[0]

    new_prod = {
        'product_name': prod_name,
        'variant_name': variant_label,
        'sku': f"YW-{prod_name[:10]}-{variant_label[:10]}",
        'category': base.get('category') if base else None,
        'selling_price': base.get('selling_price') if base else None,
        'unit_cost_ntd': base.get('unit_cost_ntd') if base else None,
        'purchase_price_cny': base.get('purchase_price_cny') if base else None,
        'platform_fee_rate': base.get('platform_fee_rate') if base else None,
        'weight_kg': base.get('weight_kg') if base else None,
        'product_status': '常駐',
    }

    print(f"  建立: {prod_name} | {variant_label} ({total_count} 筆)")

    try:
        result = api_post('products', new_prod)
        new_id = result[0]['id']
        created_variants[(prod_name, variant_label)] = new_id

        if prod_name not in prod_by_name:
            prod_by_name[prod_name] = {}
        prod_by_name[prod_name][variant_label.lower()] = {'id': new_id, **new_prod}

        print(f"    -> id={new_id}")
    except Exception as e:
        print(f"    x 建立失敗: {e}")

# ── 5. 寫回 product_id ──
print(f'\n寫回對應結果...')
updated = 0
kept = 0
failed = 0

for entry in mapping_plan:
    item_ids = entry[0]
    action = entry[4]

    if action == 'keep':
        kept += len(item_ids)
        continue

    if action == 'matched':
        pid = entry[1]
    elif action == 'need_create':
        prod_name, variant_label = entry[2], entry[3]
        pid = created_variants.get((prod_name, variant_label))
        if not pid:
            failed += len(item_ids)
            continue
    else:
        continue

    # Batch update
    for i in range(0, len(item_ids), 50):
        batch = item_ids[i:i+50]
        id_filter = ','.join(str(x) for x in batch)
        api_patch('sales_order_items', f'id=in.({id_filter})', {'product_id': pid})
        updated += len(batch)

print(f'\n=== 結果 ===')
print(f'已更新: {updated} 筆')
print(f'維持不變: {kept} 筆')
print(f'建立失敗: {failed} 筆')
print(f'未對應: {len(unmapped)} 組')
if skipped:
    print(f'略過（補寄等）: {sum(c for _, c in skipped)} 筆')

if unmapped:
    print(f'\n=== 未能對應的品項 ===')
    for name, var, count in sorted(unmapped, key=lambda x: -x[2]):
        print(f'  [{count:3d}x] {name} | {var}')

print('\n完成！請執行 refresh_stats.py 更新統計欄位。')

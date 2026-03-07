import sys, json, re
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
    all_data = []
    offset = 0
    while True:
        req = Request(f'{url}/rest/v1/{table}?select={select}&offset={offset}&limit=1000', headers={
            'apikey': key, 'Authorization': f'Bearer {key}'
        })
        data = json.loads(urlopen(req).read())
        all_data.extend(data)
        if len(data) < 1000: break
        offset += 1000
    return all_data

products = fetch_all('products', 'id,product_name,variant_name,sku')
items = fetch_all('sales_order_items', 'id,product_name,variant_name')

# Build product lookup by name
prod_by_name = {}
for p in products:
    k = p['product_name']
    if k not in prod_by_name:
        prod_by_name[k] = []
    prod_by_name[k].append(p)

def match_variant(candidates, keyword):
    if not candidates: return None
    if keyword is None: return candidates[0]
    for p in candidates:
        pvar = (p.get('variant_name') or '') + ' ' + p.get('product_name', '')
        if keyword.lower() in pvar.lower():
            return p
    return candidates[0]

def find_product(sname, svar):
    sname_lower = sname.lower()
    svar_lower = (svar or '').lower()
    combined = sname_lower + ' ' + svar_lower

    # === 硅藻土杯墊 ===
    if any(x in sname for x in ['硅藻', '矽藻', '珪藻']):
        c = prod_by_name.get('硅藻泥异形杯垫', [])
        if '深灰' in svar_lower: return match_variant(c, '深灰')
        if '淺灰' in svar_lower or '浅灰' in svar_lower: return match_variant(c, '淺灰')
        if '白' in svar_lower: return match_variant(c, '白')
        return c[0] if c else None

    # === 實木杯墊 / 收納座 ===
    if '實木杯墊' in combined:
        c = prod_by_name.get('實木杯墊', [])
        c_box_h = prod_by_name.get('實木收納盒(胡桃木)', [])
        c_box_b = prod_by_name.get('實木收納盒(櫸木)', [])
        if '收納座' in svar_lower or '收納盒' in svar_lower:
            if '胡桃' in combined: return c_box_h[0] if c_box_h else None
            return c_box_b[0] if c_box_b else None
        if '櫸木' in combined or '榉木' in combined or '淺色' in combined:
            return match_variant(c, '榉木')
        if '胡桃' in combined or '深色' in combined:
            return match_variant(c, '胡桃')
        return c[0] if c else None

    # === 愛心布質杯墊 ===
    if '愛心' in sname and '杯墊' in sname:
        c = prod_by_name.get('愛心布質杯墊', [])
        return c[0] if c else None

    # === 百摺衛生紙套 ===
    if '百摺衛生紙' in sname or ('衛生紙套' in sname and '棉麻' not in sname):
        c = prod_by_name.get('風琴摺衛生紙套', [])
        if '綠' in svar_lower or '酪梨' in svar_lower: return match_variant(c, '綠')
        if '黃' in svar_lower or '檸檬' in svar_lower: return match_variant(c, '黃')
        if '焦糖' in svar_lower or '橙' in svar_lower: return match_variant(c, '焦糖')
        if '奶油白' in svar_lower: return match_variant(c, None)  # no white variant, closest
        # 淡雅灰/可可棕 也沒有精確對應，給最接近的
        return c[0] if c else None

    # === 日式棉麻衛生紙套 ===
    if '棉麻' in sname and ('衛生紙' in sname or '紙巾' in sname):
        c = prod_by_name.get('風琴摺衛生紙套', [])
        return c[0] if c else None

    # === 實木飾品收納盤 ===
    if '實木飾品收納盤' in sname or '實木質感飾品' in sname:
        return None  # 無精確對應

    # === 霧面陶瓷首飾盤 ===
    if '霧面' in sname and '陶瓷' in sname and '首飾' in sname:
        c = prod_by_name.get('日式粗陶陶瓷戒指盘首饰盒小盘子小碟子', [])
        if '白' in svar_lower or '奶油' in svar_lower: return match_variant(c, '白')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 蛋殼陶瓷 ===
    if '蛋殼' in sname and '陶瓷' in sname:
        c = prod_by_name.get('韓系不規則造型陶瓷飾品收納盤', [])
        if '白' in svar_lower: return match_variant(c, '白')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 仿石分裝瓶 ===
    if '仿石' in sname and '分裝瓶' in sname:
        c = prod_by_name.get('仿石紋極簡洗手乳按壓瓶', [])
        if '米白' in svar_lower: return match_variant(c, '米白')
        if '米黃' in svar_lower: return match_variant(c, '米黃')
        if '深灰' in svar_lower or '深空灰' in svar_lower: return match_variant(c, '深灰')
        if '淺灰' in svar_lower: return match_variant(c, '淺灰')
        return c[0] if c else None

    # === 鐵藝金屬收納籃 ===
    if '鐵藝' in sname and '收納' in sname:
        c = prod_by_name.get('韓系金屬網格收納籃（大／小）', [])
        if '大' in svar_lower or '13x13' in svar_lower: return match_variant(c, '大')
        if '小' in svar_lower or '11x11' in svar_lower: return match_variant(c, '小')
        if '長方' in svar_lower or '25' in svar_lower:
            c2 = prod_by_name.get('桌面置物籃／保養品整理架', [])
            return c2[0] if c2 else (c[0] if c else None)
        return c[0] if c else None

    # === 日韓鐵藝收納籃 ===
    if '日韓' in sname and '鐵藝' in sname:
        c = prod_by_name.get('韓系金屬網格收納籃（大／小）', [])
        if '大' in svar_lower: return match_variant(c, '大')
        if '小' in svar_lower: return match_variant(c, '小')
        return c[0] if c else None

    # === 擠牙膏器 ===
    if '擠牙膏' in sname:
        c = prod_by_name.get('金屬旋轉式擠牙膏器', [])
        if c: return c[0]
        c = prod_by_name.get('金屬擠護手霜', [])
        return c[0] if c else None

    # === 卡通掛布 ===
    if '卡通掛布' in sname or '插畫卡通掛布' in sname:
        c = prod_by_name.get('簡約日韓可愛風插畫卡通掛布', [])
        if 'book' in svar_lower or 'beer' in svar_lower: return match_variant(c, 'BOOK')
        if 'cheese' in svar_lower: return match_variant(c, 'CHEESE')
        if '爵士' in svar_lower or '黑膠' in svar_lower: return match_variant(c, '爵士')
        return c[0] if c else None

    # === 文藝亞麻掛布 ===
    if '亞麻' in sname and '掛布' in sname:
        c = prod_by_name.get('復古文藝風法式英文雅麻掛布掛飾', [])
        if '莓' in svar_lower: return match_variant(c, '莓')
        if '紅酒' in svar_lower: return match_variant(c, '紅酒')
        if '早餐' in svar_lower: return match_variant(c, '早餐')
        return c[0] if c else None

    # === 法式奶油風掛布 ===
    if '法式' in sname and '掛布' in sname and ('奶油' in sname or '咖啡廳' in sname):
        c = prod_by_name.get('法式奶油風韓系咖啡廳餐廳廚房辦公室掛布', [])
        if '巴黎' in svar_lower or 'cream' in svar_lower: return match_variant(c, '巴黎')
        if '麵包' in svar_lower or 'baguette' in svar_lower: return match_variant(c, '麵包')
        if '吐司' in svar_lower: return match_variant(c, '吐司')
        return c[0] if c else None

    # === 海報/卡片牆 ===
    if '海报' in sname or '海報' in sname or '卡片牆' in sname:
        c = prod_by_name.get('美式復古海报卡片牆貼房間臥室辦公室書房佈置', [])
        if '記憶' in svar_lower: return match_variant(c, '記憶')
        if '午後' in svar_lower or '陽光' in svar_lower: return match_variant(c, '午後')
        if '美好' in svar_lower: return match_variant(c, '美好')
        return c[0] if c else None

    # === 彈簧牙刷架 ===
    if '彈簧' in sname and '牙刷' in sname:
        c = prod_by_name.get('彈簧牙刷架', [])
        if '大' in svar_lower: return match_variant(c, '大')
        if '小' in svar_lower: return match_variant(c, '小')
        return c[0] if c else None

    # === 幸運草牙刷架 ===
    if '牙刷架' in sname and ('幸運草' in sname or '花花' in sname):
        c = prod_by_name.get('不鏽鋼幸運草造型牙刷架', [])
        return c[0] if c else None

    # === 木質收納置物架 ===
    if '木質' in sname and '收納置物架' in sname:
        c = prod_by_name.get('原木三層展示收納架｜桌面香氛／飾品／文具陳列架', [])
        return c[0] if c else None

    # === 不鏽鋼雙層置物架 ===
    if '不鏽鋼雙層置物架' in sname or '不鏽鋼' in sname and '雙層' in sname and '置物' in sname:
        c = prod_by_name.get('不鏽鋼多层置物架', [])
        return c[0] if c else None

    # === 金屬皮革雙層收納架 ===
    if '金屬皮革' in sname and '收納架' in sname:
        # No exact match
        return None

    # === 胡桃木紋吸盤 ===
    if '胡桃木紋吸盤' in sname:
        c = prod_by_name.get('吸盤掛鉤', [])
        return match_variant(c, '木纹')

    # === 多巴胺吸盤 ===
    if '多巴胺' in sname and '吸盤' in sname:
        c = prod_by_name.get('吸盤掛鉤', [])
        if '紅' in svar_lower: return match_variant(c, '红')
        if '黃' in svar_lower: return match_variant(c, '黃')
        if '藍' in svar_lower: return match_variant(c, '藍')
        if '粉' in svar_lower: return match_variant(c, '粉')
        return c[0] if c else None

    # === 復古不鏽鋼餐具 ===
    if '復古' in sname and '不鏽鋼餐具' in sname:
        c = prod_by_name.get('日式復古做舊304不鏽鋼餐具', [])
        if '水果叉' in svar_lower: return match_variant(c, '水果叉')
        if '甜品' in svar_lower and '叉' in svar_lower: return match_variant(c, '水果叉')
        if '叉' in svar_lower: return match_variant(c, '主餐叉')
        if '勺' in svar_lower or '湯匙' in svar_lower: return match_variant(c, '主餐勺')
        if '刀' in svar_lower: return match_variant(c, '甜品刀')
        if '茶' in svar_lower: return match_variant(c, '茶勺')
        return c[0] if c else None

    # === 皮革拖鞋 / EVA拖鞋 ===
    if '拖鞋' in sname and ('皮革' in sname or 'eva' in sname_lower):
        c = prod_by_name.get('EVA拖鞋', [])
        for p in c:
            pvar = (p.get('variant_name') or '').lower()
            if not pvar: continue
            color_match = False
            for col in ['白', '深棕', '浅咖', '黑']:
                if col in svar_lower and col in pvar:
                    color_match = True
                    break
            if not color_match: continue
            for sz in ['36-37', '38-39', '40-41', '42-43', '44-45']:
                if sz in svar_lower and sz in pvar:
                    return p
        return c[0] if c else None

    # === 丹麥皺褶杯 ===
    if '皺褶杯' in sname or '紙杯風' in sname:
        c = prod_by_name.get('丹麥皺褶杯', [])
        if '焦糖' in svar_lower or '深棕' in svar_lower: return match_variant(c, '焦糖')
        if '扁桃' in svar_lower or '淡褐' in svar_lower: return match_variant(c, '扁桃')
        if '胡桃' in svar_lower or '深褐' in svar_lower: return match_variant(c, '胡桃')
        if '綠' in svar_lower: return match_variant(c, '绿')
        if '黃' in svar_lower or '陽光' in svar_lower: return match_variant(c, '阳光')
        return c[0] if c else None

    # === 不鏽鋼咖啡杯 ===
    if '不鏽鋼' in sname and '咖啡杯' in sname:
        if '500' in sname:
            c = prod_by_name.get('500ml高顏值美式工業風304不銹鋼咖啡杯', [])
        else:
            c = prod_by_name.get('350ml美式工業風304不銹鋼便攜咖啡杯', [])
        if '菱形' in svar_lower: return match_variant(c, '菱形')
        if '錘紋' in svar_lower: return match_variant(c, '錘紋')
        if '一般' in svar_lower: return match_variant(c, '一般')
        return c[0] if c else None

    # === 304咖啡杯 ===
    if '304' in sname and '咖啡杯' in sname:
        if '500' in sname:
            c = prod_by_name.get('500ml高顏值美式工業風304不銹鋼咖啡杯', [])
        else:
            c = prod_by_name.get('350ml美式工業風304不銹鋼便攜咖啡杯', [])
        if '菱形' in svar_lower: return match_variant(c, '菱形')
        if '錘紋' in svar_lower: return match_variant(c, '錘紋')
        return c[0] if c else None

    # === 鬆餅格/華夫格抹布 ===
    if '鬆餅格' in sname or '華夫格' in sname:
        c = prod_by_name.get('超細纖維菠萝格抹布', [])
        if '深灰' in svar_lower and '40' in svar_lower: return match_variant(c, '深灰 40')
        if '深灰' in svar_lower: return match_variant(c, '深灰 30')
        if '淺灰' in svar_lower and '40' in svar_lower: return match_variant(c, '淺灰 40')
        if '淺灰' in svar_lower: return match_variant(c, '淺灰 30')
        return c[0] if c else None

    # === 零食夾 ===
    if '零食夾' in sname or '薯片夾' in sname:
        c = prod_by_name.get('塑膠零食夾', [])
        return c[0] if c else None

    # === 牙刷 ===
    if '軟毛牙刷' in sname or ('寬頭' in sname and '牙刷' in sname):
        c = prod_by_name.get('黑白日系牙刷', [])
        if '白' in svar_lower: return match_variant(c, '白')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 雲朵化妝鏡 ===
    if '雲朵' in sname and '化妝鏡' in sname:
        c = prod_by_name.get('雲朵化妝鏡', [])
        if '白' in svar_lower or '奶油' in svar_lower: return match_variant(c, '奶油白')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 雲朵小夜燈 ===
    if '雲朵' in sname and '燈' in sname and '化妝' not in sname:
        c = prod_by_name.get('極簡光雕玻璃氛圍燈｜USB充電觸控小夜燈（雙光型）', [])
        if '銀' in svar_lower: return match_variant(c, '銀')
        if '灰' in svar_lower: return match_variant(c, '灰')
        return c[0] if c else None

    # === 花苞燈/蘑菇燈 ===
    if '花苞燈' in sname or '蘑菇燈' in sname:
        c = prod_by_name.get('觸摸蘑菇檯燈', [])
        return c[0] if c else None

    # === 量子/磁吸夜燈 ===
    if ('量子' in sname or '磁吸' in sname) and '夜燈' in sname:
        c = prod_by_name.get('極簡光雕玻璃氛圍燈｜USB充電觸控小夜燈（雙光型）', [])
        return c[0] if c else None

    # === 貓咪擦手巾 ===
    if '貓咪' in sname and '擦手巾' in sname:
        c = prod_by_name.get('猫咪擦手巾', [])
        if '橘' in svar_lower: return match_variant(c, '橘')
        if '灰' in svar_lower: return match_variant(c, '灰')
        return c[0] if c else None

    # === 法式擦手巾 ===
    if '法式擦手巾' in sname or ('擦手巾' in sname and '法式' in sname):
        c = prod_by_name.get('質感可愛奶油風掛式擦手巾', [])
        if '櫻桃' in svar_lower: return match_variant(c, '櫻桃')
        if '字母' in svar_lower or '瓶' in svar_lower: return match_variant(c, '字母')
        return c[0] if c else None

    # === 磁吸開瓶器 ===
    if '磁吸' in sname and '開瓶' in sname:
        c = prod_by_name.get('磁吸開罐器', [])
        return c[0] if c else None

    # === 茶包/陶瓷點心筐 ===
    if '陶瓷點心小筐' in sname:
        c = prod_by_name.get('茶包收納筐', [])
        if '紅' in svar_lower: return match_variant(c, '紅')
        if '黃' in svar_lower: return match_variant(c, '黃')
        if '藍' in svar_lower: return match_variant(c, '藍')
        if '白' in svar_lower: return match_variant(c, '白')
        return c[0] if c else None

    # === 拖鞋架 ===
    if '拖鞋架' in sname:
        c = prod_by_name.get('浴室拖鞋架免打孔壁掛架', [])
        if '黑' in svar_lower: return match_variant(c, '黑')
        if '灰' in svar_lower: return match_variant(c, '灰')
        if '白' in svar_lower: return match_variant(c, '白')
        return c[0] if c else None

    # === 刮水器 ===
    if '刮水' in sname:
        c = prod_by_name.get('霜山刮水器', [])
        return c[0] if c else None

    # === 掛勾長尾夾 ===
    if '掛勾' in sname and '長尾夾' in sname:
        c = prod_by_name.get('掛勾夾子', [])
        return c[0] if c else None

    # === 衣架 ===
    if '衣架' in sname and ('鋁合金' in sname or '圓弧' in sname):
        c = prod_by_name.get('鋁合金半圓衣架', [])
        if '銀' in svar_lower: return match_variant(c, '銀')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 翻頁鐘 ===
    if '翻頁鐘' in sname:
        c = prod_by_name.get('桌面復古擺飾時鐘', [])
        if '黑' in svar_lower: return match_variant(c, '黑')
        if '白' in svar_lower: return match_variant(c, '白')
        return c[0] if c else None

    # === 地墊 ===
    if '地墊' in sname or '地毯' in sname:
        c1 = prod_by_name.get('Bonjour黑/摩卡棕格紋玄關地墊', [])
        c2 = prod_by_name.get('Bonjour紅黑格紋玄關地墊', [])
        if '摩卡' in svar_lower or '棕' in svar_lower: return match_variant(c1, '摩卡')
        if '黑' in svar_lower: return match_variant(c1, '黑')
        if '紅' in svar_lower: return c2[0] if c2 else None
        return c1[0] if c1 else None

    # === 矽膠碗夾/防燙 ===
    if '矽膠' in sname and ('碗夾' in sname or '防燙' in sname or '防滑夾' in sname or '料理夾' in sname):
        c = prod_by_name.get('矽膠防滑夾 碗夾', [])
        return c[0] if c else None

    # === 鴨子毛髮夾 ===
    if '鴨子' in sname:
        c = prod_by_name.get('鴨子浴室頭髮清潔夾', [])
        if '粉' in svar_lower: return match_variant(c, '粉')
        return c[0] if c else None

    # === 封口夾/文件夾 ===
    if '封口夾' in sname:
        c = prod_by_name.get('文件夾封口夾', [])
        if '不锈钢' in svar_lower or '銀' in svar_lower: return match_variant(c, '不锈钢')
        if '黑' in svar_lower: return match_variant(c, '黑')
        return c[0] if c else None

    # === 海綿菜瓜布 ===
    if '菜瓜布' in sname or '海綿' in sname:
        c = prod_by_name.get('高密度海綿菜瓜布', [])
        if '15' in svar_lower: return match_variant(c, '15')
        if '5' in svar_lower: return match_variant(c, '5')
        return c[0] if c else None

    # === 聖誕樹隔熱墊 ===
    if '聖誕' in sname: return None

    # === 補寄/售後 ===
    if '補寄' in sname or '漏寄' in sname or '售後' in sname: return None

    return None


# Process all items
groups = {}
for it in items:
    k = (it.get('product_name','') or '', it.get('variant_name','') or '')
    if k not in groups:
        groups[k] = {'count': 0, 'ids': []}
    groups[k]['count'] += 1
    groups[k]['ids'].append(it['id'])

matched_groups = 0
matched_items = 0
unmatched = []
update_plan = []  # (product_name, variant_name, product_id, count)

for (sname, svar), info in sorted(groups.items(), key=lambda x: -x[1]['count']):
    product = find_product(sname, svar)
    if product:
        matched_groups += 1
        matched_items += info['count']
        update_plan.append({
            'shopee_name': sname,
            'shopee_var': svar,
            'product_id': product['id'],
            'db_name': product['product_name'],
            'db_var': product.get('variant_name', ''),
            'count': info['count']
        })
    else:
        unmatched.append((sname, svar, info['count']))

total = sum(info['count'] for info in groups.values())

print("=== 未對應 ===")
for sname, svar, cnt in unmatched:
    print(f"  [{cnt:3d}x] {sname[:55]}  |  {(svar or '(無)')[:30]}")

print(f"\n=== 統計 ===")
print(f"已對應: {matched_groups} 種 / {matched_items} 筆")
print(f"未對應: {len(unmatched)} 種 / {sum(x[2] for x in unmatched)} 筆")
print(f"覆蓋率: {matched_items}/{total} = {matched_items/total*100:.1f}%")

# Save plan
with open('scripts/mapping_plan.json', 'w', encoding='utf-8') as f:
    json.dump(update_plan, f, ensure_ascii=False, indent=2)
print(f"\n對應計畫已存到 scripts/mapping_plan.json ({len(update_plan)} 筆)")

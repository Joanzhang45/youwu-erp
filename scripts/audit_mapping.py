"""
audit_mapping.py — 全面盤點蝦皮訂單品項 vs 商品主檔的對應狀況
輸出 shopee_items_audit.json 和 products_master.json 供 remap 腳本使用
"""
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from urllib.request import Request, urlopen

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

print('=== 盤點蝦皮訂單品項 vs 商品主檔 ===\n')

prods = fetch_all('products', 'id,product_name,variant_name,sku,selling_price,unit_cost_ntd,category,platform_fee_rate')
items = fetch_all('sales_order_items', 'id,product_name,variant_name,product_id,qty,unit_price')

prod_map = {p['id']: p for p in prods}
prod_list = [{'id': p['id'], 'name': p['product_name'], 'variant': p.get('variant_name') or '', 'sku': p.get('sku') or ''} for p in prods]

print(f'商品主檔: {len(prods)} 筆')
print(f'訂單品項: {len(items)} 筆')

# Group shopee items by unique (product_name, variant_name)
shopee_groups = {}
for i in items:
    pname = i.get('product_name') or ''
    vname = i.get('variant_name') or ''
    k = (pname, vname)
    if k not in shopee_groups:
        shopee_groups[k] = {'count': 0, 'current_pid': i.get('product_id'), 'price': i.get('unit_price'), 'item_ids': []}
    shopee_groups[k]['count'] += 1
    shopee_groups[k]['item_ids'].append(i['id'])

print(f'蝦皮唯一品項組合: {len(shopee_groups)} 種\n')

# Detect problems: multiple shopee variants -> same product variant
pid_to_shopee_variants = {}
for (pname, vname), info in shopee_groups.items():
    pid = info['current_pid']
    if not pid: continue
    if pid not in pid_to_shopee_variants:
        pid_to_shopee_variants[pid] = set()
    pid_to_shopee_variants[pid].add(vname or '(none)')

print('=== 對應問題：同一商品被多種不同蝦皮款式對應 ===')
problem_count = 0
for pid, variants in sorted(pid_to_shopee_variants.items(), key=lambda x: -len(x[1])):
    if len(variants) <= 2: continue
    p = prod_map.get(pid, {})
    print(f"\n  [{len(variants)} 種蝦皮款式] → {p.get('product_name','')} | {p.get('variant_name','')}")
    for v in sorted(variants)[:5]:
        print(f"    - {v[:70]}")
    if len(variants) > 5:
        print(f"    ... 還有 {len(variants)-5} 種")
    problem_count += 1

print(f'\n共 {problem_count} 個商品有對應問題')

# Save for remap script
output = []
for (pname, vname), info in sorted(shopee_groups.items(), key=lambda x: -x[1]['count']):
    output.append({
        'shopee_name': pname,
        'shopee_variant': vname,
        'count': info['count'],
        'current_pid': info['current_pid'],
        'price': info['price'],
        'item_ids': info['item_ids'],
    })

with open('scripts/shopee_items_audit.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
with open('scripts/products_master.json', 'w', encoding='utf-8') as f:
    json.dump(prod_list, f, ensure_ascii=False, indent=2)

print(f'\n已輸出 scripts/shopee_items_audit.json ({len(output)} 種)')
print(f'已輸出 scripts/products_master.json ({len(prod_list)} 筆)')

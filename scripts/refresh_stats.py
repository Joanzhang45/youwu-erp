"""
refresh_stats.py — 從 sales_order_items 重算 products 的統計欄位
解決問題：products 表的 total_sold_qty 等欄位是 Ragic 匯入的靜態快照，不會隨新訂單自動更新

用法：cd youwu-erp && python scripts/refresh_stats.py
"""
import sys, json
sys.stdout.reconfigure(encoding='utf-8')
from urllib.request import Request, urlopen
from urllib.parse import quote

# Load env
with open('.env.local', 'r') as f:
    lines = f.readlines()
url = key = ''
for line in lines:
    if 'NEXT_PUBLIC_SUPABASE_URL' in line: url = line.split('=',1)[1].strip()
    if 'NEXT_PUBLIC_SUPABASE_ANON_KEY' in line: key = line.split('=',1)[1].strip()

def fetch_all(table, select='*', filters=''):
    all_data = []
    offset = 0
    while True:
        req_url = f'{url}/rest/v1/{table}?select={select}&offset={offset}&limit=1000'
        if filters:
            req_url += f'&{filters}'
        req = Request(req_url, headers={
            'apikey': key, 'Authorization': f'Bearer {key}'
        })
        data = json.loads(urlopen(req).read())
        all_data.extend(data)
        if len(data) < 1000: break
        offset += 1000
    return all_data

def patch(table, id, body):
    data = json.dumps(body).encode('utf-8')
    req = Request(f'{url}/rest/v1/{table}?id=eq.{id}', data=data, headers={
        'apikey': key, 'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }, method='PATCH')
    urlopen(req)

print('=== refresh_stats.py ===\n')

# 1. Fetch all products
products = fetch_all('products', 'id,product_name,variant_name,unit_cost_ntd,selling_price,platform_fee_rate')
print(f'商品: {len(products)} 筆')

# 2. Fetch all sales_order_items with product_id
items = fetch_all('sales_order_items', 'product_id,qty,unit_price,subtotal')
print(f'訂單品項: {len(items)} 筆')

# 3. Fetch all sales_orders for revenue/fee data
orders = fetch_all('sales_orders', 'id,order_amount,net_revenue,status')
print(f'訂單: {len(orders)} 筆')

# 4. Aggregate sold qty and revenue per product
sold_stats = {}  # product_id -> {qty, revenue}
for item in items:
    pid = item.get('product_id')
    if not pid:
        continue
    if pid not in sold_stats:
        sold_stats[pid] = {'qty': 0, 'revenue': 0}
    sold_stats[pid]['qty'] += int(item.get('qty') or 1)
    sold_stats[pid]['revenue'] += float(item.get('subtotal') or item.get('unit_price') or 0)

# 5. Update each product
updated = 0
for p in products:
    pid = p['id']
    stats = sold_stats.get(pid, {'qty': 0, 'revenue': 0})

    sold_qty = stats['qty']
    sales_revenue = stats['revenue']
    unit_cost = float(p.get('unit_cost_ntd') or 0)
    selling_price = float(p.get('selling_price') or 0)
    fee_rate = float(p.get('platform_fee_rate') or 0)

    # Calculate gross margin
    if selling_price > 0:
        fees = selling_price * (fee_rate / 100)
        profit = selling_price - unit_cost - fees
        margin = profit / selling_price
    else:
        margin = 0

    # Calculate realized profit
    realized = (selling_price - unit_cost - (selling_price * fee_rate / 100)) * sold_qty if selling_price > 0 else 0

    update_body = {
        'total_sold_qty': sold_qty,
        'total_sales_revenue': round(sales_revenue, 2),
        'gross_margin': round(margin, 5),
        'realized_profit': round(realized, 2),
    }

    # Check if values changed
    patch('products', pid, update_body)
    updated += 1

print(f'\n更新: {updated} 筆商品')

# 6. Show top sellers
print('\n=== Top 10 銷售商品 ===')
top = sorted(sold_stats.items(), key=lambda x: -x[1]['qty'])[:10]
prod_map = {p['id']: p for p in products}
for pid, s in top:
    p = prod_map.get(pid, {})
    name = p.get('product_name', '?')
    var = p.get('variant_name', '')
    print(f'  [{s["qty"]:4d}x] ${s["revenue"]:>8.0f}  {name} | {var}')

# 7. Summary
total_sold = sum(s['qty'] for s in sold_stats.values())
total_rev = sum(s['revenue'] for s in sold_stats.values())
print(f'\n總銷售: {total_sold} 件 / ${total_rev:,.0f}')
print('完成！')

"""QA: 驗證所有 Supabase 資料完整性"""
import json, urllib.request, ssl

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE
SUPABASE_URL = "https://nhwmmpiglfxhlnagusvp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od21tcGlnbGZ4aGxuYWd1c3ZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjgxMjk0MSwiZXhwIjoyMDg4Mzg4OTQxfQ.aiW5QJ6gF2XfX3JPC0joJH0jPYrwZ6gOzHIGq8vTckE"

def query(table, select="*", extra=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}{extra}"
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, context=ssl_ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))

print("=== Supabase 資料驗證 ===\n")

# 1. Selections
sels = query("product_selections", "id,selection_number,product_name,status", "&order=created_at.desc&limit=5")
all_sels = query("product_selections", "id")
print(f"product_selections: {len(all_sels)} 筆")
for s in sels[:3]:
    print(f"  {s['selection_number']} | {s['product_name']} | {s['status']}")

# 2. Variants
all_vars = query("product_variants", "id", "&limit=1000")
print(f"\nproduct_variants: {len(all_vars)} 筆")

# 3. Competitors
all_comps = query("competitor_products", "id", "&limit=1000")
print(f"competitor_products: {len(all_comps)} 筆")

# 4. Receiving records
recs = query("receiving_records", "id,receiving_number,shipment_number,receiving_date", "&order=receiving_date.desc")
print(f"\nreceiving_records: {len(recs)} 筆")
for r in recs[:3]:
    print(f"  {r['receiving_number']} | {r['shipment_number']} | {r['receiving_date']}")

# 5. Receiving items
all_items = query("receiving_record_items", "id", "&limit=1000")
print(f"receiving_record_items: {len(all_items)} 筆")

# 6. Domestic logistics
all_logs = query("domestic_logistics", "id,tracking_number,status", "&order=created_at.desc&limit=5")
total_logs = query("domestic_logistics", "id")
print(f"\ndomestic_logistics: {len(total_logs)} 筆")
for l in all_logs[:3]:
    print(f"  {l['tracking_number']} | {l['status']}")

# 7. Test selection detail (variants + competitors for first selection)
if all_sels:
    first_id = sels[0]["id"]
    sel_vars = query("product_variants", "id,variant_name,purchase_price_cny,selling_price_ntd,margin_pct", f"&selection_id=eq.{first_id}")
    sel_comps = query("competitor_products", "id,competitor_name,competitor_price", f"&selection_id=eq.{first_id}")
    print(f"\n--- 選品詳情測試 ({sels[0]['selection_number']}) ---")
    print(f"  款式: {len(sel_vars)}")
    for v in sel_vars[:2]:
        print(f"    {v['variant_name']} | CNY {v.get('purchase_price_cny','?')} | NTD {v.get('selling_price_ntd','?')} | {v.get('margin_pct','?')}%")
    print(f"  競品: {len(sel_comps)}")
    for c in sel_comps[:2]:
        print(f"    {c['competitor_name']} | ${c.get('competitor_price','?')}")

# 8. Products mapping check
print(f"\n--- 商品對應檢查 ---")
products = query("products", "id", "&limit=1000")
print(f"products: {len(products)} 筆")

# Check order items mapping status
all_order_items = []
offset = 0
while True:
    batch = query("sales_order_items", "id,product_id", f"&limit=1000&offset={offset}")
    all_order_items.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

mapped = len([i for i in all_order_items if i.get("product_id")])
print(f"sales_order_items: {len(all_order_items)} 筆 (已對應: {mapped}, 未對應: {len(all_order_items) - mapped})")

print("\n=== QA 結果 ===")
errors = []
if len(all_sels) != 99:
    errors.append(f"product_selections 預期 99 筆, 實際 {len(all_sels)}")
if len(all_vars) < 200:
    errors.append(f"product_variants 預期 ~238 筆, 實際 {len(all_vars)}")
if len(all_comps) < 130:
    errors.append(f"competitor_products 預期 ~134 筆, 實際 {len(all_comps)}")
if len(recs) != 13:
    errors.append(f"receiving_records 預期 13 筆, 實際 {len(recs)}")
if len(all_items) != 227:
    errors.append(f"receiving_record_items 預期 227 筆, 實際 {len(all_items)}")
if len(total_logs) < 115:
    errors.append(f"domestic_logistics 預期 ~117 筆, 實際 {len(total_logs)}")

if errors:
    print("FAIL:")
    for e in errors:
        print(f"  x {e}")
else:
    print("ALL PASS - 所有資料筆數正確")

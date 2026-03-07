"""
有物 ERP 2.0 — Ragic 資料匯入腳本
從 Ragic (ap14.ragic.com/youwu) 匯入剩餘資料到 Supabase

匯入項目：
1. 選品 (product_selections + product_variants)
2. 競品 (competitor_products)
3. 驗收紀錄 (receiving_records + receiving_record_items)
4. 境內物流 (domestic_logistics) — 補完整欄位
5. 商品 SKU 差異檢查

用法: python scripts/import-ragic-data.py
"""

import json
import urllib.request
import ssl
import time
import sys

# === 設定 ===
RAGIC_API_KEY = "WWpTdk5yZkVYb1JjOHhvRTZDT2VoMWROeUVuZ1dCSGVjZ0pFcmpkelVUYmdUU3RTaUxYdFVXckl0SHlXWS9wVw=="
RAGIC_BASE = "https://ap14.ragic.com/youwu"
SUPABASE_URL = "https://nhwmmpiglfxhlnagusvp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od21tcGlnbGZ4aGxuYWd1c3ZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjgxMjk0MSwiZXhwIjoyMDg4Mzg4OTQxfQ.aiW5QJ6gF2XfX3JPC0joJH0jPYrwZ6gOzHIGq8vTckE"

# Disable SSL verification for Windows compatibility
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def ragic_get(path, listing=True):
    """Fetch data from Ragic API"""
    url = f"{RAGIC_BASE}/{path}?api&APIKey={RAGIC_API_KEY}"
    if listing:
        url += "&listing"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, context=ssl_ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ragic_get_single(path, row_id):
    """Fetch single record from Ragic (includes subtables)"""
    url = f"{RAGIC_BASE}/{path}/{row_id}?api&APIKey={RAGIC_API_KEY}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, context=ssl_ctx) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data.get(str(row_id), {})


def supabase_post(table, rows):
    """Insert rows into Supabase, skip duplicates"""
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }
    data = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx) as resp:
            return len(rows)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"  ERROR {e.code}: {body[:200]}")
        return 0


def supabase_upsert(table, rows, on_conflict="id"):
    """Upsert rows into Supabase"""
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    data = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx) as resp:
            return len(rows)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"  ERROR {e.code}: {body[:200]}")
        return 0


def supabase_query(table, select="*", filters=None):
    """Query Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}"
    if filters:
        url += "&" + "&".join(f"{k}=eq.{v}" for k, v in filters.items())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, context=ssl_ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def safe_float(val, default=None):
    try:
        return float(val) if val not in (None, "", " ") else default
    except (ValueError, TypeError):
        return default


def safe_int(val, default=None):
    try:
        return int(float(val)) if val not in (None, "", " ") else default
    except (ValueError, TypeError):
        return default


# ============================================================
# 1. 匯入選品 + 款式
# ============================================================
def import_selections():
    print("\n=== 1. 匯入選品 (product_selections + product_variants) ===")

    # Get listing first
    listing = ragic_get("procurement/1")
    print(f"  Ragic 選品: {len(listing)} 筆")

    # Check existing
    existing = supabase_query("product_selections", "selection_number")
    existing_nums = {r["selection_number"] for r in existing}
    print(f"  Supabase 現有: {len(existing)} 筆")

    sel_rows = []
    variant_map = {}  # selection_number -> variants

    for row_id, rec in listing.items():
        sel_num = rec.get("選品編號", "")
        if sel_num in existing_nums:
            continue

        # Fetch full record with subtable
        full = ragic_get_single("procurement/1", row_id)
        time.sleep(0.3)

        sel_row = {
            "selection_number": sel_num,
            "selection_date": full.get("選品日期") or None,
            "product_name": full.get("產品名稱") or None,
            "product_image": None,  # Ragic images won't work externally
            "status": full.get("狀態") or "評估中",
            "order_link": full.get("訂貨連結") or None,
            "notes": full.get("備註") or None,
            "total_qty": safe_int(full.get("總數量")),
            "total_weight_kg": safe_float(full.get("總重量(Kg)")),
            "total_purchase_cost_ntd": safe_float(full.get("總進貨成本(NTD)")),
        }
        sel_rows.append(sel_row)

        # Extract variants from subtable
        subtable = full.get("_subtable_1000119", {})
        if subtable:
            variants = []
            for sub_id, sub in subtable.items():
                variants.append({
                    "variant_name": sub.get("款式/尺寸") or sub.get("SKU編號") or "未命名",
                    "purchase_price_cny": safe_float(sub.get("訂貨單價(CNY)")),
                    "selling_price_ntd": safe_float(sub.get("售價(NTD)")),
                    "weight_kg": safe_float(sub.get("每件重量(Kg)") or sub.get("單品項重量(Kg)")),
                    "domestic_shipping_cny": safe_float(sub.get("單品成本(NTD)")),  # mapping approximate
                    "qty": safe_int(sub.get("訂購數量")),
                    "unit_cost_ntd": safe_float(sub.get("單品成本(NTD)")),
                    "margin_pct": safe_float(sub.get("毛利率")),
                })
            variant_map[sel_num] = variants

    if sel_rows:
        count = supabase_post("product_selections", sel_rows)
        print(f"  匯入選品: {count} 筆")

        # Now insert variants with selection_id
        time.sleep(0.5)
        inserted = supabase_query("product_selections", "id,selection_number")
        num_to_id = {r["selection_number"]: r["id"] for r in inserted}

        all_variants = []
        for sel_num, variants in variant_map.items():
            sel_id = num_to_id.get(sel_num)
            if not sel_id:
                continue
            for v in variants:
                v["selection_id"] = sel_id
                all_variants.append(v)

        if all_variants:
            count = supabase_post("product_variants", all_variants)
            print(f"  匯入款式: {count} 筆")
    else:
        print("  無新選品需匯入")


# ============================================================
# 2. 匯入競品
# ============================================================
def import_competitors():
    print("\n=== 2. 匯入競品 (competitor_products) ===")

    existing_comps = supabase_query("competitor_products", "id")
    if existing_comps:
        print(f"  Supabase 已有 {len(existing_comps)} 筆競品，跳過")
        return

    # Get selections mapping
    sels = supabase_query("product_selections", "id,selection_number")
    num_to_id = {r["selection_number"]: r["id"] for r in sels}

    # Fetch competitors from Ragic
    listing = ragic_get("procurement/3")
    print(f"  Ragic 競品: {len(listing)} 筆")

    comp_rows = []
    for row_id, rec in listing.items():
        sel_num = rec.get("選品編號", "")
        sel_id = num_to_id.get(sel_num)

        # Fetch full record for extra fields
        full = ragic_get_single("procurement/3", row_id)
        time.sleep(0.2)

        comp_rows.append({
            "selection_id": sel_id,
            "competitor_name": f"競品 #{rec.get('排名', '?')} ({sel_num})",
            "competitor_price": safe_float(rec.get("售價")),
            "competitor_link": full.get("競品連結") or None,
            "notes": f"排名:{rec.get('排名','')} 總銷量:{rec.get('總銷量','')} 店鋪:{full.get('店鋪類型','')} 月銷:{full.get('月銷量','')}".strip(),
        })

    if comp_rows:
        count = supabase_post("competitor_products", comp_rows)
        print(f"  匯入競品: {count} 筆")


# ============================================================
# 3. 匯入驗收紀錄
# ============================================================
def import_receiving():
    print("\n=== 3. 匯入驗收紀錄 (receiving_records + receiving_record_items) ===")

    existing = supabase_query("receiving_records", "receiving_number")
    existing_nums = {r["receiving_number"] for r in existing}
    print(f"  Supabase 現有: {len(existing)} 筆")

    listing = ragic_get("product/26")
    print(f"  Ragic 驗收: {len(listing)} 筆")

    rec_rows = []
    item_map = {}  # receiving_number -> items

    for row_id, rec in listing.items():
        recv_num = rec.get("驗收編號", "")
        if recv_num in existing_nums:
            continue

        rec_rows.append({
            "receiving_number": recv_num,
            "shipment_number": rec.get("回台集運單單號") or None,
            "receiving_date": rec.get("驗收完成日期") or None,
            "receiver": rec.get("驗收人員") or None,
            "notes": None,
        })

        # Fetch subtable items
        full = ragic_get_single("product/26", row_id)
        time.sleep(0.3)

        subtable = full.get("_subtable_1000443", {})
        items = []
        for sub_id, sub in subtable.items():
            items.append({
                "product_name": sub.get("商品名稱") or None,
                "variant_name": sub.get("SKU", "").split("-")[-1] if sub.get("SKU") else None,
                "expected_qty": safe_int(sub.get("本次進貨數量")),
                "actual_qty": safe_int(sub.get("可入庫數量")),
                "condition": "良好" if sub.get("驗退數量", "0") == "0" else "瑕疵",
                "notes": sub.get("驗退原因/備註") or None,
            })
        if items:
            item_map[recv_num] = items

    if rec_rows:
        count = supabase_post("receiving_records", rec_rows)
        print(f"  匯入驗收: {count} 筆")

        # Insert items
        time.sleep(0.5)
        inserted = supabase_query("receiving_records", "id,receiving_number")
        num_to_id = {r["receiving_number"]: r["id"] for r in inserted}

        all_items = []
        for recv_num, items in item_map.items():
            recv_id = num_to_id.get(recv_num)
            if not recv_id:
                continue
            for item in items:
                item["receiving_id"] = recv_id
                all_items.append(item)

        if all_items:
            count = supabase_post("receiving_record_items", all_items)
            print(f"  匯入驗收品項: {count} 筆")
    else:
        print("  無新驗收紀錄需匯入")


# ============================================================
# 4. 補充境內物流完整欄位
# ============================================================
def update_logistics():
    print("\n=== 4. 補充境內物流 (domestic_logistics) ===")

    existing = supabase_query("domestic_logistics", "id,tracking_number")
    existing_nums = {r["tracking_number"]: r["id"] for r in existing}
    print(f"  Supabase 現有: {len(existing)} 筆")

    # Ragic listing only has 5 fields, need full records
    listing = ragic_get("logistics/1")
    print(f"  Ragic 境內物流: {len(listing)} 筆")

    new_rows = []
    update_rows = []

    for row_id, rec in listing.items():
        tracking = rec.get("貨運單號", "")
        if not tracking:
            continue

        # Fetch full record
        full = ragic_get_single("logistics/1", row_id)
        time.sleep(0.2)

        status_map = {
            "": "待寄出",
            "已寄出": "已寄出",
            "運送中": "運送中",
            "已到達": "已到達",
            "已簽收": "已到達",
            "已入倉": "已入倉",
            "集運倉已收": "已入倉",
        }
        raw_status = full.get("物流狀態", "")
        mapped_status = status_map.get(raw_status, raw_status or "待寄出")

        row_data = {
            "tracking_number": tracking,
            "po_number": full.get("採購單單號") or None,
            "logistics_company": full.get("貨運服務商") or None,
            "forwarder": full.get("集運商") or None,
            "waybill_number": full.get("集運入庫單編號") or None,
            "status": mapped_status,
            "total_weight_kg": safe_float(full.get("集運商秤重總重")),
            "shipping_cost_cny": safe_float(full.get("單個境內運費(CNY)")),
            "notes": full.get("備註") or None,
        }

        if tracking in existing_nums:
            row_data["id"] = existing_nums[tracking]
            update_rows.append(row_data)
        else:
            new_rows.append(row_data)

    if new_rows:
        count = supabase_post("domestic_logistics", new_rows)
        print(f"  新增物流: {count} 筆")

    if update_rows:
        count = supabase_upsert("domestic_logistics", update_rows)
        print(f"  更新物流: {count} 筆")

    if not new_rows and not update_rows:
        print("  無需更新")


# ============================================================
# 5. 商品 SKU 差異檢查
# ============================================================
def check_products():
    print("\n=== 5. 商品 SKU 差異檢查 ===")

    ragic_products = ragic_get("calculation/4")
    supabase_products = supabase_query("products", "id,sku,product_name")

    ragic_skus = {rec.get("SKU", "") for rec in ragic_products.values()}
    supabase_skus = {p["sku"] for p in supabase_products if p["sku"]}

    missing = ragic_skus - supabase_skus
    extra = supabase_skus - ragic_skus

    print(f"  Ragic SKU: {len(ragic_skus)}")
    print(f"  Supabase SKU: {len(supabase_skus)}")
    print(f"  Ragic 有但 Supabase 沒有: {len(missing)}")
    print(f"  Supabase 有但 Ragic 沒有: {len(extra)}")

    if missing:
        print(f"\n  缺少的 SKU (前 10 個):")
        for sku in sorted(missing)[:10]:
            # Find product name
            for rec in ragic_products.values():
                if rec.get("SKU") == sku:
                    print(f"    {sku} — {rec.get('商品名稱', '?')}")
                    break


# ============================================================
# Main
# ============================================================
if __name__ == "__main__":
    print("=" * 60)
    print("有物 ERP 2.0 — Ragic 資料匯入")
    print("=" * 60)

    try:
        import_selections()
        import_competitors()
        import_receiving()
        update_logistics()
        check_products()
    except Exception as e:
        print(f"\n!!! 錯誤: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print("匯入完成！")
    print("=" * 60)

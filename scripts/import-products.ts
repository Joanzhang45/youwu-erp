/**
 * Import products from Ragic CSV export to Supabase
 * Usage: npx tsx scripts/import-products.ts
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
 * (Use service key, not anon key, to bypass RLS)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const CSV_PATH = 'C:/Users/Joan/Desktop/蝦皮/Ragic資料/Rowdata/商品資訊.csv'

async function main() {
  const raw = readFileSync(CSV_PATH, 'utf-8')
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true })

  console.log(`Read ${records.length} products from CSV`)

  const products = records.map((r: Record<string, string>) => ({
    product_name: r['產品名稱'] || '',
    sku: r['SKU編號'] || null,
    category: r['分類'] || null,
    variant_name: r['款式/尺寸'] || null,
    selection_number: r['原選品編號'] || null,
    shopee_spec_id: r['蝦皮規格ID'] || null,
    order_link: r['訂貨連結'] || null,
    product_positioning: r['產品定位'] || null,
    product_image: r['款式圖片'] || null,
    notes: r['備註'] || null,
    selling_price: parseFloat(r['售價(NTD)']) || null,
    purchase_price_cny: parseFloat(r['進貨單價(CNY)']) || null,
    product_status: r['商品狀態'] || '測品',
    domestic_shipping_thrown: parseFloat(r['境內運費(拋轉)']) || null,
    unit_cost_ntd: parseFloat(r['單品成本(NTD)']) || null,
    domestic_shipping_per_unit_cny: parseFloat(r['單個境內運費(CNY)']) || null,
    initial_order_qty: parseInt(r['初次訂貨數量']) || null,
    domestic_shipping_per_unit_thrown: parseFloat(r['單個境內運費(拋轉)']) || null,
    platform_fee_rate: parseFloat(r['蝦皮平台抽成(均14.5%)']) || 0.145,
    avg_daily_sales: parseFloat(r['平均每日銷量']) || null,
    avg_shipping_days: parseFloat(r['平均運輸天數']) || null,
    unit_profit: parseFloat(r['單品利潤']) || null,
    weight_kg: parseFloat(r['每件重量(Kg)']) || null,
    safety_stock: parseInt(r['安全庫存量']) || null,
    total_purchased_qty: parseInt(r['總進貨數量']) || 0,
    total_purchase_cost: parseFloat(r['總進貨成本']) || 0,
    avg_purchase_price: parseFloat(r['平均進價']) || null,
    current_stock_cost: parseFloat(r['現有庫存成本']) || 0,
    total_sold_qty: parseInt(r['總銷貨數量']) || 0,
    total_sales_revenue: parseFloat(r['總銷貨收入']) || 0,
    gross_margin: parseFloat(r['毛利率']) || null,
    realized_profit: parseFloat(r['已實現利得']) || 0,
    total_shipped_qty: parseInt(r['已出貨數量']) || 0,
    shopee_fee_total: parseFloat(r['蝦皮手續費支出']) || 0,
    net_revenue_subtotal: parseFloat(r['實收營收小計']) || 0,
    latest_po_number: r['最新一筆採購單'] || null,
  }))

  // Filter out products with empty names
  const valid = products.filter((p: { product_name: string }) => p.product_name.trim())
  console.log(`Valid products: ${valid.length}`)

  // Upsert in batches of 50
  for (let i = 0; i < valid.length; i += 50) {
    const batch = valid.slice(i, i + 50)
    const { error } = await supabase.from('products').upsert(batch, {
      onConflict: 'sku',
    })
    if (error) {
      console.error(`Error at batch ${i}:`, error.message)
    } else {
      console.log(`Imported ${Math.min(i + 50, valid.length)}/${valid.length}`)
    }
  }

  console.log('Done!')
}

main().catch(console.error)

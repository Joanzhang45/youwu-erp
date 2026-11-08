-- 算錢與庫存的回歸測試（第二次健檢 #25）。在一個交易裡跑完由外層撤銷，不留資料。
-- 每個數字都附手算過程，改公式時先改這裡的預期值並寫清楚為什麼。
DO $test$
DECLARE
  joan constant text := '{"sub":"d1bcb4cc-5619-42be-a194-16ab9a2a9dba","role":"authenticated"}';
  pa bigint; pb bigint;            -- 商品 A（0.5kg、人民幣 10）、B（1.5kg、人民幣 20）
  po1 bigint; po2 bigint; po3 bigint;
  cs1 bigint; cs2 bigint; cs3 bigint;
  ia bigint; ib bigint; ia2 bigint; ib3 bigint;
  so bigint; so2 bigint;
  got numeric; n int; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', joan, true);

  INSERT INTO products (product_name, weight_kg, purchase_price_cny, product_status)
  VALUES ('TEST-CI-商品A', 0.5, 10, '常駐') RETURNING id INTO pa;
  INSERT INTO products (product_name, weight_kg, purchase_price_cny, product_status)
  VALUES ('TEST-CI-商品B', 1.5, 20, '常駐') RETURNING id INTO pb;

  -- ---------- 1. 第一批：運費按「實收件數 × 單件重量」全額分攤 ----------
  INSERT INTO purchase_orders (po_number, cny_rate, order_date) VALUES ('TEST-CI-PO1', 4.5, current_date) RETURNING id INTO po1;
  INSERT INTO purchase_order_items (po_id, product_id, product_name, qty, unit_price_cny) VALUES
    (po1, pa, 'TEST-CI-商品A', 10, 10), (po1, pb, 'TEST-CI-商品B', 5, 20);
  INSERT INTO consolidated_shipments (shipment_number, status, total_weight_kg, total_cost_ntd)
  VALUES ('TEST-CI-CS1', '已到達', 20, 900) RETURNING id INTO cs1;
  INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, qty)
  VALUES (cs1, 'TEST-CI-PO1', pa, 'TEST-CI-商品A', 10) RETURNING id INTO ia;
  INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, qty)
  VALUES (cs1, 'TEST-CI-PO1', pb, 'TEST-CI-商品B', 5) RETURNING id INTO ib;

  PERFORM receive_shipment(cs1, jsonb_build_array(
    jsonb_build_object('id', ia, 'actual_qty', 10), jsonb_build_object('id', ib, 'actual_qty', 5)));

  -- 分攤基準 10×0.5 + 5×1.5 = 12.5；A 每件運費 0.5×900/12.5 = 36、B 1.5×900/12.5 = 108（合計 900，一塊不少）
  -- A 落地成本 10×4.5×1.015 + 36 = 81.675 → 81.68；B 20×4.5×1.015 + 108 = 199.35
  SELECT unit_cost_ntd INTO got FROM products WHERE id = pa;
  ASSERT got = 81.68, format('A 成本應為 81.68，實際 %s', got);
  SELECT unit_cost_ntd INTO got FROM products WHERE id = pb;
  ASSERT got = 199.35, format('B 成本應為 199.35，實際 %s', got);
  SELECT sum(qty_delta) INTO n FROM inventory_ledger WHERE product_id = pa;
  ASSERT n = 10, format('A 點收後庫存應為 10，實際 %s', n);
  SELECT status_received INTO ok FROM purchase_orders WHERE id = po1;
  ASSERT ok, 'PO1 全部收到應自動結案';

  -- 同一批不能點收兩次
  BEGIN
    PERFORM receive_shipment(cs1, jsonb_build_array(jsonb_build_object('id', ia, 'actual_qty', 10)));
    RAISE EXCEPTION 'TEST_FAIL 重複點收沒有被擋';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm LIKE 'ALREADY_RECEIVED%', format('重複點收應回 ALREADY_RECEIVED，實際 %s', sqlerrm);
  END;

  -- ---------- 2. 第二批：成本加權平均，不是整個換成新價 ----------
  INSERT INTO purchase_orders (po_number, cny_rate, order_date) VALUES ('TEST-CI-PO2', 4.5, current_date) RETURNING id INTO po2;
  INSERT INTO purchase_order_items (po_id, product_id, product_name, qty, unit_price_cny) VALUES (po2, pa, 'TEST-CI-商品A', 10, 10);
  INSERT INTO consolidated_shipments (shipment_number, status, total_weight_kg, total_cost_ntd)
  VALUES ('TEST-CI-CS2', '已到達', 5, 0) RETURNING id INTO cs2;
  INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, qty)
  VALUES (cs2, 'TEST-CI-PO2', pa, 'TEST-CI-商品A', 10) RETURNING id INTO ia2;
  PERFORM receive_shipment(cs2, jsonb_build_array(jsonb_build_object('id', ia2, 'actual_qty', 10)));
  -- 新到 10 件落地 45.675（運費 0）；(10×81.68 + 10×45.675) / 20 = 63.6775 → 63.68
  SELECT unit_cost_ntd INTO got FROM products WHERE id = pa;
  ASSERT got = 63.68, format('A 加權平均成本應為 63.68，實際 %s', got);

  -- ---------- 3. 少收：結案看實收，不是看排了幾件 ----------
  INSERT INTO purchase_orders (po_number, cny_rate, order_date) VALUES ('TEST-CI-PO3', 4.5, current_date) RETURNING id INTO po3;
  INSERT INTO purchase_order_items (po_id, product_id, product_name, qty, unit_price_cny) VALUES (po3, pb, 'TEST-CI-商品B', 10, 20);
  INSERT INTO consolidated_shipments (shipment_number, status, total_weight_kg, total_cost_ntd)
  VALUES ('TEST-CI-CS3', '已到達', 15, 300) RETURNING id INTO cs3;
  INSERT INTO consolidated_shipment_items (shipment_id, po_number, product_id, product_name, qty)
  VALUES (cs3, 'TEST-CI-PO3', pb, 'TEST-CI-商品B', 10) RETURNING id INTO ib3;
  PERFORM receive_shipment(cs3, jsonb_build_array(jsonb_build_object('id', ib3, 'actual_qty', 8)));
  SELECT status_received INTO ok FROM purchase_orders WHERE id = po3;
  ASSERT NOT ok, '排 10 件只收到 8 件，PO3 不應結案';

  -- ---------- 4. 取消判斷 ----------
  ASSERT is_cancelled_status('不成立'), '「不成立」要算取消';
  ASSERT is_cancelled_status('已取消'), '「已取消」要算取消';
  ASSERT NOT is_cancelled_status('已完成(鑑賞期內)，但買家仍可申請退貨/退款。'), '鑑賞期內的已完成不是取消';
  ASSERT NOT is_cancelled_status('已完成'), '「已完成」不是取消';
  ASSERT NOT is_cancelled_status(NULL), '空白狀態不是取消';

  -- ---------- 5. 賣出扣庫存、記成本快照；取消回沖 ----------
  INSERT INTO sales_orders (order_number, order_date, order_amount, status)
  VALUES ('TEST-CI-SO1', current_date, 500, '運送中') RETURNING id INTO so;
  INSERT INTO sales_order_items (order_id, product_id, product_name, qty, unit_price, subtotal)
  VALUES (so, pa, 'TEST-CI-商品A', 2, 250, 500);
  SELECT sum(qty_delta) INTO n FROM inventory_ledger WHERE product_id = pa;
  ASSERT n = 18, format('A 賣 2 件後庫存應為 20−2=18，實際 %s', n);
  SELECT unit_cost_at_sale INTO got FROM sales_order_items WHERE order_id = so;
  ASSERT got = 63.68, format('成本快照應記賣出當下的 63.68，實際 %s', got);
  UPDATE sales_orders SET status = '不成立' WHERE id = so;
  SELECT sum(qty_delta) INTO n FROM inventory_ledger WHERE product_id = pa;
  ASSERT n = 20, format('訂單不成立要把 2 件加回，庫存應為 20，實際 %s', n);

  INSERT INTO sales_orders (order_number, order_date, order_amount, status)
  VALUES ('TEST-CI-SO2', current_date, 250, '運送中') RETURNING id INTO so2;
  INSERT INTO sales_order_items (order_id, product_id, product_name, qty, unit_price, subtotal)
  VALUES (so2, pa, 'TEST-CI-商品A', 1, 250, 250);
  UPDATE sales_orders SET status = '已完成(鑑賞期內)，但買家仍可申請退貨/退款。' WHERE id = so2;
  SELECT sum(qty_delta) INTO n FROM inventory_ledger WHERE product_id = pa;
  ASSERT n = 19, format('鑑賞期內的已完成不能回沖，庫存應為 19，實際 %s', n);

  -- ---------- 6. 庫存紀錄：記得是誰改的、不能刪 ----------
  SELECT count(*) INTO n FROM inventory_ledger
   WHERE product_id = pa AND created_by = 'd1bcb4cc-5619-42be-a194-16ab9a2a9dba'::uuid;
  ASSERT n > 0, '登入者寫入的庫存紀錄要記 created_by';
  BEGIN
    DELETE FROM inventory_ledger WHERE product_id = pa;
    RAISE EXCEPTION 'TEST_FAIL 庫存紀錄可以被刪';
  EXCEPTION WHEN others THEN
    ASSERT sqlerrm LIKE 'LEDGER_NO_DELETE%', format('刪庫存紀錄應回 LEDGER_NO_DELETE，實際 %s', sqlerrm);
  END;

  RAISE NOTICE '001_receive_cost_and_sales: all assertions passed';
END
$test$;

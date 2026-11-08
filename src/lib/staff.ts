// 登入者 uid → 顯示名稱（app_users，migration 020）。庫存紀錄的 created_by 用這個換成名字。
import { getSupabase } from "./supabase";

let cache: Promise<Map<string, string>> | null = null;

export function staffNames(): Promise<Map<string, string>> {
  if (!cache) {
    cache = (async () => {
      const { data, error } = await getSupabase().from("app_users").select("user_id, display_name");
      if (error) {
        cache = null; // 下次再試，不把失敗結果記住
        return new Map<string, string>();
      }
      return new Map((data || []).map((r) => [r.user_id as string, r.display_name as string]));
    })();
  }
  return cache;
}

// migration 020 套用前的舊紀錄沒有記是誰，不顯示名字（不能猜）
const ACTOR_RECORDED_FROM = "2026-11-08";

// 回傳空字串＝不顯示。created_by 是 NULL 而且是 020 之後的紀錄＝匯入腳本等系統寫入
export function actorName(names: Map<string, string>, uid: string | null | undefined, occurredAt: string): string {
  if (uid) return names.get(uid) ?? "其他帳號";
  return occurredAt >= ACTOR_RECORDED_FROM ? "系統" : "";
}

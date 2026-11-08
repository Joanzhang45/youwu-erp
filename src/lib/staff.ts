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

// migration 020 套用當下帳本最大 id 是 2128（2026-11-08 查證：當時 873 筆 created_by 全為 NULL）。
// 這之前的紀錄沒有記是誰，不顯示名字（不能猜）。
const LAST_ID_BEFORE_ACTOR = 2128;

// 回傳空字串＝不顯示。names 是空的（名單讀取失敗）也不顯示，免得每筆都變「其他帳號」。
export function actorName(names: Map<string, string>, uid: string | null | undefined, ledgerId: number): string {
  if (uid) return names.size === 0 ? "" : names.get(uid) ?? "其他帳號";
  return ledgerId > LAST_ID_BEFORE_ACTOR ? "系統" : "";
}

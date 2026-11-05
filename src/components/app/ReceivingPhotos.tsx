"use client";

// 到貨異常照片：上傳到私有儲存區 receiving-photos（migration 014，只有白名單兩人能讀寫），
// 顯示時換成 1 小時有效的簽名網址。
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export const PHOTO_BUCKET = "receiving-photos";

export async function uploadReceivingPhoto(shipmentId: number, itemId: number, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `shipment-${shipmentId}/item-${itemId}-${Date.now()}.${ext}`;
  const { error } = await getSupabase().storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export function ReceivingPhotos({ receivingId }: { receivingId: number }) {
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("receiving_record_items")
        .select("product_name, photo_path")
        .eq("receiving_id", receivingId)
        .not("photo_path", "is", null);
      const rows = (data || []) as { product_name: string | null; photo_path: string }[];
      if (rows.length === 0) return;
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(
        rows.map((r) => r.photo_path),
        3600
      );
      if (!alive) return;
      setPhotos(
        rows
          .map((r, i) => ({ name: r.product_name || "", url: signed?.[i]?.signedUrl || "" }))
          .filter((p) => p.url)
      );
    })();
    return () => {
      alive = false;
    };
  }, [receivingId]);

  if (photos.length === 0) return null;
  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {photos.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={p.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.name} className="w-14 h-14 rounded-lg object-cover border border-[#EAEAEA]" />
        </a>
      ))}
    </div>
  );
}

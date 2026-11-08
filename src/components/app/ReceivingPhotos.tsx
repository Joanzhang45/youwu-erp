"use client";

// 到貨異常照片：上傳到私有儲存區 receiving-photos（migration 014，只有白名單兩人能讀寫），
// 顯示時換成 1 小時有效的簽名網址。
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export const PHOTO_BUCKET = "receiving-photos";

// 手機原圖常 3～8MB，上傳前縮到長邊 1600px、JPEG 品質 0.8（約 200～500KB），省流量也省儲存空間
// （第二次健檢 #27）。瀏覽器解不開（例如部分裝置的 HEIC）或本來就小就傳原檔。
const MAX_SIDE = 1600;
const SKIP_BELOW_BYTES = 400 * 1024;

async function compressImage(file: File): Promise<Blob> {
  if (file.size < SKIP_BELOW_BYTES || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadReceivingPhoto(shipmentId: number, itemId: number, file: File): Promise<string> {
  const body = await compressImage(file);
  const compressed = body !== file;
  const ext = compressed
    ? "jpg"
    : (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `shipment-${shipmentId}/item-${itemId}-${Date.now()}.${ext}`;
  const { error } = await getSupabase().storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: compressed ? "image/jpeg" : file.type || "image/jpeg",
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

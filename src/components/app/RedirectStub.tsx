"use client";

// M5 舊頁退場：14 個舊路由（首頁＋13 頁）共用這支 redirect stub，取代各自的完整介面。
// static export 仍會為每個舊路由產出一支真實可 200 的 HTML（curl 不會 404，滿足 A12），
// 首次繪出時只顯示「頁面已搬家」極簡過渡文案，hydrate 後 useEffect 立刻 router.replace
// 到新 IA 對應頁——GH Pages 上人眼幾乎感覺不到停留。
// useSearchParams() 在 Next.js static export 底下一律要包 Suspense（沿用 /purchase/detail、
// /inbound 等既有頁面的既定慣例），即使某支舊頁其實不需要帶參數也一併包，維持單一元件好維護。
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Transitioning() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-sm text-[#8F8F8F]">頁面已搬家，帶你過去…</p>
    </div>
  );
}

function RedirectStubContent({ resolve }: { resolve: (params: URLSearchParams) => string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const target = resolve(searchParams);

  useEffect(() => {
    router.replace(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return <Transitioning />;
}

export function RedirectStub({ resolve }: { resolve: (params: URLSearchParams) => string }) {
  return (
    <Suspense fallback={<Transitioning />}>
      <RedirectStubContent resolve={resolve} />
    </Suspense>
  );
}

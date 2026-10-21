import { NextResponse } from "next/server";
import { readPricingSettings } from "@/lib/pricing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readPricingSettings();
    return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Fiyatlandırma ayarları okunamadı:", error);
    return NextResponse.json({ error: "Fiyat ayarları şu anda alınamıyor." }, { status: 503 });
  }
}

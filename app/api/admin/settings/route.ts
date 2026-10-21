import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, originIsSameSite } from "@/lib/admin-auth";
import { validatePricingSettings } from "@/lib/pricing";
import { readPricingSettings, writePricingSettings } from "@/lib/pricing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  }

  try {
    const settings = await readPricingSettings();
    return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Yönetici fiyat ayarları okunamadı:", error);
    return NextResponse.json({ error: "Ayarlar okunamadı. R2 yapılandırmasını kontrol edin." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  if (!originIsSameSite(request)) {
    return NextResponse.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const settings = validatePricingSettings(body);
  if (!settings) {
    return NextResponse.json({ error: "Fiyat alanları sıfır veya daha büyük geçerli sayılar olmalı." }, { status: 400 });
  }

  try {
    await writePricingSettings(settings);
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Yönetici fiyat ayarları kaydedilemedi:", error);
    return NextResponse.json({ error: "Ayarlar kaydedilemedi. R2 yazma izinlerini kontrol edin." }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, createAdminSession, verifyAdminCredentials, originIsSameSite } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!originIsSameSite(request)) {
    return NextResponse.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }

  const emailConfigured = Boolean(process.env.ADMIN_EMAIL);
  const passwordConfigured = Boolean(process.env.ADMIN_PASSWORD);
  const secretConfigured = Boolean(process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.length >= 32);
  if (!emailConfigured || !passwordConfigured || !secretConfigured) {
    return NextResponse.json(
      { error: "Yönetici girişi henüz yapılandırılmamış. Vercel ortam değişkenlerini kontrol edin." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const values = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (!verifyAdminCredentials(values.email, values.password)) {
    return NextResponse.json({ error: "E-posta veya şifre hatalı." }, { status: 401 });
  }

  try {
    const session = createAdminSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, session.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: session.maxAge
    });
    return response;
  } catch (error) {
    console.error("Yönetici oturumu oluşturulamadı:", error);
    return NextResponse.json({ error: "Oturum başlatılamadı." }, { status: 500 });
  }
}

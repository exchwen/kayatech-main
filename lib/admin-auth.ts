import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "kayatech_admin_session";
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAdminCredentials(email: unknown, password: unknown): boolean {
  const expectedEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const expectedPassword = process.env.ADMIN_PASSWORD || "";
  if (!expectedEmail || !expectedPassword) return false;
  if (typeof email !== "string" || typeof password !== "string") return false;
  return safeEqual(email.trim().toLowerCase(), expectedEmail) && safeEqual(password, expectedPassword);
}

function sessionSignature(expiresAt: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (secret.length < 32 || !email) throw new Error("Yönetici oturumu yapılandırılmamış.");
  return createHmac("sha256", secret).update(`${email}:${expiresAt}`).digest("base64url");
}

export function createAdminSession(): { value: string; maxAge: number } {
  const maxAge = ADMIN_SESSION_SECONDS;
  const expiresAt = String(Math.floor(Date.now() / 1000) + maxAge);
  return { value: `${expiresAt}.${sessionSignature(expiresAt)}`, maxAge };
}

export function isAdminRequest(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (secret.length < 32 || !email) return false;

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = token.slice(0, dot);
  const providedSignature = token.slice(dot + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  try {
    return safeEqual(providedSignature, sessionSignature(expiresAt));
  } catch {
    return false;
  }
}

export function originIsSameSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

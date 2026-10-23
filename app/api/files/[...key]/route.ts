import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: { key: string[] } }) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const key = params.key.join("/");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !/^uploads\/[0-9a-f-]{36}\.(stl|3mf)$/i.test(key)) return NextResponse.json({ error: "Geçersiz dosya bağlantısı." }, { status: 400 });
  const s3 = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  try { const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 * 60 * 24 * 7 }); return NextResponse.redirect(url); } catch { return NextResponse.json({ error: "Dosya bağlantısı oluşturulamadı." }, { status: 404 }); } finally { s3.destroy(); }
}

import { GoogleAuth } from "google-auth-library";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const SERVICE_URL = process.env.SLICER_SERVICE_URL;
const MAX_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 270_000;

function createR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 ayarları eksik.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });
}

function safeResponseText(value: string): string {
  return value
    .replace(
      /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
      "Bearer [REDACTED]"
    )
    .slice(0, 1200);
}

function getErrorInfo(error: unknown) {
  const err =
    typeof error === "object" && error !== null
      ? (error as {
          name?: string;
          message?: string;
          code?: string;
          response?: {
            status?: number;
            data?: unknown;
          };
          $metadata?: {
            httpStatusCode?: number;
          };
          cause?: unknown;
        })
      : {};

  let responseDetails: string | undefined;

  if (err.response?.data !== undefined) {
    try {
      responseDetails =
        typeof err.response.data === "string"
          ? err.response.data
          : JSON.stringify(err.response.data);

      responseDetails = safeResponseText(
        responseDetails ?? ""
      );
    } catch {
      responseDetails = "[Yanıt ayrıntısı okunamadı]";
    }
  }

  let cause: { name?: string; message?: string } | undefined;

  if (err.cause instanceof Error) {
    cause = {
      name: err.cause.name,
      message: safeResponseText(err.cause.message)
    };
  }

  return {
    name: err.name ?? "UnknownError",
    message:
      typeof err.message === "string"
        ? safeResponseText(err.message)
        : String(error),
    code: err.code,
    status:
      err.response?.status ??
      err.$metadata?.httpStatusCode,
    responseDetails,
    cause
  };
}

export async function POST(request: NextRequest) {
  let key: string | undefined;
  let bucket: string | undefined;
  let s3: S3Client | undefined;

  let phase = "START";
  let upstreamStatus: number | undefined;
  let upstreamBody: string | undefined;

  try {
    // 1. Yapılandırmayı kontrol et.
    phase = "CHECK_CONFIG";

    if (!SERVICE_URL) {
      return NextResponse.json(
        { error: "Dilimleme servisi yapılandırılmamış." },
        { status: 500 }
      );
    }

    const serviceBaseUrl = SERVICE_URL.replace(/\/+$/, "");
    new URL(serviceBaseUrl);

    bucket = process.env.R2_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        { error: "R2 bucket ayarı eksik." },
        { status: 500 }
      );
    }

    // 2. İstek gövdesini ve dosya anahtarını doğrula.
    phase = "READ_REQUEST";

    const body = await request.json();
    key = body?.key;

    const scalePercent = body?.scale_percent;
    if (
      typeof scalePercent !== "number" ||
      !Number.isFinite(scalePercent) ||
      scalePercent < 50 ||
      scalePercent > 200
    ) {
      return NextResponse.json(
        { error: "Ölçek yüzde 50 ile 200 arasında olmalıdır." },
        { status: 400 }
      );
    }

    if (
      typeof key !== "string" ||
      !/^uploads\/[0-9a-f-]{36}\.(stl|3mf)$/i.test(key)
    ) {
      return NextResponse.json(
        { error: "Geçersiz dosya anahtarı." },
        { status: 400 }
      );
    }

    // 3. STL dosyasını Cloudflare R2'den indir.
    phase = "R2_DOWNLOAD";

    s3 = createR2Client();

    const object = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    if (!object.Body) {
      return NextResponse.json(
        { error: "R2 dosyası okunamadı." },
        { status: 404 }
      );
    }

    if (
      object.ContentLength === undefined ||
      object.ContentLength <= 0 ||
      object.ContentLength > MAX_BYTES
    ) {
      return NextResponse.json(
        { error: "Dosya boş veya 25 MB sınırını aşıyor." },
        { status: 413 }
      );
    }

    const bytes = await object.Body.transformToByteArray();

    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_BYTES
    ) {
      return NextResponse.json(
        { error: "Dosya boş veya 25 MB sınırını aşıyor." },
        { status: 413 }
      );
    }

    // 4. Google servis hesabını oku.
    phase = "GOOGLE_AUTH_SETUP";

    const credentialsJson =
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!credentialsJson) {
      return NextResponse.json(
        { error: "Google servis hesabı yapılandırılmamış." },
        { status: 500 }
      );
    }

    const credentials = JSON.parse(credentialsJson);
    const auth = new GoogleAuth({ credentials });

    // 5. Cloud Run için ID token istemcisi oluştur.
    phase = "CREATE_ID_TOKEN_CLIENT";

    const client = await auth.getIdTokenClient(
      serviceBaseUrl
    );

    // 6. Kimlik doğrulama başlıklarını al.
    phase = "GET_ID_TOKEN";

    const headers = await client.getRequestHeaders(
      serviceBaseUrl
    );

    // 7. STL dosyasını multipart biçiminde hazırla.
    phase = "PREPARE_MULTIPART";

    const form = new FormData();
    const fileBuffer = new ArrayBuffer(bytes.byteLength);

    new Uint8Array(fileBuffer).set(bytes);

    const originalFilename = typeof body?.filename === "string" && /\.(stl|3mf)$/i.test(body.filename)
      ? body.filename
      : key.endsWith(".3mf") ? "model.3mf" : "model.stl";

    form.append(
      "file",
      new Blob([fileBuffer], {
        type: "application/octet-stream"
      }),
      originalFilename
    );
    form.append("preview", "true");
    form.append("scale_percent", String(scalePercent));

    // 8. STL dosyasını Cloud Run'a gönder.
    phase = "CLOUD_RUN_POST";

    const response = await fetch(
      `${serviceBaseUrl}/slice`,
      {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(
          UPSTREAM_TIMEOUT_MS
        ),
        cache: "no-store"
      }
    );

    // Content-Type başlığını elle ekleme.
    // fetch multipart boundary bilgisini kendisi oluşturur.

    // 9. Cloud Run yanıtını oku.
    phase = "READ_CLOUD_RUN_RESPONSE";

    const responseText = await response.text();

    upstreamStatus = response.status;
    upstreamBody = safeResponseText(responseText);

    if (!response.ok) {
      phase = "CLOUD_RUN_HTTP_ERROR";

      throw new Error(
        `Cloud Run HTTP ${response.status} yanıtı döndürdü.`
      );
    }

    // 10. Başarılı yanıtın JSON olduğunu doğrula.
    phase = "PARSE_CLOUD_RUN_RESPONSE";

    let result: unknown;

    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        "Cloud Run geçerli JSON yanıtı döndürmedi."
      );
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const details = getErrorInfo(error);

    console.error("STL dilimleme hatası:", {
      phase,
      name: details.name,
      message: details.message,
      code: details.code,
      status: upstreamStatus ?? details.status,
      responseDetails:
        upstreamBody ?? details.responseDetails,
      cause: details.cause
    });

    const isMissingFile =
      details.name === "NoSuchKey";

    const status = isMissingFile
      ? 404
      : upstreamStatus ?? 502;

    return NextResponse.json(
      {
        error: isMissingFile
          ? "R2'de dosya bulunamadı. Dosyayı yeniden yükleyin."
          : "Dilimleme başarısız oldu. Sunucu ayarlarını kontrol edin."
      },
      { status }
    );
  } finally {
    // 11. Geçici STL dosyasını R2'den sil.
    if (s3 && bucket && key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
          })
        );
      } catch (error: unknown) {
        console.error(
          "Geçici R2 dosyası silinemedi:",
          getErrorInfo(error)
        );
      }
    }

    s3?.destroy();
  }
}

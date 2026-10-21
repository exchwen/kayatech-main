import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  DEFAULT_PRICING_SETTINGS,
  normalizePricingSettings,
  type PricingSettings
} from "./pricing";

const SETTINGS_KEY = "settings/pricing.json";

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
    credentials: { accessKeyId, secretAccessKey }
  });
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2 bucket ayarı eksik.");
  return bucket;
}

export async function readPricingSettings(): Promise<PricingSettings> {
  const client = createR2Client();
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: SETTINGS_KEY })
    );
    if (!response.Body) return DEFAULT_PRICING_SETTINGS;
    const text = await response.Body.transformToString();
    return normalizePricingSettings(JSON.parse(text));
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return DEFAULT_PRICING_SETTINGS;
    }
    throw error;
  } finally {
    client.destroy();
  }
}

export async function writePricingSettings(settings: PricingSettings): Promise<void> {
  const client = createR2Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: SETTINGS_KEY,
        Body: JSON.stringify(settings, null, 2),
        ContentType: "application/json",
        CacheControl: "no-store"
      })
    );
  } finally {
    client.destroy();
  }
}

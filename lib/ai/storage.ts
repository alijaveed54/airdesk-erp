import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function getR2() {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
  const bucket = process.env.R2_BUCKET_NAME!;

  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
  };
}

export function getAIResultKey(imageKey: string) {
  return `ai-results/${imageKey.replace(/\.[^.]+$/, ".json")}`;
}

export async function saveAIResult(imageKey: string, result: unknown) {
  const { client, bucket } = getR2();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: getAIResultKey(imageKey),
      Body: JSON.stringify(result, null, 2),
      ContentType: "application/json",
      CacheControl: "public,max-age=31536000,immutable",
    }),
  );
}

export async function aiResultExists(imageKey: string) {
  const { client, bucket } = getR2();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: getAIResultKey(imageKey),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadAIResult<T = unknown>(
  imageKey: string,
): Promise<T | null> {
  const { client, bucket } = getR2();

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: getAIResultKey(imageKey),
      }),
    );

    const text = await response.Body?.transformToString();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

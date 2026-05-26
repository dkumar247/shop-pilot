import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export async function POST(request: Request) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const accessKey = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretKey = process.env.CLOUDFLARE_R2_SECRET_KEY;

  if (!accountId || !bucket || !accessKey || !secretKey) {
    return Response.json({ error: "Missing Cloudflare config" }, { status: 500 });
  }

  const s3 = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const key = `audio/${Date.now()}-${crypto.randomUUID()}.webm`;
  const body = await request.arrayBuffer();

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: new Uint8Array(body),
    ContentType: "audio/webm",
  }));

  return Response.json({ key });
}

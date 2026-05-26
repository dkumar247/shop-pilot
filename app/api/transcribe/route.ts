export async function POST(request: Request) {
  const whisperUrl = process.env.BASETEN_WHISPER_URL;
  const apiKey = process.env.BASETEN_API_KEY;

  if (!whisperUrl) {
    return Response.json({ transcript: "", fallback: true });
  }

  if (!apiKey) {
    return Response.json({ error: "Missing BaseTen config" }, { status: 500 });
  }

  let audioBlob: Blob;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    // Pattern 2: { key } — fetch from R2 then transcribe
    const { key } = await request.json();
    if (!key) {
      return Response.json({ error: "Missing key" }, { status: 400 });
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const bucket = process.env.CLOUDFLARE_R2_BUCKET;
    const accessKey = process.env.CLOUDFLARE_R2_ACCESS_KEY;
    const secretKey = process.env.CLOUDFLARE_R2_SECRET_KEY;

    if (!accountId || !bucket || !accessKey || !secretKey) {
      return Response.json({ error: "Missing Cloudflare R2 config" }, { status: 500 });
    }

    const { S3Client, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await obj.Body!.transformToByteArray();
    audioBlob = new Blob([bytes], { type: "audio/webm" });

    // Clean up R2 after reading
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } else {
    // Pattern 1: multipart form-data with "audio" field
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!audio || typeof audio === "string") {
      return Response.json({ error: "Missing audio field" }, { status: 400 });
    }
    audioBlob = audio as Blob;
  }

  const outgoing = new FormData();
  outgoing.append("audio", audioBlob, "audio.webm");

  const upstream = await fetch(whisperUrl, {
    method: "POST",
    headers: { Authorization: `Api-Key ${apiKey}` },
    body: outgoing,
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return Response.json(
      { error: `BaseTen error ${upstream.status}: ${text}` },
      { status: 502 }
    );
  }

  const data = await upstream.json() as Record<string, unknown>;
  const transcript =
    (data.transcription as string) ??
    (data.transcript as string) ??
    "";

  return Response.json({ transcript });
}

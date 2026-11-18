import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.637.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.637.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const MAX_VIDEO_FILE_SIZE = 5 * 1024 * 1024 * 1024;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await request.json();
    const action = body.action;

    // Matches the exact secrets you already saved in Supabase:
    const endpoint = Deno.env.get("B2_ENDPOINT");
    const region = Deno.env.get("B2_REGION") || "us-east-005";
    const bucket = Deno.env.get("B2_BUCKET_NAME");
    const accessKeyId = Deno.env.get("B2_KEY_ID");
    const secretAccessKey = Deno.env.get("B2_APP_KEY");

    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
      console.error("Video signing is missing one or more B2 secrets.");
      return jsonResponse({ error: "Video uploads and playback are not configured yet." }, 503);
    }

    const s3 = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }
    });

    if (action === "upload") {
      const { fileName, fileType, fileSize } = body;
      const title = typeof body.title === "string" ? body.title.trim() : "";

      if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 255) {
        return jsonResponse({ error: "Choose a video with a valid file name." }, 400);
      }
      if (typeof fileType !== "string" || !/^video\/[\w.+-]+$/i.test(fileType)) {
        return jsonResponse({ error: "The selected file is not a supported video type." }, 400);
      }
      if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_VIDEO_FILE_SIZE) {
        return jsonResponse({ error: "Videos must be smaller than 5 GB." }, 400);
      }
      if (title.length > 255) return jsonResponse({ error: "Video titles must be 255 characters or fewer." }, 400);

      const extension = fileName.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase();
      const fileKey = `videos/${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: fileKey, ContentType: fileType }),
        { expiresIn: 900 }
      );

      return jsonResponse({ uploadUrl, fileKey, title: title || fileName });
    }

    if (action === "watch") {
      const fileKey = typeof body.fileKey === "string" ? body.fileKey : body.fileName;
      if (typeof fileKey !== "string" || !/^videos\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/i.test(fileKey)) {
        return jsonResponse({ error: "That video key is not valid." }, 400);
      }

      const watchUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
        { expiresIn: 4 * 60 * 60 }
      );
      return jsonResponse({ watchUrl });
    }

    return jsonResponse({ error: "Action must be upload or watch." }, 400);
  } catch (error) {
    console.error("Could not prepare the video URL:", error);
    return jsonResponse({ error: "Could not prepare this video request. Please try again." }, 500);
  }
});

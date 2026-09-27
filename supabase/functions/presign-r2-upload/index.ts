// @ts-nocheck — Deno Edge runtime; not typechecked by the Expo TS project.
/**
 * Presigned PUT URLs for Cloudflare R2 (S3-compatible).
 * Secrets (Dashboard → Edge Functions → presign-r2-upload → Secrets, or `supabase secrets set`):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
 * Optional:
 *   R2_ALLOW_CLIENT_PUB_UPLOAD=true  — allow purpose "pub_gallery" from the app (default off)
 *   R2_REQUIRE_CONTENT_LENGTH=true   — refuse requests without contentLength. Builds before
 *     audit Batch 7 don't send it; turn this on once most users have updated.
 *
 * Size / type: when the app sends contentLength (bytes, max MAX_UPLOAD_BYTES), the URL
 * signs Content-Length and Content-Type, so the PUT must match both exactly.
 *
 * Object keys (single bucket, prefix layout):
 *   reports/{userId}/{uuid}.{ext}
 *   avatars/{userId}/{uuid}.{ext}
 *   pubs/{pubId}/{slot}.{ext}   — only when R2_ALLOW_CLIENT_PUB_UPLOAD=true
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.741.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.741.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Purpose = "report" | "avatar" | "pub_gallery";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Extension comes from the content type, never from the client. */
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing bearer token" }, 401);
    }

    const jwt = authHeader.slice(7);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !user) {
      return json({ error: "Invalid session" }, 401);
    }

    const body = (await req.json()) as {
      purpose?: string;
      contentType?: string;
      contentLength?: number;
      pubId?: string;
      slot?: number;
    };

    const purpose = body.purpose as Purpose;
    const contentType = body.contentType ?? "";
    const fileExt = EXT_BY_TYPE[contentType];
    if (!fileExt) {
      return json({ error: "Invalid content type" }, 400);
    }

    const contentLength = body.contentLength;
    if (contentLength == null) {
      if (Deno.env.get("R2_REQUIRE_CONTENT_LENGTH") === "true") {
        return json({ error: "contentLength required" }, 400);
      }
    } else if (
      !Number.isInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_UPLOAD_BYTES
    ) {
      return json({ error: "Image must be 5 MB or smaller" }, 413);
    }

    const allowedPurposes: Purpose[] = ["report", "avatar", "pub_gallery"];
    if (!purpose || !allowedPurposes.includes(purpose)) {
      return json({ error: "Invalid purpose" }, 400);
    }

    let objectKey: string;
    const uid = user.id;
    const rid = crypto.randomUUID();

    if (purpose === "report") {
      objectKey = `reports/${uid}/${rid}.${fileExt}`;
    } else if (purpose === "avatar") {
      objectKey = `avatars/${uid}/${rid}.${fileExt}`;
    } else {
      const allowPub = Deno.env.get("R2_ALLOW_CLIENT_PUB_UPLOAD") === "true";
      if (!allowPub) {
        return json(
          { error: "Pub gallery client upload disabled. Use an admin path or enable R2_ALLOW_CLIENT_PUB_UPLOAD." },
          403,
        );
      }
      const pubId = typeof body.pubId === "string" ? body.pubId.trim() : "";
      const slot = Number(body.slot);
      if (!pubId || !Number.isInteger(slot) || slot < 0 || slot > 5) {
        return json({ error: "pubId and integer slot 0–5 required" }, 400);
      }
      const safePub = pubId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
      if (!safePub) {
        return json({ error: "Invalid pubId" }, 400);
      }
      objectKey = `pubs/${safePub}/${slot}.${fileExt}`;
    }

    const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
    const accessKey = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    const bucket = Deno.env.get("R2_BUCKET_NAME") ?? "";
    const publicBaseRaw = Deno.env.get("R2_PUBLIC_BASE_URL") ?? "";
    if (!accountId || !accessKey || !secretKey || !bucket || !publicBaseRaw) {
      console.error("Missing R2 env vars");
      return json({ error: "R2 not configured on server" }, 500);
    }

    const publicBase = publicBaseRaw.replace(/\/$/, "");

    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
      ...(contentLength != null ? { ContentLength: contentLength } : {}),
    });

    // Signing these headers is what enforces the size and type on the PUT.
    // Old builds (no contentLength) get an unsigned-size URL as before.
    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: 120,
      ...(contentLength != null
        ? { signableHeaders: new Set(["content-length", "content-type"]) }
        : {}),
    });
    const publicUrl = `${publicBase}/${objectKey}`;

    return json({ uploadUrl, publicUrl, objectKey }, 200);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

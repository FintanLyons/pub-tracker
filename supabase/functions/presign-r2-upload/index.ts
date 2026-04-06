/**
 * Presigned PUT URLs for Cloudflare R2 (S3-compatible).
 * Secrets (Dashboard → Edge Functions → presign-r2-upload → Secrets, or `supabase secrets set`):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
 * Optional:
 *   R2_ALLOW_CLIENT_PUB_UPLOAD=true  — allow purpose "pub_gallery" from the app (default off)
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
      fileExt?: string;
      pubId?: string;
      slot?: number;
    };

    const purpose = body.purpose as Purpose;
    const contentType = body.contentType ?? "";
    const rawExt = String(body.fileExt ?? "jpg").toLowerCase();
    const fileExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : "jpg";

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(contentType)) {
      return json({ error: "Invalid content type" }, 400);
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
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 120 });
    const publicUrl = `${publicBase}/${objectKey}`;

    return json({ uploadUrl, publicUrl, objectKey });
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

import { getUnit } from "@/lib/content-db";
import {
  createClient,
  createServiceRoleClient,
  isServiceRoleConfigured,
} from "@/lib/supabase/server";
import type { NoteSection } from "@/lib/types";

export const maxDuration = 300;

interface PodcastLine {
  s: "Deniz" | "Mert";
  t: string;
}

interface PodcastBody {
  subject: string;
  unitSlug: string;
  lang: "tr" | "en";
  force?: boolean;
}

/* ---------- cloud storage: new Cubad Supabase project's public podcasts bucket ---------- */

const BUCKET = "podcasts";
// Gemini 2.5 Flash is no longer available to this production key. Keep the script
// generator on the current stable Flash model; the dedicated 2.5 Preview TTS model
// remains the supported audio-generation endpoint.
const SCRIPT_MODEL = "gemini-3.5-flash";
const hasStorage = () => isServiceRoleConfigured();

const audioPath = (subject: string, unitSlug: string, lang: string) =>
  `${subject}/${unitSlug}/${lang}.wav`;
const scriptPath = (subject: string, unitSlug: string, lang: string) =>
  `${subject}/${unitSlug}/${lang}.json`;

/** The published library is public, but only an administrator may create it. */
async function requirePodcastAdmin(): Promise<Response | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ error: "upstream" }, { status: 502 });
  if (profile?.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

async function canGeneratePodcast(): Promise<boolean> {
  return (await requirePodcastAdmin()) === null;
}

/** Returns the public URL if the object exists, else null. */
async function storedUrl(path: string): Promise<string | null> {
  if (!hasStorage()) return null;
  const supabase = createServiceRoleClient();
  const dir = path.split("/").slice(0, -1).join("/");
  const filename = path.split("/").pop()!;
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: filename });
  if (error || !data?.some((file) => file.name === filename)) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function storeObject(
  path: string,
  body: Buffer | string,
  contentType: string
): Promise<string | null> {
  if (!hasStorage()) return null;
  const supabase = createServiceRoleClient();
  const payload = typeof body === "string" ? body : new Uint8Array(body);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, payload, { contentType, upsert: true });
  if (error) {
    console.error("supabase upload failed", error.message);
    return null;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * GET without params: capability report.
 * GET ?subject=...&unit=...: capability + per-language stored podcast URLs, so every
 * device sees the same library.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subject = searchParams.get("subject");
  const unitSlug = searchParams.get("unit");
  const base = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    storage: hasStorage(),
    canGenerate: await canGeneratePodcast(),
  };

  if (!subject || !unitSlug || !hasStorage()) {
    return Response.json({ ...base, tr: null, en: null });
  }

  const [trAudio, enAudio, trScript, enScript] = await Promise.all([
    storedUrl(audioPath(subject, unitSlug, "tr")),
    storedUrl(audioPath(subject, unitSlug, "en")),
    storedUrl(scriptPath(subject, unitSlug, "tr")),
    storedUrl(scriptPath(subject, unitSlug, "en")),
  ]);

  return Response.json({
    ...base,
    tr: trAudio ? { audio: trAudio, script: trScript } : null,
    en: enAudio ? { audio: enAudio, script: enScript } : null,
  });
}

/** Strip the most common markdown syntax down to plain readable text. */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function buildNotesDigest(notes: NoteSection[], lang: "tr" | "en"): string {
  const parts: string[] = [];
  let wordCount = 0;
  const CAP = 6000;
  for (const n of notes) {
    const title = n.title[lang] || n.title.en || n.title.tr;
    const body = stripMarkdown(n.body[lang] || n.body.en || n.body.tr);
    const section = `## ${title}\n${body}`;
    const words = section.split(/\s+/).filter(Boolean);
    if (wordCount + words.length > CAP) {
      const remaining = CAP - wordCount;
      if (remaining > 0) parts.push(words.slice(0, remaining).join(" "));
      break;
    }
    parts.push(section);
    wordCount += words.length;
  }
  return parts.join("\n\n");
}

function scriptSystemPrompt(lang: "tr" | "en", digest: string): string {
  const langName = lang === "tr" ? "Turkish" : "English";
  return `You are writing a script for a 4-6 minute exam-prep podcast in ${langName}, in the "cubad" exam-prep app.
Two friendly hosts, "Deniz" and "Mert", talk through the lesson notes below like a study podcast.

Rules:
- Simple, warm, conversational words. Short sentences. Explain jargon the moment it appears.
- Cover EVERY note section below, in order, so nothing is skipped.
- Partway through, have the hosts quiz each other on the 3 trickiest points from the notes.
- End with a rapid-fire 5-item recap ("hızlı tekrar" / "rapid recap").
- Output STRICT JSON ONLY, matching exactly this shape, no markdown fences, no extra keys:
{"lines":[{"s":"Deniz","t":"..."},{"s":"Mert","t":"..."}]}
- "s" must be exactly "Deniz" or "Mert". "t" is what that host says (one turn).

LESSON NOTES:
${digest}`;
}

/**
 * Preserve only a small, non-sensitive provider diagnostic in function logs.
 * Gemini's raw error body can contain request details, so it must never be logged.
 */
async function logGeminiFailure(stage: "script" | "audio", response: Response): Promise<void> {
  let providerStatus = "unknown";
  try {
    const body = (await response.clone().json()) as { error?: { status?: unknown } };
    if (typeof body.error?.status === "string" && /^[A-Z_]{1,64}$/.test(body.error.status)) {
      providerStatus = body.error.status;
    }
  } catch {
    // The HTTP status remains useful when the provider returned a non-JSON error.
  }
  console.error("gemini podcast call failed", {
    stage,
    httpStatus: response.status,
    providerStatus,
  });
}

async function generateScript(
  key: string,
  lang: "tr" | "en",
  digest: string
): Promise<PodcastLine[] | null> {
  const payload = {
    contents: [{ role: "user", parts: [{ text: scriptSystemPrompt(lang, digest) }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
    },
  };

  const tryOnce = async (): Promise<PodcastLine[] | null> => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${SCRIPT_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      await logGeminiFailure("script", res);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      const parsed = JSON.parse(text) as { lines?: PodcastLine[] };
      if (
        Array.isArray(parsed.lines) &&
        parsed.lines.every(
          (l) => (l.s === "Deniz" || l.s === "Mert") && typeof l.t === "string" && l.t.trim()
        )
      ) {
        return parsed.lines;
      }
    } catch {
      // The provider accepted the request but did not return the promised structured result.
      // Do not log its text: it contains lesson content and may be large.
      console.error("gemini podcast call returned an invalid script response", { stage: "script" });
    }
    return null;
  };

  const first = await tryOnce();
  if (first) return first;
  return await tryOnce();
}

function wrapWav(pcm: Buffer, sampleRate = 24000, bitsPerSample = 16, numChannels = 1): Buffer {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generateAudio(key: string, lines: PodcastLine[]): Promise<Buffer | null> {
  const conversation = lines.map((l) => `${l.s}: ${l.t}`).join("\n");
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `TTS the following conversation between Deniz and Mert:\n${conversation}` }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: "Deniz", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
            { speaker: "Mert", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          ],
        },
      },
    },
  };
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    await logGeminiFailure("audio", res);
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) return null;
  const pcm = Buffer.from(b64, "base64");
  return wrapWav(pcm);
}

export async function POST(request: Request) {
  const authorizationError = await requirePodcastAdmin();
  if (authorizationError) return authorizationError;

  let body: PodcastBody;
  try {
    body = (await request.json()) as PodcastBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { subject, unitSlug, lang, force } = body;
  if (!subject || !unitSlug || (lang !== "tr" && lang !== "en")) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  // Already stored in the cloud? Every device gets the same file.
  if (hasStorage() && !force) {
    const existing = await storedUrl(audioPath(subject, unitSlug, lang));
    if (existing) {
      const script = await storedUrl(scriptPath(subject, unitSlug, lang));
      return Response.json({ url: existing, scriptUrl: script });
    }
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "not-configured" }, { status: 503 });

  const unit = await getUnit(subject, unitSlug);
  if (!unit || !unit.notes?.length) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const digest = buildNotesDigest(unit.notes, lang);

  try {
    const lines = await generateScript(key, lang, digest);
    if (!lines) return Response.json({ error: "script-failed" }, { status: 502 });

    const wav = await generateAudio(key, lines);
    if (!wav) {
      return Response.json({ scriptOnly: true, lines });
    }

    // Persist to the cloud so phones/other browsers stream the same file.
    if (hasStorage()) {
      const [audioUrl, scriptUrl] = await Promise.all([
        storeObject(audioPath(subject, unitSlug, lang), wav, "audio/wav"),
        storeObject(scriptPath(subject, unitSlug, lang), JSON.stringify(lines), "application/json"),
      ]);
      if (audioUrl) {
        return Response.json({ url: audioUrl, scriptUrl, lines });
      }
      // upload failed — fall through to inline audio so the user still gets their podcast
    }

    const scriptB64 = Buffer.from(JSON.stringify(lines)).toString("base64");
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "X-Podcast-Lines": scriptB64,
      },
    });
  } catch (e) {
    console.error("podcast route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}

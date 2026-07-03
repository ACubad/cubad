import { head, put } from "@vercel/blob";
import { getUnit } from "@/lib/content";
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
  userKey?: string;
  force?: boolean;
}

const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const audioPath = (subject: string, unitSlug: string, lang: string) =>
  `podcasts/${subject}/${unitSlug}/${lang}.wav`;
const scriptPath = (subject: string, unitSlug: string, lang: string) =>
  `podcasts/${subject}/${unitSlug}/${lang}.json`;

async function blobUrl(pathname: string): Promise<string | null> {
  try {
    const meta = await head(pathname);
    return meta.url;
  } catch {
    return null;
  }
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
  const base = { gemini: Boolean(process.env.GEMINI_API_KEY), blob: hasBlob() };

  if (!subject || !unitSlug || !hasBlob()) {
    return Response.json({ ...base, tr: null, en: null });
  }

  const [trAudio, enAudio, trScript, enScript] = await Promise.all([
    blobUrl(audioPath(subject, unitSlug, "tr")),
    blobUrl(audioPath(subject, unitSlug, "en")),
    blobUrl(scriptPath(subject, unitSlug, "tr")),
    blobUrl(scriptPath(subject, unitSlug, "en")),
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
  return `You are writing a script for a 5-8 minute exam-prep podcast in ${langName}, in the "cubad" exam-prep app.
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) return null;
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
      /* fall through to retry */
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) return null;
  const pcm = Buffer.from(b64, "base64");
  return wrapWav(pcm);
}

export async function POST(request: Request) {
  let body: PodcastBody;
  try {
    body = (await request.json()) as PodcastBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { subject, unitSlug, lang, userKey, force } = body;
  if (!subject || !unitSlug || (lang !== "tr" && lang !== "en")) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  // Already stored in the cloud? Every device gets the same file.
  if (hasBlob() && !force) {
    const existing = await blobUrl(audioPath(subject, unitSlug, lang));
    if (existing) {
      const script = await blobUrl(scriptPath(subject, unitSlug, lang));
      return Response.json({ url: existing, scriptUrl: script });
    }
  }

  const key = process.env.GEMINI_API_KEY || userKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });

  const unit = getUnit(subject, unitSlug);
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
    if (hasBlob()) {
      try {
        const [audioBlob, scriptBlob] = await Promise.all([
          put(audioPath(subject, unitSlug, lang), wav, {
            access: "public",
            contentType: "audio/wav",
            addRandomSuffix: false,
            allowOverwrite: true,
          }),
          put(scriptPath(subject, unitSlug, lang), JSON.stringify(lines), {
            access: "public",
            contentType: "application/json",
            addRandomSuffix: false,
            allowOverwrite: true,
          }),
        ]);
        return Response.json({ url: audioBlob.url, scriptUrl: scriptBlob.url, lines });
      } catch (e) {
        console.error("blob upload failed, falling back to inline audio", e);
      }
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

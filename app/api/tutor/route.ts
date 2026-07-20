import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash",
  openai: "gpt-5-mini",
} as const;

type Provider = keyof typeof DEFAULT_MODELS;

export async function GET() {
  return Response.json({
    gemini: Boolean(process.env.GEMINI_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    defaults: DEFAULT_MODELS,
  });
}

interface TutorMessage {
  role: "user" | "model";
  text: string;
  attachments?: TutorAttachment[];
}

interface TutorAttachment {
  kind?: "image";
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
}

type ValidImageAttachment = TutorAttachment & {
  kind: "image";
  mimeType: string;
  data: string;
};

interface TutorBody {
  messages: TutorMessage[];
  context?: string;
  subject?: string;
  lang?: string;
  provider?: Provider;
  model?: string;
  userKey?: string;
}

type TutorError =
  | "bad-key"
  | "empty-response"
  | "invalid-attachment"
  | "invalid-request"
  | "model-not-found"
  | "overloaded"
  | "quota"
  | "upstream"
  | "upstream-timeout";

type TutorResult =
  | { text: string; truncated?: boolean }
  | { error: TutorError; message?: string; retryAfterSeconds?: number };

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_IMAGE_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8;
const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SUBJECT_NAMES: Record<string, string> = {
  hidroloji: "Hydrology (Hidroloji)",
  "insaat-yonetimi": "Construction Management (İnşaat Yönetimi)",
};

function systemPrompt(
  lang: string | undefined,
  context: string | undefined,
  subject: string | undefined
) {
  const langName = lang === "tr" ? "Turkish" : "English";
  const course = SUBJECT_NAMES[subject ?? ""] ?? "a civil engineering course";
  return `You are a warm, patient tutor inside the exam-prep app "cubad" (Bursa Uludağ University civil engineering). The student is preparing for an exam in ${course}.

Rules:
- Answer in ${langName} unless the student writes in the other language.
- FEYNMAN MODE, always: explain as if to a smart friend hearing the topic for the first time. Plain everyday words, short sentences, one idea per sentence. Use a concrete everyday analogy or a tiny numeric example before (or instead of) abstract statements. If you catch yourself using a technical term, immediately unpack it in parentheses in plain words. Never say "it is trivial/obvious".
- Simplicity must NOT cost correctness: keep every fact, number, formula, condition and exception intact — simplify the wording, never the content. If a detail matters for the exam, say it explicitly.
- End longer answers with a one-sentence "Özetle / In short:" takeaway.
- Prefer guiding over giving away: if the student asks "how do I solve this", outline the reasoning path first, then the details.
- Use LaTeX for math, wrapped in $...$ or $$...$$.
- Use the terminology and metric conventions of the course materials; Turkish technical terms (as used in the context below) are the exam language — give them alongside English explanations.
- If the question is unrelated to the course or study prep, gently steer back.

Context for the current page (JSON):
${context ?? "none"}`;
}

function getErrorMessage(detail: string) {
  try {
    const data = JSON.parse(detail) as { error?: { message?: string } };
    return data.error?.message?.trim() || detail.trim();
  } catch {
    return detail.trim();
  }
}

function compactMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 360);
}

function retryAfterSeconds(res: Response, message: string) {
  const header = res.headers.get("retry-after");
  if (header && /^\d+$/.test(header)) return Number(header);
  const match = message.match(/retry in\s+([\d.]+)s/i);
  return match ? Math.ceil(Number(match[1])) : undefined;
}

function classifyGeminiError(res: Response, detail: string): TutorResult {
  const message = getErrorMessage(detail);
  const lower = message.toLowerCase();
  if (res.status === 400 && lower.includes("api key not valid")) {
    return { error: "bad-key", message: compactMessage(message) };
  }
  if (res.status === 401 || res.status === 403) {
    return { error: "bad-key", message: compactMessage(message) };
  }
  if (res.status === 404) {
    return { error: "model-not-found", message: compactMessage(message) };
  }
  if (res.status === 429) {
    return {
      error: "quota",
      message: compactMessage(message),
      retryAfterSeconds: retryAfterSeconds(res, message),
    };
  }
  if (res.status === 503) {
    return {
      error: "overloaded",
      message: compactMessage(message),
      retryAfterSeconds: retryAfterSeconds(res, message),
    };
  }
  if (res.status === 408 || res.status === 504) {
    return { error: "upstream-timeout", message: compactMessage(message) };
  }
  if (res.status === 400) {
    return { error: "invalid-request", message: compactMessage(message) };
  }
  return { error: "upstream", message: compactMessage(message) };
}

function classifyOpenAIError(res: Response, detail: string): TutorResult {
  const message = getErrorMessage(detail);
  if (res.status === 401 || res.status === 403) {
    return { error: "bad-key", message: compactMessage(message) };
  }
  if (res.status === 404) return { error: "model-not-found", message: compactMessage(message) };
  if (res.status === 429) {
    return {
      error: "quota",
      message: compactMessage(message),
      retryAfterSeconds: retryAfterSeconds(res, message),
    };
  }
  if (res.status === 400) return { error: "invalid-request", message: compactMessage(message) };
  if (res.status === 408 || res.status === 504) {
    return { error: "upstream-timeout", message: compactMessage(message) };
  }
  if (res.status === 503) return { error: "overloaded", message: compactMessage(message) };
  return { error: "upstream", message: compactMessage(message) };
}

function validImageAttachment(a: TutorAttachment): a is ValidImageAttachment {
  return (
    a.kind === "image" &&
    typeof a.mimeType === "string" &&
    IMAGE_MIME_TYPES.has(a.mimeType) &&
    typeof a.data === "string" &&
    a.data.length > 0 &&
    a.data.length <= MAX_BASE64_IMAGE_CHARS &&
    /^[A-Za-z0-9+/=\s]+$/.test(a.data)
  );
}

function validAttachments(messages: TutorMessage[]) {
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (!attachment.data) continue;
      if (!validImageAttachment(attachment)) return false;
    }
  }
  return true;
}

function geminiParts(message: TutorMessage) {
  const parts: ({ text: string } | { inline_data: { mime_type: string; data: string } })[] = [];
  for (const attachment of message.attachments ?? []) {
    if (message.role !== "user" || !validImageAttachment(attachment)) continue;
    parts.push({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.data.replace(/\s/g, ""),
      },
    });
  }
  const text = message.text?.trim();
  if (text) parts.push({ text });
  return parts.length > 0 ? parts : [{ text: message.role === "user" ? "Please continue." : "" }];
}

async function callGemini(key: string, model: string, body: TutorBody): Promise<TutorResult> {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(body.lang, body.context, body.subject) }] },
    contents: body.messages.map((m) => ({
      role: m.role,
      parts: geminiParts(m),
    })),
    // generous cap: on Gemini 2.5+/3.x the model's internal thinking also counts
    // against maxOutputTokens, so small caps silently truncate visible answers
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    console.error("gemini error", res.status, detail.slice(0, 400));
    return classifyGeminiError(res, detail);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) return { error: "empty-response" };
  return { text, truncated: cand?.finishReason === "MAX_TOKENS" };
}

function openAIContent(message: TutorMessage) {
  const validImages =
    message.role === "user" ? (message.attachments ?? []).filter(validImageAttachment) : [];
  const imageParts = validImages.map((a) => ({
    type: "image_url",
    image_url: { url: `data:${a.mimeType};base64,${a.data.replace(/\s/g, "")}` },
  }));
  if (imageParts.length === 0) return message.text;
  return [
    { type: "text", text: message.text || "Please explain the attached image." },
    ...imageParts,
  ];
}

async function callOpenAI(key: string, model: string, body: TutorBody): Promise<TutorResult> {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt(body.lang, body.context, body.subject) },
      ...body.messages.map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        content: openAIContent(m),
      })),
    ],
    max_completion_tokens: 4096,
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("openai error", res.status, detail.slice(0, 400));
    return classifyOpenAIError(res, detail);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim() ?? "";
  if (!text) return { error: "empty-response" };
  return { text, truncated: choice?.finish_reason === "length" };
}

export async function POST(request: Request) {
  let body: TutorBody;
  try {
    body = (await request.json()) as TutorBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const provider: Provider = body.provider === "openai" ? "openai" : "gemini";
  const envKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
  const userKey = typeof body.userKey === "string" ? body.userKey.trim() : "";
  const key = userKey || envKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });

  const rawModel = (body.model ?? "").trim();
  const model = /^[a-zA-Z0-9._/-]{1,64}$/.test(rawModel) ? rawModel : DEFAULT_MODELS[provider];

  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-16);
  if (messages.length === 0) return Response.json({ error: "empty" }, { status: 400 });
  body.messages = messages;
  if (!validAttachments(messages)) {
    return Response.json({ error: "invalid-attachment" }, { status: 400 });
  }

  // A supplied BYOK key spends the student's own provider quota. Only the
  // shared server key consumes the Cubad bucket.
  const usingServerKey = !userKey && Boolean(envKey);
  if (usingServerKey) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const rateLimitKey = user
      ? `tutor:user:${user.id}`
      : `tutor:ip:${clientIp(request)}`;
    const allowed = await checkRateLimit({
      key: rateLimitKey,
      max: 20,
      windowSeconds: 3_600,
    });
    if (!allowed) {
      return Response.json(
        { error: "rate-limited", retryAfterSeconds: 3_600 },
        { status: 429, headers: { "Retry-After": "3600" } }
      );
    }
  }

  try {
    const result =
      provider === "openai" ? await callOpenAI(key, model, body) : await callGemini(key, model, body);
    if ("error" in result) {
      const status =
        result.error === "bad-key"
          ? 401
          : result.error === "quota"
            ? 429
            : result.error === "overloaded"
              ? 503
              : result.error === "invalid-request" || result.error === "model-not-found"
                ? 400
                : 502;
      return Response.json(
        {
          error: result.error,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status }
      );
    }
    return Response.json({
      text: result.text,
      truncated: Boolean(result.truncated),
      model,
      provider,
    });
  } catch (e) {
    console.error("tutor route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}

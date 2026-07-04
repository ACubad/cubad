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
}

interface TutorBody {
  messages: TutorMessage[];
  context?: string;
  subject?: string;
  lang?: string;
  provider?: Provider;
  model?: string;
  userKey?: string;
}

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

async function callGemini(key: string, model: string, body: TutorBody) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(body.lang, body.context, body.subject) }] },
    contents: body.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
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
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    console.error("gemini error", res.status, detail.slice(0, 400));
    return { error: res.status === 400 || res.status === 403 ? "bad-key" : "upstream" };
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  if (!text) return { error: "empty-response" };
  return { text, truncated: cand?.finishReason === "MAX_TOKENS" };
}

async function callOpenAI(key: string, model: string, body: TutorBody) {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt(body.lang, body.context, body.subject) },
      ...body.messages.map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        content: m.text,
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
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("openai error", res.status, detail.slice(0, 400));
    return { error: res.status === 401 || res.status === 403 ? "bad-key" : "upstream" };
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
  const key = envKey || body.userKey;
  if (!key) return Response.json({ error: "no-key" }, { status: 401 });

  const rawModel = (body.model ?? "").trim();
  const model = /^[a-zA-Z0-9._/-]{1,64}$/.test(rawModel) ? rawModel : DEFAULT_MODELS[provider];

  const messages = (body.messages ?? []).slice(-16);
  if (messages.length === 0) return Response.json({ error: "empty" }, { status: 400 });
  body.messages = messages;

  try {
    const result =
      provider === "openai" ? await callOpenAI(key, model, body) : await callGemini(key, model, body);
    if ("error" in result) {
      const status = result.error === "bad-key" ? 401 : 502;
      return Response.json({ error: result.error }, { status });
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

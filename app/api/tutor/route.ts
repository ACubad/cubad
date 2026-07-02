const DEFAULT_MODELS = {
  gemini: "gemini-2.5-flash",
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
  lang?: string;
  provider?: Provider;
  model?: string;
  userKey?: string;
}

function systemPrompt(lang: string | undefined, context: string | undefined) {
  const langName = lang === "tr" ? "Turkish" : "English";
  return `You are a warm, patient hydrology tutor inside the exam-prep app "cubad" (Bursa Uludağ University civil engineering hydrology course). The student's exam is in about 2 days.

Rules:
- Answer in ${langName} unless the student writes in the other language.
- Be SIMPLE and CONCRETE. Short sentences. Define every symbol you use.
- Prefer guiding over giving away: if the student asks "how do I solve this", outline the reasoning path first, then the math.
- Use LaTeX for math, wrapped in $...$ or $$...$$.
- Use the metric conventions of the course (mm, cm, m³/sn, tekerrür süresi T, Gumbel KT, Horton f = fc + (f0-fc)e^(-kt), etc.).
- If the question is unrelated to hydrology or study prep, gently steer back.

Current question context (JSON):
${context ?? "none"}`;
}

async function callGemini(key: string, model: string, body: TutorBody) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(body.lang, body.context) }] },
    contents: body.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
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
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  return text ? { text } : { error: "empty-response" };
}

async function callOpenAI(key: string, model: string, body: TutorBody) {
  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt(body.lang, body.context) },
      ...body.messages.map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        content: m.text,
      })),
    ],
    max_completion_tokens: 1400,
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
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return text ? { text } : { error: "empty-response" };
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
    return Response.json({ text: result.text, model, provider });
  } catch (e) {
    console.error("tutor route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}

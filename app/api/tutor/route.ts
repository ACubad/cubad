const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export async function GET() {
  return Response.json({ hasServerKey: Boolean(process.env.GEMINI_API_KEY) });
}

interface TutorMessage {
  role: "user" | "model";
  text: string;
}

interface TutorBody {
  messages: TutorMessage[];
  context?: string;
  lang?: string;
  userKey?: string;
}

export async function POST(request: Request) {
  let body: TutorBody;
  try {
    body = (await request.json()) as TutorBody;
  } catch {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY || body.userKey;
  if (!key) {
    return Response.json({ error: "no-key" }, { status: 401 });
  }

  const messages = (body.messages ?? []).slice(-16);
  if (messages.length === 0) {
    return Response.json({ error: "empty" }, { status: 400 });
  }

  const langName = body.lang === "tr" ? "Turkish" : "English";
  const system = `You are a warm, patient hydrology tutor inside the exam-prep app "cubad" (Bursa Uludağ University civil engineering hydrology course). The student's exam is in about 2 days.

Rules:
- Answer in ${langName} unless the student writes in the other language.
- Be SIMPLE and CONCRETE. Short sentences. Define every symbol you use.
- Prefer guiding over giving away: if the student asks "how do I solve this", outline the reasoning path first, then the math.
- Use LaTeX for math, wrapped in $...$ or $$...$$.
- Use the metric conventions of the course (mm, cm, m³/sn, tekerrür süresi T, Gumbel KT, Horton f = fc + (f0-fc)e^(-kt), etc.).
- If the question is unrelated to hydrology or study prep, gently steer back.

Current question context (JSON):
${body.context ?? "none"}`;

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
  };

  try {
    const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      const status = res.status === 400 || res.status === 403 ? "bad-key" : "upstream";
      console.error("gemini error", res.status, detail.slice(0, 500));
      return Response.json({ error: status }, { status: 502 });
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    if (!text) return Response.json({ error: "empty-response" }, { status: 502 });
    return Response.json({ text });
  } catch (e) {
    console.error("tutor route error", e);
    return Response.json({ error: "network" }, { status: 502 });
  }
}

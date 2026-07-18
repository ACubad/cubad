import { revalidateContent } from "@/lib/content-db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return Response.json({ revalidated: false, error: "invalid secret" }, { status: 401 });
  }

  const subject = searchParams.get("subject") ?? undefined;
  revalidateContent(subject);
  return Response.json({ revalidated: true, subject: subject ?? "all", now: Date.now() });
}

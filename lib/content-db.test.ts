import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

vi.mock("server-only", () => ({}));

import { getSubjects, getUnits, revalidateContent, toSubjectMeta, toUnit } from "./content-db";
import { revalidateTag } from "next/cache";

function chain(finalData: unknown, finalError: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.order = vi.fn(async () => ({ data: finalData, error: finalError }));
  builder.maybeSingle = vi.fn(async () => ({ data: finalData, error: finalError }));
  return builder;
}

describe("toSubjectMeta / toUnit (pure mapping)", () => {
  it("maps a subject row into SubjectMeta, mirroring section_order into the deprecated kind field", () => {
    const row = {
      slug: "hidroloji",
      title: { tr: "Hidroloji", en: "Hydrology" },
      tagline: { tr: "t", en: "t" },
      section_order: "walkthrough" as const,
    };
    expect(toSubjectMeta(row)).toEqual({
      slug: "hidroloji",
      title: row.title,
      tagline: row.tagline,
      section_order: "walkthrough",
      kind: "walkthrough",
    });
  });

  it("passes the content column through verbatim as the Unit shape", () => {
    const content = {
      unit: 1,
      slug: "unit-1",
      title: { tr: "a", en: "a" },
      tagline: { tr: "b", en: "b" },
    };
    expect(toUnit({ content } as never)).toBe(content);
  });

  it("prefers the last published snapshot while a newer draft exists", () => {
    const draft = { unit: 1, slug: "unit-1", tagline: { tr: "Taslak", en: "Draft" } };
    const published = { unit: 1, slug: "unit-1", tagline: { tr: "Canlı", en: "Live" } };
    expect(toUnit({ content: draft, published_content: published } as never)).toBe(published);
  });
});

describe("getSubjects", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("queries only published subjects, ordered by sort, and maps every row", async () => {
    mockFrom.mockReturnValue(
      chain([
        {
          slug: "hidroloji",
          title: { tr: "H", en: "H" },
          tagline: { tr: "t", en: "t" },
          section_order: "walkthrough",
        },
        {
          slug: "insaat-yonetimi",
          title: { tr: "I", en: "I" },
          tagline: { tr: "t", en: "t" },
          section_order: "study",
        },
      ])
    );

    const subjects = await getSubjects();

    expect(mockFrom).toHaveBeenCalledWith("subjects");
    expect(subjects).toHaveLength(2);
    expect(subjects[0].section_order).toBe("walkthrough");
    expect(subjects[1].kind).toBe("study");
  });

  it("throws rather than silently returning an empty list when Supabase errors", async () => {
    mockFrom.mockReturnValue(chain(null, { message: "network blip" }));
    await expect(getSubjects()).rejects.toThrow(/getSubjects/);
  });
});

describe("getUnits", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("returns [] when the subject is not found/published, without querying units", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "subjects" ? chain(null) : chain([])
    );
    await expect(getUnits("does-not-exist")).resolves.toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("returns the public revision for each row, ordered by unit_number", async () => {
    const unitA = { unit: 1, slug: "unit-1" };
    const unitB = { unit: 2, slug: "unit-2" };
    mockFrom.mockImplementation((table: string) =>
      table === "subjects"
        ? chain({ id: "subj-1" })
        : chain([
            { status: "published", content: unitA, published_content: null },
            { status: "draft", content: { unit: 2, slug: "new-draft" }, published_content: unitB },
          ])
    );
    await expect(getUnits("hidroloji")).resolves.toEqual([unitA, unitB]);
  });
});

describe("revalidateContent", () => {
  beforeEach(() => {
    vi.mocked(revalidateTag).mockClear();
  });

  it("revalidates only the subject tag when a slug is given", () => {
    revalidateContent("hidroloji");
    expect(revalidateTag).toHaveBeenCalledWith("content:hidroloji", "max");
  });

  it("revalidates the shared list tag when no subject is given", () => {
    revalidateContent();
    expect(revalidateTag).toHaveBeenCalledWith("content:list", "max");
  });
});

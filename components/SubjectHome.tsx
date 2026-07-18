"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useProgress } from "@/lib/progress";
import type { SubjectMeta, Unit } from "@/lib/types";
import { WaterProgress } from "./ui";

// This is intentionally specific to the existing hydrology course. It preserves the current
// landing copy verbatim; a future subject-level landing-copy model is not part of Phase 3.
const HIDROLOJI_PLAN = {
  en: [
    {
      day: "Today",
      focus: "Foundations",
      items: [
        "Unit 1 (Water balance) + Unit 2 (Precipitation) — walk through every question.",
        "Unit 3 (Evaporation) + Unit 4 (Infiltration). Horton is an exam favourite: do 4.2 and 4.3 twice.",
        "Finish with each unit's quick quiz. Wrong answer? Reopen that walkthrough.",
      ],
    },
    {
      day: "Tomorrow",
      focus: "The heavy hitters",
      items: [
        "Unit 5 (Streamflow) and Unit 6 (Hydrographs) — 6.1 and 6.5 are the classic exam questions.",
        "Unit 7 (Floods): Gumbel + Rational method. Unit 8 (Groundwater): both well equations.",
        "Evening: read every ⚠ exam-trap card and the What-if scenarios. That's where points are lost.",
      ],
    },
    {
      day: "Exam morning",
      focus: "Sharpen",
      items: [
        "Skim the Formula sheet once — say out loud when each formula applies.",
        "Redo (on paper!) the 'high likelihood' questions marked red.",
        "Check units before every answer: mm→cm, minutes→hours, m³/s→volume.",
      ],
    },
  ],
  tr: [
    {
      day: "Bugün",
      focus: "Temeller",
      items: [
        "Konu 1 (Su dengesi) + Konu 2 (Yağış) — her soruyu adım adım çöz.",
        "Konu 3 (Buharlaşma) + Konu 4 (Sızma). Horton sınavların gözdesi: 4.2 ve 4.3'ü iki kez yap.",
        "Her konuyu mini sınavla bitir. Yanlış mı yaptın? İlgili çözümü tekrar aç.",
      ],
    },
    {
      day: "Yarın",
      focus: "Ağır toplar",
      items: [
        "Konu 5 (Akım) ve Konu 6 (Hidrograflar) — 6.1 ve 6.5 klasik sınav sorularıdır.",
        "Konu 7 (Taşkınlar): Gumbel + Rasyonel yöntem. Konu 8 (Yeraltı suyu): iki kuyu denklemi.",
        "Akşam: tüm ⚠ tuzak kartlarını ve 'Ya olsaydı?' senaryolarını oku. Puanlar orada kaybedilir.",
      ],
    },
    {
      day: "Sınav sabahı",
      focus: "Bilenme",
      items: [
        "Formül kartını bir kez tara — her formülün ne zaman kullanıldığını sesli söyle.",
        "Kırmızı işaretli 'yüksek olasılık' sorularını (kâğıt üzerinde!) yeniden çöz.",
        "Her cevaptan önce birimleri kontrol et: mm→cm, dakika→saat, m³/sn→hacim.",
      ],
    },
  ],
};

export function SubjectHome({ subject, units }: { subject: SubjectMeta; units: Unit[] }) {
  const { lang, t, bi } = useLang();
  const { state } = useProgress();
  const isWalkthrough = subject.section_order === "walkthrough";
  const isHidroloji = subject.slug === "hidroloji";

  const totalQ = isWalkthrough
    ? units.reduce((n, unit) => n + (unit.questions?.length ?? 0), 0)
    : units.reduce((n, unit) => n + (unit.practice?.length ?? 0), 0);
  const doneQ = isWalkthrough
    ? units.reduce(
        (n, unit) =>
          n +
          (unit.questions ?? []).filter((question) => state.q[`${subject.slug}/${question.id}`]?.done)
            .length,
        0
      )
    : units.reduce(
        (n, unit) =>
          n +
          (unit.practice ?? []).filter(
            (practice) => state.practice[`${subject.slug}/${unit.slug}/${practice.id}`]?.answered
          ).length,
        0
      );

  return (
    <div className="space-y-10">
      <section className="rise-in pt-4 sm:pt-8">
        <h1 className="font-display text-4xl font-semibold leading-tight text-deniz-deep sm:text-5xl">
          {isHidroloji ? (
            lang === "tr" ? (
              <>Hidrolojiyi <em className="text-deniz">anlayarak</em> geç.</>
            ) : (
              <>Pass hydrology by <em className="text-deniz">understanding</em> it.</>
            )
          ) : (
            bi(subject.title)
          )}
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          {isHidroloji
            ? lang === "tr"
              ? "Her soru, elinden tutan bir öğretmen gibi adım adım çözülür: önce sen düşün, sonra ipucu al, sonra adımı ve nedenini gör."
              : "Every question unfolds like a tutor holding your hand: think first, take a hint, then see the step — and why we take it."
            : bi(subject.tagline)}
        </p>
        {totalQ > 0 && (
          <div className="mt-5 max-w-md">
            <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
              <span>{t("totalProgress")}</span>
              <span>{doneQ}/{totalQ} {t("questions")}</span>
            </div>
            <WaterProgress value={totalQ ? doneQ / totalQ : 0} className="h-2.5" />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("allUnits")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((unit) => {
            const notesN = unit.notes?.length ?? 0;
            const cardsN = unit.flashcards?.length ?? 0;
            const practiceN = unit.practice?.length ?? 0;
            const questionsN = unit.questions?.length ?? 0;
            const done = isWalkthrough
              ? (unit.questions ?? []).filter((question) => state.q[`${subject.slug}/${question.id}`]?.done).length
              : (unit.practice ?? []).filter(
                  (practice) => state.practice[`${subject.slug}/${unit.slug}/${practice.id}`]?.answered
                ).length;
            const total = isWalkthrough ? questionsN : practiceN;
            return (
              <Link
                key={unit.slug}
                href={`/s/${subject.slug}/unit/${unit.slug}`}
                className="group rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,43,51,0.04)] transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-deniz">{String(unit.unit).padStart(2, "0")}</span>
                  {isWalkthrough && <span className="text-xs text-ink-faint">{questionsN} {t("questions")}</span>}
                </div>
                <h3 className="font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">{bi(unit.title)}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(unit.tagline)}</p>
                {isWalkthrough ? (
                  <div className="mt-4"><WaterProgress value={total ? done / total : 0} /></div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                    <span>{notesN} {t("konuAnlatimi").toLowerCase()}</span>
                    <span>{cardsN} {t("cardsCount")}</span>
                    <span>{practiceN} {t("questions")}</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {isHidroloji && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("studyPlan")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {HIDROLOJI_PLAN[lang].map((day, index) => (
              <div key={index} className="rounded-2xl border border-line bg-card p-5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-deniz">{day.day}</p>
                <h3 className="mb-2 font-display text-lg font-semibold">{day.focus}</h3>
                <ul className="space-y-2 text-sm text-ink-soft">
                  {day.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-deniz/50" />{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

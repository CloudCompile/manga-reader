"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { getTheme } from "@/lib/storage";
import type { LegalDoc } from "@/lib/legal";

// Renders one legal document. Theme is read from the same cookie the reader
// uses, but only after mount, so the first paint is the default dark theme on
// both server and client and there is no hydration mismatch.
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(getTheme() !== "light");
  }, []);

  const bg = isDark ? "bg-[#0a0a0a]" : "bg-[#f5f5f5]";
  const textCol = isDark ? "text-white" : "text-gray-900";
  const subText = isDark ? "text-white/50" : "text-gray-500";
  const panelBg = isDark ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const rule = isDark ? "border-white/10" : "border-gray-200";

  return (
    <div className={`min-h-screen ${bg} ${textCol}`}>
      <header className={`border-b px-6 py-4 ${panelBg}`}>
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className={`inline-flex items-center gap-2 text-sm ${subText} hover:underline`}
            aria-label="Back to Manga Reader"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to reader
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] mb-5 ${isDark ? "bg-white/5 text-white/60" : "bg-gray-100 text-gray-500"}`}>
          <FileText className="h-3 w-3" />
          Last updated {doc.updated}
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-3">{doc.title}</h1>
        <p className={`text-sm mb-8 ${subText}`}>{doc.summary}</p>

        <div className="space-y-8">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-base font-semibold mb-2">{section.heading}</h2>
              {section.paragraphs?.map((p, i) => (
                <p key={i} className={`text-sm leading-relaxed mb-2 ${subText}`}>
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul className={`list-disc pl-5 space-y-1 text-sm leading-relaxed ${subText}`}>
                  {section.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <nav className={`mt-12 pt-6 border-t ${rule} flex flex-wrap gap-4 text-sm ${subText}`}>
          <Link href="/terms" className="hover:underline">Terms of Use</Link>
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/disclaimer" className="hover:underline">Disclaimer</Link>
        </nav>
      </main>
    </div>
  );
}

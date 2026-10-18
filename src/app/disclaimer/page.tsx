import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";
import { DISCLAIMER } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Disclaimer — Manga Reader",
  description: DISCLAIMER.summary,
};

export default function Page() {
  return <LegalPage doc={DISCLAIMER} />;
}

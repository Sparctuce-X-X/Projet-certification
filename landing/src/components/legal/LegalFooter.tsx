import Link from "next/link";

// Footer + nav transverse pour les 6 documents légaux. Le `LegalFooter`
// complet est utilisé sur les pages /legal/*. Le `LegalLinksNav` (nav seule)
// se branche dans les footers existants de la homepage et de /a/[id] pour
// exposer les URL publiques requises par les reviews Apple/Google.

const LEGAL_LINKS: Array<{ slug: string; label: string }> = [
  { slug: "cgu", label: "CGU" },
  { slug: "cgv", label: "CGV" },
  { slug: "confidentialite", label: "Confidentialité" },
  { slug: "mentions-legales", label: "Mentions légales" },
  { slug: "charte-communautaire", label: "Charte" },
  { slug: "cookies", label: "Cookies" },
];

export function LegalLinksNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Liens légaux"
      className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-niqo-gray-500 ${className ?? ""}`}
    >
      {LEGAL_LINKS.map((link) => (
        <Link
          key={link.slug}
          href={`/legal/${link.slug}`}
          className="hover:text-niqo-coral underline-offset-2 hover:underline inline-flex items-center min-h-[44px] min-w-[44px] justify-center px-3 py-2"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function LegalFooter() {
  return (
    <footer className="border-t border-niqo-gray-200 mt-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
        <LegalLinksNav className="text-sm text-niqo-gray-800" />
        <p className="mt-4 text-xs text-niqo-gray-500">
          © Niqo Ltd — société immatriculée au Rwanda. Contact :{" "}
          <a
            href="mailto:support@niqo.africa"
            className="hover:text-niqo-coral underline-offset-2 hover:underline"
          >
            support@niqo.africa
          </a>
        </p>
      </div>
    </footer>
  );
}

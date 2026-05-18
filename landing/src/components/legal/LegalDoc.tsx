import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import matter from "gray-matter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LegalFooter } from "./LegalFooter";

// Server Component qui rend un document légal depuis sa source markdown
// canonique dans `docs/legal/<slug>.md`.
//
// Le fichier .md est lu via `fs.readFileSync` à la build (RSC, statique).
// Le frontmatter est strippé via gray-matter et n'est pas affiché dans la
// page — il sert uniquement à versionner et à afficher la date dans le
// header.

export type LegalSlug =
  | "cgu"
  | "cgv"
  | "confidentialite"
  | "mentions-legales"
  | "charte-communautaire"
  | "cookies";

const TITLE_BY_SLUG: Record<LegalSlug, string> = {
  cgu: "Conditions générales d'utilisation",
  cgv: "Conditions générales de vente",
  confidentialite: "Politique de confidentialité",
  "mentions-legales": "Mentions légales",
  "charte-communautaire": "Charte communautaire",
  cookies: "Politique cookies",
};

function readLegalDoc(slug: LegalSlug) {
  // Source canonique : docs/legal/<slug>.md (à la racine du monorepo).
  // Vercel déploie `landing/` comme rootDirectory → `docs/` est hors du
  // build context. Une copie miroir est maintenue dans
  // `landing/src/legal-content/<slug>.md`. Le script `npm run sync-legal`
  // (et le prebuild) recopie depuis docs/legal/ pour éviter la dérive.
  const filePath = path.join(process.cwd(), "src", "legal-content", `${slug}.md`);
  const raw = fs.readFileSync(filePath, "utf8");
  return matter(raw);
}

export function LegalDoc({ slug }: { slug: LegalSlug }) {
  const { content, data } = readLegalDoc(slug);
  const title = TITLE_BY_SLUG[slug];
  const version = typeof data.version === "string" ? data.version : String(data.version ?? "");
  const date = typeof data.date === "string" ? data.date : "";

  return (
    <div className="min-h-screen bg-niqo-white text-niqo-black flex flex-col">
      <header className="border-b border-niqo-gray-200 sticky top-0 bg-niqo-white/95 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 active:opacity-60 hover:opacity-80 rounded-md"
            aria-label="Retour à l'accueil Niqo"
          >
            <ArrowLeft size={22} />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold truncate">
            {title}
          </h1>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 prose-niqo">
          {(version || date) && (
            <p className="text-xs text-niqo-gray-500 mb-6">
              {date && `Dernière mise à jour : ${date}`}
              {date && version && " — "}
              {version && `version ${version}`}
            </p>
          )}

          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold mt-0 mb-6 leading-tight">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-3 leading-tight text-niqo-black">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="font-[family-name:var(--font-body)] text-base font-semibold mt-5 mb-2 text-niqo-black">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-3">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="my-3 space-y-1.5 list-none pl-0">{children}</ul>
              ),
              li: ({ children }) => (
                <li className="text-[15px] leading-relaxed text-niqo-gray-800 pl-5 relative before:content-['•'] before:absolute before:left-0 before:text-niqo-coral before:font-bold">
                  {children}
                </li>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-niqo-black">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              a: ({ children, href }) => (
                <a
                  href={href}
                  className="text-niqo-coral underline hover:no-underline"
                  rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
                  target={href?.startsWith("http") ? "_blank" : undefined}
                >
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-niqo-gray-200 pl-4 my-4 text-niqo-gray-800 italic [&>p]:text-[14px]">
                  {children}
                </blockquote>
              ),
              code: ({ children }) => (
                <code className="font-[family-name:var(--font-mono)] text-[13px] bg-niqo-gray-100 px-1.5 py-0.5 rounded">
                  {children}
                </code>
              ),
              hr: () => <hr className="my-8 border-niqo-gray-200" />,
              table: ({ children }) => (
                <div className="overflow-x-auto my-4 -mx-4 sm:mx-0">
                  <table className="min-w-full text-sm border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-niqo-gray-50 border-b border-niqo-gray-200">
                  {children}
                </thead>
              ),
              th: ({ children }) => (
                <th className="text-left px-3 py-2 font-semibold text-niqo-black">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 border-b border-niqo-gray-100 text-niqo-gray-800 align-top">
                  {children}
                </td>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </main>

      <LegalFooter />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from "lucide-react";

import { Avatar } from "@/components/admin/Avatar";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateShort } from "@/lib/date-format";

import { VerifFilters } from "./_filters";

export const metadata: Metadata = {
  title: "Vérifications · Niqo Admin",
  robots: { index: false, follow: false },
};

type Filter = "all" | "pending" | "verified" | "rejected";

interface VerifRow {
  id: string;
  statut: "pending" | "verified" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  user: {
    id: string;
    prenom: string | null;
    nom: string | null;
    ville: string | null;
    pays: "CI" | "CG" | null;
    avatar_url: string | null;
  } | null;
}

const COUNTRY_LABEL: Record<string, string> = {
  CI: "Côte d'Ivoire",
  CG: "Congo",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return formatParisDateShort(iso);
}

function StatusBadge({ statut }: { statut: VerifRow["statut"] }) {
  if (statut === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-coral/10 text-niqo-coral text-xs font-medium">
        <Clock className="w-3 h-3" strokeWidth={2.4} />
        En attente
      </span>
    );
  }
  if (statut === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-success/10 text-niqo-success text-xs font-medium">
        <CheckCircle2 className="w-3 h-3" strokeWidth={2.4} />
        Validé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-danger/10 text-niqo-danger text-xs font-medium">
      <XCircle className="w-3 h-3" strokeWidth={2.4} />
      Refusé
    </span>
  );
}

export default async function VerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: Filter; q?: string }>;
}) {
  const params = await searchParams;
  const filter = params.filter ?? "pending";
  const query = params.q?.trim() ?? "";

  const supabase = await createClient();

  // Counts pour les chips (on fetch tout, c'est <1k rows pour MVP)
  const { data: countsData } = await supabase
    .from("verifications_identite")
    .select("statut", { count: "exact" });
  const counts = {
    all: countsData?.length ?? 0,
    pending: countsData?.filter((r) => r.statut === "pending").length ?? 0,
    verified: countsData?.filter((r) => r.statut === "verified").length ?? 0,
    rejected: countsData?.filter((r) => r.statut === "rejected").length ?? 0,
  };

  // Fetch list filtrée
  let listQuery = supabase
    .from("verifications_identite")
    .select(
      `
      id, statut, created_at, reviewed_at,
      user:users!verifications_identite_user_id_fkey (
        id, prenom, nom, ville, pays, avatar_url
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter !== "all") {
    listQuery = listQuery.eq("statut", filter);
  }

  const { data: rawRows } = await listQuery;
  const rows = (rawRows ?? []) as unknown as VerifRow[];

  // Filtre côté serveur (recherche par prenom/nom/ville)
  const filteredRows = query
    ? rows.filter((r) => {
        const haystack = `${r.user?.prenom ?? ""} ${r.user?.nom ?? ""} ${r.user?.ville ?? ""}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    : rows;

  // Tri custom : pending d'abord même quand filter=all
  const sortedRows =
    filter === "all"
      ? [...filteredRows].sort((a, b) => {
          if (a.statut === "pending" && b.statut !== "pending") return -1;
          if (a.statut !== "pending" && b.statut === "pending") return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        })
      : filteredRows;

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-niqo-black">
            Vérifications<span className="text-niqo-coral">.</span>
          </h1>
          <p className="mt-1.5 text-sm text-niqo-gray-500">
            {counts.pending} en attente · {counts.all} au total
          </p>
        </div>
      </div>

      <VerifFilters counts={counts} />

      {sortedRows.length === 0 ? (
        <div className="bg-white border border-niqo-gray-200 rounded-xl p-10 text-center">
          <ShieldCheck
            className="w-10 h-10 text-niqo-gray-500 mx-auto mb-3"
            strokeWidth={1.6}
          />
          <p className="font-display text-base font-bold text-niqo-black mb-1">
            {query ? "Aucun résultat" : "Aucune vérification"}
          </p>
          <p className="text-sm text-niqo-gray-500">
            {query
              ? "Aucun dossier ne correspond à ta recherche."
              : "Tous les dossiers ont été traités, bravo."}
          </p>
        </div>
      ) : (
        // V1 audit : overflow-x-auto + min-w pour viewport <1024px (cohérent
        // avec /admin/signalements S1 audit). Sans, troncature silencieuse.
        <div className="bg-white border border-niqo-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="bg-niqo-gray-50 border-b border-niqo-gray-200">
              <tr className="text-left text-xs font-mono uppercase tracking-wider text-niqo-gray-500">
                <th className="px-5 py-3 font-medium">Vendeur</th>
                <th className="px-5 py-3 font-medium">Localisation</th>
                <th className="px-5 py-3 font-medium">Soumis</th>
                <th className="px-5 py-3 font-medium">Statut</th>
                <th className="px-5 py-3 w-10" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-niqo-gray-100 hover:bg-niqo-gray-50 transition-colors duration-150"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/admin/verifications/${row.id}`}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <Avatar
                        url={row.user?.avatar_url ?? null}
                        prenom={row.user?.prenom ?? null}
                        nom={row.user?.nom ?? null}
                        size="sm"
                      />
                      <span className="font-medium text-sm text-niqo-black">
                        {row.user?.prenom ?? "—"}
                        {row.user?.nom && row.user.nom !== "—"
                          ? ` ${row.user.nom}`
                          : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-niqo-gray-800">
                    {row.user?.ville ?? "—"}
                    {row.user?.pays ? (
                      <span className="text-niqo-gray-500">
                        {" · "}
                        {COUNTRY_LABEL[row.user.pays] ?? row.user.pays}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-niqo-gray-800">
                    {timeAgo(row.created_at)}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge statut={row.statut} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href={`/admin/verifications/${row.id}`}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-niqo-gray-100 text-niqo-gray-500 cursor-pointer"
                      aria-label="Examiner"
                    >
                      <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarX,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Flag,
  ShoppingBag,
  User,
  MessageCircle,
} from "lucide-react";

import { Avatar } from "@/components/admin/Avatar";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateShort } from "@/lib/date-format";

import { SignalementsFilters } from "./_filters";

export const metadata: Metadata = {
  title: "Signalements · Niqo Admin",
  robots: { index: false, follow: false },
};

type StatutFilter = "all" | "en_attente" | "traite" | "rejete";
type CibleFilter = "all" | "annonce" | "utilisateur" | "message" | "rdv_post";
type TargetType = "annonce" | "utilisateur" | "message" | "rdv_post";

interface SignalementRow {
  id: string;
  target_type: TargetType;
  target_id: string;
  motif: string;
  statut: "en_attente" | "traite" | "rejete";
  created_at: string;
  signaleur: {
    id: string;
    prenom: string | null;
    nom: string | null;
    avatar_url: string | null;
  } | null;
}

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

function StatusBadge({ statut }: { statut: SignalementRow["statut"] }) {
  if (statut === "en_attente") {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-coral/10 text-niqo-coral text-xs font-medium">
        <Clock className="w-3 h-3" strokeWidth={2.4} />
        En attente
      </span>
    );
  }
  if (statut === "traite") {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-success/10 text-niqo-success text-xs font-medium">
        <CheckCircle2 className="w-3 h-3" strokeWidth={2.4} />
        Traité
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-niqo-gray-100 text-niqo-gray-800 text-xs font-medium">
      <XCircle className="w-3 h-3" strokeWidth={2.4} />
      Rejeté
    </span>
  );
}

function CibleBadge({ type }: { type: SignalementRow["target_type"] }) {
  const config = {
    annonce: { label: "Annonce", Icon: ShoppingBag },
    utilisateur: { label: "Utilisateur", Icon: User },
    message: { label: "Message", Icon: MessageCircle },
    rdv_post: { label: "RDV", Icon: CalendarX },
  }[type];
  const { Icon } = config;
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-niqo-gray-50 text-niqo-gray-800 text-xs font-medium border border-niqo-gray-200">
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {config.label}
    </span>
  );
}

export default async function SignalementsListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: StatutFilter; cible?: CibleFilter; q?: string }>;
}) {
  const params = await searchParams;
  const filter = params.filter ?? "en_attente";
  const cible = params.cible ?? "all";
  const query = params.q?.trim() ?? "";

  const supabase = await createClient();

  // Counts pour les chips (un seul fetch)
  const { data: countsData } = await supabase
    .from("signalements")
    .select("statut, target_type");

  const counts = {
    all: countsData?.length ?? 0,
    en_attente: countsData?.filter((r) => r.statut === "en_attente").length ?? 0,
    traite: countsData?.filter((r) => r.statut === "traite").length ?? 0,
    rejete: countsData?.filter((r) => r.statut === "rejete").length ?? 0,
  };

  // Fetch list filtrée
  let listQuery = supabase
    .from("signalements")
    .select(
      `
      id, target_type, target_id, motif, statut, created_at,
      signaleur:users!signaleur_id (
        id, prenom, nom, avatar_url
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter !== "all") listQuery = listQuery.eq("statut", filter);
  if (cible !== "all") listQuery = listQuery.eq("target_type", cible);

  const { data: rawRows } = await listQuery;
  const rows = (rawRows ?? []) as unknown as SignalementRow[];

  const filteredRows = query
    ? rows.filter((r) => {
        const haystack =
          `${r.motif} ${r.signaleur?.prenom ?? ""} ${r.signaleur?.nom ?? ""}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    : rows;

  // Tri custom : en_attente d'abord même quand filter=all
  const sortedRows =
    filter === "all"
      ? [...filteredRows].sort((a, b) => {
          if (a.statut === "en_attente" && b.statut !== "en_attente") return -1;
          if (a.statut !== "en_attente" && b.statut === "en_attente") return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        })
      : filteredRows;

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-niqo-black">
            Signalements<span className="text-niqo-coral">.</span>
          </h1>
          <p className="mt-1.5 text-sm text-niqo-gray-500">
            {counts.en_attente} en attente · {counts.all} au total
          </p>
        </div>
      </div>

      <SignalementsFilters counts={counts} />

      {sortedRows.length === 0 ? (
        <div className="bg-white border border-niqo-gray-200 rounded-xl p-10 text-center">
          <Flag
            className="w-10 h-10 text-niqo-gray-500 mx-auto mb-3"
            strokeWidth={1.6}
          />
          <p className="font-display text-base font-bold text-niqo-black mb-1">
            {query ? "Aucun résultat" : "Aucun signalement"}
          </p>
          <p className="text-sm text-niqo-gray-500">
            {query
              ? "Aucun signalement ne correspond à ta recherche."
              : "Tout est calme côté modération."}
          </p>
        </div>
      ) : (
        // S1 audit : overflow-x-auto + min-w-[720px] pour viewport <1024px
        // (laptop 13" / tablet). Sans, la table tronque ou casse la grid mère.
        <div className="bg-white border border-niqo-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-niqo-gray-50 border-b border-niqo-gray-200">
              <tr className="text-left text-xs font-mono uppercase tracking-wider text-niqo-gray-500">
                <th className="px-5 py-3 font-medium">Signaleur</th>
                <th className="px-5 py-3 font-medium">Cible</th>
                <th className="px-5 py-3 font-medium">Motif</th>
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
                      href={`/admin/signalements/${row.id}`}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <Avatar
                        url={row.signaleur?.avatar_url ?? null}
                        prenom={row.signaleur?.prenom ?? null}
                        nom={row.signaleur?.nom ?? null}
                        size="sm"
                      />
                      <span className="font-medium text-sm text-niqo-black">
                        {row.signaleur?.prenom ?? "—"}
                        {row.signaleur?.nom && row.signaleur.nom !== "—"
                          ? ` ${row.signaleur.nom}`
                          : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <CibleBadge type={row.target_type} />
                  </td>
                  <td className="px-5 py-3.5 text-sm text-niqo-gray-800 max-w-xs truncate">
                    {row.motif}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-niqo-gray-800">
                    {timeAgo(row.created_at)}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge statut={row.statut} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href={`/admin/signalements/${row.id}`}
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

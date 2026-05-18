import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  History,
  MessageCircle,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  User,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatParisDateShort, formatParisDateTime } from "@/lib/date-format";

import { AuditFilters } from "./_filters";

export const metadata: Metadata = {
  title: "Audit log · Niqo Admin",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

type TargetType = "verification" | "signalement" | "annonce" | "user" | "message";
type TargetFilter = "all" | TargetType;

interface AuditRow {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  admin: { prenom: string | null; nom: string | null } | null;
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

function absoluteAbidjan(iso: string): string {
  return formatParisDateTime(iso);
}

const ACTION_CONFIG: Record<
  string,
  { label: string; tone: "success" | "danger" | "warning" | "gray" | "coral" }
> = {
  kyc_verified: { label: "KYC validée", tone: "success" },
  kyc_rejected: { label: "KYC refusée", tone: "danger" },
  signalement_traite: { label: "Signalement traité", tone: "success" },
  signalement_rejete: { label: "Signalement rejeté", tone: "gray" },
  annonce_suspended: { label: "Annonce suspendue", tone: "warning" },
  user_suspended: { label: "User suspendu", tone: "warning" },
  message_soft_deleted: { label: "Message supprimé", tone: "warning" },
  annonce_reverted_active: { label: "Annonce remise en vente", tone: "coral" },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, tone: "gray" as const };
  const styles = {
    success: "bg-niqo-success/10 text-niqo-success",
    danger: "bg-niqo-danger/10 text-niqo-danger",
    warning: "bg-niqo-warning/10 text-niqo-warning",
    coral: "bg-niqo-coral/10 text-niqo-coral",
    gray: "bg-niqo-gray-100 text-niqo-gray-800",
  }[cfg.tone];

  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-md text-xs font-medium ${styles}`}
    >
      {cfg.label}
    </span>
  );
}

const TARGET_ICONS: Record<string, typeof ShieldCheck> = {
  verification: ShieldCheck,
  signalement: Flag,
  annonce: ShoppingBag,
  user: User,
  message: MessageCircle,
};

function TargetCell({
  type,
  id,
}: {
  type: string;
  id: string | null;
}) {
  const Icon = TARGET_ICONS[type] ?? RotateCcw;
  const idShort = id ? id.slice(0, 8) : "—";

  // Lien vers la page admin si elle existe (verification, signalement)
  const href =
    type === "verification" && id
      ? `/admin/verifications/${id}`
      : type === "signalement" && id
        ? `/admin/signalements/${id}`
        : null;

  const inner = (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="w-3.5 h-3.5 text-niqo-gray-500" strokeWidth={2.2} />
      <span className="text-niqo-gray-800 capitalize">{type}</span>
      <span className="font-mono text-xs text-niqo-gray-500">#{idShort}</span>
    </span>
  );

  return href ? (
    <Link
      href={href}
      className="inline-flex items-center hover:opacity-80 cursor-pointer"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) {
    return <span className="text-xs text-niqo-gray-500">—</span>;
  }
  return (
    <div className="space-y-0.5 text-xs text-niqo-gray-800 max-w-[280px]">
      {entries.map(([k, v]) => (
        <div key={k} className="truncate" title={String(v)}>
          <span className="font-mono text-niqo-gray-500">{k}:</span>{" "}
          <span>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: TargetFilter; page?: string }>;
}) {
  const params = await searchParams;
  const target = params.target ?? "all";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // Counts par target_type pour les chips de filtre
  const { data: countsData } = await supabase
    .from("audit_log_admin")
    .select("target_type");

  const counts = {
    all: countsData?.length ?? 0,
    verification: countsData?.filter((r) => r.target_type === "verification").length ?? 0,
    signalement: countsData?.filter((r) => r.target_type === "signalement").length ?? 0,
    annonce: countsData?.filter((r) => r.target_type === "annonce").length ?? 0,
    user: countsData?.filter((r) => r.target_type === "user").length ?? 0,
    message: countsData?.filter((r) => r.target_type === "message").length ?? 0,
  };

  // Fetch paginée avec count exact
  let listQuery = supabase
    .from("audit_log_admin")
    .select(
      `
      id, admin_id, action, target_type, target_id, metadata, created_at,
      admin:users!admin_id (prenom, nom)
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (target !== "all") {
    listQuery = listQuery.eq("target_type", target);
  }

  const { data: rawRows, count: totalCount } = await listQuery;
  const rows = (rawRows ?? []) as unknown as AuditRow[];
  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));

  return (
    <div className="px-8 py-10 max-w-6xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-niqo-black">
            Audit log<span className="text-niqo-coral">.</span>
          </h1>
          <p className="mt-1.5 text-sm text-niqo-gray-500">
            {counts.all.toLocaleString("fr-FR")} action
            {counts.all > 1 ? "s" : ""} admin enregistrée{counts.all > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <AuditFilters counts={counts} />

      {rows.length === 0 ? (
        <div className="bg-white border border-niqo-gray-200 rounded-xl p-10 text-center">
          <History
            className="w-10 h-10 text-niqo-gray-500 mx-auto mb-3"
            strokeWidth={1.6}
          />
          <p className="font-display text-base font-bold text-niqo-black mb-1">
            Aucune action enregistrée
          </p>
          <p className="text-sm text-niqo-gray-500">
            {target === "all"
              ? "Quand tu valideras une KYC ou modéreras un signalement, ça apparaîtra ici."
              : "Aucune action sur cette catégorie de cible."}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-niqo-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="bg-niqo-gray-50 border-b border-niqo-gray-200">
                <tr className="text-left text-xs font-mono uppercase tracking-wider text-niqo-gray-500">
                  <th className="px-5 py-3 font-medium w-32">Quand</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Cible</th>
                  <th className="px-5 py-3 font-medium">Détails</th>
                  <th className="px-5 py-3 font-medium w-32">Admin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-niqo-gray-100 hover:bg-niqo-gray-50 transition-colors duration-150"
                  >
                    <td
                      className="px-5 py-3 text-sm text-niqo-gray-800"
                      title={absoluteAbidjan(row.created_at)}
                    >
                      {timeAgo(row.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      <ActionBadge action={row.action} />
                    </td>
                    <td className="px-5 py-3">
                      <TargetCell type={row.target_type} id={row.target_id} />
                    </td>
                    <td className="px-5 py-3">
                      <MetadataCell metadata={row.metadata} />
                    </td>
                    <td className="px-5 py-3 text-sm text-niqo-gray-800">
                      {row.admin?.prenom ?? <span className="text-niqo-gray-500 italic">— purgé</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-niqo-gray-500">
              <p>
                Page {page} sur {totalPages} · {totalCount?.toLocaleString("fr-FR")} entrées
              </p>
              <div className="flex items-center gap-2">
                {page > 1 && (
                  <Link
                    href={`/admin/audit?${new URLSearchParams({
                      ...(target !== "all" ? { target } : {}),
                      page: String(page - 1),
                    }).toString()}`}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-niqo-gray-200 text-niqo-gray-800 hover:bg-niqo-gray-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
                  >
                    <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
                    Précédent
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/admin/audit?${new URLSearchParams({
                      ...(target !== "all" ? { target } : {}),
                      page: String(page + 1),
                    }).toString()}`}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-niqo-gray-200 text-niqo-gray-800 hover:bg-niqo-gray-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
                  >
                    Suivant
                    <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}


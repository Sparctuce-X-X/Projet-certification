import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

interface Props {
  /** ID du signalement actuellement ouvert (à exclure de la liste). */
  currentSignalementId: string;
  /** target_type de la cible — même type matching strict. */
  targetType: "annonce" | "utilisateur" | "message" | "rdv_post";
  /** target_id de la cible — même id matching strict (compositeur option C
   *  conv+annonce du TODO pre-prod 2026-05-09 → MVP : matching exact même
   *  tuple `(target_type, target_id)`. Cross-target Phase 2). */
  targetId: string;
}

/**
 * Server Component — liste les autres signalements EN ATTENTE sur la même
 * cible que le signalement actuel. Permet à l'admin de traiter en série
 * sans naviguer entre 2 onglets.
 *
 * Affiche rien si aucun autre signalement en attente (pas de section vide).
 *
 * Filtre :
 *   target_type = props.targetType
 *   AND target_id = props.targetId
 *   AND id != props.currentSignalementId
 *   AND statut = 'en_attente'
 */
export async function RelatedSignalements({
  currentSignalementId,
  targetType,
  targetId,
}: Props) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("signalements")
    .select(
      `id, motif, motif_categorie, role_signaleur, created_at,
       signaleur:users!signalements_signaleur_id_fkey(prenom, nom)`
    )
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("statut", "en_attente")
    .neq("id", currentSignalementId)
    .order("created_at", { ascending: false })
    .limit(10);

  const related = (data ?? []) as unknown as Array<{
    id: string;
    motif: string;
    motif_categorie: string | null;
    role_signaleur: string | null;
    created_at: string;
    signaleur: { prenom: string | null; nom: string | null } | null;
  }>;

  if (related.length === 0) return null;

  return (
    <section className="mt-6 bg-white border border-niqo-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-base font-bold text-niqo-black">
          Signalements liés ({related.length})
        </h2>
      </div>
      <p className="text-xs text-niqo-gray-500 mb-4">
        Autres signalements en attente sur la même cible — tu peux les traiter en série sans naviguer.
      </p>
      <ul className="divide-y divide-niqo-gray-100">
        {related.map((s) => {
          const signaleurName = s.signaleur
            ? `${s.signaleur.prenom ?? ""} ${s.signaleur.nom ?? ""}`.trim() ||
              "Signaleur inconnu"
            : "Compte supprimé";
          const motifDisplay = s.motif_categorie ?? s.motif;
          return (
            <li key={s.id}>
              <Link
                href={`/admin/signalements/${s.id}`}
                className="group flex items-center gap-3 py-3 hover:bg-niqo-gray-50 -mx-2 px-2 rounded-lg transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-niqo-black truncate">
                    {motifDisplay}
                  </p>
                  <p className="text-xs text-niqo-gray-500 truncate inline-flex items-center gap-1.5 mt-0.5">
                    <span>par {signaleurName}</span>
                    {s.role_signaleur ? (
                      <>
                        <span>·</span>
                        <span className="capitalize">{s.role_signaleur}</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <Clock className="w-3 h-3" strokeWidth={2.2} />
                    <time>{relativeTime(s.created_at)}</time>
                  </p>
                </div>
                <ArrowRight
                  className="w-4 h-4 text-niqo-gray-500 group-hover:text-niqo-coral transition-colors shrink-0"
                  strokeWidth={2.2}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

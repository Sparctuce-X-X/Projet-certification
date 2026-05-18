import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export type CibleSignalement = "annonce" | "utilisateur" | "message";

export interface SubmitReportResult {
  success: boolean;
  error?: string;
}

// ── Motifs prédéfinis par cible ─────────────────────────────────────────────

export const MOTIFS_PAR_CIBLE: Record<CibleSignalement, string[]> = {
  utilisateur: [
    "Faux profil",
    "Arnaque suspectée",
    "Comportement inapproprié",
    "Vendeur fantôme",
  ],
  annonce: [
    "Article frauduleux",
    "Contenu interdit",
    "Photos trompeuses",
    "Prix abusif",
  ],
  message: [
    "Contenu inapproprié",
    "Harcèlement",
    "Arnaque suspectée",
    "Spam",
  ],
};

// ── Signalement post-RDV (mig 91) ───────────────────────────────────────────

export type MotifSignalementRdv =
  | "no_show"
  | "produit_different"
  | "produit_defectueux"
  | "tentative_fraude"
  | "comportement_dangereux"
  | "complot_fraude"
  | "autre";

export interface MotifRdvOption {
  value: MotifSignalementRdv;
  label: string;
  description: string;
  /** Vrai si la description textuelle est obligatoire (cas 'autre'). */
  requiresDescription: boolean;
}

export const MOTIFS_RDV: MotifRdvOption[] = [
  {
    value: "no_show",
    label: "Absent au rendez-vous",
    description: "L'autre n'est pas venu au RDV convenu.",
    requiresDescription: false,
  },
  {
    value: "produit_different",
    label: "Produit ne correspond pas",
    description: "Le produit reçu ne correspond pas à l'annonce.",
    requiresDescription: false,
  },
  {
    value: "produit_defectueux",
    label: "Produit défectueux ou cassé",
    description: "Le produit ne fonctionne pas ou a un défaut majeur.",
    requiresDescription: false,
  },
  {
    value: "tentative_fraude",
    label: "Tentative de fraude",
    description: "Fausse monnaie, vol, escroquerie pendant le RDV.",
    requiresDescription: false,
  },
  {
    value: "comportement_dangereux",
    label: "Comportement dangereux",
    description: "Violence, menaces ou harcèlement pendant le RDV.",
    requiresDescription: false,
  },
  {
    value: "complot_fraude",
    label: "Complot suspecté",
    description: "Suspicion de coordination malveillante (multi-comptes, faux acheteur).",
    requiresDescription: false,
  },
  {
    value: "autre",
    label: "Autre",
    description: "Décris la situation ci-dessous.",
    requiresDescription: true,
  },
];

// ── Messages FR pour les erreurs ────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Connecte-toi pour signaler.",
  cannot_report_self: "Tu ne peux pas te signaler toi-même.",
  target_not_found: "L'élément à signaler n'existe plus.",
  already_reported: "Tu as déjà signalé cet élément.",
  // Mig 91 — signalement post-RDV
  not_participant: "Tu n'es pas participant à cette conversation.",
  conversation_not_found: "Conversation introuvable.",
  no_confirmed_rdv: "Aucun RDV confirmé sur cette conversation.",
  rdv_not_past: "Le RDV n'est pas encore passé.",
  description_required: "Décris la situation pour ce motif.",
  description_too_long: "Description trop longue (max 1000 caractères).",
};

// ── Submit ──────────────────────────────────────────────────────────────────

/**
 * Soumet un signalement via la RPC submit_report.
 * Retourne { success, error? } avec un message FR user-friendly.
 */
export async function submitReport(
  targetType: CibleSignalement,
  targetId: string,
  motif: string,
  description?: string
): Promise<SubmitReportResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("submit_report", {
        p_target_type: targetType,
        p_target_id: targetId,
        p_motif: motif,
        p_description: description ?? null,
      })
    ),
    AUTH_TIMEOUT_MS,
    "submitReport"
  );

  if (error) throw new Error(error.message);

  const result = data as SubmitReportResult;
  if (!result.success && result.error) {
    return {
      success: false,
      error: ERROR_MESSAGES[result.error] ?? "Erreur inconnue. Réessaie.",
    };
  }

  return { success: true };
}

/**
 * Soumet un signalement contextualisé post-RDV (mig 91).
 * Gates côté DB : participant conv + RDV confirmé + date passée + description
 * requise pour motif='autre'. Anti-doublon (1 seul report par conv par user).
 */
export async function submitRdvReport(
  conversationId: string,
  motif: MotifSignalementRdv,
  description?: string
): Promise<SubmitReportResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("create_signalement_post_rdv", {
        p_conversation_id: conversationId,
        p_motif_categorie: motif,
        p_description: description ?? null,
      })
    ),
    AUTH_TIMEOUT_MS,
    "submitRdvReport"
  );

  if (error) throw new Error(error.message);

  const result = data as SubmitReportResult;
  if (!result.success && result.error) {
    return {
      success: false,
      error: ERROR_MESSAGES[result.error] ?? "Erreur inconnue. Réessaie.",
    };
  }

  return { success: true };
}

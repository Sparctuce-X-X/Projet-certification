"use server";

import { revalidatePath } from "next/cache";

import { sendAnnonceSuspendedEmail } from "@/lib/email/annonce-suspended";
import { sendSignalementResultEmail } from "@/lib/email/signalement-result";
import { createClient } from "@/lib/supabase/server";

/** Mapping enum motif_signalement_rdv → label FR (synchro avec mig 91). */
const RDV_FRAUD_MOTIFS_LABELS: Record<string, string> = {
  tentative_fraude: "Tentative de fraude validée par la modération",
  complot_fraude: "Complot de fraude validé par la modération",
};

/**
 * Server Action — marque un signalement comme traité ou rejeté.
 *
 * Appelle la RPC `admin_treat_signalement` qui :
 *   - Vérifie auth + is_admin (via helper is_current_user_admin, mig 52)
 *   - Update statut ('traite' ou 'rejete')
 *   - Si 'traite' → trigger fn_signalement_check_threshold (mig 25 + 91) :
 *     incrémente score_abus du target user, auto-suspend si ≥ 3 en 30j
 *     OU auto-suspend l'annonce du rdv_snapshot si motif=fraude post-RDV (mig 91)
 *
 * Le `statut = 'en_attente'` côté DB empêche les double-traitements.
 *
 * Si auto-suspension annonce (mig 91 fraude) → envoie un email au vendeur
 * (best-effort). Complément du push trigger DB (mig 67) qui peut être manqué.
 */
export async function treatSignalement(
  signalementId: string,
  action: "traite" | "rejete"
): Promise<{ success?: true; error?: string }> {
  if (!signalementId || typeof signalementId !== "string") {
    return { error: "ID invalide." };
  }
  if (action !== "traite" && action !== "rejete") {
    return { error: "Action invalide." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Session expirée. Reconnecte-toi." };
  }

  // Pre-fetch signalement pour :
  //   1. Détecter le cas auto-suspension fraude post-RDV (mig 91)
  //      → besoin de target_type + motif_categorie + rdv_snapshot.annonce_id
  //   2. Envoyer le mail "verdict" au signaleur (closure psychologique)
  //      → besoin de signaleur (email + prenom) + motif text label FR
  //   3. Envoyer le mail "verdict" à la cible (transparence)
  //      → besoin de target_type + target_id + role_signaleur (rdv_post)
  // AVANT le RPC car les permissions / l'état pourraient changer post-update.
  const { data: signalementPre } = await supabase
    .from("signalements")
    .select(
      `target_type, target_id, role_signaleur, motif_categorie, motif, rdv_snapshot,
       signaleur:users!signalements_signaleur_id_fkey(email, prenom, nom)`
    )
    .eq("id", signalementId)
    .maybeSingle();

  const { error } = await supabase.rpc("admin_treat_signalement", {
    p_signalement_id: signalementId,
    p_action: action,
  });

  if (error) {
    return { error: mapRpcError(error.message) };
  }

  revalidatePath("/admin/signalements");
  revalidatePath(`/admin/signalements/${signalementId}`);

  if (signalementPre) {
    const motifLabel = (signalementPre.motif as string) ?? "Signalement";
    let targetEmailedViaSuspension = false;

    // Email vendeur si auto-suspension annonce via mig 91 (fraude post-RDV traitée)
    if (action === "traite") {
      const motifCat = signalementPre.motif_categorie as string | null;
      if (
        signalementPre.target_type === "rdv_post" &&
        motifCat &&
        motifCat in RDV_FRAUD_MOTIFS_LABELS
      ) {
        const snapshot = signalementPre.rdv_snapshot as {
          annonce_id?: string;
        } | null;
        const annonceId = snapshot?.annonce_id;
        if (annonceId) {
          void notifyVendorAnnonceSuspended(
            supabase,
            annonceId,
            RDV_FRAUD_MOTIFS_LABELS[motifCat]!
          );
          targetEmailedViaSuspension = true;
        }
      }
    }

    // Email "verdict" au signaleur (traite OU rejete) — closure psychologique.
    const signaleur = (
      signalementPre as unknown as {
        signaleur:
          | { email: string; prenom: string | null; nom: string | null }
          | null;
      }
    ).signaleur;
    if (signaleur?.email) {
      void sendSignalementResultEmail({
        to: signaleur.email,
        userName:
          `${signaleur.prenom ?? ""} ${signaleur.nom ?? ""}`.trim() ||
          "Utilisateur",
        status: action,
        // motif text rempli au create par le RPC (label FR pour rdv_post via
        // mapping mig 91, saisie libre user pour annonce/user/message).
        motifLabel,
        recipient: "reporter",
      });
    }

    // Email "verdict" à la cible (transparence — sait qu'elle a été signalée
    // et le verdict, mais l'identité du signaleur reste anonyme).
    // Skip si auto-suspension annonce déjà fired : la cible reçoit déjà
    // le mail dédié "Annonce suspendue" qui est plus informatif.
    if (!targetEmailedViaSuspension) {
      const targetUser = await resolveTargetUser(supabase, {
        target_type: signalementPre.target_type as string,
        target_id: signalementPre.target_id as string,
        role_signaleur: (signalementPre.role_signaleur as string | null) ?? null,
      });
      if (targetUser?.email) {
        void sendSignalementResultEmail({
          to: targetUser.email,
          userName:
            `${targetUser.prenom ?? ""} ${targetUser.nom ?? ""}`.trim() ||
            "Utilisateur",
          status: action,
          motifLabel,
          recipient: "target",
        });
      }
    }
  }

  return { success: true };
}

/**
 * Helper interne — résout la personne signalée (cible) en fonction du type
 * de signalement. Renvoie email + prenom + nom pour l'envoi mail.
 *
 * Mapping target_type → cible :
 *   - 'annonce'  : vendeur de l'annonce (target_id = annonce.id)
 *   - 'user'     : user direct (target_id = user.id)
 *   - 'message'  : auteur du message (target_id = message.id)
 *   - 'rdv_post' : autre partie de la conv (target_id = conversation.id,
 *                  résolu via role_signaleur — mig 91)
 */
async function resolveTargetUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  signalement: {
    target_type: string;
    target_id: string;
    role_signaleur: string | null;
  }
): Promise<{ email: string; prenom: string | null; nom: string | null } | null> {
  if (signalement.target_type === "user") {
    const { data } = await supabase
      .from("users")
      .select("email, prenom, nom")
      .eq("id", signalement.target_id)
      .maybeSingle();
    return data ?? null;
  }

  if (signalement.target_type === "annonce") {
    const { data } = await supabase
      .from("annonces")
      .select(
        `vendeur:users!annonces_vendeur_id_fkey(email, prenom, nom)`
      )
      .eq("id", signalement.target_id)
      .maybeSingle();
    return (
      (data as { vendeur: { email: string; prenom: string | null; nom: string | null } | null } | null)
        ?.vendeur ?? null
    );
  }

  if (signalement.target_type === "message") {
    const { data } = await supabase
      .from("messages")
      .select(
        `expediteur:users!messages_expediteur_id_fkey(email, prenom, nom)`
      )
      .eq("id", signalement.target_id)
      .maybeSingle();
    return (
      (data as { expediteur: { email: string; prenom: string | null; nom: string | null } | null } | null)
        ?.expediteur ?? null
    );
  }

  if (signalement.target_type === "rdv_post") {
    // role_signaleur = 'acheteur' → cible = vendeur, et inverse
    const targetSide =
      signalement.role_signaleur === "acheteur" ? "vendeur" : "acheteur";
    const fkAlias =
      targetSide === "vendeur"
        ? "vendeur:users!conversations_vendeur_id_fkey(email, prenom, nom)"
        : "acheteur:users!conversations_acheteur_id_fkey(email, prenom, nom)";
    const { data } = await supabase
      .from("conversations")
      .select(fkAlias)
      .eq("id", signalement.target_id)
      .maybeSingle();
    const row = data as
      | {
          vendeur?: { email: string; prenom: string | null; nom: string | null } | null;
          acheteur?: { email: string; prenom: string | null; nom: string | null } | null;
        }
      | null;
    return (targetSide === "vendeur" ? row?.vendeur : row?.acheteur) ?? null;
  }

  return null;
}

/**
 * Helper interne — fetch le contact vendeur d'une annonce + envoie l'email
 * "Annonce suspendue". Best-effort : log mais ne throw jamais.
 *
 * Dupliqué depuis cascade-actions.ts (2 callsites, pas d'extraction nécessaire).
 */
async function notifyVendorAnnonceSuspended(
  supabase: Awaited<ReturnType<typeof createClient>>,
  annonceId: string,
  motif: string
): Promise<void> {
  const { data } = await supabase
    .from("annonces")
    .select(
      `titre, vendeur:users!annonces_vendeur_id_fkey(email, prenom, nom)`
    )
    .eq("id", annonceId)
    .maybeSingle();

  const row = data as {
    titre: string;
    vendeur: { email: string; prenom: string | null; nom: string | null } | null;
  } | null;

  if (!row?.vendeur?.email) return;

  void sendAnnonceSuspendedEmail({
    to: row.vendeur.email,
    userName:
      `${row.vendeur.prenom ?? ""} ${row.vendeur.nom ?? ""}`.trim() ||
      "Utilisateur",
    annonceTitre: row.titre,
    motif,
  });
}

/**
 * Server Action — revert manuelle d'une annonce de `en_cours` vers `active`
 * (mig 95). Utilisée après signalement post-RDV non-fraude validé pour
 * libérer l'annonce du gel disputed (mig 86 §4.6).
 *
 * RPC `admin_revert_annonce_to_active` :
 *   - Vérifie auth + is_admin
 *   - Vérifie annonce.statut = 'en_cours' (sinon INVALID_STATE)
 *   - Update statut → 'active' + push vendeur "Annonce remise en vente"
 */
export async function revertAnnonceToActive(
  annonceId: string,
  signalementId: string
): Promise<{ success?: true; error?: string }> {
  if (!annonceId || typeof annonceId !== "string") {
    return { error: "ID annonce invalide." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Session expirée. Reconnecte-toi." };
  }

  const { data, error } = await supabase.rpc(
    "admin_revert_annonce_to_active",
    { p_annonce_id: annonceId }
  );

  if (error) {
    return { error: mapRpcError(error.message) };
  }

  // La RPC retourne jsonb { success, error?, current_statut? }
  if (data && typeof data === "object" && "success" in data && !data.success) {
    const code = "error" in data ? String(data.error) : "UNKNOWN";
    const current =
      "current_statut" in data ? String(data.current_statut) : null;
    if (code === "INVALID_STATE" && current) {
      return {
        error: `L'annonce est déjà en « ${current} », pas en « en_cours ». Rien à faire.`,
      };
    }
    return { error: mapRpcError(code) };
  }

  revalidatePath("/admin/signalements");
  revalidatePath(`/admin/signalements/${signalementId}`);

  return { success: true };
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Session expirée. Reconnecte-toi.",
  ADMIN_REQUIRED: "Accès admin requis.",
  INVALID_ACTION: "Action invalide.",
  SIGNALEMENT_NOT_PENDING:
    "Ce signalement a déjà été traité. Recharge la page.",
  ANNONCE_NOT_FOUND: "Annonce introuvable (déjà supprimée ?).",
  INVALID_STATE: "L'annonce n'est pas dans un état revertable.",
};

function mapRpcError(rawMessage: string): string {
  for (const code of Object.keys(RPC_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return RPC_ERROR_MESSAGES[code]!;
  }
  return "Erreur serveur. Réessaie.";
}

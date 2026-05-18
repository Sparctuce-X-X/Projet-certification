"use server";

import { revalidatePath } from "next/cache";

import { sendAnnonceSuspendedEmail } from "@/lib/email/annonce-suspended";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions cascade — suspendre/supprimer la cible d'un signalement
 * sans toucher au statut du signalement lui-même.
 *
 * Voir mig 57 pour la justification : un admin peut vouloir retirer une
 * annonce dangereuse de la circulation immédiatement, indépendamment de
 * sa décision sur le signalement (qui peut prendre +tard si analyse).
 *
 * Les RPCs DB vérifient is_admin (helper mig 52). Pas besoin de re-check
 * côté action — defense in depth.
 */

const RPC_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Session expirée. Reconnecte-toi.",
  ADMIN_REQUIRED: "Accès admin requis.",
  ANNONCE_NOT_FOUND: "Annonce introuvable (déjà supprimée ?).",
  USER_NOT_FOUND: "Utilisateur introuvable.",
  MESSAGE_NOT_FOUND: "Message introuvable.",
  CANNOT_SUSPEND_SELF: "Tu ne peux pas suspendre ton propre compte admin.",
};

function mapRpcError(rawMessage: string): string {
  for (const code of Object.keys(RPC_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return RPC_ERROR_MESSAGES[code]!;
  }
  return "Erreur serveur. Réessaie.";
}

/** Suspend une annonce signalée. Statut → 'suspendue'. */
export async function suspendAnnonce(
  signalementId: string,
  annonceId: string
): Promise<{ success?: true; error?: string }> {
  if (!annonceId) return { error: "ID annonce invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_suspend_annonce", {
    p_annonce_id: annonceId,
  });

  if (error) return { error: mapRpcError(error.message) };

  revalidatePath(`/admin/signalements/${signalementId}`);
  revalidatePath("/admin/signalements");

  // Email vendeur post-suspension (best-effort, n'échoue pas l'action si l'email plante).
  // Complément du push trigger DB (mig 67) qui peut être manqué.
  void notifyVendorAnnonceSuspended(supabase, annonceId, "Décision de modération");

  return { success: true };
}

/** Suspend un user. is_active → false. */
export async function suspendUser(
  signalementId: string,
  userId: string
): Promise<{ success?: true; error?: string }> {
  if (!userId) return { error: "ID utilisateur invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_suspend_user", {
    p_user_id: userId,
  });

  if (error) return { error: mapRpcError(error.message) };

  revalidatePath(`/admin/signalements/${signalementId}`);
  revalidatePath("/admin/signalements");
  return { success: true };
}

/**
 * Helper interne — fetch le contact vendeur d'une annonce + envoie l'email
 * "Annonce suspendue". Best-effort : log mais ne throw jamais (Server Action
 * doit rester succès même si l'email plante).
 *
 * Lecture via JOIN sur users (RLS admin OK depuis mig 52).
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

/** Soft delete un message. is_deleted → true. */
export async function softDeleteMessage(
  signalementId: string,
  messageId: string
): Promise<{ success?: true; error?: string }> {
  if (!messageId) return { error: "ID message invalide." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_soft_delete_message", {
    p_message_id: messageId,
  });

  if (error) return { error: mapRpcError(error.message) };

  revalidatePath(`/admin/signalements/${signalementId}`);
  revalidatePath("/admin/signalements");
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { sendVerificationResultEmail } from "@/lib/email/verification-result";
import { createClient } from "@/lib/supabase/server";

/** Récupère email + nom complet du user owner d'une verification (server-side, RLS admin). */
async function getVerificationUserContact(
  supabase: Awaited<ReturnType<typeof createClient>>,
  verificationId: string
): Promise<{ email: string; userName: string } | null> {
  const { data } = await supabase
    .from("verifications_identite")
    .select(
      `user:users!verifications_identite_user_id_fkey(email, prenom, nom)`
    )
    .eq("id", verificationId)
    .maybeSingle();

  const user = (data as { user: { email: string; prenom: string | null; nom: string | null } | null } | null)?.user;
  if (!user?.email) return null;

  return {
    email: user.email,
    userName: `${user.prenom ?? ""} ${user.nom ?? ""}`.trim() || "Utilisateur",
  };
}

/**
 * Server Action — valide une vérification d'identité.
 *
 * Le RPC `admin_validate_verification` (mig 45 + mig 85) :
 *   - Vérifie côté serveur que l'appelant est admin (auth.uid() + is_admin)
 *   - Persiste numero_cni (UNIQUE WHERE statut='verified', mig 85)
 *   - Update verifications_identite.statut = 'verified'
 *   - Trigger fn_verif_on_approve set users.is_verified = true
 *   - Tout est atomique
 *
 * Validation côté client (input sanitisation Server Action skill rule HIGH).
 * Le numéro CNI est tapé par l'admin en lisant la photo (anti-fraude
 * multi-comptes : empêche un fraudeur de soumettre la même CNI 5 fois).
 */
export async function validateVerification(
  verificationId: string,
  numeroCni: string
) {
  if (!verificationId || typeof verificationId !== "string") {
    return { error: "ID invalide." };
  }

  const trimmedCni = numeroCni.trim().toUpperCase();
  if (trimmedCni.length < 4 || trimmedCni.length > 20) {
    return { error: "Numéro CNI invalide (4 à 20 caractères)." };
  }
  if (!/^[A-Z0-9 \-]+$/.test(trimmedCni)) {
    return { error: "Numéro CNI : caractères autorisés A-Z, 0-9, espaces et tirets." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Session expirée. Reconnecte-toi." };
  }

  const { data: rpcData, error } = await supabase.rpc(
    "admin_validate_verification",
    {
      p_verification_id: verificationId,
      p_approved: true,
      p_reject_reason: null,
      p_numero_cni: trimmedCni,
    }
  );

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[validateVerification] rpc error", error.code);
    }
    return { error: mapRpcError(error.message) };
  }
  void rpcData;

  revalidatePath("/admin/verifications");
  revalidatePath(`/admin/verifications/${verificationId}`);

  // Email post-validation (best-effort, n'échoue pas l'action si l'email plante)
  const contact = await getVerificationUserContact(supabase, verificationId);
  if (contact) {
    void sendVerificationResultEmail({
      to: contact.email,
      userName: contact.userName,
      status: "verified",
    });
  }

  return { success: true };
}

/**
 * Server Action — refuse une vérification avec raison.
 * Min 5 chars enforcé côté client (modal disabled) + côté DB (RPC + check).
 */
export async function rejectVerification(
  verificationId: string,
  reason: string
) {
  if (!verificationId || typeof verificationId !== "string") {
    return { error: "ID invalide." };
  }

  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { error: "Raison de refus requise (5 caractères minimum)." };
  }
  if (trimmed.length > 500) {
    return { error: "Raison trop longue (500 caractères max)." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Session expirée. Reconnecte-toi." };
  }

  const { error } = await supabase.rpc("admin_validate_verification", {
    p_verification_id: verificationId,
    p_approved: false,
    p_reject_reason: trimmed,
  });

  if (error) {
    return { error: mapRpcError(error.message) };
  }

  revalidatePath("/admin/verifications");
  revalidatePath(`/admin/verifications/${verificationId}`);

  // Email post-refus (best-effort, n'échoue pas l'action si l'email plante)
  const contact = await getVerificationUserContact(supabase, verificationId);
  if (contact) {
    void sendVerificationResultEmail({
      to: contact.email,
      userName: contact.userName,
      status: "rejected",
      rejectReason: trimmed,
    });
  }

  return { success: true };
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Session expirée. Reconnecte-toi.",
  ADMIN_REQUIRED: "Accès admin requis.",
  REJECT_REASON_REQUIRED: "Raison de refus requise.",
  VERIFICATION_NOT_PENDING:
    "Cette vérification a déjà été traitée. Recharge la page.",
  // Mig 85 — anti-fraude CNI
  NUMERO_CNI_REQUIRED: "Numéro CNI requis pour valider.",
  NUMERO_CNI_INVALID: "Numéro CNI invalide (4-20 caractères, A-Z, 0-9).",
  CNI_ALREADY_USED:
    "Cette CNI est déjà associée à un autre compte vérifié — refuser cette soumission (suspicion de fraude).",
};

function mapRpcError(rawMessage: string): string {
  for (const code of Object.keys(RPC_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return RPC_ERROR_MESSAGES[code]!;
  }
  return "Erreur serveur. Réessaie.";
}

import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export interface BlockUserResult {
  success: boolean;
  error?: string;
}

export interface UnblockUserResult extends BlockUserResult {
  was_blocked?: boolean;
}

export interface BlockedUserRow {
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

// ── Messages FR user-friendly pour les erreurs RPC ─────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Connecte-toi pour bloquer un utilisateur.",
  cannot_block_self: "Tu ne peux pas te bloquer toi-même.",
  cannot_block_system: "Cet utilisateur ne peut pas être bloqué.",
  target_not_found: "Cet utilisateur n'existe plus.",
  already_blocked: "Tu as déjà bloqué cet utilisateur.",
};

// ── Block ──────────────────────────────────────────────────────────────────

/**
 * Bloque un user via RPC block_user. Crée aussi un signalement implicite
 * (Apple Guideline 1.2 — "notify the developer of the inappropriate content").
 *
 * @param targetId UUID de l'user à bloquer
 * @param reason   Motif optionnel (max 500 chars, affiché côté admin)
 */
export async function blockUser(
  targetId: string,
  reason?: string
): Promise<BlockUserResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("block_user", {
        p_target_id: targetId,
        p_reason: reason ?? null,
      })
    ),
    AUTH_TIMEOUT_MS,
    "blockUser"
  );

  if (error) throw new Error(error.message);

  const result = data as BlockUserResult;
  if (!result.success && result.error) {
    return {
      success: false,
      error: ERROR_MESSAGES[result.error] ?? "Erreur inconnue. Réessaie.",
    };
  }

  return { success: true };
}

/**
 * Déblocage idempotent. Retourne was_blocked=false si rien à supprimer.
 */
export async function unblockUser(targetId: string): Promise<UnblockUserResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("unblock_user", { p_target_id: targetId })
    ),
    AUTH_TIMEOUT_MS,
    "unblockUser"
  );

  if (error) throw new Error(error.message);

  const result = data as UnblockUserResult;
  if (!result.success && result.error) {
    return {
      success: false,
      error: ERROR_MESSAGES[result.error] ?? "Erreur inconnue. Réessaie.",
    };
  }

  return { success: true, was_blocked: result.was_blocked };
}

// ── Fetch + Realtime ───────────────────────────────────────────────────────

/**
 * Charge en bulk la liste des user IDs bloqués par l'user authentifié.
 * Utilisé par useBlockedUsers + filter front (annonces, conversations).
 */
export async function fetchMyBlockedUserIds(): Promise<string[]> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("get_my_blocked_user_ids")),
    AUTH_TIMEOUT_MS,
    "fetchMyBlockedUserIds"
  );

  if (error) throw new Error(error.message);
  return (data as string[] | null) ?? [];
}

/**
 * Charge la liste complète (avec reason + created_at) — utilisé sur la page
 * Profil → "Utilisateurs bloqués" pour gestion (unblock).
 */
export async function fetchMyBlockedUsers(): Promise<BlockedUserRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocker_id, blocked_id, reason, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as BlockedUserRow[] | null) ?? [];
}

/**
 * Charge en bulk les profils publics des users bloqués (prenom, avatar, etc.)
 * via une 2e query — évite N+1 dans la page liste.
 */
export interface BlockedUserDisplay {
  id: string;
  prenom: string;
  avatar_url: string | null;
  blocked_at: string;
  reason: string | null;
}

export async function fetchMyBlockedUsersWithProfiles(): Promise<BlockedUserDisplay[]> {
  // Utilise la RPC SECURITY DEFINER (mig 132) qui bypass RLS sur public.users.
  // Sans ça, SELECT direct depuis users renvoie 0 row pour les profils bloqués
  // hors conversation partagée — la liste affichait "Utilisateur supprimé".
  const { data, error } = await supabase.rpc("get_my_blocked_users_display");

  if (error) throw new Error(error.message);

  const rows = (data as Array<{
    id: string;
    prenom: string;
    avatar_url: string | null;
    reason: string | null;
    blocked_at: string;
  }> | null) ?? [];

  return rows.map((r) => ({
    id: r.id,
    prenom: r.prenom,
    avatar_url: r.avatar_url,
    blocked_at: r.blocked_at,
    reason: r.reason,
  }));
}

/**
 * Check si l'user courant est bloqué dans une conv donnée.
 * Utilisé par le composer de message — désactive le composer si bloqué.
 */
export async function amIBlockedInConv(conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("am_i_blocked_in_conv", {
    p_conversation_id: conversationId,
  });

  if (error) {
    // Fail-open : si la RPC échoue, on autorise l'envoi (le trigger DB
    // catch via BLOCKED_BY_RECIPIENT au moment de l'INSERT messages).
    return false;
  }

  return (data as boolean) ?? false;
}

// ── Realtime subscribe ─────────────────────────────────────────────────────

/**
 * Subscribe aux changements de blocked_users pour l'user courant.
 * Émet une callback à chaque INSERT/DELETE (refresh la liste côté front).
 * Retourne une fonction d'unsubscribe.
 */
export function subscribeToBlockedUsers(
  userId: string,
  onChange: () => void
): () => void {
  const channel = supabase
    .channel(`blocked_users:${userId}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "blocked_users",
        filter: `blocker_id=eq.${userId}`,
      },
      () => onChange()
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// ── Helpers exposés au front ───────────────────────────────────────────────

/**
 * Check si BLOCKED_BY_RECIPIENT est l'erreur retournée par un INSERT messages.
 * Le client mobile peut alors afficher un message générique non-révélateur.
 */
export function isBlockedByRecipientError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error as Error)?.message ?? "";
  return msg.includes("BLOCKED_BY_RECIPIENT") || msg.includes("blocked you");
}

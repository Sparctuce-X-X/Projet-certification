import {
  AUTH_TIMEOUT_MS,
  supabase,
  withTimeout,
} from "@/lib/supabase";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";
import { fetchPublicUserProfile } from "@/lib/users";
import type { StatutAnnonce, TypeOffreImmo } from "@/lib/annonces";
import {
  getRdvState,
  getRencontreState,
  type RdvFields,
} from "@/lib/rdv";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Conversation extends RdvFields {
  id: string;
  annonce_id: string | null;
  acheteur_id: string;
  vendeur_id: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ConversationListItem extends RdvFields {
  id: string;
  annonce_id: string | null;
  annonce_titre: string;
  annonce_cover_url: string;
  /** Mig 39 — annonce purgée (FK set null) ou jamais créée. La conv reste accessible
   * pour préserver l'historique avis. UI : photo placeholder + titre italique gris. */
  annonce_deleted: boolean;
  /** Statut de l'annonce — null si annonce supprimée. */
  annonce_statut: StatutAnnonce | null;
  /** Type d'offre immo (location/vente) — null si annonce non-immo ou supprimée. */
  annonce_type_offre: TypeOffreImmo | null;
  /** True si l'user authentifié est le vendeur (sinon acheteur). Dérivé client-side. */
  is_vendeur: boolean;
  other_user_id: string;
  other_user_prenom: string;
  other_user_avatar_url: string | null;
  /** Pour afficher le badge vendeur fiable (≥5 ventes + note ≥4.0) */
  other_user_nb_ventes: number;
  other_user_note_vendeur: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  expediteur_id: string;
  contenu: string;
  type: "texte" | "offre_prix" | "systeme" | "image";
  is_read: boolean;
  created_at: string;
}

// ── Helpers internes ────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

// ── Get or Create Conversation ──────────────────────────────────────────────

interface GetOrCreateResult {
  success: boolean;
  error?: string;
  conversation?: Conversation;
}

/**
 * Crée ou récupère une conversation pour une annonce donnée.
 * Le vendeur est déduit de l'annonce côté serveur (anti-triche).
 * Idempotent — si la conversation existe déjà, la retourne.
 */
export async function getOrCreateConversation(
  annonceId: string
): Promise<GetOrCreateResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("get_or_create_conversation", { p_annonce_id: annonceId })
    ),
    AUTH_TIMEOUT_MS,
    "getOrCreateConversation"
  );

  if (error) throw new Error(error.message);
  return data as GetOrCreateResult;
}

// ── Fetch Conversations List ────────────────────────────────────────────────

/**
 * Récupère toutes les conversations de l'user connecté avec les infos
 * d'affichage (annonce, autre participant, dernier message, unread count).
 */
export async function fetchMyConversations(): Promise<ConversationListItem[]> {
  const userId = await getCurrentUserId();

  // 1. Fetch conversations + annonce info (pas de join users — RLS ambiguë)
  // SELECT inclut les champs RDV (mig 35) + rencontre (mig 86) + admin marker
  // (mig 96) pour pouvoir surfacer l'état RDV directement dans la liste sans
  // tap sur chaque conv. Cohérent avec `RdvFields` de `lib/rdv.ts`.
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("conversations")
        .select(`
          id,
          annonce_id,
          acheteur_id,
          vendeur_id,
          last_message_preview,
          last_message_at,
          rdv_lieu,
          rdv_date,
          rdv_propose_par,
          rdv_propose_at,
          rdv_confirme_at,
          rdv_annule_par,
          rdv_annule_at,
          rencontre_acheteur,
          rencontre_vendeur,
          rencontre_decided_at,
          admin_signalement_decided_at,
          annonces:annonce_id (titre, photos, statut, type_offre)
        `)
        .or(`acheteur_id.eq.${userId},vendeur_id.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false })
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyConversations"
  );

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  type AnnonceJoin = {
    titre: string;
    photos: string[];
    statut: StatutAnnonce;
    type_offre: TypeOffreImmo | null;
  };
  type ConvRow = RdvFields & {
    id: string;
    annonce_id: string | null;
    acheteur_id: string;
    vendeur_id: string;
    last_message_preview: string | null;
    last_message_at: string | null;
    annonces: AnnonceJoin | AnnonceJoin[] | null;
  };
  const rows = data as unknown as ConvRow[];

  // 2. Fetch les profils des autres participants via RPC (bypass RLS)
  const otherUserIds = [
    ...new Set(
      rows.map((r) => (r.acheteur_id === userId ? r.vendeur_id : r.acheteur_id))
    ),
  ];
  const profileMap: Record<string, { prenom: string; avatar_url: string | null; nb_ventes: number; note_vendeur: number }> = {};
  await Promise.all(
    otherUserIds.map(async (uid) => {
      try {
        const profile = await fetchPublicUserProfile(uid);
        if (profile) {
          profileMap[uid] = {
            prenom: profile.prenom,
            avatar_url: profile.avatar_url,
            nb_ventes: profile.nb_ventes,
            note_vendeur: profile.note_vendeur,
          };
        }
      } catch {
      }
    })
  );

  // 3. Compter les messages non-lus par conversation
  const convIds = rows.map((c) => c.id);
  const unreadMap: Record<string, number> = {};

  const { data: unreadData } = await supabase
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", convIds)
    .neq("expediteur_id", userId)
    .eq("is_read", false);

  if (unreadData) {
    for (const row of unreadData as { conversation_id: string }[]) {
      unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1;
    }
  }

  // 4. Assembler
  return rows.map((row) => {
    const otherId = row.acheteur_id === userId ? row.vendeur_id : row.acheteur_id;
    const other = profileMap[otherId];
    const annonce = Array.isArray(row.annonces) ? row.annonces[0] : row.annonces;
    const annonceDeleted = !annonce;

    return {
      id: row.id,
      annonce_id: row.annonce_id,
      annonce_titre: annonce?.titre ?? "Annonce supprimée",
      annonce_cover_url: annonce?.photos?.[0]
        ? getAnnoncePhotoUrl(annonce.photos[0])
        : "",
      annonce_deleted: annonceDeleted,
      annonce_statut: annonce?.statut ?? null,
      annonce_type_offre: annonce?.type_offre ?? null,
      is_vendeur: row.vendeur_id === userId,
      other_user_id: otherId,
      other_user_prenom: other?.prenom ?? "Utilisateur",
      other_user_avatar_url: other?.avatar_url ?? null,
      other_user_nb_ventes: other?.nb_ventes ?? 0,
      other_user_note_vendeur: other?.note_vendeur ?? 0,
      last_message_preview: row.last_message_preview,
      last_message_at: row.last_message_at,
      unread_count: unreadMap[row.id] ?? 0,
      // RdvFields — passés tels quels pour deriveConvBadge() côté UI
      rdv_lieu: row.rdv_lieu,
      rdv_date: row.rdv_date,
      rdv_propose_par: row.rdv_propose_par,
      rdv_propose_at: row.rdv_propose_at,
      rdv_confirme_at: row.rdv_confirme_at,
      rdv_annule_par: row.rdv_annule_par,
      rdv_annule_at: row.rdv_annule_at,
      rencontre_acheteur: row.rencontre_acheteur,
      rencontre_vendeur: row.rencontre_vendeur,
      rencontre_decided_at: row.rencontre_decided_at,
      admin_signalement_decided_at: row.admin_signalement_decided_at,
    };
  });
}

// ── Badge dérivé pour la liste Messages ─────────────────────────────────────

/**
 * État affiché sur chaque card de conv dans `/messages.tsx`. Pure derivation
 * depuis RdvFields + statut annonce — pas d'I/O, recalculé à chaque render.
 *
 * Priorité (du plus important au moins) :
 *   1. Annonce vendue/louée  → "Vendue" / "Louée" (vert)
 *   2. RDV passé en attente   → "Confirme la rencontre" (orange) — l'user doit décider
 *   3. RDV en désaccord       → "Désaccord" (rouge) ou "RDV examiné" (gris) si admin tranché
 *   4. RDV confirmé futur     → "RDV · {date courte}" (vert calendaire)
 *   5. RDV proposé non confirmé → "RDV proposé" (bleu)
 *   6. Sinon                  → none (pas de badge)
 *
 * `met` (les 2 ont confirmé la rencontre) sans annonce vendue → none, parce
 * que le RDV est déjà passé et OK : l'action utile est ailleurs (noter, marquer
 * vendue) et est déjà surfacée par la bannière Home (mig 93).
 */
export type ConvBadgeKind =
  | { kind: "none" }
  | { kind: "sold" }
  | { kind: "rented" }
  | { kind: "rdv_proposed" }
  | { kind: "rdv_confirmed"; date: string }
  | { kind: "pending_meeting" }
  | { kind: "disputed"; admin_decided: boolean };

export function deriveConvBadge(conv: ConversationListItem): ConvBadgeKind {
  if (conv.annonce_statut === "vendue") {
    return {
      kind: conv.annonce_type_offre === "location" ? "rented" : "sold",
    };
  }

  const rdvState = getRdvState(conv);

  if (rdvState === "past") {
    const rencontreState = getRencontreState(conv, conv.is_vendeur);
    if (rencontreState === "pending" || rencontreState === "unilateral_other") {
      return { kind: "pending_meeting" };
    }
    if (rencontreState === "disputed") {
      return {
        kind: "disputed",
        admin_decided: conv.admin_signalement_decided_at !== null,
      };
    }
    return { kind: "none" };
  }

  if (rdvState === "confirmed") {
    return { kind: "rdv_confirmed", date: conv.rdv_date! };
  }

  if (rdvState === "proposed") {
    return { kind: "rdv_proposed" };
  }

  return { kind: "none" };
}

// ── Fetch Messages ──────────────────────────────────────────────────────────

const MESSAGES_PAGE_SIZE = 30;

/**
 * Récupère les messages d'une conversation (pagination cursor-based).
 * Retourne les messages du plus récent au plus ancien.
 */
export async function fetchMessages(
  conversationId: string,
  cursor?: string
): Promise<Message[]> {
  let query = supabase
    .from("messages")
    .select("id, conversation_id, expediteur_id, contenu, type, is_read, created_at")
    .eq("conversation_id", conversationId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await withTimeout(
    Promise.resolve(query),
    AUTH_TIMEOUT_MS,
    "fetchMessages"
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}

// ── Send Message ────────────────────────────────────────────────────────────

/**
 * Envoie un message texte dans une conversation.
 * Le trigger DB met à jour last_message_preview sur la conversation.
 */
export async function sendMessage(
  conversationId: string,
  contenu: string
): Promise<Message> {
  const userId = await getCurrentUserId();
  const trimmed = contenu.trim();

  if (!trimmed) throw new Error("Le message ne peut pas être vide");
  if (trimmed.length > 2000) throw new Error("Message trop long (2000 caractères max)");

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          expediteur_id: userId,
          contenu: trimmed,
          type: "texte" as const,
        })
        .select("id, conversation_id, expediteur_id, contenu, type, is_read, created_at")
        .single()
    ),
    AUTH_TIMEOUT_MS,
    "sendMessage"
  );

  if (error) {
    // Le trigger contenu_interdit met le code dans error.message et le
    // détail dans error.hint. On combine les deux pour que le client
    // puisse détecter "contenu_interdit" dans le message.
    const fullMsg = [error.message, error.hint, error.details]
      .filter(Boolean)
      .join(" ");
    throw new Error(fullMsg);
  }
  return data as Message;
}

// ── Mark as Read ────────────────────────────────────────────────────────────

/**
 * Marque tous les messages non-lus d'une conversation comme lus.
 * Fire-and-forget OK — si ça échoue, le compteur sera un peu décalé
 * jusqu'au prochain focus.
 */
export async function markMessagesRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_messages_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message);
}

// ── Unread Count ────────────────────────────────────────────────────────────

/**
 * Compte total des messages non-lus de l'user (toutes conversations).
 * Utilisé pour le badge BottomNav.
 *
 * On filtre explicitement par participation (acheteur_id ou vendeur_id =
 * userId) plutôt que de s'appuyer sur RLS : la policy `messages_admin_select`
 * (mig 56) ouvre la lecture de TOUS les messages aux admins pour modérer les
 * signalements. Sans ce filtre, le badge d'un admin affiche le total
 * plateforme au lieu de ses propres messages non-lus.
 */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const userId = await getCurrentUserId();

    const { data: convs, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .or(`acheteur_id.eq.${userId},vendeur_id.eq.${userId}`);

    if (convError) return 0;
    const convIds = (convs ?? []).map((c) => c.id as string);
    if (convIds.length === 0) return 0;

    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .neq("expediteur_id", userId)
      .eq("is_read", false);

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ── Realtime Subscriptions ──────────────────────────────────────────────────

/**
 * Souscrit aux INSERT et UPDATE d'une conversation spécifique.
 * Retourne le channel pour cleanup (channel.unsubscribe() au unmount).
 */
export function subscribeToConversation(
  conversationId: string,
  onInsert: (msg: Message) => void,
  onUpdate?: (msg: Message) => void
): RealtimeChannel {
  const channelName = `messages:${conversationId}:${Date.now()}`;
  const channel = supabase.channel(channelName);
  channel
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onInsert(payload.new as Message);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onUpdate?.(payload.new as Message);
      }
    );
  channel.subscribe();
  return channel;
}

/**
 * Souscrit aux nouveaux messages sur TOUTES les conversations de l'user.
 * Le callback est appelé à chaque INSERT. Utilisé pour le badge BottomNav.
 * Retourne le channel pour cleanup.
 *
 * Nom de channel garantirement unique (timestamp + random + counter) — sinon
 * deux appels concurrents (useUnreadCount + useEffect dans messages.tsx) dans
 * la même milliseconde réutilisent le même channel Supabase et plantent avec
 * "cannot add postgres_changes callbacks ... after subscribe()".
 */
let allMessagesChannelCounter = 0;
export function subscribeToAllMessages(
  onNewMessage: () => void
): RealtimeChannel {
  allMessagesChannelCounter += 1;
  const channelName = `messages:all:${Date.now()}:${allMessagesChannelCounter}:${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase.channel(channelName);
  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
    },
    () => {
      onNewMessage();
    }
  );
  channel.subscribe();
  return channel;
}

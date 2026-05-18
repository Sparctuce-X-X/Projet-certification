import { useFocusEffect } from "@react-navigation/native";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  AlertTriangle,
  CalendarCheck,
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Flag,
  MoreVertical,
  PackageCheck,
  RefreshCw,
  SendHorizontal,
  ShieldOff,
  User,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlockUserSheet } from "@/components/blocking/BlockUserSheet";
import { ChatSafetyTips } from "@/components/chat/ChatSafetyTips";
import { RdvProposeSheet } from "@/components/chat/RdvProposeSheet";
import { RdvReportSheet } from "@/components/chat/RdvReportSheet";
import { RencontrePhotosBlock } from "@/components/chat/RencontrePhotosBlock";
import { isBlockedByRecipientError, unblockUser } from "@/lib/blocking";
import { useBlockedUsers } from "@/lib/hooks/useBlockedUsers";
import { AvisSubmitSheet } from "@/components/notation/AvisSubmitSheet";
import { StarRating } from "@/components/notation/StarRating";
import {
  fetchMyAvisOnConv,
  type Avis,
} from "@/lib/notation";
import {
  MOTIFS_PAR_CIBLE,
  submitReport,
} from "@/lib/signalements";
import { TrustedAvatar } from "@/components/ui/TrustedAvatar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";
import { fetchPublicUserProfile } from "@/lib/users";
import {
  fetchMessages,
  markMessagesRead,
  sendMessage,
  subscribeToConversation,
  type Message,
} from "@/lib/messages";
import {
  cancelRdv,
  confirmRdv,
  confirmRencontre,
  getRdvState,
  fetchMyRdvSignalementStatus,
  getRencontreState,
  type MyRdvSignalementStatus,
  rdvErrorToFr,
  type RdvFields,
  type RdvState,
  type RencontreState,
} from "@/lib/rdv";
import { initSounds, playSendSound, playReceiveSound, releaseSounds } from "@/lib/sounds";
import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function isSameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** Deux messages consécutifs du même expéditeur → pas besoin de ré-afficher l'avatar */
function isSameSender(a: Message | undefined, b: Message): boolean {
  return !!a && a.expediteur_id === b.expediteur_id && isSameDay(a.created_at, b.created_at);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ConvInfo extends RdvFields {
  annonce_id: string;
  annonce_titre: string;
  annonce_cover_url: string;
  /** Statut de l'annonce — pilote l'affichage du bouton "Marquer comme vendue" côté vendeur. */
  annonce_statut: "active" | "en_cours" | "vendue" | "expiree" | "suspendue" | null;
  /** True si l'annonce est immobilière (type_offre non-null, mig 32). Cache toute la chaîne RDV — voir mig 100. */
  is_immo: boolean;
  /** True si le caller est le vendeur de l'annonce (pas l'acheteur). */
  is_vendeur: boolean;
  other_user_id: string;
  other_prenom: string;
  other_avatar_url: string | null;
  other_nb_ventes: number;
  other_note_vendeur: number;
}

function formatRdvDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} à ${time}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const userId = profile?.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [convInfo, setConvInfo] = useState<ConvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  // Flash "Copié !" inline 1.2s après tap (M4 audit) — évite un toast global
  // pour un seul cas d'usage. Reset auto via setTimeout dans le handler.
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  // Banner discret + retry si refreshConvInfo échoue (M6 audit). Posé en
  // catch silent → toast UI au lieu de complètement masquer l'erreur.
  const [convInfoError, setConvInfoError] = useState(false);
  const [rdvSheetVisible, setRdvSheetVisible] = useState(false);
  const [rdvSubmitting, setRdvSubmitting] = useState(false);
  const [avisSheetVisible, setAvisSheetVisible] = useState(false);
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [blockSheetVisible, setBlockSheetVisible] = useState(false);
  const { blockedIds, refresh: refreshBlocked } = useBlockedUsers();
  const [myAvis, setMyAvis] = useState<Avis | null>(null);
  const [mySignalement, setMySignalement] = useState<MyRdvSignalementStatus | null>(null);
  const sendingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);

  // ── Init sons ────────────────────────────────────────────────────────────
  useEffect(() => {
    void initSounds();
    return () => { void releaseSounds(); };
  }, []);

  // ── Fetch conversation info ─────────────────────────────────────────────
  const refreshConvInfo = useCallback(async () => {
    if (!conversationId || !userId) return;
    try {
      setConvInfoError(false);
      const { data, error } = await withTimeout(
        Promise.resolve(
          supabase
            .from("conversations")
            .select(
              `annonce_id, acheteur_id, vendeur_id,
               rdv_lieu, rdv_date, rdv_propose_par, rdv_propose_at,
               rdv_confirme_at, rdv_annule_par, rdv_annule_at,
               rencontre_acheteur, rencontre_vendeur, rencontre_decided_at,
               admin_signalement_decided_at,
               annonces:annonce_id (titre, photos, statut, type_offre)`
            )
            .eq("id", conversationId)
            .single()
        ),
        AUTH_TIMEOUT_MS,
        "fetchConvInfo"
      );
      if (error || !data) {
        setConvInfoError(true);
        return;
      }

      const row = data as unknown as {
        annonce_id: string;
        acheteur_id: string;
        vendeur_id: string;
        rdv_lieu: string | null;
        rdv_date: string | null;
        rdv_propose_par: string | null;
        rdv_propose_at: string | null;
        rdv_confirme_at: string | null;
        rdv_annule_par: string | null;
        rdv_annule_at: string | null;
        rencontre_acheteur: boolean | null;
        rencontre_vendeur: boolean | null;
        rencontre_decided_at: string | null;
        admin_signalement_decided_at: string | null;
        annonces:
          | { titre: string; photos: string[]; statut: ConvInfo["annonce_statut"]; type_offre: string | null }
          | { titre: string; photos: string[]; statut: ConvInfo["annonce_statut"]; type_offre: string | null }[]
          | null;
      };

      const annonce = Array.isArray(row.annonces) ? row.annonces[0] : row.annonces;
      const isAcheteur = row.acheteur_id === userId;
      const otherId = isAcheteur ? row.vendeur_id : row.acheteur_id;

      const otherProfile = await fetchPublicUserProfile(otherId);

      setConvInfo({
        annonce_id: row.annonce_id,
        annonce_titre: annonce?.titre ?? "Annonce",
        annonce_cover_url: annonce?.photos?.[0]
          ? getAnnoncePhotoUrl(annonce.photos[0])
          : "",
        annonce_statut: annonce?.statut ?? null,
        is_immo: annonce?.type_offre != null,
        is_vendeur: !isAcheteur,
        other_user_id: otherId,
        other_prenom: otherProfile?.prenom ?? "Utilisateur",
        other_avatar_url: otherProfile?.avatar_url ?? null,
        other_nb_ventes: otherProfile?.nb_ventes ?? 0,
        other_note_vendeur: otherProfile?.note_vendeur ?? 0,
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
      });
    } catch {
      // Reseau down ou DB perm denied — banner UI proposera retry. Pas de
      // log console (production) car déjà signalé visuellement.
      setConvInfoError(true);
    }
  }, [conversationId, userId]);

  useEffect(() => {
    void refreshConvInfo();
  }, [refreshConvInfo]);

  // ── Mig 98 : fetch verdict signalement perso quand admin a tranché ──────
  useEffect(() => {
    if (!conversationId || !convInfo) return;
    if (!convInfo.admin_signalement_decided_at) {
      setMySignalement(null);
      return;
    }
    let cancelled = false;
    fetchMyRdvSignalementStatus(conversationId).then((res) => {
      if (!cancelled) setMySignalement(res);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, convInfo]);

  // ── Realtime sur la conversation (pour syncer les colonnes RDV) ─────────
  useEffect(() => {
    if (!conversationId) return;
    const channelName = `conv:${conversationId}:${Date.now()}`;
    const channel = supabase.channel(channelName);
    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `id=eq.${conversationId}`,
      },
      () => {
        void refreshConvInfo();
      }
    );
    channel.subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, [conversationId, refreshConvInfo]);

  // ── Fetch messages ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await fetchMessages(conversationId);
        if (!cancelled) {
          setMessages(msgs);
          setHasMore(msgs.length === 30);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  // ── Mark as read on focus ───────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      if (conversationId) {
        void markMessagesRead(conversationId).catch(() => {});
      }
    }, [])
  );

  // ── Realtime subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId) return;
    const channel = subscribeToConversation(
      conversationId,
      (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [newMsg, ...prev];
        });
        if (newMsg.expediteur_id !== userId) {
          void playReceiveSound();
          void markMessagesRead(conversationId).catch(() => {});
        }
      },
      (updatedMsg) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
        );
      }
    );
    return () => { channel.unsubscribe(); };
  }, [conversationId, userId]);

  // ── Load more ─────────────────────────────────────────────────────────
  const onLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0 || !conversationId) return;
    setLoadingMore(true);
    try {
      const cursor = messages[messages.length - 1].created_at;
      const older = await fetchMessages(conversationId, cursor);
      setHasMore(older.length === 30);
      setMessages((prev) => [...prev, ...older]);
    } catch {
      // silent
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, messages, conversationId]);

  // ── RDV : état dérivé + handlers ────────────────────────────────────────
  const rdvState: RdvState = convInfo ? getRdvState(convInfo) : "none";
  const isMyProposal =
    !!convInfo?.rdv_propose_par && convInfo.rdv_propose_par === userId;

  // ── Rencontre post-RDV (mig 86) — état + handlers ───────────────────────
  const rencontreState: RencontreState | null =
    convInfo && rdvState === "past"
      ? getRencontreState(convInfo, convInfo.is_vendeur)
      : null;
  const [confirmingRencontre, setConfirmingRencontre] = useState(false);

  const handleConfirmRencontre = useCallback(
    (rencontre: boolean) => {
      if (!convInfo || !conversationId || confirmingRencontre) return;
      const label = rencontre ? "Oui, on s'est vu" : "Non, on ne s'est pas vu";
      const explain = rencontre
        ? "Cette confirmation permet de marquer l'annonce vendue et de noter l'autre."
        : "Si vous êtes deux à dire « non », l'annonce sera remise en vente.";
      Alert.alert(label, explain, [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          onPress: async () => {
            setConfirmingRencontre(true);
            const r = await confirmRencontre(conversationId, rencontre);
            setConfirmingRencontre(false);
            if (!r.success) {
              Alert.alert("Erreur", rdvErrorToFr(r.error));
              return;
            }
            void refreshConvInfo();
          },
        },
      ]);
    },
    [conversationId, convInfo, confirmingRencontre, refreshConvInfo]
  );

  // ── Avis : état "ai-je déjà noté ?" — fetch quand RDV passé ──────────
  const refreshMyAvis = useCallback(() => {
    if (!conversationId) return;
    void fetchMyAvisOnConv(conversationId).then(setMyAvis);
  }, [conversationId]);

  useEffect(() => {
    if (rdvState === "past") refreshMyAvis();
    else setMyAvis(null);
  }, [rdvState, refreshMyAvis]);

  const handleConfirmRdv = useCallback(async () => {
    if (!conversationId || rdvSubmitting) return;
    setRdvSubmitting(true);
    const r = await confirmRdv(conversationId);
    setRdvSubmitting(false);
    if (!r.success) {
      Alert.alert("Erreur", rdvErrorToFr(r.error));
      return;
    }
    void refreshConvInfo();
  }, [conversationId, rdvSubmitting, refreshConvInfo]);

  // ── Marquer l'annonce comme vendue (vendeur uniquement, RDV passé) ──────
  const [markingVendue, setMarkingVendue] = useState(false);
  const handleMarkVendue = useCallback(() => {
    if (!convInfo || markingVendue) return;
    Alert.alert(
      "Marquer comme vendue ?",
      "Ton annonce ne sera plus visible dans la recherche. L'historique des conversations et avis reste intact.",
      [
        { text: "Non", style: "cancel" },
        {
          text: "Oui, vendue",
          onPress: async () => {
            setMarkingVendue(true);
            const { data, error } = await supabase.rpc("mark_annonce_vendue", {
              p_annonce_id: convInfo.annonce_id,
            });
            setMarkingVendue(false);
            if (error || !(data as { success?: boolean })?.success) {
              const code = (data as { error?: string })?.error ?? "";
              const msg: Record<string, string> = {
                no_meeting_confirmed:
                  "Vous devez tous les deux confirmer la rencontre avant de marquer vendue.",
                not_owner: "Tu n'es pas le propriétaire de cette annonce.",
                invalid_state: "L'annonce ne peut plus être marquée comme vendue.",
              };
              Alert.alert(
                "Impossible",
                msg[code] ?? "Impossible de marquer l'annonce comme vendue. Réessaie."
              );
              return;
            }
            void refreshConvInfo();
          },
        },
      ]
    );
  }, [convInfo, markingVendue, refreshConvInfo]);

  const handleCancelRdv = useCallback(() => {
    if (!conversationId) return;
    Alert.alert(
      "Annuler le RDV ?",
      rdvState === "confirmed"
        ? "Le RDV confirmé sera annulé. Tu pourras en proposer un nouveau."
        : "La proposition de RDV sera annulée.",
      [
        { text: "Non", style: "cancel" },
        {
          text: "Oui, annuler",
          style: "destructive",
          onPress: async () => {
            setRdvSubmitting(true);
            const r = await cancelRdv(conversationId);
            setRdvSubmitting(false);
            if (!r.success) {
              Alert.alert("Erreur", rdvErrorToFr(r.error));
              return;
            }
            void refreshConvInfo();
          },
        },
      ]
    );
  }, [conversationId, rdvState, refreshConvInfo]);

  // ── Menu kebab header (Voir profil / Signaler / Bloquer) ───────────────
  // Pattern iOS natif via ActionSheetIOS. Android fallback Alert.alert avec
  // boutons (l'OS rend ça comme une AlertDialog Material standard).
  const otherUserId = convInfo?.other_user_id;
  const otherPrenom = convInfo?.other_prenom ?? "";
  const isOtherBlocked = otherUserId ? blockedIds.has(otherUserId) : false;

  const onHeaderMenuPress = useCallback(() => {
    if (!otherUserId) return;

    const blockLabel = isOtherBlocked
      ? `Débloquer ${otherPrenom}`
      : `Bloquer ${otherPrenom}`;

    const handleViewProfile = () => {
      router.push(`/u/${otherUserId}`);
    };

    const handleReport = () => {
      const motifs = MOTIFS_PAR_CIBLE.utilisateur;
      Alert.alert("Signaler", "Pourquoi veux-tu signaler ?", [
        ...motifs.map((motif) => ({
          text: motif,
          onPress: () => {
            void (async () => {
              const r = await submitReport(
                "utilisateur",
                otherUserId,
                motif
              );
              if (r.success) {
                Alert.alert(
                  "Merci",
                  "Ton signalement a été envoyé. Notre équipe va l'examiner sous 24h."
                );
              } else {
                Alert.alert("Impossible", r.error ?? "Réessaie plus tard.");
              }
            })();
          },
        })),
        { text: "Annuler", style: "cancel" as const },
      ]);
    };

    const handleBlockOrUnblock = () => {
      if (isOtherBlocked) {
        Alert.alert(
          `Débloquer ${otherPrenom} ?`,
          "Cette personne pourra à nouveau te contacter.",
          [
            { text: "Annuler", style: "cancel" },
            {
              text: "Débloquer",
              style: "destructive",
              onPress: () => {
                void (async () => {
                  try {
                    const r = await unblockUser(otherUserId);
                    if (!r.success) {
                      Alert.alert(
                        "Erreur",
                        r.error ?? "Le déblocage a échoué."
                      );
                      return;
                    }
                    void refreshBlocked();
                  } catch {
                    Alert.alert(
                      "Erreur",
                      "Vérifie ta connexion et réessaie."
                    );
                  }
                })();
              },
            },
          ]
        );
      } else {
        setBlockSheetVisible(true);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Voir le profil", "Signaler", blockLabel, "Annuler"],
          cancelButtonIndex: 3,
          destructiveButtonIndex: isOtherBlocked ? undefined : 2,
          userInterfaceStyle: "light",
        },
        (idx) => {
          if (idx === 0) handleViewProfile();
          else if (idx === 1) handleReport();
          else if (idx === 2) handleBlockOrUnblock();
        }
      );
    } else {
      // Android : Alert avec 3 boutons + cancel. Pas d'ActionSheet natif sur
      // Android sans lib externe, Alert reste cohérent UX et stable.
      Alert.alert("Options", undefined, [
        { text: "Voir le profil", onPress: handleViewProfile },
        { text: "Signaler", onPress: handleReport },
        {
          text: blockLabel,
          style: isOtherBlocked ? "default" : "destructive",
          onPress: handleBlockOrUnblock,
        },
        { text: "Annuler", style: "cancel" },
      ]);
    }
  }, [otherUserId, otherPrenom, isOtherBlocked, refreshBlocked]);

  // ── Send ──────────────────────────────────────────────────────────────
  const onSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sendingRef.current || !conversationId) return;
    sendingRef.current = true;
    setSending(true);

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      conversation_id: conversationId,
      expediteur_id: userId ?? "",
      contenu: trimmed,
      type: "texte",
      is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [optimisticMsg, ...prev]);
    setInput("");
    void playSendSound();

    try {
      const real = await sendMessage(conversationId, trimmed);
      setMessages((prev) => {
        // Race possible : Realtime a déjà ajouté le message réel avant que
        // sendMessage ne résolve. Dans ce cas on retire juste l'optimistic.
        if (prev.some((m) => m.id === real.id)) {
          return prev.filter((m) => m.id !== optimisticId);
        }
        return prev.map((m) => (m.id === optimisticId ? real : m));
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setInput(trimmed);
      // Message d'erreur spécifique pour contenu interdit
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("contenu_interdit")) {
        Alert.alert("Message refusé", "Ton message contient un terme interdit.");
      } else if (isBlockedByRecipientError(err)) {
        // Volontairement neutre — best-practice industrie : le bloqué ne sait
        // pas qu'il a été bloqué. Erreur générique sans révéler l'existence du
        // block (cohérent avec mig 130 fn_messages_block_check).
        Alert.alert(
          "Message non envoyé",
          "Ce message n'a pas pu être envoyé. Réessaie plus tard."
        );
      } else {
        setSendError(true);
        setTimeout(() => setSendError(false), 4000);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [input, conversationId, userId]);

  // Index (dans la liste inversée) du dernier message envoyé par l'user
  // qui est lu — c'est là qu'on affiche "Vu". -1 = aucun.
  const lastReadSentIdx = useMemo(() => {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (
        m.expediteur_id === userId &&
        !m.id.startsWith("optimistic-") &&
        m.is_read
      ) {
        return i;
      }
    }
    return -1;
  }, [messages, userId]);

  // ── Render ────────────────────────────────────────────────────────────

  // M1 audit : on n'attend plus que `loading` (= messages fetched). Si convInfo
  // est dispo (fetch parallèle, généralement plus rapide), on render le header
  // + les bandeaux RDV pour permettre l'action immédiate, et on remplace juste
  // la zone messages par un spinner inline. Sinon (premier load froid), early
  // return spinner global comme avant.
  if (!convInfo) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }} className="bg-niqo-gray-50">
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header redesigné ───────────────────────────────────────────── */}
      <View
        className="bg-niqo-white px-3 flex-row items-center border-b border-niqo-gray-150"
        style={{ minHeight: 64, zIndex: 10 }}
      >
        {/* Back */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/messages" as never))}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>

        {/* Avatar + Nom */}
        {convInfo && (
          <View className="flex-1 flex-row items-center ml-1">
            {/* Avatar interlocuteur avec badge confiance */}
            <Pressable
              onPress={() => router.push(`/u/${convInfo.other_user_id}`)}
              accessibilityLabel={`Profil de ${convInfo.other_prenom}`}
            >
              <TrustedAvatar
                avatarUrl={convInfo.other_avatar_url}
                prenom={convInfo.other_prenom}
                nbVentes={convInfo.other_nb_ventes}
                noteVendeur={convInfo.other_note_vendeur}
                size={40}
              />
            </Pressable>

            {/* Nom + annonce */}
            <View className="ml-3 flex-1">
              <Text className="font-display text-label text-niqo-black" numberOfLines={1}>
                {convInfo.other_prenom}
              </Text>
              <Pressable
                onPress={() => router.push(`/announce/${convInfo.annonce_id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Voir l'annonce ${convInfo.annonce_titre}`}
                className="flex-row items-center active:opacity-60"
              >
                <Text className="font-body text-micro text-niqo-coral" numberOfLines={1}>
                  {convInfo.annonce_titre}
                </Text>
                <ChevronRight size={12} color="#D85A30" />
              </Pressable>
            </View>

            {/* Mini cover annonce */}
            {convInfo.annonce_cover_url ? (
              <Pressable
                onPress={() => router.push(`/announce/${convInfo.annonce_id}`)}
                accessibilityLabel="Voir l'annonce"
                className="active:opacity-60"
              >
                <Image
                  source={{ uri: convInfo.annonce_cover_url }}
                  style={{ width: 40, height: 40, borderRadius: 8 }}
                  contentFit="cover"
                  transition={100}
                />
              </Pressable>
            ) : null}
          </View>
        )}

        {/* Menu kebab — actions sur l'autre user (profil / signaler / bloquer).
            Apple Guideline 1.2 UGC : bouton block accessible depuis la conv. */}
        <Pressable
          onPress={onHeaderMenuPress}
          accessibilityRole="button"
          accessibilityLabel="Options de la conversation"
          accessibilityHint="Voir le profil, signaler ou bloquer"
          className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
        >
          <MoreVertical size={20} color="#1A1A1A" />
        </Pressable>
      </View>

      {/* M6 audit : banner discret + retry si refreshConvInfo échoue. Posé
          en silent catch avant — l'user voyait juste des bandeaux RDV stales
          sans savoir que la dernière sync avait échoué. Bouton "Réessayer"
          pour rattraper sans avoir à killer/rouvrir l'app. */}
      {convInfoError && (
        <View className="flex-row items-center bg-niqo-status-en-litige-bg border-b border-niqo-danger/30 px-4 py-2 gap-2">
          <AlertTriangle size={14} color="#E24B4A" />
          <Text className="flex-1 font-body text-micro text-niqo-status-en-litige-text">
            Données pas à jour — connexion lente.
          </Text>
          <Pressable
            onPress={() => void refreshConvInfo()}
            accessibilityRole="button"
            accessibilityLabel="Réessayer la mise à jour"
            hitSlop={8}
            className="flex-row items-center gap-1 active:opacity-60"
          >
            <RefreshCw size={12} color="#E24B4A" />
            <Text className="font-display text-micro text-niqo-danger">
              Réessayer
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Conseils de sécurité (PR1.8) ──────────────────────────────── */}
      {/* Mode Immo : bandeau anti-arnaque immo (titre + tips dédiés) — voir mig 100 */}
      {conversationId && convInfo && (
        <ChatSafetyTips convId={conversationId} isImmo={convInfo.is_immo} />
      )}

      {/* ── Banner RDV (contextuel) ────────────────────────────────────── */}
      {/* Mode Immo : pas de RDV (visites/baux gérés hors plateforme) — voir mig 100 + memory project_immo_no_rdv */}
      {convInfo && !convInfo.is_immo && rdvState === "none" && (
        <Pressable
          onPress={() => setRdvSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Proposer un RDV"
          className="flex-row items-center justify-center bg-niqo-coral/10 border-b border-niqo-coral/20 px-4 py-3 active:opacity-70"
        >
          <CalendarPlus size={16} color="#D85A30" />
          <Text className="ml-2 font-display text-label text-niqo-coral">
            Proposer un RDV
          </Text>
        </Pressable>
      )}

      {convInfo && rdvState === "proposed" && isMyProposal && convInfo.rdv_date && (
        <View className="bg-niqo-gray-50 border-b border-niqo-gray-150 px-4 py-3">
          <View className="flex-row items-center mb-2">
            <Clock size={14} color="#888780" />
            <Text className="ml-1.5 font-body text-micro text-niqo-gray-800">
              En attente de confirmation
            </Text>
          </View>
          <Text className="font-body text-body text-niqo-black" numberOfLines={2}>
            {formatRdvDateTime(convInfo.rdv_date)}
            {convInfo.rdv_lieu ? ` — ${convInfo.rdv_lieu}` : ""}
          </Text>
          <View className="flex-row gap-2 mt-3">
            <Pressable
              onPress={() => setRdvSheetVisible(true)}
              disabled={rdvSubmitting}
              className="flex-1 h-10 items-center justify-center border border-niqo-gray-200 rounded-btn active:opacity-60"
            >
              <Text className="font-body text-label text-niqo-black">
                Modifier
              </Text>
            </Pressable>
            <Pressable
              onPress={handleCancelRdv}
              disabled={rdvSubmitting}
              className="flex-1 h-10 flex-row items-center justify-center border border-niqo-danger/40 rounded-btn active:opacity-60"
            >
              <X size={14} color="#E24B4A" />
              <Text className="ml-1.5 font-body text-label text-niqo-danger">
                Annuler
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {convInfo && rdvState === "proposed" && !isMyProposal && convInfo.rdv_date && (
        <View className="bg-niqo-coral/10 border-b border-niqo-coral/20 px-4 py-3">
          <Text className="font-body text-micro text-niqo-gray-800 mb-1">
            {convInfo.other_prenom} propose un RDV
          </Text>
          <Text className="font-body text-body text-niqo-black" numberOfLines={2}>
            {formatRdvDateTime(convInfo.rdv_date)}
            {convInfo.rdv_lieu ? ` — ${convInfo.rdv_lieu}` : ""}
          </Text>
          <View className="flex-row gap-2 mt-3">
            <Pressable
              onPress={handleCancelRdv}
              disabled={rdvSubmitting}
              className="flex-1 h-10 items-center justify-center border border-niqo-gray-200 rounded-btn active:opacity-60"
            >
              <Text className="font-body text-label text-niqo-black">
                Refuser
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirmRdv}
              disabled={rdvSubmitting}
              className={`flex-1 h-10 flex-row items-center justify-center rounded-btn ${
                rdvSubmitting ? "bg-niqo-gray-200" : "bg-niqo-coral active:opacity-80"
              }`}
            >
              {rdvSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <CalendarCheck size={14} color="#FFFFFF" />
                  <Text className="ml-1.5 font-body text-label text-niqo-white">
                    Confirmer
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {convInfo && rdvState === "confirmed" && convInfo.rdv_date && (
        <View className="bg-niqo-success/10 border-b border-niqo-success/20 px-4 py-3">
          <View className="flex-row items-center mb-1">
            <CalendarCheck size={14} color="#2D8654" />
            <Text className="ml-1.5 font-body text-micro text-niqo-success">
              RDV confirmé
            </Text>
          </View>
          <Text className="font-body text-body text-niqo-black" numberOfLines={2}>
            {formatRdvDateTime(convInfo.rdv_date)}
            {convInfo.rdv_lieu ? ` — ${convInfo.rdv_lieu}` : ""}
          </Text>
          <Pressable
            onPress={handleCancelRdv}
            disabled={rdvSubmitting}
            className="self-start h-9 px-3 flex-row items-center justify-center mt-2 border border-niqo-gray-200 rounded-btn active:opacity-60"
          >
            <Text className="font-body text-label text-niqo-gray-800">
              Annuler le RDV
            </Text>
          </Pressable>
        </View>
      )}

      {convInfo && rdvState === "past" && convInfo.rdv_date && rencontreState && (
        <View
          className={`border-b px-4 py-3 ${
            rencontreState === "met"
              ? "bg-niqo-success/10 border-niqo-success/20"
              : rencontreState === "disputed"
                ? "bg-niqo-warning/10 border-niqo-warning/30"
                : rencontreState === "unconfirmed"
                  ? "bg-niqo-gray-100 border-niqo-gray-200"
                  : "bg-niqo-gray-100 border-niqo-gray-200"
          }`}
        >
          <View className="flex-row items-center mb-1">
            <CalendarCheck
              size={14}
              color={
                rencontreState === "met"
                  ? "#2D8654"
                  : rencontreState === "disputed"
                    ? "#C97A1F"
                    : "#888780"
              }
            />
            <Text
              className={`ml-1.5 font-body text-micro ${
                rencontreState === "met"
                  ? "text-niqo-success"
                  : rencontreState === "disputed"
                    ? "text-niqo-warning"
                    : "text-niqo-gray-800"
              }`}
            >
              RDV passé
            </Text>
          </View>
          <Text className="font-body text-body text-niqo-gray-800" numberOfLines={2}>
            {formatRdvDateTime(convInfo.rdv_date)}
            {convInfo.rdv_lieu ? ` — ${convInfo.rdv_lieu}` : ""}
          </Text>

          {/* ── État pending : 2 boutons "Oui / Non" ──────────────────── */}
          {(rencontreState === "pending" || rencontreState === "unilateral_other") && (
            <>
              <Text className="font-body text-micro text-niqo-gray-800 mt-3 mb-2">
                {rencontreState === "unilateral_other"
                  ? `${convInfo.other_prenom} a déjà répondu. À ton tour : vous êtes-vous vus ?`
                  : "Vous êtes-vous rencontrés ?"}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleConfirmRencontre(true)}
                  disabled={confirmingRencontre}
                  accessibilityRole="button"
                  accessibilityLabel="Oui, on s'est vu"
                  className={`flex-1 h-10 flex-row items-center justify-center rounded-btn ${
                    confirmingRencontre ? "bg-niqo-gray-200" : "bg-niqo-success active:opacity-80"
                  }`}
                >
                  {confirmingRencontre ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="font-display text-label text-niqo-white">
                      Oui, on s'est vu
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => handleConfirmRencontre(false)}
                  disabled={confirmingRencontre}
                  accessibilityRole="button"
                  accessibilityLabel="Non, on ne s'est pas vu"
                  className="flex-1 h-10 flex-row items-center justify-center border border-niqo-gray-200 rounded-btn active:opacity-60"
                >
                  <Text className="font-body text-label text-niqo-gray-800">
                    Non
                  </Text>
                </Pressable>
              </View>

              {/* Mig 88 — Vendeur peut mark_vendue dès que l'acheteur a confirmé */}
              {rencontreState === "unilateral_other" &&
                convInfo.is_vendeur &&
                convInfo.rencontre_acheteur === true &&
                (convInfo.annonce_statut === "active" || convInfo.annonce_statut === "en_cours") && (
                  <Pressable
                    onPress={handleMarkVendue}
                    disabled={markingVendue}
                    accessibilityRole="button"
                    accessibilityLabel="Marquer cette annonce comme vendue"
                    className={`mt-3 self-start h-10 px-4 flex-row items-center justify-center bg-niqo-success rounded-btn ${
                      markingVendue ? "opacity-50" : "active:opacity-80"
                    }`}
                  >
                    {markingVendue ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <PackageCheck size={14} color="#FFFFFF" />
                        <Text className="ml-1.5 font-display text-label text-niqo-white">
                          Marquer vendue
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
            </>
          )}

          {/* ── unilateral_self : moi j'ai répondu, en attente de l'autre ── */}
          {rencontreState === "unilateral_self" && (
            <View className="mt-3 bg-niqo-white rounded-btn px-3 py-2">
              <Text className="font-body text-micro text-niqo-gray-800">
                {(convInfo.is_vendeur ? convInfo.rencontre_vendeur : convInfo.rencontre_acheteur)
                  ? `Tu as confirmé la rencontre. En attente de ${convInfo.other_prenom}.`
                  : `Tu as dit que la rencontre n'a pas eu lieu. En attente de ${convInfo.other_prenom}.`}
              </Text>
            </View>
          )}

          {/* ── met : tout débloqué (Marquer vendue + Noter) ──────────── */}
          {rencontreState === "met" && (
            <View className="flex-row flex-wrap items-center gap-2 mt-3">
              {myAvis ? (
                <View className="flex-row items-center">
                  <Text className="font-body text-micro text-niqo-gray-800 mr-2">
                    Tu as noté {convInfo.other_prenom}
                  </Text>
                  <StarRating value={myAvis.note} size={14} gap={2} />
                </View>
              ) : (
                <Pressable
                  onPress={() => setAvisSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Noter ${convInfo.other_prenom}`}
                  className="h-10 px-4 flex-row items-center justify-center bg-niqo-coral rounded-btn active:opacity-80"
                >
                  <Text className="font-display text-label text-niqo-white">
                    Noter {convInfo.other_prenom}
                  </Text>
                </Pressable>
              )}

              {convInfo.is_vendeur &&
                (convInfo.annonce_statut === "active" || convInfo.annonce_statut === "en_cours") && (
                  <Pressable
                    onPress={handleMarkVendue}
                    disabled={markingVendue}
                    accessibilityRole="button"
                    accessibilityLabel="Marquer cette annonce comme vendue"
                    className={`h-10 px-4 flex-row items-center justify-center bg-niqo-success rounded-btn ${
                      markingVendue ? "opacity-50" : "active:opacity-80"
                    }`}
                  >
                    {markingVendue ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <PackageCheck size={14} color="#FFFFFF" />
                        <Text className="ml-1.5 font-display text-label text-niqo-white">
                          Marquer vendue
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}

              {convInfo.is_vendeur && convInfo.annonce_statut === "vendue" && (
                <View className="flex-row items-center bg-niqo-success/10 rounded-btn h-10 px-3">
                  <PackageCheck size={14} color="#2D8654" />
                  <Text className="ml-1.5 font-body text-micro text-niqo-success">
                    Annonce marquée vendue
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── disputed : désaccord → invitation au signalement (mig 91)
                OU bandeau résolu si admin a déjà tranché (mig 96)
                + verdict perso si caller a signalé (mig 98) ─────────────── */}
          {rencontreState === "disputed" &&
            (convInfo.admin_signalement_decided_at ? (
              <View className="mt-3 bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn px-3 py-2.5">
                <Text className="font-body text-micro text-niqo-gray-800">
                  <Text className="font-medium text-niqo-black">
                    Ce RDV a été examiné par l&apos;équipe Niqo.
                  </Text>{" "}
                  La situation est connue. La notation et la vente restent
                  bloquées sur cette conversation.
                </Text>
                {mySignalement?.has_signalement &&
                  mySignalement.statut !== "en_attente" && (
                    <Text className="font-body text-micro mt-2 pt-2 border-t border-niqo-gray-200/60">
                      <Text
                        className={
                          mySignalement.statut === "traite"
                            ? "text-niqo-success font-medium"
                            : "text-niqo-gray-500 font-medium"
                        }
                      >
                        {mySignalement.statut === "traite"
                          ? "✓ Ton signalement a été validé. "
                          : "✗ Ton signalement a été examiné — non retenu. "}
                      </Text>
                      <Text className="text-niqo-gray-800">
                        Motif : {mySignalement.motif ?? "—"}
                      </Text>
                    </Text>
                  )}
                {mySignalement?.has_signalement &&
                  mySignalement.statut === "en_attente" && (
                    <Text className="font-body text-micro mt-2 pt-2 border-t border-niqo-gray-200/60 text-niqo-coral font-medium">
                      Ton signalement (« {mySignalement.motif} ») est en cours
                      d&apos;examen.
                    </Text>
                  )}
              </View>
            ) : (
              <>
                <Text className="font-body text-micro text-niqo-warning mt-3 mb-2">
                  Vous n&apos;êtes pas d&apos;accord sur la rencontre. La notation
                  et la vente sont bloquées. Si tu penses être victime d&apos;une
                  fraude, signale-le.
                </Text>
                {/* M5 audit : bouton Signaler ce RDV avec fond warning au
                    lieu de juste une bordure légère. C'est l'action critique
                    anti-fraude pour un user qui se sent victime — doit être
                    immédiatement visible. */}
                <Pressable
                  onPress={() => setReportSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Signaler ce RDV"
                  className="self-start h-12 px-4 flex-row items-center justify-center bg-niqo-warning/15 border border-niqo-warning/50 rounded-btn active:opacity-80"
                >
                  <Flag size={16} color="#C97A1F" strokeWidth={2.2} />
                  <Text className="ml-1.5 font-display text-label text-niqo-warning">
                    Signaler ce RDV
                  </Text>
                </Pressable>
              </>
            ))}

          {/* ── unconfirmed : aucune rencontre → annonce remise en vente ── */}
          {rencontreState === "unconfirmed" && (
            <View className="mt-3 bg-niqo-white rounded-btn px-3 py-2">
              <Text className="font-body text-micro text-niqo-gray-800">
                Aucune rencontre confirmée. L'annonce est de retour en vente
                pour les autres acheteurs.
              </Text>
            </View>
          )}

          {/* ── Preuves photo (PR3 — mig 92, durci mig 106) ──────────── */}
          {/* Affiché UNIQUEMENT en état disputed (un Oui, un Non) — c'est
              le seul cas où des preuves photo ont du poids juridique pour
              la modération. En pending/unilateral/met/unconfirmed, le block
              est masqué : pas de litige actif → pas besoin de pollution
              storage. La RPC add_rencontre_photo (mig 106) gate aussi
              côté serveur en defense in depth.
              Verrouillé si admin a tranché un signalement post-RDV (mig 96/102). */}
          {conversationId && rencontreState === "disputed" && (
            <RencontrePhotosBlock
              conversationId={conversationId}
              locked={!!convInfo?.admin_signalement_decided_at}
            />
          )}
        </View>
      )}

      {/* ── Messages list (inverted) ───────────────────────────────────── */}
      <KeyboardAvoidingView
        // Android : "height" force le KAV à remonter le contenu (sans ça l'input
        // est masqué par le clavier avec edgeToEdgeEnabled: true Android 15+).
        // iOS : "padding" classique, ajoute du padding-bottom = hauteur clavier.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          inverted
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 8,
          }}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View className="py-3 items-center">
                <ActivityIndicator size="small" color="#888780" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              {loading ? (
                <ActivityIndicator size="small" color="#888780" />
              ) : (
                <Text className="font-body text-body text-niqo-gray-500 text-center">
                  Envoie un premier message !
                </Text>
              )}
            </View>
          }
          renderItem={({ item, index }) => {
            const isMine = item.expediteur_id === userId;
            const isOptimistic = item.id.startsWith("optimistic-");
            const prevMsg = messages[index - 1]; // message plus récent (inversé)
            const nextMsg = messages[index + 1]; // message plus ancien (inversé)

            // Date separator
            const showDateSep = !nextMsg || !isSameDay(item.created_at, nextMsg.created_at);

            // ── Message système (RDV) — rendu centré, pas de bulle ─────
            if (item.type === "systeme") {
              return (
                <View>
                  {showDateSep && (
                    <View className="items-center py-4">
                      <View className="bg-niqo-white rounded-full px-4 py-1.5 shadow-card">
                        <Text className="font-body text-micro text-niqo-gray-800">
                          {formatDateSeparator(item.created_at)}
                        </Text>
                      </View>
                    </View>
                  )}
                  <View className="items-center my-2 px-4">
                    <View className="bg-niqo-coral/10 rounded-full px-3 py-1.5">
                      <Text className="font-body text-micro text-niqo-coral text-center">
                        {item.contenu}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            }

            // Groupage : masquer l'avatar si le msg précédent est du même sender
            const showAvatar = !isMine && !isSameSender(prevMsg, item);
            // Dernier msg d'un groupe → espacement plus grand
            const isLastInGroup = !isSameSender(item, nextMsg ?? ({} as Message));

            return (
              <View>
                {showDateSep && (
                  <View className="items-center py-4">
                    <View className="bg-niqo-white rounded-full px-4 py-1.5 shadow-card">
                      <Text className="font-body text-micro text-niqo-gray-800">
                        {formatDateSeparator(item.created_at)}
                      </Text>
                    </View>
                  </View>
                )}

                <View
                  className={`flex-row ${isMine ? "justify-end" : "justify-start"} ${
                    isLastInGroup ? "mb-3" : "mb-1"
                  }`}
                >
                  {/* Avatar de l'interlocuteur (groupé) */}
                  {!isMine && (
                    <View className="w-8 mr-2">
                      {showAvatar && convInfo?.other_avatar_url ? (
                        <Image
                          source={{ uri: convInfo.other_avatar_url }}
                          style={{ width: 28, height: 28, borderRadius: 14 }}
                          contentFit="cover"
                        />
                      ) : showAvatar ? (
                        <View className="w-7 h-7 rounded-full bg-niqo-gray-200 items-center justify-center">
                          <User size={14} color="#888780" />
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Bulle — long-press = menu contextuel inline */}
                  <Pressable
                    className="max-w-[75%]"
                    onLongPress={
                      !isOptimistic
                        ? () => setSelectedMsgId(selectedMsgId === item.id ? null : item.id)
                        : undefined
                    }
                    onPress={
                      selectedMsgId ? () => setSelectedMsgId(null) : undefined
                    }
                    delayLongPress={400}
                  >
                    <View
                      className={`px-4 py-2.5 ${
                        isMine
                          ? selectedMsgId === item.id
                            ? "bg-niqo-gray-800 rounded-2xl rounded-br-md"
                            : "bg-niqo-black rounded-2xl rounded-br-md"
                          : selectedMsgId === item.id
                            ? "bg-niqo-gray-200 rounded-2xl rounded-bl-md"
                            : "bg-niqo-white rounded-2xl rounded-bl-md"
                      }`}
                      style={
                        isMine
                          ? undefined
                          : selectedMsgId !== item.id
                            ? {
                                shadowColor: "#000",
                                shadowOffset: { width: 0, height: 1 },
                                shadowOpacity: 0.04,
                                shadowRadius: 3,
                                elevation: 1,
                              }
                            : undefined
                      }
                    >
                      <Text
                        className={`font-body text-body leading-relaxed ${
                          isMine ? "text-niqo-white" : "text-niqo-black"
                        }`}
                      >
                        {item.contenu}
                      </Text>
                    </View>

                    {/* Menu contextuel inline — visible après long-press.
                        hitSlop universel pour atteindre 44px touch effectif
                        (pills h ~28px en visuel, M3 audit). Flash "Copié !"
                        1.2s au lieu d'un toast global (M4). */}
                    {selectedMsgId === item.id && (
                      <View
                        className={`flex-row gap-1 mt-1 ${
                          isMine ? "justify-end" : "justify-start"
                        }`}
                      >
                        {/* Copier — bascule en "Copié !" pendant 1.2s avec
                            check vert, puis ferme le menu. */}
                        <Pressable
                          onPress={() => {
                            const wasCopied = copiedMsgId === item.id;
                            if (wasCopied) return;
                            void Clipboard.setStringAsync(item.contenu);
                            setCopiedMsgId(item.id);
                            setTimeout(() => {
                              setCopiedMsgId(null);
                              setSelectedMsgId((prev) =>
                                prev === item.id ? null : prev
                              );
                            }, 1200);
                          }}
                          accessibilityLabel={
                            copiedMsgId === item.id
                              ? "Message copié"
                              : "Copier le message"
                          }
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          className={`flex-row items-center rounded-full px-3 py-1.5 active:opacity-60 ${
                            copiedMsgId === item.id
                              ? "bg-niqo-success/10 border border-niqo-success/40"
                              : "bg-niqo-white border border-niqo-gray-200"
                          }`}
                        >
                          {copiedMsgId === item.id ? (
                            <Check size={12} color="#1D9E75" strokeWidth={2.6} />
                          ) : (
                            <Copy size={12} color="#444441" />
                          )}
                          <Text
                            className={`ml-1.5 font-body text-micro ${
                              copiedMsgId === item.id
                                ? "text-niqo-success font-medium"
                                : "text-niqo-gray-800"
                            }`}
                          >
                            {copiedMsgId === item.id ? "Copié !" : "Copier"}
                          </Text>
                        </Pressable>

                        {/* Signaler — uniquement sur les messages reçus */}
                        {!isMine && (
                          <Pressable
                            onPress={() => {
                              setSelectedMsgId(null);
                              Alert.alert(
                                "Signaler ce message",
                                "Pourquoi ?",
                                [
                                  ...MOTIFS_PAR_CIBLE.message.map((motif) => ({
                                    text: motif,
                                    onPress: () => {
                                      void submitReport("message", item.id, motif).then((r) => {
                                        Alert.alert(
                                          r.success ? "Merci" : "Impossible",
                                          r.success
                                            ? "Ton signalement a été envoyé."
                                            : r.error ?? "Réessaie."
                                        );
                                      });
                                    },
                                  })),
                                  { text: "Annuler", style: "cancel" as const },
                                ]
                              );
                            }}
                            accessibilityLabel="Signaler le message"
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            className="flex-row items-center bg-niqo-white border border-niqo-gray-200 rounded-full px-3 py-1.5 active:opacity-60"
                          >
                            <Flag size={12} color="#E24B4A" />
                            <Text className="ml-1.5 font-body text-micro text-niqo-danger">
                              Signaler
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}

                    {/* Timestamp — affiché uniquement sur le dernier msg du groupe */}
                    {isLastInGroup && selectedMsgId !== item.id && (
                      <Text
                        className={`font-body text-2xs text-niqo-gray-500 mt-1 ${
                          isMine ? "text-right mr-1" : "text-left ml-1"
                        }`}
                      >
                        {formatTime(item.created_at)}
                        {isOptimistic ? " · envoi…" : ""}
                      </Text>
                    )}

                    {/* Indicateur "Vu" — uniquement sur le dernier msg envoyé par
                        l'user qui est confirmé lu (style iMessage/WhatsApp) */}
                    {isMine && index === lastReadSentIdx && (
                      <Text className="font-body text-micro text-niqo-gray-500 mt-0.5 text-right mr-1">
                        Vu
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          }}
        />

        {/* ── Erreur envoi ───────────────────────────────────────────── */}
        {sendError && (
          <View className="mx-3 mb-1 bg-niqo-status-en-litige-bg rounded-btn px-3 py-2">
            <Text className="font-body text-micro text-niqo-status-en-litige-text text-center">
              Message non envoyé. Vérifie ta connexion et réessaie.
            </Text>
          </View>
        )}

        {/* ── Input bar ────────────────────────────────────────────────── */}
        <View
          className="flex-row items-end px-3 pt-2 bg-niqo-white border-t border-niqo-gray-100"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder="Écrire un message…"
            placeholderTextColor="#888780"
            multiline
            maxLength={2000}
            accessibilityLabel="Message"
            className="flex-1 bg-niqo-gray-50 rounded-3xl px-4 py-3 mr-2 font-body text-body text-niqo-black"
            style={{ maxHeight: 100, minHeight: 44 }}
          />
          <Pressable
            onPress={onSend}
            disabled={!input.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Envoyer"
            className={`w-11 h-11 rounded-full items-center justify-center mb-0.5 ${
              input.trim() && !sending
                ? "bg-niqo-black active:opacity-80"
                : "bg-niqo-gray-200"
            }`}
          >
            <SendHorizontal
              size={18}
              color={input.trim() && !sending ? "#FFFFFF" : "#888780"}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* ── Sheet : proposer / re-proposer un RDV ──────────────────────── */}
      {conversationId && (
        <RdvProposeSheet
          visible={rdvSheetVisible}
          conversationId={conversationId}
          initialLieu={
            isMyProposal && convInfo?.rdv_lieu ? convInfo.rdv_lieu : undefined
          }
          initialDate={
            isMyProposal && convInfo?.rdv_date
              ? new Date(convInfo.rdv_date)
              : undefined
          }
          onClose={() => setRdvSheetVisible(false)}
          onProposed={() => void refreshConvInfo()}
        />
      )}

      {/* ── Sheet : noter l'autre partie après RDV passé ───────────────── */}
      {conversationId && convInfo && (
        <AvisSubmitSheet
          visible={avisSheetVisible}
          conversationId={conversationId}
          cibleName={convInfo.other_prenom}
          onClose={() => setAvisSheetVisible(false)}
          onSubmitted={() => refreshMyAvis()}
        />
      )}

      {/* ── Sheet : signaler le RDV (mig 91, état disputed) ────────────── */}
      {conversationId && (
        <RdvReportSheet
          visible={reportSheetVisible}
          conversationId={conversationId}
          onClose={() => setReportSheetVisible(false)}
          onSubmitted={() => {
            // Pas d'action particulière — l'user reçoit la confirmation Alert
            // côté RdvReportSheet et le bandeau disputed reste affiché.
          }}
        />
      )}

      {/* ── Sheet : bloquer l'autre user (Apple Guideline 1.2 UGC, mig 129) */}
      {otherUserId && (
        <BlockUserSheet
          visible={blockSheetVisible}
          targetUserId={otherUserId}
          targetPrenom={otherPrenom}
          onClose={() => setBlockSheetVisible(false)}
          onBlocked={() => void refreshBlocked()}
        />
      )}
    </View>
  );
}

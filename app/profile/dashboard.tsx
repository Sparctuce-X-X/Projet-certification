import { Stack, useRouter } from "expo-router";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  Package,
  ShoppingBag,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchMyDashboardStats, type DashboardStats } from "@/lib/dashboard";
import { useAuth } from "@/lib/auth/AuthProvider";
import { MIN_ACHATS_FOR_NOTE, MIN_VENTES_FOR_NOTE } from "@/lib/users";

/**
 * Dashboard vendeur — vue d'ensemble des stats du compte.
 *
 * 1 RPC agrégée (mig 58 `get_my_dashboard_stats`) → 1 round-trip.
 * Pull-to-refresh manuel + skeleton loading sur le 1er fetch.
 *
 * Layout (validé via skill ui-ux-pro-max) :
 *   1. Hero "Vues totales" — méga chiffre coral (le hook qui motive)
 *   2. Bento KPIs 2×2 (Conv / Annonces / RDV / Ventes)
 *   3. Stacked bar Annonces breakdown
 *   4. Notes vendeur + acheteur (étoiles)
 *   5. Alertes conditionnelles (suspendu / score abus / signalements)
 *   6. CTAs (Booster F09 disabled + Voir mes annonces + Voir messages)
 *
 * Empty state : si 0 annonces → grande card centrée avec CTA "Vendre".
 */
export default function DashboardScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchMyDashboardStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // useAuth() expose `profile`, pas `user` — cf. AuthProvider. L'ancien
  // code lisait `user.user_metadata.prenom` (silencieusement undefined →
  // hero affichait "Bonjour —"). Le profile vient de la table public.users
  // hydratée à l'auth, prenom y est garanti non-null.
  const prenom = profile?.prenom ?? "";

  if (loading) {
    return (
      <View
        className="flex-1 bg-niqo-gray-50"
        style={{ paddingTop: insets.top }}
      >
        <Stack.Screen
          options={{
            title: "Dashboard",
            headerShown: true,
            headerStyle: { backgroundColor: "#FAFAFA" },
            headerTitleStyle: { fontFamily: "SpaceGrotesk-Bold" },
          }}
        />
        <DashboardSkeleton />
      </View>
    );
  }

  if (error || !stats) {
    return (
      <View
        className="flex-1 bg-niqo-gray-50 items-center justify-center px-6"
        style={{ paddingTop: insets.top }}
      >
        <Stack.Screen options={{ title: "Dashboard" }} />
        <AlertCircle size={40} color="#E24B4A" strokeWidth={1.8} />
        <Text className="font-display text-h3 text-niqo-black mt-3 text-center">
          Impossible de charger
        </Text>
        <Text className="font-body text-body text-niqo-gray-800 text-center mt-1">
          {error ?? "Réessaie dans un instant."}
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load().finally(() => setLoading(false));
          }}
          className="mt-5 px-5 py-3 bg-niqo-coral rounded-btn active:opacity-80"
        >
          <Text className="font-body text-label text-niqo-white">Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  const isEmpty = stats.annonces.total === 0;

  return (
    <View className="flex-1 bg-niqo-gray-50">
      <Stack.Screen
        options={{
          title: "Dashboard",
          headerShown: true,
          headerStyle: { backgroundColor: "#FAFAFA" },
          headerTitleStyle: { fontFamily: "SpaceGrotesk-Bold", color: "#1A1A1A" },
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D85A30"
          />
        }
      >
        {isEmpty ? (
          <DashboardEmpty prenom={prenom} onCtaPress={() => router.push("/sell")} />
        ) : (
          <>
            <DashboardHero prenom={prenom} vuesTotal={stats.vues_total} />
            <DashboardKpiBento
              stats={stats}
              onConvPress={() => router.push("/messages")}
              onAnnoncesPress={() => router.push("/profile/announces")}
            />
            <DashboardAnnoncesBar
              data={stats.annonces}
              onPress={() => router.push("/profile/announces")}
            />
            <DashboardNotes
              noteVendeur={stats.profile.note_vendeur}
              noteAcheteur={stats.profile.note_acheteur}
              nbVentes={stats.profile.nb_ventes}
              nbAchats={stats.profile.nb_achats}
            />
            <DashboardAlerts profile={stats.profile} />
            <DashboardCtas
              onBoostPress={() => router.push("/profile/announces")}
              onAnnoncesPress={() => router.push("/profile/announces")}
              onMessagesPress={() => router.push("/messages")}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function DashboardHero({
  prenom,
  vuesTotal,
}: {
  prenom: string;
  vuesTotal: number;
}) {
  return (
    <View className="bg-niqo-coral-light rounded-3xl px-6 py-7 mb-3">
      <Text className="font-display text-h3 text-niqo-black mb-3">
        Bonjour {prenom || "—"}
        <Text className="text-niqo-coral">.</Text>
      </Text>
      <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wider mb-1.5">
        Vues totales sur tes annonces
      </Text>
      <View className="flex-row items-baseline gap-2">
        <Text
          className="font-mono text-niqo-coral"
          style={{ fontSize: 56, lineHeight: 60 }}
          allowFontScaling={false}
        >
          {vuesTotal.toLocaleString("fr-FR")}
        </Text>
        <TrendingUp size={20} color="#D85A30" strokeWidth={2.4} />
      </View>
    </View>
  );
}

// ── KPI Bento 2x2 ────────────────────────────────────────────────────────────

function DashboardKpiBento({
  stats,
  onConvPress,
  onAnnoncesPress,
}: {
  stats: DashboardStats;
  onConvPress: () => void;
  onAnnoncesPress: () => void;
}) {
  return (
    <View className="gap-3 mb-3">
      <View className="flex-row gap-3">
        <KpiCard
          icon={<MessageCircle size={18} color="#D85A30" strokeWidth={2.2} />}
          label="Conversations"
          value={stats.conversations.total.toString()}
          subText={
            stats.conversations.unread > 0
              ? `${stats.conversations.unread} non lus`
              : "tout est lu"
          }
          subTextAlert={stats.conversations.unread > 0}
          onPress={onConvPress}
        />
        <KpiCard
          icon={<Package size={18} color="#D85A30" strokeWidth={2.2} />}
          label="Annonces"
          value={`${stats.annonces.active}/${stats.annonces.total}`}
          subText={
            stats.annonces.boosted > 0
              ? `✨ ${stats.annonces.boosted} boostée${stats.annonces.boosted > 1 ? "s" : ""}`
              : "actives"
          }
          subTextAlert={stats.annonces.boosted > 0}
          onPress={onAnnoncesPress}
        />
      </View>
      <View className="flex-row gap-3">
        <KpiCard
          icon={<Calendar size={18} color="#D85A30" strokeWidth={2.2} />}
          label="RDV à venir"
          value={stats.rdv.confirmed_upcoming.toString()}
          subText={
            stats.rdv.proposed > 0
              ? `${stats.rdv.proposed} proposés`
              : "rien en attente"
          }
        />
        <KpiCard
          icon={<CheckCircle2 size={18} color="#1D9E75" strokeWidth={2.2} />}
          label="Annonces vendues"
          value={stats.annonces.vendue.toString()}
          subText={
            stats.profile.nb_ventes > 0
              ? `${stats.profile.nb_ventes} avis reçus`
              : "aucun avis"
          }
          accentSuccess
        />
      </View>
    </View>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subText,
  subTextAlert,
  accentSuccess,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subText: string;
  subTextAlert?: boolean;
  accentSuccess?: boolean;
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      className={`flex-1 bg-niqo-white rounded-2xl p-4 border border-niqo-gray-100 ${
        onPress ? "active:opacity-80" : ""
      }`}
    >
      <View
        className={`w-8 h-8 rounded-lg items-center justify-center mb-3 ${
          accentSuccess ? "bg-niqo-success/10" : "bg-niqo-coral-light"
        }`}
      >
        {icon}
      </View>
      <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wider">
        {label}
      </Text>
      <Text
        className={`font-mono text-h2 mt-1 ${
          accentSuccess ? "text-niqo-success" : "text-niqo-black"
        }`}
        allowFontScaling={false}
      >
        {value}
      </Text>
      <Text
        className={`font-body text-micro mt-0.5 ${
          subTextAlert ? "text-niqo-coral font-medium" : "text-niqo-gray-500"
        }`}
      >
        {subText}
      </Text>
    </Container>
  );
}

// ── Stacked bar Annonces ─────────────────────────────────────────────────────

function DashboardAnnoncesBar({
  data,
  onPress,
}: {
  data: DashboardStats["annonces"];
  onPress: () => void;
}) {
  const segments = [
    { key: "active", label: "active", value: data.active, color: "bg-niqo-success" },
    { key: "en_cours", label: "en cours", value: data.en_cours, color: "bg-niqo-coral-light" },
    { key: "vendue", label: "vendue", value: data.vendue, color: "bg-niqo-coral" },
    { key: "expiree", label: "expirée", value: data.expiree, color: "bg-niqo-gray-200" },
    { key: "suspendue", label: "suspendue", value: data.suspendue, color: "bg-niqo-danger" },
  ].filter((s) => s.value > 0);

  const dotColors: Record<string, string> = {
    active: "bg-niqo-success",
    en_cours: "bg-niqo-coral-light",
    vendue: "bg-niqo-coral",
    expiree: "bg-niqo-gray-200",
    suspendue: "bg-niqo-danger",
  };

  const total = data.total || 1; // avoid div by zero

  return (
    <Pressable
      onPress={onPress}
      className="bg-niqo-white rounded-2xl p-5 border border-niqo-gray-100 mb-3 active:opacity-80"
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-display text-label text-niqo-black">
          Mes annonces ({data.total})
        </Text>
        <ChevronRight size={18} color="#888780" strokeWidth={2.2} />
      </View>

      {/* Stacked bar */}
      <View className="flex-row h-2 rounded-full overflow-hidden bg-niqo-gray-100">
        {segments.map((s) => (
          <View
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </View>

      {/* Légende — n'affiche que les statuts > 0 */}
      <View className="flex-row flex-wrap gap-x-3 gap-y-1.5 mt-3">
        {segments.map((s) => (
          <View key={s.key} className="flex-row items-center gap-1.5">
            <View className={`w-2 h-2 rounded-full ${dotColors[s.key]}`} />
            <Text className="font-body text-micro text-niqo-gray-800">
              {s.label} <Text className="font-mono text-niqo-black">{s.value}</Text>
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

// ── Notes vendeur + acheteur ─────────────────────────────────────────────────

function DashboardNotes({
  noteVendeur,
  noteAcheteur,
  nbVentes,
  nbAchats,
}: {
  noteVendeur: number;
  noteAcheteur: number;
  nbVentes: number;
  nbAchats: number;
}) {
  return (
    <View className="flex-row gap-3 mb-3">
      <NoteCard
        label="Vendeur"
        score={noteVendeur}
        nbActions={nbVentes}
        actionLabel="ventes"
        minActions={MIN_VENTES_FOR_NOTE}
      />
      <NoteCard
        label="Acheteur"
        score={noteAcheteur}
        nbActions={nbAchats}
        actionLabel="achats"
        minActions={MIN_ACHATS_FOR_NOTE}
      />
    </View>
  );
}

function NoteCard({
  label,
  score,
  nbActions,
  actionLabel,
  minActions,
}: {
  label: string;
  score: number;
  nbActions: number;
  actionLabel: string;
  /** Note pas affichée tant que nbActions < minActions (anti-fraude amis-pour-amis,
   *  cohérent avec /u/[id] et /profile). En dessous, on montre une invitation
   *  "X ventes restantes pour débloquer ta note" plus motivante. */
  minActions: number;
}) {
  const hasNote = nbActions >= minActions && score > 0;
  const filled = Math.round(score);

  return (
    <View className="flex-1 bg-niqo-white rounded-2xl p-4 border border-niqo-gray-100">
      <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wider mb-1.5">
        Note {label}
      </Text>
      {hasNote ? (
        <>
          <View className="flex-row gap-0.5 mb-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                size={14}
                color={i <= filled ? "#D85A30" : "#E5E5E5"}
                fill={i <= filled ? "#D85A30" : "transparent"}
                strokeWidth={2}
              />
            ))}
          </View>
          <Text
            className="font-mono text-h3 text-niqo-black"
            allowFontScaling={false}
          >
            {score.toFixed(1)} / 5
          </Text>
          <Text className="font-body text-micro text-niqo-gray-500 mt-0.5">
            sur {nbActions} {actionLabel}
          </Text>
        </>
      ) : (
        <>
          <Text className="font-body text-caption text-niqo-gray-500 italic mt-1.5">
            Pas encore de note
          </Text>
          <Text className="font-body text-micro text-niqo-gray-500 mt-0.5">
            {nbActions === 0
              ? `Termine ton 1er RDV`
              : `${minActions - nbActions} ${actionLabel} restante${
                  minActions - nbActions > 1 ? "s" : ""
                } pour débloquer`}
          </Text>
        </>
      )}
    </View>
  );
}

// ── Alertes conditionnelles ──────────────────────────────────────────────────

function DashboardAlerts({
  profile,
}: {
  profile: DashboardStats["profile"];
}) {
  const alerts: { tone: "danger" | "warn"; text: string; icon: React.ReactNode }[] = [];

  if (!profile.is_active) {
    alerts.push({
      tone: "danger",
      text: "Compte suspendu — contacte le support pour le réactiver.",
      icon: <AlertCircle size={16} color="#E24B4A" strokeWidth={2.4} />,
    });
  } else {
    if (profile.score_abus >= 1) {
      alerts.push({
        tone: profile.score_abus >= 2 ? "danger" : "warn",
        text: `Score d'abus ${profile.score_abus}/3 — suspension auto à 3 confirmés en 30j.`,
        icon: <AlertTriangle size={16} color="#D85A30" strokeWidth={2.4} />,
      });
    }
    if (profile.nb_signalements >= 1) {
      alerts.push({
        tone: "warn",
        text: `${profile.nb_signalements} signalement${profile.nb_signalements > 1 ? "s" : ""} confirmé${profile.nb_signalements > 1 ? "s" : ""} sur ton compte.`,
        icon: <AlertCircle size={16} color="#D85A30" strokeWidth={2.4} />,
      });
    }
  }

  if (alerts.length === 0) return null;

  return (
    <View className="mb-3 gap-2">
      {alerts.map((a, i) => (
        <View
          key={i}
          className={`flex-row items-start gap-2.5 rounded-xl p-3.5 border ${
            a.tone === "danger"
              ? "bg-niqo-danger/5 border-niqo-danger/30"
              : "bg-niqo-coral/5 border-niqo-coral/30"
          }`}
        >
          <View className="mt-0.5">{a.icon}</View>
          <Text
            className={`flex-1 font-body text-caption leading-relaxed ${
              a.tone === "danger" ? "text-niqo-danger" : "text-niqo-gray-800"
            }`}
          >
            {a.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── CTAs en pied ─────────────────────────────────────────────────────────────

function DashboardCtas({
  onBoostPress,
  onAnnoncesPress,
  onMessagesPress,
}: {
  onBoostPress: () => void;
  onAnnoncesPress: () => void;
  onMessagesPress: () => void;
}) {
  return (
    <View className="gap-2 mt-3">
      {/* Boost — F09 actif : redirige vers Mes annonces où l'user choisit */}
      <Pressable
        onPress={onBoostPress}
        className="flex-row items-center gap-3 bg-niqo-coral-light rounded-2xl p-4 active:opacity-80"
      >
        <View className="w-9 h-9 rounded-lg bg-niqo-coral items-center justify-center">
          <Zap size={18} color="#FFFFFF" strokeWidth={2.2} />
        </View>
        <View className="flex-1">
          <Text className="font-display text-label text-niqo-black">
            Choisir une annonce à booster
          </Text>
          <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
            Apparais en premier · à partir de 1 000 FCFA / 7j
          </Text>
        </View>
        <ChevronRight size={18} color="#D85A30" strokeWidth={2.2} />
      </Pressable>

      {/* Liens secondaires */}
      <Pressable
        onPress={onAnnoncesPress}
        className="flex-row items-center gap-3 bg-niqo-white rounded-2xl p-4 border border-niqo-gray-100 active:opacity-80"
      >
        <View className="w-9 h-9 rounded-lg bg-niqo-gray-50 items-center justify-center">
          <Package size={18} color="#1A1A1A" strokeWidth={2.2} />
        </View>
        <Text className="flex-1 font-body text-label text-niqo-black">
          Voir mes annonces
        </Text>
        <ChevronRight size={18} color="#888780" strokeWidth={2.2} />
      </Pressable>

      <Pressable
        onPress={onMessagesPress}
        className="flex-row items-center gap-3 bg-niqo-white rounded-2xl p-4 border border-niqo-gray-100 active:opacity-80"
      >
        <View className="w-9 h-9 rounded-lg bg-niqo-gray-50 items-center justify-center">
          <MessageCircle size={18} color="#1A1A1A" strokeWidth={2.2} />
        </View>
        <Text className="flex-1 font-body text-label text-niqo-black">
          Voir mes messages
        </Text>
        <ChevronRight size={18} color="#888780" strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

// ── Empty state — nouveau vendeur 0 annonces ─────────────────────────────────

function DashboardEmpty({
  prenom,
  onCtaPress,
}: {
  prenom: string;
  onCtaPress: () => void;
}) {
  return (
    <View className="bg-niqo-coral-light rounded-3xl px-6 py-10 items-center">
      <View className="w-16 h-16 rounded-full bg-niqo-coral items-center justify-center mb-5">
        <Package size={32} color="#FFFFFF" strokeWidth={2} />
      </View>
      <Text className="font-display text-h2 text-niqo-black text-center mb-2">
        Ton dashboard se réveille{prenom ? `, ${prenom}` : ""}
        <Text className="text-niqo-coral">.</Text>
      </Text>
      <Text className="font-body text-body text-niqo-gray-800 text-center leading-relaxed mb-6">
        Publie ta 1ère annonce pour voir tes vues, conversations et ventes
        apparaître ici.
      </Text>
      <Pressable
        onPress={onCtaPress}
        className="flex-row items-center gap-2 bg-niqo-coral rounded-btn px-6 py-3.5 active:opacity-80"
      >
        <ShoppingBag size={18} color="#FFFFFF" strokeWidth={2.4} />
        <Text className="font-body text-label text-niqo-white">
          Vendre quelque chose
        </Text>
      </Pressable>
    </View>
  );
}

// ── Skeleton loader ──────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <View className="p-4 gap-3">
      <View className="bg-niqo-gray-100 rounded-3xl h-36" />
      <View className="flex-row gap-3">
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
      </View>
      <View className="bg-niqo-gray-100 rounded-2xl h-24" />
      <View className="flex-row gap-3">
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
        <View className="flex-1 bg-niqo-gray-100 rounded-2xl h-28" />
      </View>
    </View>
  );
}

import { useFocusEffect } from "@react-navigation/native";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Heart,
  HelpCircle,
  LogOut,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  ShieldCheck,
  ShieldOff,
  ShoppingBag,
  ShoppingCart,
  Star,
  Tag,
  ThumbsUp,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VerifPendingBanner } from "@/components/verification/VerifPendingBanner";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatPhoneDisplay } from "@/lib/phone";
import { deleteMyAccount, getMyPhone, supabase } from "@/lib/supabase";
import {
  isTrustedSeller,
  MIN_ACHATS_FOR_NOTE,
  MIN_VENTES_FOR_NOTE,
} from "@/lib/users";

const COUNTRY_LABELS: Record<"CI" | "CG", string> = {
  CI: "Côte d'Ivoire",
  CG: "Congo Brazzaville",
};

const SUPPORT_EMAIL = "support@niqo.africa";

interface StatCardProps {
  Icon: LucideIcon;
  label: string;
  value: string;
}

function StatCard({ Icon, label, value }: StatCardProps) {
  return (
    <View className="flex-1 min-w-[45%] bg-niqo-gray-50 rounded-card py-4 px-3 items-center">
      <Icon size={20} color="#D85A30" />
      <Text
        className="mt-2 font-mono text-h3 text-niqo-black"
        allowFontScaling={false}
      >
        {value}
      </Text>
      <Text className="font-body text-micro text-niqo-gray-500 text-center">
        {label}
      </Text>
    </View>
  );
}

interface MenuRowProps {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
  badge?: string;
  destructive?: boolean;
}

function MenuRow({
  Icon,
  label,
  onPress,
  badge,
  destructive,
}: MenuRowProps) {
  const iconColor = destructive ? "#E24B4A" : "#444441";
  const textClass = destructive ? "text-niqo-danger" : "text-niqo-black";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center px-4 min-h-[56px] active:opacity-60"
    >
      <Icon size={20} color={iconColor} />
      <Text className={`ml-3 flex-1 font-body text-body ${textClass}`}>
        {label}
      </Text>
      {badge && (
        <View className="bg-niqo-gray-100 rounded-full px-2 py-0.5 mr-2">
          <Text
            className="font-body text-2xs text-niqo-gray-800"
            allowFontScaling={false}
          >
            {badge}
          </Text>
        </View>
      )}
      <ChevronRight size={18} color="#888780" />
    </Pressable>
  );
}

function MenuDivider() {
  return <View className="h-px bg-niqo-gray-150 ml-12" />;
}

/**
 * Format relatif "il y a X" en français — ex: "aujourd'hui", "3 jours",
 * "2 semaines", "5 mois", "1 an". Utilisé pour "Membre depuis…" — plus
 * parlant qu'un mois absolu, surtout sur compte récent.
 */
function formatMemberSince(createdAt: string): string {
  const days = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  );
  if (days < 1) return "aujourd'hui";
  if (days < 2) return "hier";
  if (days < 7) return `${days} jours`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 semaine" : `${weeks} semaines`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 mois" : `${months} mois`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 an" : `${years} ans`;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, signOut, isLoading, isAuthenticated, refreshProfile } =
    useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  // `auth.users.new_email` est non-null tant que le lien de confirmation
  // n'a pas été cliqué après un changement d'email. On l'affiche dans un
  // banner pour que l'user n'oublie pas l'action en attente.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Pull-to-refresh : refetch profil + téléphone + new_email en parallèle.
  // Erreurs swallowed — si le réseau plombe, l'écran garde les données déjà
  // affichées et l'user peut retry. Pas d'Alert pour ne pas être agressif.
  const onRefresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshProfile(),
        getMyPhone().then(setPhone),
        supabase.auth.getUser().then(({ data }) => {
          const newEmail = (data.user as { new_email?: string } | null)
            ?.new_email;
          setPendingEmail(newEmail ?? null);
        }),
      ]);
    } catch {
      // Silent — données précédentes conservées, retry possible
    } finally {
      setRefreshing(false);
    }
  }, [isAuthenticated, refreshProfile]);

  // Defensive — should never render this screen without auth, but guard
  // against direct deep-link / dev navigation.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/home");
    }
  }, [isLoading, isAuthenticated]);

  // Fetch en parallèle au focus : téléphone déchiffré (RPC, bytea pas exposé
  // en REST) + email en attente de confirmation (auth.users.new_email).
  // useFocusEffect re-run après retour de /profile/edit, donc une demande
  // de changement d'email freshly émise est reflétée immédiatement.
  // Re-fetch téléphone + pending email À CHAQUE focus (retour de /profile/edit,
  // switch d'app, etc.). Le callback ne doit PAS avoir de deps fixes sinon
  // useFocusEffect ne le relance pas (même ref = skip).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setPhone(null);
        setPendingEmail(null);
        return;
      }
      let cancelled = false;
      void Promise.all([getMyPhone(), supabase.auth.getUser()]).then(
        ([p, { data }]) => {
          if (cancelled) return;
          setPhone(p);
          const newEmail = (data.user as { new_email?: string } | null)
            ?.new_email;
          setPendingEmail(newEmail ?? null);
        }
      );
      return () => {
        cancelled = true;
      };
    }, []) // deps vides intentionnel — on veut re-run à CHAQUE focus
  );

  if (!profile) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white"
      />
    );
  }

  const initials = (profile.prenom[0] ?? "U") + (profile.nom[0] ?? "");
  const memberSince = formatMemberSince(profile.created_at);
  const countryLabel = COUNTRY_LABELS[profile.pays];

  function handleSignOut() {
    Alert.alert(
      "Se déconnecter ?",
      "Tu pourras te reconnecter à tout moment.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Se déconnecter",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await signOut();
              router.replace("/home");
            })();
          },
        },
      ]
    );
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Supprimer ton compte ?",
      "Cette action est définitive. Toutes tes données (profil, téléphone, historique) seront supprimées immédiatement et de manière irréversible.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Continuer",
          style: "destructive",
          onPress: confirmDeleteAccount,
        },
      ]
    );
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Dernière confirmation",
      "Es-tu absolument sûr ? Aucune récupération ne sera possible.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer définitivement",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteMyAccount();
                await signOut();
                router.replace("/home");
              } catch {
                Alert.alert(
                  "Erreur",
                  "La suppression a échoué. Vérifie ta connexion et réessaie."
                );
              }
            })();
          },
        },
      ]
    );
  }

  function openSupport() {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
      Alert.alert("Aide & support", `Écris-nous à ${SUPPORT_EMAIL}`);
    });
  }

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="flex-1 bg-niqo-white"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="bg-niqo-white border-b border-niqo-gray-150 px-4 h-14 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
          >
            <ArrowLeft size={22} color="#1A1A1A" />
          </Pressable>
          <Text className="ml-2 font-display text-h3 text-niqo-black">
            Mon profil
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/profile/edit")}
          accessibilityRole="button"
          accessibilityLabel="Modifier le profil"
          className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
        >
          <Pencil size={20} color="#D85A30" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 32,
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
        {/* Banner KYC : pending / rejected (verified = pas de banner, badge ailleurs) */}
        <VerifPendingBanner />

        {/* Pending email banner — visible tant que le lien de confirmation
            n'a pas été cliqué. Couleurs warning (code-envoye) pour signaler
            une action en attente sans bloquer l'écran. */}
        {pendingEmail && (
          <View className="bg-niqo-status-code-envoye-bg rounded-card p-3 mb-4 flex-row items-start gap-3">
            <Mail size={20} color="#BA7517" />
            <View className="flex-1">
              <Text className="font-body text-label text-niqo-status-code-envoye-text">
                Confirme ton nouvel email
              </Text>
              <Text className="font-body text-caption text-niqo-gray-800 mt-0.5">
                Un lien a été envoyé à {pendingEmail}. Clique dessus pour
                valider le changement.
              </Text>
            </View>
          </View>
        )}

        {/* Hero — avatar + identity */}
        {(() => {
          const trusted = isTrustedSeller(
            profile.nb_ventes,
            profile.note_vendeur
          );
          return (
            <View className="items-center mt-4 mb-6">
              {/* Avatar — anneau vert si Vendeur Fiable */}
              <View
                style={{
                  width: trusted ? 104 : 96,
                  height: trusted ? 104 : 96,
                  borderRadius: trusted ? 52 : 48,
                  borderWidth: trusted ? 3 : 0,
                  borderColor: "#1D9E75",
                  padding: trusted ? 2 : 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                className="mb-3"
              >
                <View className="w-24 h-24 rounded-full bg-niqo-coral items-center justify-center overflow-hidden">
                  {profile.avatar_url ? (
                    <Image
                      source={{ uri: profile.avatar_url }}
                      style={{ width: 96, height: 96 }}
                      contentFit="cover"
                    />
                  ) : (
                    <Text
                      className="font-display text-h1 text-niqo-white"
                      allowFontScaling={false}
                    >
                      {initials.toUpperCase()}
                    </Text>
                  )}
                </View>
              </View>

              {/* Nom + badge Vérifié inline (style Instagram) */}
              <View className="flex-row items-center justify-center gap-1.5">
                <Text className="font-display text-h2 text-niqo-black text-center">
                  {profile.prenom} {profile.nom}
                </Text>
                {profile.is_verified && (
                  <View
                    accessibilityLabel="Vendeur Vérifié"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: "#D85A30",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={13} color="#FFFFFF" strokeWidth={3.2} />
                  </View>
                )}
              </View>

              {/* Pills explicites — cohérent avec u/[id] (profil public) */}
              {(profile.is_verified || trusted) && (
                <View className="flex-row items-center flex-wrap justify-center gap-2 mt-2">
                  {profile.is_verified && (
                    <View className="flex-row items-center bg-niqo-coral-light rounded-full px-3 py-1">
                      <CheckCircle2 size={12} color="#D85A30" />
                      <Text className="ml-1 font-body text-micro text-niqo-coral">
                        Vendeur Vérifié
                      </Text>
                    </View>
                  )}
                  {trusted && (
                    <View className="flex-row items-center bg-niqo-success/10 rounded-full px-3 py-1">
                      <CheckCircle2 size={12} color="#1D9E75" />
                      <Text className="ml-1 font-body text-micro text-niqo-success">
                        Vendeur Fiable
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <Text className="mt-1 font-body text-body text-niqo-gray-500 text-center">
                {profile.quartier ? `${profile.quartier}, ` : ""}
                {profile.ville} · {countryLabel}
              </Text>
              <Text className="mt-1 font-body text-micro text-niqo-gray-500 text-center">
                Membre depuis {memberSince}
              </Text>
            </View>
          );
        })()}

        {/* Stats grid — 2 cols × 2 rows on 360px.
            Note affichée seulement si l'user a un historique représentatif
            (≥ MIN_VENTES/ACHATS_FOR_NOTE) — sinon "—" pour rester cohérent
            avec ce qu'un acheteur voit sur /u/[id] (anti-fraude amis). */}
        <View className="flex-row flex-wrap gap-3 mb-8">
          <StatCard
            Icon={Star}
            label="Note vendeur"
            value={
              profile.nb_ventes >= MIN_VENTES_FOR_NOTE
                ? profile.note_vendeur.toFixed(1)
                : "—"
            }
          />
          <StatCard
            Icon={ThumbsUp}
            label="Note acheteur"
            value={
              profile.nb_achats >= MIN_ACHATS_FOR_NOTE
                ? profile.note_acheteur.toFixed(1)
                : "—"
            }
          />
          <StatCard
            Icon={ShoppingBag}
            label="Ventes"
            value={profile.nb_ventes.toString()}
          />
          <StatCard
            Icon={ShoppingCart}
            label="Achats"
            value={profile.nb_achats.toString()}
          />
        </View>

        {/* Coordonnées section — email + phone (read-only display) */}
        <Text
          className="font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
          allowFontScaling={false}
        >
          Coordonnées
        </Text>
        <View className="bg-niqo-gray-50 rounded-card overflow-hidden mb-6">
          <View className="flex-row items-center px-4 min-h-[56px]">
            <Mail size={20} color="#444441" />
            <Text className="ml-3 flex-1 font-body text-body text-niqo-black">
              {profile.email}
            </Text>
          </View>
          <View className="h-px bg-niqo-gray-150 ml-12" />
          <View className="flex-row items-center px-4 min-h-[56px]">
            <Phone size={20} color="#444441" />
            <Text
              className={`ml-3 flex-1 font-body text-body ${
                phone ? "text-niqo-black" : "text-niqo-gray-500"
              }`}
            >
              {phone ? formatPhoneDisplay(phone) : "Numéro non renseigné"}
            </Text>
          </View>
        </View>

        {/* Activité section */}
        <Text
          className="font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
          allowFontScaling={false}
        >
          Activité
        </Text>
        <View className="bg-niqo-gray-50 rounded-card overflow-hidden mb-6">
          <MenuRow
            Icon={BarChart3}
            label="Mon dashboard"
            onPress={() => router.push("/profile/dashboard")}
          />
          <MenuDivider />
          <MenuRow
            Icon={Tag}
            label="Mes annonces"
            onPress={() => router.push("/profile/announces")}
          />
          <MenuDivider />
          <MenuRow
            Icon={ShoppingCart}
            label="Mes achats"
            onPress={() => router.push("/profile/achats")}
          />
          <MenuDivider />
          <MenuRow
            Icon={Heart}
            label="Mes favoris"
            onPress={() => router.push("/profile/favorites")}
          />
          <MenuDivider />
          <MenuRow
            Icon={MessageCircle}
            label="Mes messages"
            onPress={() => router.push("/messages")}
          />
        </View>

        {/* Compte section */}
        <Text
          className="font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
          allowFontScaling={false}
        >
          Compte
        </Text>
        <View className="bg-niqo-gray-50 rounded-card overflow-hidden mb-8">
          <MenuRow
            Icon={ShieldCheck}
            label={
              profile.is_verified
                ? "Vérification d'identité"
                : "Devenir vendeur vérifié"
            }
            badge={profile.is_verified ? "Vérifié" : undefined}
            onPress={() => router.push("/profile/verification")}
          />
          <MenuDivider />
          <MenuRow
            Icon={ShieldOff}
            label="Utilisateurs bloqués"
            onPress={() => router.push("/profile/blocked-users" as never)}
          />
          <MenuDivider />
          <MenuRow
            Icon={HelpCircle}
            label="Aide & support"
            onPress={openSupport}
          />
        </View>

        {/* Sign out — destructive secondary button */}
        <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Se déconnecter"
          className="flex-row items-center justify-center gap-2 bg-niqo-white border border-niqo-danger rounded-btn min-h-[48px] px-4 active:opacity-60"
        >
          <LogOut size={20} color="#E24B4A" />
          <Text className="font-body text-label text-niqo-danger">
            Se déconnecter
          </Text>
        </Pressable>

        {/* Delete account — discreet text-only link, RGPD droit à l'oubli */}
        <Pressable
          onPress={handleDeleteAccount}
          accessibilityRole="button"
          accessibilityLabel="Supprimer mon compte définitivement"
          className="mt-3 min-h-[44px] items-center justify-center active:opacity-60"
        >
          <Text className="font-body text-caption text-niqo-gray-500 underline">
            Supprimer mon compte
          </Text>
        </Pressable>

        {/* Version footer */}
        <Text className="mt-6 font-body text-micro text-niqo-gray-500 text-center">
          Niqo v1.0
        </Text>
      </ScrollView>
    </View>
  );
}

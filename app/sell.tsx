import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, router } from "expo-router";
import { ArrowLeft, FileText, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Step1Details } from "@/components/sell/Step1Details";
import { Step2Category } from "@/components/sell/Step2Category";
import { Step3Condition } from "@/components/sell/Step3Condition";
import { StepImmobilier } from "@/components/sell/StepImmobilier";
import { Step4Photos } from "@/components/sell/Step4Photos";
import { Step5Price } from "@/components/sell/Step5Price";
import { WizardProgress } from "@/components/ui/WizardProgress";
import {
  createAnnonce,
  fetchMyAnnonces,
  type EtatObjet,
  type Pays,
  type TypeBien,
  type TypeOffreImmo,
} from "@/lib/annonces";
import { fetchCategories, type Category } from "@/lib/categories";
import { annonceErrorToFr } from "@/lib/annonces/errors";
import { useAuth } from "@/lib/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

type Step = 1 | 2 | 3 | 4 | 5;

interface SellState {
  step: Step;
  // Step 1
  titre: string;
  description: string;
  // Step 2
  categorie_id: string | null;
  // Step 3 — état (classique) OU immobilier
  etat: EtatObjet | null;
  // Step 3 — immobilier
  type_bien: TypeBien | null;
  type_offre: TypeOffreImmo | null;
  surface_m2: string;
  nb_pieces: string;
  meuble: boolean | null;
  // Step 4
  photoUris: string[];
  // Step 5
  prix: string;
  ville: string;
  quartier: string;
}

const INITIAL_STATE: SellState = {
  step: 1,
  titre: "",
  description: "",
  categorie_id: null,
  etat: null,
  type_bien: null,
  type_offre: null,
  surface_m2: "",
  nb_pieces: "",
  meuble: null,
  photoUris: [],
  prix: "",
  ville: "",
  quartier: "",
};

type SellPatch = Partial<Omit<SellState, "step">>;

type SellAction =
  | { type: "set"; patch: SellPatch }
  | { type: "next" }
  | { type: "back" }
  | { type: "reset" }
  | { type: "hydrate"; state: SellState };

function reducer(state: SellState, action: SellAction): SellState {
  switch (action.type) {
    case "set":
      return { ...state, ...action.patch };
    case "next":
      return state.step < 5 ? { ...state, step: (state.step + 1) as Step } : state;
    case "back":
      return state.step > 1 ? { ...state, step: (state.step - 1) as Step } : state;
    case "reset":
      return INITIAL_STATE;
    case "hydrate":
      return action.state;
  }
}

const DRAFT_KEY = "niqo_sell_draft";
const COUNTRY_KEY = "niqo_country";

const STEP_COPY: Record<Step, { title: string; subtitle: string }> = {
  1: {
    title: "Décris ton article",
    subtitle: "Un titre clair et une description honnête vendent mieux.",
  },
  2: {
    title: "Catégorie",
    subtitle: "Dans quelle catégorie se trouve ton article ?",
  },
  3: {
    title: "État de l'article",
    subtitle: "Sois honnête — ça inspire confiance aux acheteurs.",
  },
  4: {
    title: "Photos",
    subtitle: "1 minimum, 5 maximum. La première sera la couverture.",
  },
  5: {
    title: "Prix & lieu",
    subtitle: "Fixe ton prix et indique ta ville.",
  },
};

/** Au-dessus de ce seuil, on demande confirmation à l'user (sanity check
 *  contre le "zéro stuck" lors d'une saisie pressée). 50M FCFA/XAF couvre
 *  largement les annonces classiques ; au-delà, presque toujours immo
 *  (vente terrain/maison). Le cap dur 12 chiffres est dans Step5Price
 *  (matche la contrainte numeric(12,0) DB). */
const PRICE_CONFIRM_THRESHOLD = 50_000_000;

export default function SellScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, requireAuth } = useAuth();

  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [country, setCountry] = useState<Pays | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isFirstPost, setIsFirstPost] = useState(false);
  const [cguAccepted, setCguAccepted] = useState(false);
  const hydratedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  // Banner "Brouillon restauré" — affiché au mount si on a hydraté un draft
  // non-vide. L'user peut taper "Recommencer" pour purger ou ignorer.
  const [draftRestored, setDraftRestored] = useState(false);

  // ── Auth gate ────────────────────────────────────────────────────────────
  // Si l'user atteint /sell sans être auth (deep link, etc.), on ouvre le
  // gate global et on redirige vers /home pour ne pas afficher un wizard
  // bloqué derrière la modale.
  useEffect(() => {
    if (!isAuthenticated) {
      requireAuth("sell");
      router.replace("/home");
    }
  }, [isAuthenticated, requireAuth]);

  // ── Hydrate country (pour cap prix + liste villes) ───────────────────────
  useEffect(() => {
    void (async () => {
      const saved = await AsyncStorage.getItem(COUNTRY_KEY);
      if (saved === "CI" || saved === "CG") setCountry(saved);
    })();
  }, []);

  // ── Fetch categories (pour détecter "Immobilier") ────────────────────────
  useEffect(() => {
    void fetchCategories().then(setCategories).catch(() => {});
  }, []);

  // Détecte si la catégorie sélectionnée est "Immobilier" via l'icone (stable
  // en DB depuis mig 32) plutôt que le nom (fragile : si le nom passe à
  // "Immobilier · CI" ou est traduit, toute la branche immo casse).
  const isImmo = categories.some(
    (c) => c.id === state.categorie_id && c.icone === "building-2"
  );

  // ── Détecte si c'est le 1er post (→ checkbox CGU obligatoire) ────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const mine = await fetchMyAnnonces();
        setIsFirstPost(mine.length === 0);
      } catch {
        // En cas d'erreur réseau, on affiche la checkbox par précaution
        setIsFirstPost(true);
      }
    })();
  }, [isAuthenticated]);

  // ── Restore brouillon au mount ───────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SellState;
          // Vérifier que les URIs photo sont encore accessibles (l'OS peut
          // les avoir purgées si l'app a été tuée entre-temps — fréquent
          // sur Android low-end avec peu de RAM).
          if (parsed.photoUris && parsed.photoUris.length > 0) {
            const validUris: string[] = [];
            for (const uri of parsed.photoUris) {
              try {
                const info = await FileSystem.getInfoAsync(uri);
                if (info.exists) validUris.push(uri);
              } catch {
                // fichier inaccessible — on le retire silencieusement
              }
            }
            parsed.photoUris = validUris;
          }
          dispatch({ type: "hydrate", state: parsed });
          // Signal au user que ses saisies précédentes ont été restaurées —
          // évite la confusion "pourquoi y a déjà des trucs ?". Banner
          // dismissable + bouton "Recommencer" pour purge rapide.
          const isPristine =
            parsed.titre === "" &&
            parsed.description === "" &&
            parsed.photoUris.length === 0 &&
            parsed.categorie_id === null;
          if (!isPristine) setDraftRestored(true);
        }
      } catch {
        // draft corrompu — on ignore, repart de zéro
      } finally {
        hydratedRef.current = true;
      }
    })();
  }, []);

  // ── Persist on background ────────────────────────────────────────────────
  // Évite de perdre la progression si l'user switche d'app (recevoir un
  // appel WhatsApp, ouvrir l'appareil photo via l'UI native, etc.). Pas de
  // persist sur chaque keystroke (overhead AsyncStorage).
  useEffect(() => {
    function onChange(status: AppStateStatus) {
      if (status === "background" && hydratedRef.current) {
        void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      }
    }
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [state]);

  // ── Persist au unmount (S6) ─────────────────────────────────────────────
  // AppState background ne triggers que si l'app passe vraiment en background.
  // Si l'user navigue dans Niqo (ex : tape sur un onglet vers Home depuis le
  // wizard), le state n'est pas sauvé — il perd tout au retour. On capture
  // donc la dernière version du state via une ref + persist au unmount final.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    return () => {
      // Évite d'écraser un draft fraîchement reset si l'user a confirmé
      // "Recommencer à zéro" juste avant de quitter l'écran.
      const s = stateRef.current;
      const isPristine =
        s.titre === "" && s.description === "" && s.photoUris.length === 0;
      if (hydratedRef.current && !isPristine) {
        void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(s));
      }
    };
  }, []);

  // ── Validation par step ──────────────────────────────────────────────────
  const canProceed = (() => {
    switch (state.step) {
      case 1:
        return (
          state.titre.trim().length >= 3 &&
          state.titre.trim().length <= 50 &&
          state.description.trim().length >= 10 &&
          state.description.trim().length <= 2000
        );
      case 2:
        return state.categorie_id !== null;
      case 3:
        if (isImmo) {
          return state.type_offre !== null && state.type_bien !== null;
        }
        return state.etat !== null;
      case 4:
        return state.photoUris.length >= 1 && state.photoUris.length <= 5;
      case 5: {
        const prix = parseInt(state.prix.replace(/\s/g, ""), 10);
        const fieldsValid =
          !isNaN(prix) && prix > 0 && state.ville.trim().length >= 2;
        return fieldsValid && (!isFirstPost || cguAccepted);
      }
    }
  })();

  // ── Back ─────────────────────────────────────────────────────────────────
  const onBack = useCallback(() => {
    setError(null);
    if (state.step > 1) {
      dispatch({ type: "back" });
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [state.step]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // ── Reset draft (avec confirmation — anti-tap accidentel destructeur) ───
  const onResetDraft = useCallback(() => {
    Alert.alert(
      "Recommencer à zéro ?",
      "Toutes tes saisies (titre, photos, prix…) seront effacées définitivement.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Recommencer",
          style: "destructive",
          onPress: () => {
            setError(null);
            setDraftRestored(false);
            dispatch({ type: "reset" });
            void AsyncStorage.removeItem(DRAFT_KEY);
          },
        },
      ]
    );
  }, []);

  // ── Patch state ──────────────────────────────────────────────────────────
  const onPatch = useCallback((patch: SellPatch) => {
    dispatch({ type: "set", patch });
  }, []);

  // ── Submit final (Step 5 → publication) ──────────────────────────────────
  const doPublish = useCallback(async () => {
    if (!canProceed || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const annonce = await createAnnonce({
        titre: state.titre.trim(),
        description: state.description.trim(),
        prix: parseInt(state.prix.replace(/\s/g, ""), 10),
        categorie_id: state.categorie_id!,
        etat: isImmo ? null : state.etat!,
        ville: state.ville.trim(),
        quartier: state.quartier.trim() || null,
        photoUris: state.photoUris,
        // Immobilier
        type_bien: isImmo ? state.type_bien : null,
        type_offre: isImmo ? state.type_offre : null,
        surface_m2: isImmo && state.surface_m2 ? parseInt(state.surface_m2, 10) : null,
        nb_pieces: isImmo && state.nb_pieces ? parseInt(state.nb_pieces.replace("+", ""), 10) : null,
        meuble: isImmo ? state.meuble : null,
      });
      // Succès : purge le draft + retour home (la route /announce/[id]
      // arrivera dans le paquet suivant — pour l'instant on rentre sur home,
      // l'annonce sera visible en haut du listing).
      await AsyncStorage.removeItem(DRAFT_KEY);

      // Traçabilité RGPD : enregistrer l'acceptation CGU vente côté serveur
      // (timestamp serveur, pas client — preuve légale ARTCI/ANRTIC).
      // Await obligatoire — le router.replace qui suit tuerait un fire-and-forget,
      // et c'est une preuve légale, pas un nice-to-have.
      if (isFirstPost && cguAccepted) {
        try {
          await supabase.rpc("accept_sell_cgu");
        } catch {
          // L'annonce est déjà créée — on ne bloque pas le redirect pour ça.
          // Le pire cas : cgu_sell_accepted_at reste null, rattrapable par
          // un backfill admin (tous les users avec nb_ventes > 0 et null).
        }
      }

      router.replace(`/announce/${annonce.id}`);
    } catch (err) {
      setError(annonceErrorToFr(err));
      // Scroll en haut pour que l'user voie le banner d'erreur
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canProceed, country, state, isImmo, isFirstPost, cguAccepted]);

  // Wrapper qui demande confirmation si le prix dépasse le seuil sanity check
  // (anti "zéro stuck" — un user pressé qui tape 50 000 000 au lieu de 50 000).
  const onPublish = useCallback(() => {
    const prixNum = parseInt(state.prix.replace(/\s/g, ""), 10);
    if (!isNaN(prixNum) && prixNum >= PRICE_CONFIRM_THRESHOLD) {
      const formatted = prixNum
        .toLocaleString("fr-FR")
        .replace(/ /g, " ");
      Alert.alert(
        "Confirme le prix",
        `Tu as saisi ${formatted}. Es-tu sûr ?`,
        [
          { text: "Modifier", style: "cancel" },
          { text: "Publier", onPress: () => void doPublish() },
        ]
      );
      return;
    }
    void doPublish();
  }, [state.prix, doPublish]);

  // ── CTA action ───────────────────────────────────────────────────────────
  const onCTA = useCallback(() => {
    if (state.step === 5) {
      onPublish();
    } else {
      setError(null);
      dispatch({ type: "next" });
    }
  }, [onPublish, state.step]);

  const ctaLabel = state.step === 5 ? "Publier l'annonce" : "Suivant";

  // Si pas auth, on a déjà déclenché le redirect — render minimal en attendant
  // Si country pas encore hydraté, on attend aussi (évite race condition prix cap)
  if (!isAuthenticated || country === null) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center">
        <ActivityIndicator color="#D85A30" />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="bg-niqo-white"
    >
      <Stack.Screen
        options={{
          headerShown: false,
          // Désactive le swipe-back iOS quand on est dans un step > 1 — on
          // n'a pas envie de perdre l'état du wizard sans transition contrôlée.
          gestureEnabled: state.step === 1,
        }}
      />

      {/* Header — zIndex élevé pour rester au-dessus du KeyboardAvoidingView */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-2" style={{ zIndex: 10 }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="font-display text-h3 text-niqo-black">
          Vendre
        </Text>
        <Pressable
          onPress={onResetDraft}
          accessibilityRole="button"
          accessibilityLabel="Recommencer à zéro"
          hitSlop={8}
          className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2 active:opacity-60"
        >
          <RotateCcw size={20} color="#888780" />
        </Pressable>
      </View>

      {/* Wizard progress */}
      <View className="px-4 pt-2 pb-2">
        <WizardProgress step={state.step} total={5} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title + subtitle */}
          <Text className="font-display text-h2 text-niqo-black">
            {state.step === 3 && isImmo
              ? "Détails du bien"
              : STEP_COPY[state.step].title}
          </Text>
          <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
            {state.step === 3 && isImmo
              ? "Type de bien, surface, nombre de pièces…"
              : STEP_COPY[state.step].subtitle}
          </Text>

          {/* Brouillon restauré banner — affiché au mount si on a hydraté
              un draft non-vide (S2 audit). Évite la confusion "pourquoi y a
              des trucs déjà saisis ?" + bouton "Recommencer" pour purge
              rapide cohérent avec l'icône RotateCcw du header. */}
          {draftRestored && (
            <View className="mb-4 bg-niqo-coral-light border border-niqo-coral/30 rounded-card px-4 py-3 flex-row items-start gap-2">
              <FileText size={16} color="#D85A30" />
              <View className="flex-1">
                <Text className="font-body text-caption text-niqo-coral">
                  Brouillon restauré
                </Text>
                <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
                  Tes saisies précédentes ont été conservées. Tape l&apos;icône{" "}
                  <Text className="font-mono">↻</Text> en haut pour recommencer.
                </Text>
              </View>
              <Pressable
                onPress={() => setDraftRestored(false)}
                hitSlop={6}
                accessibilityLabel="Masquer la notification"
                className="active:opacity-60"
              >
                <Text className="font-display text-caption text-niqo-coral">
                  OK
                </Text>
              </Pressable>
            </View>
          )}

          {/* Error banner */}
          {error && (
            <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-en-litige-text">
                {error}
              </Text>
            </View>
          )}

          {/* Steps */}
          {state.step === 1 && (
            <Step1Details
              titre={state.titre}
              description={state.description}
              onChange={onPatch}
            />
          )}
          {state.step === 2 && (
            <Step2Category
              categorie_id={state.categorie_id}
              onChange={onPatch}
            />
          )}
          {state.step === 3 && !isImmo && (
            <Step3Condition
              etat={state.etat}
              onChange={onPatch}
            />
          )}
          {state.step === 3 && isImmo && (
            <StepImmobilier
              typeBien={state.type_bien}
              typeOffre={state.type_offre}
              surfaceM2={state.surface_m2}
              nbPieces={state.nb_pieces}
              meuble={state.meuble}
              onChange={onPatch}
            />
          )}
          {state.step === 4 && (
            <Step4Photos
              photoUris={state.photoUris}
              onChange={onPatch}
            />
          )}
          {state.step === 5 && (
            <Step5Price
              prix={state.prix}
              ville={state.ville}
              quartier={state.quartier}
              country={country}
              onChange={onPatch}
              isFirstPost={isFirstPost}
              cguAccepted={cguAccepted}
              onCguChange={setCguAccepted}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* CTA bottom-sticky */}
      <View
        className="px-4 pt-3 border-t border-niqo-gray-100 bg-niqo-white"
        style={{ paddingBottom: 12 }}
      >
        <Pressable
          onPress={onCTA}
          disabled={!canProceed || submitting}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: !canProceed || submitting }}
          className={`flex-row items-center justify-center bg-niqo-coral rounded-btn min-h-[48px] px-4 ${
            !canProceed || submitting ? "opacity-50" : "active:opacity-80"
          }`}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="font-body text-label text-niqo-white">
              {ctaLabel}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

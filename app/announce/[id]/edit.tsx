import { useNavigation } from "@react-navigation/native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
// Renommé en Step5Price suite à l'audit /sell.tsx (S3) — réutilisé ici en
// tant que dernier step du wizard d'édition (step 4 d'edit, step 5 de /sell).
import { Step5Price } from "@/components/sell/Step5Price";
import {
  fetchAnnonceById,
  updateAnnonce,
  type Annonce,
  type EtatObjet,
  type Pays,
  type TypeBien,
  type TypeOffreImmo,
} from "@/lib/annonces";
import { fetchCategories, type Category } from "@/lib/categories";
import { annonceErrorToFr } from "@/lib/annonces/errors";

// ── State ───────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

interface EditState {
  step: Step;
  titre: string;
  description: string;
  categorie_id: string | null;
  etat: EtatObjet | null;
  // Immobilier
  type_bien: TypeBien | null;
  type_offre: TypeOffreImmo | null;
  surface_m2: string;
  nb_pieces: string;
  meuble: boolean | null;
  // Prix
  prix: string;
  ville: string;
  quartier: string;
}

type EditAction =
  | { type: "hydrate"; state: EditState }
  | { type: "set"; patch: Partial<EditState> }
  | { type: "next" }
  | { type: "back" };

function reducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "set":
      return { ...state, ...action.patch };
    case "next":
      return { ...state, step: Math.min(state.step + 1, 4) as Step };
    case "back":
      return { ...state, step: Math.max(state.step - 1, 1) as Step };
  }
}

function formatPriceForInput(prix: number): string {
  return prix.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// ── Component ───────────────────────────────────────────────────────────────

export default function EditAnnonceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [original, setOriginal] = useState<Annonce | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const [state, dispatch] = useReducer(reducer, {
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
    prix: "",
    ville: "",
    quartier: "",
  });

  // Détecte si la catégorie est "Immobilier" via icone (stable depuis mig 32) —
  // cohérent avec /sell.tsx (audit S4). Le nom DB pourrait changer ("Immobilier
  // · CI", traduction…) sans casser la détection.
  const isImmo = categories.some(
    (c) => c.id === state.categorie_id && c.icone === "building-2"
  );

  // ── Fetch categories ──────────────────────────────────────────────────
  useEffect(() => {
    void fetchCategories().then(setCategories).catch(() => {});
  }, []);

  // ── Fetch original ──────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const annonce = await fetchAnnonceById(id);
        if (!annonce) {
          setError("Annonce introuvable");
          return;
        }
        if (annonce.statut !== "active") {
          setError("Cette annonce n'est plus modifiable.");
          return;
        }
        setOriginal(annonce);
        dispatch({
          type: "hydrate",
          state: {
            step: 1,
            titre: annonce.titre,
            description: annonce.description,
            categorie_id: annonce.categorie_id,
            etat: annonce.etat,
            type_bien: annonce.type_bien,
            type_offre: annonce.type_offre,
            surface_m2: annonce.surface_m2?.toString() ?? "",
            nb_pieces: annonce.nb_pieces?.toString() ?? "",
            meuble: annonce.meuble,
            prix: formatPriceForInput(annonce.prix),
            ville: annonce.ville,
            quartier: annonce.quartier ?? "",
          },
        });
      } catch {
        setError("Impossible de charger l'annonce.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // ── Validation ──────────────────────────────────────────────────────
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
      case 4: {
        const prix = parseInt(state.prix.replace(/\s/g, ""), 10);
        return !isNaN(prix) && prix > 0 && state.ville.trim().length >= 2;
      }
    }
  })();

  // ── Dirty detect (EA2 audit) ────────────────────────────────────────
  // Pas d'auto-save ici (différent de /sell.tsx) — donc quitter sans save
  // = perte totale. On flag "modifié" pour intercepter le back via
  // beforeRemove (couvre header back, swipe iOS, hardware Android).
  const isDirty = (() => {
    if (!original) return false;
    if (state.titre.trim() !== original.titre) return true;
    if (state.description.trim() !== original.description) return true;
    if (state.categorie_id !== original.categorie_id) return true;
    if (state.etat !== original.etat) return true;
    if (state.type_bien !== original.type_bien) return true;
    if (state.type_offre !== original.type_offre) return true;
    if ((state.surface_m2 || null) !== (original.surface_m2?.toString() ?? null))
      return true;
    if ((state.nb_pieces || null) !== (original.nb_pieces?.toString() ?? null))
      return true;
    if (state.meuble !== original.meuble) return true;
    if (parseInt(state.prix.replace(/\s/g, ""), 10) !== original.prix) return true;
    if (state.ville.trim() !== original.ville) return true;
    if ((state.quartier.trim() || null) !== (original.quartier ?? null))
      return true;
    return false;
  })();

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      Alert.alert(
        "Modifications non enregistrées",
        "Tu as des modifs en attente sur cette annonce. Quitter sans enregistrer ?",
        [
          { text: "Rester", style: "cancel" },
          {
            text: "Quitter sans enregistrer",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, saving]);

  // ── Save ────────────────────────────────────────────────────────────
  const onSave = useCallback(async () => {
    if (!original || !canProceed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateAnnonce(original.id, {
        titre: state.titre.trim(),
        description: state.description.trim(),
        prix: parseInt(state.prix.replace(/\s/g, ""), 10),
        categorie_id: state.categorie_id!,
        etat: isImmo ? null : state.etat!,
        ville: state.ville.trim(),
        quartier: state.quartier.trim() || null,
      });
      router.back();
    } catch (err) {
      setError(annonceErrorToFr(err));
    } finally {
      setSaving(false);
    }
  }, [original, canProceed, saving, state, isImmo]);

  // ── Nav ─────────────────────────────────────────────────────────────
  const onBack = useCallback(() => {
    setError(null);
    if (state.step > 1) {
      dispatch({ type: "back" });
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [state.step]);

  const onCTA = useCallback(() => {
    if (state.step === 4) {
      void onSave();
    } else {
      setError(null);
      dispatch({ type: "next" });
    }
  }, [onSave, state.step]);

  const onPatch = useCallback(
    (patch: Partial<EditState>) => dispatch({ type: "set", patch }),
    []
  );

  // ── Loading / Error ─────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  if (error && !original) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center px-6">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="font-display text-h3 text-niqo-black text-center">
          {error}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-6 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
        >
          <Text className="font-body text-label text-niqo-white">Retour</Text>
        </Pressable>
      </View>
    );
  }

  const ctaLabel = state.step === 4 ? "Sauvegarder" : "Suivant";
  const country = original?.pays ?? ("CI" as Pays);

  // Step titles
  const stepTitle = (() => {
    if (state.step === 3 && isImmo) return "Détails du bien";
    const titles: Record<Step, string> = {
      1: "Modifier le texte",
      2: "Catégorie",
      3: "État de l'article",
      4: "Prix et localisation",
    };
    return titles[state.step];
  })();

  const stepSubtitle = (() => {
    if (state.step === 3 && isImmo) return "Type de bien, surface, nombre de pièces…";
    const subtitles: Record<Step, string> = {
      1: "Titre et description de ton annonce.",
      2: "Vérifie ou modifie la catégorie.",
      3: "Vérifie ou modifie l'état.",
      4: "Ajuste le prix ou la ville.",
    };
    return subtitles[state.step];
  })();

  return (
    <View
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="bg-niqo-white"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="flex-1 text-center font-display text-h3 text-niqo-black">
          Modifier
        </Text>
        <View className="min-w-[44px]" />
      </View>

      {/* Step indicator */}
      <View className="flex-row px-4 gap-2 mb-2">
        {([1, 2, 3, 4] as Step[]).map((s) => (
          <View
            key={s}
            className={`flex-1 h-1 rounded-full ${
              s <= state.step ? "bg-niqo-coral" : "bg-niqo-gray-200"
            }`}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="font-display text-h2 text-niqo-black">
            {stepTitle}
          </Text>
          <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
            {stepSubtitle}
          </Text>

          {error && (
            <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-en-litige-text">
                {error}
              </Text>
            </View>
          )}

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
            <Step5Price
              prix={state.prix}
              ville={state.ville}
              quartier={state.quartier}
              country={country}
              onChange={onPatch}
              isFirstPost={false}
              cguAccepted={false}
              onCguChange={() => {}}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* CTA */}
      <View
        className="px-4 pt-3 border-t border-niqo-gray-100 bg-niqo-white"
        style={{ paddingBottom: 12 }}
      >
        <Pressable
          onPress={onCTA}
          disabled={!canProceed || saving}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          className={`flex-row items-center justify-center bg-niqo-coral rounded-btn min-h-[48px] px-4 ${
            !canProceed || saving ? "opacity-50" : "active:opacity-80"
          }`}
        >
          {saving ? (
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

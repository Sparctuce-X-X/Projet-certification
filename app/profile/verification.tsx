import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Clock,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CameraCapture } from "@/components/verification/CameraCapture";
import { CaptureReview } from "@/components/verification/CaptureReview";
import { VerifIntro } from "@/components/verification/VerifIntro";
import { VerifSummary } from "@/components/verification/VerifSummary";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Country } from "@/lib/phone";
import { getMyPhone } from "@/lib/supabase";
import {
  fetchMyLastVerification,
  fetchPaiement,
  generateVerificationDraftId,
  initVerificationPayment,
  mapSubmitVerificationError,
  submitVerification,
  uploadKycPhoto,
  VERIFICATION_SLA_HOURS,
  type MmoProvider,
  type MyVerificationStatus,
} from "@/lib/verification";

// ── Types états ──────────────────────────────────────────────────────────────

type WizardStep =
  | "loading"
  | "already-verified"
  | "already-pending"
  | "intro"
  | "recto-camera"
  | "recto-review"
  | "verso-camera"
  | "verso-review"
  | "selfie-camera"
  | "selfie-review"
  | "summary"
  | "paying"
  | "submitting"
  | "submitted";

interface CaptureSlot {
  localUri: string | null;
  uploadedPath: string | null;
}

const TOTAL_STEPS = 5; // intro=1 → recto=2 → verso=3 → selfie=4 → summary=5

// ── Composant ────────────────────────────────────────────────────────────────

export default function VerificationScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [step, setStep] = useState<WizardStep>("loading");

  // Statut existant (pour les écrans already-verified / already-pending / rejected)
  const [existing, setExisting] = useState<MyVerificationStatus | null>(null);

  // Données wizard
  const [draftId] = useState(() => generateVerificationDraftId());
  const [recto, setRecto] = useState<CaptureSlot>({ localUri: null, uploadedPath: null });
  const [verso, setVerso] = useState<CaptureSlot>({ localUri: null, uploadedPath: null });
  const [selfie, setSelfie] = useState<CaptureSlot>({ localUri: null, uploadedPath: null });

  // Paiement
  const [paiementId, setPaiementId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // V1 audit : pré-remplir le numéro Mobile Money depuis users.telephone
  // (Vault chiffré, RPC get_my_phone). Évite la re-saisie à chaque tentative.
  const [initialPhone, setInitialPhone] = useState<string | null>(null);
  // V2 audit : ref cancellable pour le polling. Set true au unmount ou tap
  // "Annuler" → le while loop ligne 173 break à la prochaine itération.
  const pollingCancelledRef = useRef(false);

  // ── Au mount : check si déjà vérifié / en cours ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    void fetchMyLastVerification()
      .then((s) => {
        if (cancelled) return;
        setExisting(s);
        if (!s || s.statut === "rejected") {
          setStep("intro");
        } else if (s.statut === "verified") {
          setStep("already-verified");
        } else {
          setStep("already-pending");
        }
      })
      .catch(() => {
        if (!cancelled) setStep("intro");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // V1 audit : charge le téléphone une fois (RPC bypass Vault). Si null
  // (user n'a pas renseigné), VerifSummary affiche son input vide.
  useEffect(() => {
    let cancelled = false;
    void getMyPhone()
      .then((p) => {
        if (!cancelled) setInitialPhone(p);
      })
      .catch(() => {
        // Best-effort — VerifSummary fera saisir manuellement si besoin
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // V2 audit : cleanup polling au unmount. Évite memory leak + race
  // conditions si l'user kill la page pendant un paiement en cours.
  useEffect(() => {
    return () => {
      pollingCancelledRef.current = true;
    };
  }, []);

  // ── Quitter — confirm si progression en cours ───────────────────────────
  const handleClose = () => {
    const hasProgress = recto.localUri || verso.localUri || selfie.localUri;
    if (hasProgress && step !== "submitted") {
      Alert.alert(
        "Quitter sans sauvegarder ?",
        "Tu devras refaire les captures. Ta progression sera perdue.",
        [
          { text: "Continuer", style: "cancel" },
          { text: "Quitter", style: "destructive", onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  // ── Capture handlers ────────────────────────────────────────────────────
  const handleCaptureRecto = (uri: string) => {
    setRecto({ localUri: uri, uploadedPath: null });
    setStep("recto-review");
  };
  const handleCaptureVerso = (uri: string) => {
    setVerso({ localUri: uri, uploadedPath: null });
    setStep("verso-review");
  };
  const handleCaptureSelfie = (uri: string) => {
    setSelfie({ localUri: uri, uploadedPath: null });
    setStep("selfie-review");
  };

  // ── Confirm handlers (uploads en arrière-plan + avance) ────────────────
  const confirmAndUpload = async (
    kind: "recto" | "verso" | "selfie",
    localUri: string,
    nextStep: WizardStep
  ) => {
    try {
      const { path } = await uploadKycPhoto({ localUri, draftId, kind });
      if (kind === "recto") setRecto({ localUri, uploadedPath: path });
      if (kind === "verso") setVerso({ localUri, uploadedPath: path });
      if (kind === "selfie") setSelfie({ localUri, uploadedPath: path });
      setStep(nextStep);
    } catch (e) {
      Alert.alert(
        "Upload impossible",
        e instanceof Error ? e.message : "Vérifie ta connexion et réessaie."
      );
    }
  };

  // ── Paiement (Edge Function) → poll → submit ───────────────────────────
  const handlePay = async (phoneE164: string, mmoProvider: MmoProvider, cgvAcceptedVersion: string) => {
    setPaymentError(null);
    pollingCancelledRef.current = false;

    // Init deposit via Edge Function
    const init = await initVerificationPayment({
      phoneNumber: phoneE164,
      mmoProvider,
      cgvAcceptedVersion,
    });
    setPaiementId(init.paiementId);
    setStep("paying");

    // Poll toutes les 3s, max 60 essais (3 min). Cancellable via ref
    // (V2 audit) — couvre unmount + bouton "Annuler" pendant `paying`.
    const MAX_POLLS = 60;
    let polls = 0;
    while (polls < MAX_POLLS) {
      await new Promise((r) => setTimeout(r, 3000));
      if (pollingCancelledRef.current) return;
      polls += 1;
      const p = await fetchPaiement(init.paiementId).catch(() => null);
      if (pollingCancelledRef.current) return;
      if (p?.statut === "completed") {
        await submitFromCompletedPayment(init.paiementId);
        return;
      }
      if (p?.statut === "failed") {
        setPaymentError(
          "Le paiement n'a pas été pris en compte. Si ton Mobile Money a été débité, reviens dans quelques minutes."
        );
        setStep("summary");
        return;
      }
    }
    // Timeout
    if (pollingCancelledRef.current) return;
    setPaymentError(
      "Le paiement met du temps à être confirmé. Reviens dans quelques minutes."
    );
    setStep("summary");
  };

  // V2 audit : tap "Annuler" pendant le polling. Le paiement Mobile Money
  // peut avoir été initié — on arrête juste le polling client. Si l'argent
  // a été débité, la prochaine ouverture detectera l'état pending via
  // fetchMyLastVerification.
  const handleCancelPayment = () => {
    pollingCancelledRef.current = true;
    setStep("summary");
  };

  const submitFromCompletedPayment = async (pid: string) => {
    if (!recto.uploadedPath || !verso.uploadedPath || !selfie.uploadedPath) {
      setPaymentError("Photos non uploadées. Recommence le wizard.");
      setStep("summary");
      return;
    }
    setStep("submitting");
    try {
      await submitVerification({
        paiementId: pid,
        rectoPath: recto.uploadedPath,
        versoPath: verso.uploadedPath,
        selfiePath: selfie.uploadedPath,
      });
      setStep("submitted");
    } catch (e) {
      const msg =
        e instanceof Error ? mapSubmitVerificationError(e.message) : "Erreur inconnue.";
      Alert.alert("Soumission impossible", msg);
      setStep("summary");
    }
  };

  // ── Rendu selon step ────────────────────────────────────────────────────

  if (step === "loading") {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white items-center justify-center"
      >
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  // Déjà vérifié — écran de succès
  if (step === "already-verified") {
    return (
      <StatusFullScreen
        icon={
          <BadgeCheck
            size={56}
            color="#1D9E75"
            fill="#1D9E75"
            opacity={0.18}
            strokeWidth={2}
          />
        }
        title="Tu es vérifié."
        subtitle="Ton badge Vendeur Vérifié est actif. Tu peux publier sans limite et tes annonces sortent en priorité."
        primaryLabel="Retour au profil"
        onPrimary={() => router.back()}
      />
    );
  }

  // Vérification en cours — écran d'attente détaillé
  if (step === "already-pending") {
    return (
      <StatusFullScreen
        icon={<Clock size={56} color="#D85A30" strokeWidth={2} />}
        title="Vérification en cours."
        subtitle={`On valide ton dossier sous ${VERIFICATION_SLA_HOURS}h. Tu recevras une notification dès qu'on aura traité ta demande.`}
        primaryLabel="Retour au profil"
        onPrimary={() => router.back()}
      />
    );
  }

  // Soumis avec succès
  if (step === "submitted") {
    return (
      <StatusFullScreen
        icon={<Clock size={56} color="#D85A30" strokeWidth={2} />}
        title="Demande envoyée."
        subtitle={`Ton dossier est entre nos mains. Tu recevras une notification sous ${VERIFICATION_SLA_HOURS}h.`}
        primaryLabel="Retour au profil"
        // V5 audit : `replace` au lieu de `back` — robuste si l'user est
        // arrivé via deeplink (pas d'écran précédent).
        onPrimary={() => router.replace("/profile")}
      />
    );
  }

  // Soumission ou paiement en cours — overlay avec bouton Annuler pour le polling
  if (step === "paying" || step === "submitting") {
    const isPaying = step === "paying";
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white items-center justify-center px-6"
      >
        <ActivityIndicator size="large" color="#D85A30" />
        <Text className="mt-5 font-display text-h3 text-niqo-black text-center">
          {isPaying ? "Paiement en cours" : "Soumission de ton dossier"}
        </Text>
        <Text className="mt-2 font-body text-body text-niqo-gray-800 text-center max-w-xs">
          {isPaying
            ? "Confirme le paiement sur ton app Mobile Money. On attend la confirmation…"
            : "On envoie ta vérification à l'équipe. Quelques secondes…"}
        </Text>
        {/* V2 audit : bouton Annuler pendant le polling — sinon l'user est
            bloqué 3 min sans recours. Pas de bouton pendant `submitting`
            (action atomique côté server, pas annulable). */}
        {isPaying && (
          <Pressable
            onPress={handleCancelPayment}
            accessibilityRole="button"
            accessibilityLabel="Annuler le paiement"
            className="mt-8 min-h-[44px] px-5 rounded-btn border border-niqo-gray-300 items-center justify-center active:opacity-60"
          >
            <Text className="font-body text-label text-niqo-gray-800">
              Annuler
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Caméra steps
  if (step === "recto-camera") {
    return (
      <CameraCapture
        guideShape="rectangle"
        tipTitle="Cadre ta CNI recto"
        tipSubtitle="Bien à plat, sur fond uni, sans reflet"
        step={2}
        totalSteps={TOTAL_STEPS}
        facing="back"
        onCapture={handleCaptureRecto}
        onClose={handleClose}
      />
    );
  }
  if (step === "verso-camera") {
    return (
      <CameraCapture
        guideShape="rectangle"
        tipTitle="Cadre ta CNI verso"
        tipSubtitle="Bien à plat, sur fond uni, sans reflet"
        step={3}
        totalSteps={TOTAL_STEPS}
        facing="back"
        onCapture={handleCaptureVerso}
        onClose={handleClose}
      />
    );
  }
  if (step === "selfie-camera") {
    return (
      <CameraCapture
        guideShape="oval"
        tipTitle="Selfie en direct"
        tipSubtitle="Regarde l'objectif, sans lunettes ni casquette"
        step={4}
        totalSteps={TOTAL_STEPS}
        facing="front"
        onCapture={handleCaptureSelfie}
        onClose={handleClose}
      />
    );
  }

  // Review steps
  if (step === "recto-review" && recto.localUri) {
    return (
      <CaptureReview
        localUri={recto.localUri}
        step={2}
        totalSteps={TOTAL_STEPS}
        label="CNI recto"
        onRetake={() => setStep("recto-camera")}
        onConfirm={() =>
          void confirmAndUpload("recto", recto.localUri!, "verso-camera")
        }
        onClose={handleClose}
      />
    );
  }
  if (step === "verso-review" && verso.localUri) {
    return (
      <CaptureReview
        localUri={verso.localUri}
        step={3}
        totalSteps={TOTAL_STEPS}
        label="CNI verso"
        onRetake={() => setStep("verso-camera")}
        onConfirm={() =>
          void confirmAndUpload("verso", verso.localUri!, "selfie-camera")
        }
        onClose={handleClose}
      />
    );
  }
  if (step === "selfie-review" && selfie.localUri) {
    return (
      <CaptureReview
        localUri={selfie.localUri}
        step={4}
        totalSteps={TOTAL_STEPS}
        label="Selfie"
        onRetake={() => setStep("selfie-camera")}
        onConfirm={() =>
          void confirmAndUpload("selfie", selfie.localUri!, "summary")
        }
        onClose={handleClose}
      />
    );
  }

  // V4 audit : si on est `summary` mais qu'au moins une photo manque (URI
  // OS purgée ou retake en cours sans uploadedPath), on rejette explicitement
  // au lieu de laisser tomber sur l'intro silencieusement.
  if (
    step === "summary" &&
    !(
      recto.uploadedPath &&
      verso.uploadedPath &&
      selfie.uploadedPath &&
      recto.localUri &&
      verso.localUri &&
      selfie.localUri
    )
  ) {
    return (
      <StatusFullScreen
        icon={<AlertCircle size={56} color="#E24B4A" strokeWidth={2} />}
        title="Photos manquantes."
        subtitle="Une ou plusieurs photos ont été perdues (espace libéré par ton téléphone). Recommence le wizard depuis l'intro."
        primaryLabel="Recommencer"
        onPrimary={() => {
          setRecto({ localUri: null, uploadedPath: null });
          setVerso({ localUri: null, uploadedPath: null });
          setSelfie({ localUri: null, uploadedPath: null });
          setPaymentError(null);
          setStep("intro");
        }}
      />
    );
  }

  // Summary (step 5)
  if (
    step === "summary" &&
    recto.uploadedPath &&
    verso.uploadedPath &&
    selfie.uploadedPath &&
    recto.localUri &&
    verso.localUri &&
    selfie.localUri
  ) {
    const country = (profile?.pays ?? "CI") as Country;
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white"
      >
        <StatusBar style="dark" />
        <Header
          step={5}
          totalSteps={TOTAL_STEPS}
          onBack={handleClose}
          showRejected={existing?.statut === "rejected" && !!existing.reject_reason}
          rejectReason={existing?.reject_reason ?? null}
        />
        <VerifSummary
          rectoUri={recto.localUri}
          versoUri={verso.localUri}
          selfieUri={selfie.localUri}
          // V1 audit : pré-rempli depuis Vault au mount — l'user n'a plus à
          // ressaisir le numéro à chaque tentative de paiement.
          initialPhoneE164={initialPhone}
          country={country}
          onEditRecto={() => {
            setPaymentError(null); // V3 audit : nouvelle tentative = clean slate
            setStep("recto-camera");
          }}
          onEditVerso={() => {
            setPaymentError(null);
            setStep("verso-camera");
          }}
          onEditSelfie={() => {
            setPaymentError(null);
            setStep("selfie-camera");
          }}
          onPay={handlePay}
        />
        {paymentError ? (
          <View className="absolute bottom-24 left-4 right-4 bg-niqo-danger/15 rounded-card p-3">
            <Text className="font-body text-micro text-niqo-danger">
              {paymentError}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Intro (step 1) — défaut quand l'user vient d'arriver
  return (
    <View
      style={{ paddingTop: insets.top }}
      className="flex-1 bg-niqo-white"
    >
      <StatusBar style="dark" />
      <Header
        step={1}
        totalSteps={TOTAL_STEPS}
        onBack={handleClose}
        showRejected={existing?.statut === "rejected" && !!existing.reject_reason}
        rejectReason={existing?.reject_reason ?? null}
      />
      <VerifIntro onStart={() => setStep("recto-camera")} />
    </View>
  );
}

// ── Sous-composants locaux ───────────────────────────────────────────────────

function Header({
  step,
  totalSteps,
  onBack,
  showRejected,
  rejectReason,
}: {
  step: number;
  totalSteps: number;
  onBack: () => void;
  showRejected?: boolean;
  rejectReason?: string | null;
}) {
  return (
    <View>
      <View className="flex-row items-center px-4 h-14 bg-niqo-white border-b border-niqo-gray-200">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={10}
          className="w-11 h-11 items-center justify-start active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" strokeWidth={2.2} />
        </Pressable>
        <View className="flex-1 items-center">
          <Text className="font-mono text-micro text-niqo-gray-500">
            Étape {step} / {totalSteps}
          </Text>
        </View>
        <View className="w-11" />
      </View>
      {showRejected && rejectReason ? (
        <View className="bg-niqo-danger/10 border-b border-niqo-danger/20 px-4 py-3 flex-row items-start gap-2">
          <AlertCircle
            size={16}
            color="#E24B4A"
            strokeWidth={2.2}
            style={{ marginTop: 1 }}
          />
          <View className="flex-1">
            <Text className="font-display text-label text-niqo-danger">
              Vérification précédente refusée
            </Text>
            <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
              {rejectReason}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StatusFullScreen({
  icon,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  primaryLabel: string;
  onPrimary: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ paddingTop: insets.top }}
      className="flex-1 bg-niqo-white px-6"
    >
      <StatusBar style="dark" />
      <View className="flex-1 items-center justify-center">
        <View className="mb-6">{icon}</View>
        <Text className="font-display text-h1 text-niqo-black text-center">
          {title}
        </Text>
        <Text className="mt-3 font-body text-body text-niqo-gray-800 text-center max-w-xs leading-relaxed">
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onPrimary}
        accessibilityRole="button"
        className="mb-8 min-h-[52px] flex-row items-center justify-center bg-niqo-coral rounded-btn active:opacity-80"
      >
        <Text className="font-body text-label text-niqo-white">
          {primaryLabel}
        </Text>
      </Pressable>
    </View>
  );
}

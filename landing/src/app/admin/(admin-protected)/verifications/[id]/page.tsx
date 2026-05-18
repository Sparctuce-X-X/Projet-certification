import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  Tag,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime } from "@/lib/date-format";

import { CniViewer } from "./_cni-viewer";
import { RejectButton } from "./_reject-button";
import { ValidateButton } from "./_validate-button";

const SIGNED_URL_TTL = 60; // secondes

const COUNTRY_LABEL: Record<string, string> = {
  CI: "Côte d'Ivoire",
  CG: "Congo",
};

interface VerifDetail {
  id: string;
  statut: "pending" | "verified" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  reject_reason: string | null;
  cni_recto_path: string;
  cni_verso_path: string;
  selfie_path: string;
  rgpd_consent_at: string;
  rgpd_consent_version: string;
  user: {
    id: string;
    prenom: string | null;
    nom: string | null;
    ville: string | null;
    quartier: string | null;
    pays: "CI" | "CG" | null;
    avatar_url: string | null;
    nb_ventes: number | null;
    nb_achats: number | null;
    score_abus: number | null;
    created_at: string;
    email: string | null;
  } | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Vérification ${id.slice(0, 8)} · Niqo Admin`,
    robots: { index: false, follow: false },
  };
}

function formatDateLong(iso: string): string {
  return formatParisDateTime(iso);
}

function memberSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "aujourd'hui";
  if (days < 30) return `il y a ${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

export default async function VerifDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Debug temporaire — montrer quel user voit la page côté server
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("users")
    .select("is_admin, email")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const { data: rawVerif, error: selectErr } = await supabase
    .from("verifications_identite")
    .select(
      `
      id, statut, created_at, reviewed_at, reject_reason,
      cni_recto_path, cni_verso_path, selfie_path,
      rgpd_consent_at, rgpd_consent_version,
      user:users!verifications_identite_user_id_fkey (
        id, prenom, nom, ville, quartier, pays, avatar_url, nb_ventes, nb_achats, score_abus, created_at, email
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (process.env.NODE_ENV !== "production" && selectErr) {
    console.warn("[verif/[id]] select error", selectErr.code);
  }

  if (!rawVerif) {
    notFound();
  }

  const verif = rawVerif as unknown as VerifDetail;

  // Generate signed URLs en parallèle (TTL 60s)
  const [rectoSigned, versoSigned, selfieSigned] = await Promise.all([
    supabase.storage
      .from("cni-verifications")
      .createSignedUrl(verif.cni_recto_path, SIGNED_URL_TTL),
    supabase.storage
      .from("cni-verifications")
      .createSignedUrl(verif.cni_verso_path, SIGNED_URL_TTL),
    supabase.storage
      .from("cni-verifications")
      .createSignedUrl(verif.selfie_path, SIGNED_URL_TTL),
  ]);

  const photos = [
    { label: "CNI recto", url: rectoSigned.data?.signedUrl ?? "" },
    { label: "CNI verso", url: versoSigned.data?.signedUrl ?? "" },
    { label: "Selfie", url: selfieSigned.data?.signedUrl ?? "" },
  ];

  const userName = `${verif.user?.prenom ?? ""} ${verif.user?.nom ?? ""}`
    .trim() || "Utilisateur";

  return (
    <div className="px-8 py-10 max-w-6xl">
      {/* Back link */}
      <Link
        href="/admin/verifications"
        className="inline-flex items-center gap-1.5 text-sm text-niqo-gray-500 hover:text-niqo-black transition-colors duration-150 mb-5 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
        <span>Retour à la liste</span>
      </Link>

      <div className="flex items-baseline justify-between mb-8">
        <h1 className="font-display text-3xl font-bold text-niqo-black">
          {userName}
          <span className="text-niqo-coral">.</span>
        </h1>
        <StatusPill statut={verif.statut} />
      </div>

      <div className="grid lg:grid-cols-12 gap-8">
        {/* Photos — 60% */}
        <div className="lg:col-span-7">
          <p className="text-xs font-mono uppercase tracking-widest text-niqo-gray-500 mb-3">
            Pièces soumises
          </p>
          <CniViewer photos={photos} />
        </div>

        {/* Infos + actions — 40% sticky */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-6 space-y-5">
            {/* Infos user */}
            <div className="bg-white border border-niqo-gray-200 rounded-xl p-5">
              <p className="text-xs font-mono uppercase tracking-widest text-niqo-gray-500 mb-3">
                Profil
              </p>
              <div className="space-y-2.5 text-sm">
                <InfoRow
                  Icon={MapPin}
                  label="Localisation"
                  value={
                    verif.user?.ville
                      ? `${verif.user.quartier ? `${verif.user.quartier}, ` : ""}${verif.user.ville}${verif.user?.pays ? ` · ${COUNTRY_LABEL[verif.user.pays]}` : ""}`
                      : "—"
                  }
                />
                <InfoRow
                  Icon={Calendar}
                  label="Membre depuis"
                  value={
                    verif.user?.created_at
                      ? memberSince(verif.user.created_at)
                      : "—"
                  }
                />
                <InfoRow
                  Icon={Tag}
                  label="Activité"
                  value={`${verif.user?.nb_ventes ?? 0} ventes · ${verif.user?.nb_achats ?? 0} achats`}
                />
                {verif.user?.email ? (
                  <InfoRow
                    Icon={ShieldCheck}
                    label="Email"
                    value={verif.user.email}
                  />
                ) : null}
              </div>
            </div>

            {/* Soumission meta */}
            <div className="bg-white border border-niqo-gray-200 rounded-xl p-5">
              <p className="text-xs font-mono uppercase tracking-widest text-niqo-gray-500 mb-3">
                Soumission
              </p>
              <div className="space-y-2.5 text-sm">
                <InfoRow
                  Icon={Clock}
                  label="Soumis le"
                  value={formatDateLong(verif.created_at)}
                />
                <InfoRow
                  Icon={ShieldCheck}
                  label="Consent RGPD"
                  value={`${verif.rgpd_consent_version} · ${formatDateLong(verif.rgpd_consent_at)}`}
                />
              </div>
            </div>

            {/* Actions / historique */}
            {verif.statut === "pending" ? (
              <div className="space-y-3">
                <ValidateButton
                  verificationId={verif.id}
                  userName={userName}
                />
                <RejectButton verificationId={verif.id} userName={userName} />
              </div>
            ) : (
              <div
                className={`rounded-xl border p-5 ${
                  verif.statut === "verified"
                    ? "bg-niqo-success/5 border-niqo-success/20"
                    : "bg-niqo-danger/5 border-niqo-danger/20"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {verif.statut === "verified" ? (
                    <CheckCircle2
                      className="w-5 h-5 text-niqo-success"
                      strokeWidth={2.2}
                    />
                  ) : (
                    <XCircle
                      className="w-5 h-5 text-niqo-danger"
                      strokeWidth={2.2}
                    />
                  )}
                  <p
                    className={`font-display font-semibold ${
                      verif.statut === "verified"
                        ? "text-niqo-success"
                        : "text-niqo-danger"
                    }`}
                  >
                    Dossier {verif.statut === "verified" ? "validé" : "refusé"}
                  </p>
                </div>
                <p className="text-xs text-niqo-gray-500 mb-3">
                  {verif.reviewed_at
                    ? `Le ${formatDateLong(verif.reviewed_at)}`
                    : "—"}
                </p>
                {verif.reject_reason ? (
                  <div className="mt-3 pt-3 border-t border-niqo-gray-200">
                    <p className="text-xs font-mono uppercase tracking-widest text-niqo-gray-500 mb-1.5">
                      Raison
                    </p>
                    <p className="text-sm text-niqo-black">
                      {verif.reject_reason}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ statut }: { statut: VerifDetail["statut"] }) {
  if (statut === "pending") {
    return (
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-niqo-coral/10 text-niqo-coral text-sm font-medium">
        <Clock className="w-4 h-4" strokeWidth={2.4} />
        En attente
      </span>
    );
  }
  if (statut === "verified") {
    return (
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-niqo-success/10 text-niqo-success text-sm font-medium">
        <CheckCircle2 className="w-4 h-4" strokeWidth={2.4} />
        Validé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-niqo-danger/10 text-niqo-danger text-sm font-medium">
      <XCircle className="w-4 h-4" strokeWidth={2.4} />
      Refusé
    </span>
  );
}

function InfoRow({
  Icon,
  label,
  value,
}: {
  Icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        className="w-4 h-4 text-niqo-gray-500 mt-0.5 shrink-0"
        strokeWidth={2.2}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-niqo-gray-500">{label}</p>
        <p className="text-niqo-black font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

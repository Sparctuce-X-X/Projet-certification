import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarX,
  CheckCircle2,
  Clock,
  Flag,
  Info,
  MapPin,
  MessageCircle,
  Quote,
  ShoppingBag,
  User,
  XCircle,
} from "lucide-react";

import { Avatar } from "@/components/admin/Avatar";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime, formatParisDateShort } from "@/lib/date-format";

import { ActionButtons } from "./_action-buttons";
import { RelatedSignalements } from "./_related-signalements";
import { RevertAnnonceButton } from "./_revert-annonce-button";
import { TargetActionButton } from "./_target-action-button";

export const metadata: Metadata = {
  title: "Signalement · Niqo Admin",
  robots: { index: false, follow: false },
};

type TargetType = "annonce" | "utilisateur" | "message" | "rdv_post";
type Statut = "en_attente" | "traite" | "rejete";

type MotifCategorie =
  | "no_show"
  | "produit_different"
  | "produit_defectueux"
  | "tentative_fraude"
  | "comportement_dangereux"
  | "complot_fraude"
  | "autre";

interface RdvSnapshot {
  conversation_id: string;
  annonce_id: string | null;
  annonce_titre: string | null;
  annonce_prix: number | null;
  annonce_statut: string | null;
  acheteur_id: string;
  acheteur_prenom: string | null;
  vendeur_id: string;
  vendeur_prenom: string | null;
  rdv_lieu: string | null;
  rdv_date: string | null;
  rdv_confirme_at: string | null;
  rencontre_acheteur: boolean | null;
  rencontre_vendeur: boolean | null;
  rencontre_decided_at: string | null;
  snapshot_at: string;
}

interface SignalementDetail {
  id: string;
  target_type: TargetType;
  target_id: string;
  motif: string;
  description: string | null;
  statut: Statut;
  created_at: string;
  updated_at: string;
  motif_categorie: MotifCategorie | null;
  rdv_snapshot: RdvSnapshot | null;
  role_signaleur: "acheteur" | "vendeur" | null;
  signaleur: {
    id: string;
    prenom: string | null;
    nom: string | null;
    avatar_url: string | null;
    email: string | null;
    pays: string | null;
    ville: string | null;
  } | null;
}

const MOTIF_CATEGORIE_LABEL: Record<MotifCategorie, string> = {
  no_show: "Absent au rendez-vous",
  produit_different: "Produit ne correspond pas à l'annonce",
  produit_defectueux: "Produit défectueux ou cassé",
  tentative_fraude: "Tentative de fraude",
  comportement_dangereux: "Comportement dangereux",
  complot_fraude: "Complot / coordination malveillante",
  autre: "Autre",
};

const FRAUD_MOTIFS: MotifCategorie[] = ["tentative_fraude", "complot_fraude"];

interface UserMiniData {
  id: string;
  prenom: string | null;
  nom: string | null;
  avatar_url: string | null;
  score_abus: number;
  nb_signalements: number;
  is_active: boolean;
}

interface AnnonceTarget {
  id: string;
  titre: string;
  description: string;
  prix: number;
  photos: string[];
  statut: string;
  ville: string;
  pays: string;
  vendeur_id: string;
  created_at: string;
  vendeur: UserMiniData | null;
}

interface UserTarget {
  id: string;
  prenom: string | null;
  nom: string | null;
  avatar_url: string | null;
  email: string | null;
  pays: string | null;
  ville: string | null;
  nb_ventes: number;
  nb_achats: number;
  nb_signalements: number;
  score_abus: number;
  is_active: boolean;
  created_at: string;
}

interface MessageTarget {
  id: string;
  contenu: string;
  type: string;
  is_deleted: boolean;
  created_at: string;
  conversation_id: string;
  expediteur_id: string;
  conversation: {
    id: string;
    annonce_id: string | null;
    acheteur_id: string;
    vendeur_id: string;
  } | null;
  expediteur: UserMiniData | null;
}

interface RdvPostTarget {
  /** Snapshot immuable au moment du signalement (mig 91). */
  snapshot: RdvSnapshot;
  /** État frais de la conv si encore présente (peut diverger du snapshot si suite RDV après signalement). */
  fresh: {
    rencontre_acheteur: boolean | null;
    rencontre_vendeur: boolean | null;
    rencontre_decided_at: string | null;
  } | null;
  /** Annonce courante (peut être suspendue/supprimée depuis). */
  annonceFresh: {
    id: string;
    titre: string;
    statut: string;
  } | null;
  /** Photos de l'annonce signalée (URLs publiques). Vide si annonce supprimée. */
  annoncePhotos: string[];
  /** Parties (acheteur + vendeur) — données fraîches pour Risk Box. */
  acheteurUser: UserMiniData | null;
  vendeurUser: UserMiniData | null;
  /** Photos preuves uploadées par les parties (mig 92). Signed URLs 1h. */
  photos: {
    id: string;
    auteur_id: string;
    role_auteur: "acheteur" | "vendeur";
    storage_path: string;
    signedUrl: string | null;
    created_at: string;
  }[];
}

const COUNTRY_LABEL: Record<string, string> = {
  CI: "Côte d'Ivoire",
  CG: "Congo",
};

const TYPE_LABEL: Record<TargetType, string> = {
  annonce: "annonce",
  utilisateur: "utilisateur",
  message: "message",
  rdv_post: "RDV",
};

function formatDate(iso: string): string {
  return formatParisDateTime(iso);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return formatParisDateShort(iso);
}

function displayName(prenom: string | null, nom: string | null): string {
  const p = prenom ?? "";
  const n = nom && nom !== "—" ? nom : "";
  return `${p} ${n}`.trim() || "—";
}

export default async function SignalementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: rawSignalement, error } = await supabase
    .from("signalements")
    .select(
      `
      id, target_type, target_id, motif, description, statut, created_at, updated_at,
      motif_categorie, rdv_snapshot, role_signaleur,
      signaleur:users!signaleur_id (
        id, prenom, nom, avatar_url, email, pays, ville
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !rawSignalement) {
    notFound();
  }

  const signalement = rawSignalement as unknown as SignalementDetail;

  // ── Fetch la cible selon target_type ────────────────────────────────────
  let annonceTarget: AnnonceTarget | null = null;
  let userTarget: UserTarget | null = null;
  let messageTarget: MessageTarget | null = null;
  let rdvPostTarget: RdvPostTarget | null = null;

  if (signalement.target_type === "annonce") {
    const { data } = await supabase
      .from("annonces")
      .select(
        `
        id, titre, description, prix, photos, statut, ville, pays, vendeur_id, created_at,
        vendeur:users!vendeur_id (
          id, prenom, nom, avatar_url, score_abus, nb_signalements, is_active
        )
      `
      )
      .eq("id", signalement.target_id)
      .maybeSingle();
    annonceTarget = data as unknown as AnnonceTarget | null;

    if (annonceTarget?.photos?.length) {
      annonceTarget = {
        ...annonceTarget,
        photos: annonceTarget.photos.map(
          (path) =>
            supabase.storage.from("annonces-photos").getPublicUrl(path).data
              .publicUrl
        ),
      };
    }
  } else if (signalement.target_type === "utilisateur") {
    const { data } = await supabase
      .from("users")
      .select(
        "id, prenom, nom, avatar_url, email, pays, ville, nb_ventes, nb_achats, nb_signalements, score_abus, is_active, created_at"
      )
      .eq("id", signalement.target_id)
      .maybeSingle();
    userTarget = data as UserTarget | null;
  } else if (signalement.target_type === "message") {
    const { data } = await supabase
      .from("messages")
      .select(
        `
        id, contenu, type, is_deleted, created_at, conversation_id, expediteur_id,
        conversation:conversations!conversation_id (
          id, annonce_id, acheteur_id, vendeur_id
        ),
        expediteur:users!expediteur_id (
          id, prenom, nom, avatar_url, score_abus, nb_signalements, is_active
        )
      `
      )
      .eq("id", signalement.target_id)
      .maybeSingle();
    messageTarget = data as unknown as MessageTarget | null;
  } else if (signalement.target_type === "rdv_post" && signalement.rdv_snapshot) {
    const snapshot = signalement.rdv_snapshot;

    // Fresh state conv (peut diverger si évolution post-signalement)
    const { data: convFresh } = await supabase
      .from("conversations")
      .select("rencontre_acheteur, rencontre_vendeur, rencontre_decided_at")
      .eq("id", signalement.target_id)
      .maybeSingle();

    // Fresh state annonce (peut être suspendue/expirée depuis) + photos
    let annonceFresh: RdvPostTarget["annonceFresh"] = null;
    let annoncePhotos: string[] = [];
    if (snapshot.annonce_id) {
      const { data: annonce } = await supabase
        .from("annonces")
        .select("id, titre, statut, photos")
        .eq("id", snapshot.annonce_id)
        .maybeSingle();
      if (annonce) {
        annonceFresh = {
          id: annonce.id as string,
          titre: annonce.titre as string,
          statut: annonce.statut as string,
        };
        const rawPhotos = (annonce.photos as string[] | null) ?? [];
        annoncePhotos = rawPhotos.map(
          (path) =>
            supabase.storage.from("annonces-photos").getPublicUrl(path).data
              .publicUrl
        );
      }
    }

    // Parties (toujours via IDs du snapshot pour résolution stable)
    const { data: parties } = await supabase
      .from("users")
      .select("id, prenom, nom, avatar_url, score_abus, nb_signalements, is_active")
      .in("id", [snapshot.acheteur_id, snapshot.vendeur_id]);

    const acheteurUser =
      (parties as UserMiniData[] | null)?.find((u) => u.id === snapshot.acheteur_id) ?? null;
    const vendeurUser =
      (parties as UserMiniData[] | null)?.find((u) => u.id === snapshot.vendeur_id) ?? null;

    // Photos preuves (mig 92) — admin SELECT all via RLS
    const { data: rawPhotos } = await supabase
      .from("rencontre_photos")
      .select("id, auteur_id, role_auteur, storage_path, created_at")
      .eq("conversation_id", signalement.target_id)
      .order("created_at", { ascending: true });

    const photos = await Promise.all(
      (rawPhotos ?? []).map(async (p) => {
        const { data } = await supabase.storage
          .from("rencontre-photos")
          .createSignedUrl(p.storage_path, 3600);
        return {
          id: p.id as string,
          auteur_id: p.auteur_id as string,
          role_auteur: p.role_auteur as "acheteur" | "vendeur",
          storage_path: p.storage_path as string,
          signedUrl: data?.signedUrl ?? null,
          created_at: p.created_at as string,
        };
      })
    );

    rdvPostTarget = {
      snapshot,
      fresh: convFresh ?? null,
      annonceFresh,
      annoncePhotos,
      acheteurUser,
      vendeurUser,
      photos,
    };
  }

  // ── Fiabilité signaleur : count des signalements précédents par statut ─
  let signaleurStats = {
    total: 0,
    traite: 0,
    rejete: 0,
    en_attente: 0,
  };
  if (signalement.signaleur?.id) {
    const { data: history } = await supabase
      .from("signalements")
      .select("statut")
      .eq("signaleur_id", signalement.signaleur.id)
      .neq("id", signalement.id); // exclure le signalement courant
    if (history) {
      const total = history.length;
      const traite = history.filter((r) => r.statut === "traite").length;
      const rejete = history.filter((r) => r.statut === "rejete").length;
      signaleurStats = {
        total,
        traite,
        rejete,
        en_attente: total - traite - rejete,
      };
    }
  }

  // ── La "personne réelle" affectée par un traitement (pour Risk Box) ────
  const targetUser: UserMiniData | null =
    signalement.target_type === "annonce"
      ? annonceTarget?.vendeur ?? null
      : signalement.target_type === "utilisateur"
      ? userTarget
        ? {
            id: userTarget.id,
            prenom: userTarget.prenom,
            nom: userTarget.nom,
            avatar_url: userTarget.avatar_url,
            score_abus: userTarget.score_abus,
            nb_signalements: userTarget.nb_signalements,
            is_active: userTarget.is_active,
          }
        : null
      : signalement.target_type === "message"
      ? messageTarget?.expediteur ?? null
      : signalement.target_type === "rdv_post" && rdvPostTarget
      ? signalement.role_signaleur === "acheteur"
        ? rdvPostTarget.vendeurUser
        : rdvPostTarget.acheteurUser
      : null;

  const targetScoreAbus = targetUser?.score_abus ?? 0;
  const targetIsActive = targetUser?.is_active ?? true;

  const isPending = signalement.statut === "en_attente";

  // Label cible pour le preview impact (passé au composant client)
  const cibleLabel =
    signalement.target_type === "annonce"
      ? annonceTarget?.titre ?? "Annonce introuvable"
      : signalement.target_type === "utilisateur"
      ? displayName(userTarget?.prenom ?? null, userTarget?.nom ?? null)
      : signalement.target_type === "message"
      ? `Message · ${displayName(messageTarget?.expediteur?.prenom ?? null, messageTarget?.expediteur?.nom ?? null)}`
      : signalement.target_type === "rdv_post" && rdvPostTarget
      ? `RDV · ${rdvPostTarget.snapshot.annonce_titre ?? "Annonce"}`
      : "Cible";

  const targetFound =
    (signalement.target_type === "annonce" && annonceTarget) ||
    (signalement.target_type === "utilisateur" && userTarget) ||
    (signalement.target_type === "message" && messageTarget) ||
    (signalement.target_type === "rdv_post" && rdvPostTarget);

  return (
    <div className="px-8 py-8 max-w-6xl">
      {/* ── Back link ──────────────────────────────────────────────────── */}
      <Link
        href="/admin/signalements"
        className="inline-flex items-center gap-1.5 text-sm text-niqo-gray-500 hover:text-niqo-black transition-colors mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
        Tous les signalements
      </Link>

      {/* ── Header compact ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-niqo-coral/10 text-niqo-coral shrink-0">
          <Flag className="w-5 h-5" strokeWidth={2.2} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-xl font-bold text-niqo-black">
              Signalement<span className="text-niqo-coral">.</span>
            </h1>
            <StatusBadge statut={signalement.statut} />
          </div>
          <p className="text-xs text-niqo-gray-500 mt-0.5 inline-flex items-center gap-1.5">
            <TargetTypeIcon type={signalement.target_type} />
            <span className="capitalize">{TYPE_LABEL[signalement.target_type]}</span>
            <span>·</span>
            <span>{timeAgo(signalement.created_at)}</span>
            <span>·</span>
            <code className="font-mono text-niqo-gray-500">
              {signalement.id.slice(0, 8)}
            </code>
          </p>
        </div>
      </div>

      {/* ── Bande narrative ───────────────────────────────────────────── */}
      <NarrativeBand
        signaleurName={
          signalement.signaleur
            ? displayName(signalement.signaleur.prenom, signalement.signaleur.nom)
            : "Quelqu'un"
        }
        targetType={signalement.target_type}
        targetName={cibleLabel}
        motif={signalement.motif}
        description={signalement.description}
      />

      {/* ── Layout 2 colonnes ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-6">
        {/* ── Col gauche : cible ──────────────────────────────────────── */}
        <div>
          {targetFound ? (
            signalement.target_type === "annonce" && annonceTarget ? (
              <AnnonceTargetCard data={annonceTarget} />
            ) : signalement.target_type === "utilisateur" && userTarget ? (
              <UserTargetCard data={userTarget} />
            ) : signalement.target_type === "message" && messageTarget ? (
              <MessageTargetCard data={messageTarget} />
            ) : signalement.target_type === "rdv_post" && rdvPostTarget ? (
              <RdvPostTargetCard
                data={rdvPostTarget}
                motifCategorie={signalement.motif_categorie}
                roleSignaleur={signalement.role_signaleur}
                signalementId={signalement.id}
                signalementStatut={signalement.statut}
              />
            ) : null
          ) : (
            <CibleIntrouvableCard targetType={signalement.target_type} />
          )}
        </div>

        {/* ── Col droite : signaleur + risque + décision ──────────────── */}
        <div className="space-y-4">
          {/* Signaleur */}
          {signalement.signaleur ? (
            <section className="bg-white border border-niqo-gray-200 rounded-xl p-4">
              <SectionLabel>Signaleur</SectionLabel>
              <div className="flex items-start gap-3">
                <Avatar
                  url={signalement.signaleur.avatar_url}
                  prenom={signalement.signaleur.prenom}
                  nom={signalement.signaleur.nom}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-niqo-black truncate">
                    {displayName(
                      signalement.signaleur.prenom,
                      signalement.signaleur.nom
                    )}
                  </p>
                  <p className="text-xs text-niqo-gray-500 truncate">
                    {signalement.signaleur.email ?? "—"}
                  </p>
                  {signalement.signaleur.ville ? (
                    <p className="text-xs text-niqo-gray-500 mt-0.5 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" strokeWidth={2.2} />
                      {signalement.signaleur.ville}
                      {signalement.signaleur.pays
                        ? ` · ${COUNTRY_LABEL[signalement.signaleur.pays] ?? signalement.signaleur.pays}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Fiabilité : verdict + breakdown */}
              <FiabiliteBlock stats={signaleurStats} />
            </section>
          ) : (
            <section className="bg-white border border-niqo-gray-200 rounded-xl p-4">
              <SectionLabel>Signaleur</SectionLabel>
              <p className="text-sm text-niqo-gray-500">
                Inconnu (compte supprimé)
              </p>
            </section>
          )}

          {/* Risque cible */}
          {targetUser ? (
            <RiskBox
              scoreAbus={targetUser.score_abus}
              nbSignalements={targetUser.nb_signalements}
              isActive={targetUser.is_active}
            />
          ) : null}

          {/* Décision sur le signalement */}
          <section className="bg-white border border-niqo-gray-200 rounded-xl p-4 sticky top-6 space-y-4">
            <div>
              <SectionLabel>Décision sur le signalement</SectionLabel>
              {isPending ? (
                <ActionButtons
                  signalementId={signalement.id}
                  cibleLabel={cibleLabel}
                  targetScoreAbus={targetScoreAbus}
                  targetIsActive={targetIsActive}
                  targetType={signalement.target_type}
                  motifCategorie={signalement.motif_categorie}
                />
              ) : (
                <DecidedBlock
                  statut={signalement.statut as Exclude<Statut, "en_attente">}
                  decidedAt={signalement.updated_at}
                />
              )}
            </div>

            {/* Action sur la cible — skip pour rdv_post (auto-suspend côté DB
                si motif=fraude validé via fn_signalement_check_threshold mig 91) */}
            {targetFound && signalement.target_type !== "rdv_post" ? (
              <div className="pt-4 border-t border-niqo-gray-100">
                <SectionLabel>Action sur la cible</SectionLabel>
                <TargetActionButton
                  signalementId={signalement.id}
                  targetType={signalement.target_type}
                  targetId={signalement.target_id}
                  annonceStatut={annonceTarget?.statut}
                  userIsActive={userTarget?.is_active}
                  messageIsDeleted={messageTarget?.is_deleted}
                />
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {/* ── Signalements liés (matching tuple target_type+target_id) ─────── */}
      <RelatedSignalements
        currentSignalementId={signalement.id}
        targetType={signalement.target_type}
        targetId={signalement.target_id}
      />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[11px] font-bold text-niqo-gray-500 uppercase tracking-wider mb-3">
      {children}
    </h2>
  );
}

function StatusBadge({ statut }: { statut: Statut }) {
  if (statut === "en_attente") {
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-niqo-coral/10 text-niqo-coral text-[11px] font-medium uppercase tracking-wider">
        <Clock className="w-3 h-3" strokeWidth={2.4} />
        En attente
      </span>
    );
  }
  if (statut === "traite") {
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-niqo-success/10 text-niqo-success text-[11px] font-medium uppercase tracking-wider">
        <CheckCircle2 className="w-3 h-3" strokeWidth={2.4} />
        Traité
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-niqo-gray-100 text-niqo-gray-800 text-[11px] font-medium uppercase tracking-wider">
      <XCircle className="w-3 h-3" strokeWidth={2.4} />
      Rejeté
    </span>
  );
}

function TargetTypeIcon({ type }: { type: TargetType }) {
  const Icon =
    type === "annonce"
      ? ShoppingBag
      : type === "utilisateur"
        ? User
        : type === "rdv_post"
          ? CalendarX
          : MessageCircle;
  return <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />;
}

// ── Bande narrative ─────────────────────────────────────────────────────────

function NarrativeBand({
  signaleurName,
  targetType,
  targetName,
  motif,
  description,
}: {
  signaleurName: string;
  targetType: TargetType;
  targetName: string;
  motif: string;
  description: string | null;
}) {
  return (
    <section className="bg-niqo-coral/5 border border-niqo-coral/20 rounded-xl px-6 py-5">
      <p className="text-[11px] text-niqo-gray-500 uppercase tracking-wider mb-2 inline-flex items-center gap-1.5">
        <span className="font-medium text-niqo-gray-800">{signaleurName}</span>
        <span>signale</span>
        <ArrowRight className="w-3 h-3" strokeWidth={2.2} />
        <span className="font-medium text-niqo-gray-800 truncate max-w-[200px]" title={targetName}>
          {targetName}
        </span>
        <span>·</span>
        <span className="capitalize">{TYPE_LABEL[targetType]}</span>
      </p>
      <h2 className="font-display text-2xl font-bold text-niqo-black leading-tight">
        {motif}
        <span className="text-niqo-coral">.</span>
      </h2>
      {description ? (
        <div className="mt-3 flex gap-2.5 max-w-2xl">
          <Quote
            className="w-3.5 h-3.5 text-niqo-coral mt-1 shrink-0"
            strokeWidth={2.4}
          />
          <p className="text-sm text-niqo-gray-800 leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        </div>
      ) : (
        <p className="text-xs text-niqo-gray-500 italic mt-2">
          Aucune description fournie par le signaleur.
        </p>
      )}
    </section>
  );
}

// ── Risk Box ────────────────────────────────────────────────────────────────

function RiskBox({
  scoreAbus,
  nbSignalements,
  isActive,
}: {
  scoreAbus: number;
  nbSignalements: number;
  isActive: boolean;
}) {
  const willSuspendOnTraite = scoreAbus + 1 >= 3 && isActive;
  const isCritical = scoreAbus >= 2 || !isActive;

  return (
    <section
      className={`rounded-xl p-4 border ${
        !isActive
          ? "bg-niqo-danger/5 border-niqo-danger/30"
          : isCritical
          ? "bg-niqo-coral/5 border-niqo-coral/30"
          : "bg-white border-niqo-gray-200"
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Risque cible</SectionLabel>
        {!isActive ? (
          <span className="text-[10px] font-bold uppercase tracking-wider text-niqo-danger">
            Suspendu
          </span>
        ) : null}
      </div>

      {/* Gauge dots */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full ${
                i < scoreAbus
                  ? scoreAbus >= 3
                    ? "bg-niqo-danger"
                    : scoreAbus === 2
                    ? "bg-niqo-coral"
                    : "bg-niqo-gray-800"
                  : "bg-niqo-gray-200"
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-sm text-niqo-black font-medium">
          {scoreAbus} / 3
        </span>
        <span className="text-xs text-niqo-gray-500 ml-auto">
          {nbSignalements}{" "}
          {nbSignalements > 1 ? "signalements" : "signalement"}
        </span>
      </div>

      {willSuspendOnTraite ? (
        <p className="text-xs text-niqo-danger font-medium leading-relaxed inline-flex items-start gap-1.5 mt-2">
          <AlertTriangle
            className="w-3.5 h-3.5 mt-0.5 shrink-0"
            strokeWidth={2.4}
          />
          <span>Suspension auto si ce signalement est confirmé</span>
        </p>
      ) : isActive && scoreAbus >= 1 ? (
        <p className="text-xs text-niqo-gray-800 leading-relaxed mt-1">
          Score à surveiller. Suspension à 3 confirmés en 30j.
        </p>
      ) : isActive ? (
        <p className="text-xs text-niqo-gray-500 leading-relaxed mt-1">
          Aucun antécédent. Compte fiable.
        </p>
      ) : (
        <p className="text-xs text-niqo-danger leading-relaxed mt-1">
          Compte déjà suspendu — pas d&apos;impact supplémentaire.
        </p>
      )}
    </section>
  );
}

// ── Fiabilité signaleur ─────────────────────────────────────────────────────

function FiabiliteBlock({
  stats,
}: {
  stats: { total: number; traite: number; rejete: number; en_attente: number };
}) {
  let verdict: { label: string; tone: "fiable" | "neutre" | "douteux" };

  if (stats.total === 0) {
    verdict = { label: "Première plainte", tone: "neutre" };
  } else if (stats.traite >= 2 && stats.traite > stats.rejete) {
    verdict = { label: "Vétéran fiable", tone: "fiable" };
  } else if (stats.rejete >= 2 && stats.rejete > stats.traite) {
    verdict = { label: "Faible fiabilité (rejets)", tone: "douteux" };
  } else {
    verdict = { label: "Historique mitigé", tone: "neutre" };
  }

  const toneClass =
    verdict.tone === "fiable"
      ? "text-niqo-success"
      : verdict.tone === "douteux"
      ? "text-niqo-coral"
      : "text-niqo-gray-500";

  return (
    <div className="mt-3 pt-3 border-t border-niqo-gray-100">
      <p className={`text-xs font-medium ${toneClass} mb-1`}>{verdict.label}</p>
      {stats.total > 0 ? (
        <p className="text-[11px] text-niqo-gray-500 leading-relaxed">
          <span className="font-mono">{stats.traite}</span> traités ·{" "}
          <span className="font-mono">{stats.rejete}</span> rejetés
          {stats.en_attente > 0 ? (
            <>
              {" · "}
              <span className="font-mono">{stats.en_attente}</span> en attente
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-[11px] text-niqo-gray-500 leading-relaxed">
          Aucun autre signalement à son actif.
        </p>
      )}
    </div>
  );
}

// ── Bloc "déjà décidé" ──────────────────────────────────────────────────────

function DecidedBlock({
  statut,
  decidedAt,
}: {
  statut: Exclude<Statut, "en_attente">;
  decidedAt: string;
}) {
  const isTraite = statut === "traite";
  return (
    <div
      className={`rounded-lg p-3 ${
        isTraite
          ? "bg-niqo-success/5 border border-niqo-success/20"
          : "bg-niqo-gray-50 border border-niqo-gray-200"
      }`}
    >
      <p
        className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${
          isTraite ? "text-niqo-success" : "text-niqo-gray-500"
        }`}
      >
        {isTraite ? "Confirmé" : "Rejeté"}
      </p>
      <p className="text-xs text-niqo-gray-800">
        Décidé le {formatDate(decidedAt)}
      </p>
    </div>
  );
}

// ── Cible introuvable ───────────────────────────────────────────────────────

function CibleIntrouvableCard({ targetType }: { targetType: TargetType }) {
  return (
    <section className="bg-niqo-coral/5 border border-niqo-coral/30 rounded-xl p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-niqo-coral/10 text-niqo-coral mx-auto mb-3 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6" strokeWidth={2.2} />
      </div>
      <p className="font-display text-base font-bold text-niqo-black mb-1.5">
        {targetType === "annonce"
          ? "Annonce supprimée"
          : targetType === "utilisateur"
          ? "Utilisateur introuvable"
          : targetType === "rdv_post"
          ? "Snapshot RDV manquant"
          : "Message supprimé"}
      </p>
      <p className="text-sm text-niqo-gray-800 max-w-md mx-auto">
        La cible n&apos;existe plus en DB depuis la soumission du signalement.
        Tu peux <strong>rejeter</strong> ce signalement (probablement obsolète),
        ou le marquer traité si la suppression est elle-même la preuve.
      </p>
    </section>
  );
}

// ── Cards par type de cible ─────────────────────────────────────────────────

function AnnonceTargetCard({ data }: { data: AnnonceTarget }) {
  return (
    <section className="bg-white border border-niqo-gray-200 border-l-4 border-l-niqo-coral rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-niqo-gray-100 bg-niqo-coral/5">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-niqo-coral/15 text-niqo-coral">
          <ShoppingBag className="w-4 h-4" strokeWidth={2.2} />
        </span>
        <span className="font-display text-xs font-bold text-niqo-coral uppercase tracking-wider">
          Annonce signalée
        </span>
        <span className="ml-auto text-[10px] text-niqo-gray-500 font-mono uppercase">
          {data.statut}
        </span>
      </div>

      <div className="p-5">
        {/* Galerie */}
        {data.photos && data.photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {data.photos.slice(0, 3).map((photo, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={photo}
                alt={`Photo ${i + 1}`}
                className="w-full aspect-square object-cover rounded-lg bg-niqo-gray-100"
              />
            ))}
          </div>
        ) : null}

        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h3 className="font-display text-lg font-bold text-niqo-black flex-1 min-w-0 truncate">
            {data.titre}
          </h3>
          <p className="font-mono text-base text-niqo-coral font-medium shrink-0">
            {data.prix.toLocaleString("fr-FR")} FCFA
          </p>
        </div>
        <p className="text-xs text-niqo-gray-500 inline-flex items-center gap-1 mb-3">
          <MapPin className="w-3 h-3" strokeWidth={2.2} />
          {data.ville} · {COUNTRY_LABEL[data.pays] ?? data.pays}
        </p>
        <p className="text-sm text-niqo-gray-800 leading-relaxed mb-4 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {data.description}
        </p>

        {data.vendeur ? (
          <div className="border-t border-niqo-gray-100 pt-3 mt-3">
            <SectionLabel>Vendeur</SectionLabel>
            <UserMini data={data.vendeur} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function UserTargetCard({ data }: { data: UserTarget }) {
  return (
    <section className="bg-white border border-niqo-gray-200 border-l-4 border-l-niqo-black rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-niqo-gray-100 bg-niqo-gray-50">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-niqo-black/10 text-niqo-black">
          <User className="w-4 h-4" strokeWidth={2.2} />
        </span>
        <span className="font-display text-xs font-bold text-niqo-black uppercase tracking-wider">
          Profil signalé
        </span>
        {!data.is_active ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-niqo-danger">
            <XCircle className="w-3 h-3" strokeWidth={2.4} />
            Suspendu
          </span>
        ) : null}
      </div>

      <div className="p-5">
        <div className="flex items-center gap-4 mb-5">
          <Avatar
            url={data.avatar_url}
            prenom={data.prenom}
            nom={data.nom}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold text-niqo-black truncate">
              {displayName(data.prenom, data.nom)}
            </p>
            <p className="text-xs text-niqo-gray-500 truncate">
              {data.email ?? "—"}
            </p>
            {data.ville ? (
              <p className="text-xs text-niqo-gray-500 mt-0.5 inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" strokeWidth={2.2} />
                {data.ville}
                {data.pays ? ` · ${COUNTRY_LABEL[data.pays] ?? data.pays}` : ""}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          <Stat label="Ventes" value={data.nb_ventes.toString()} />
          <Stat label="Achats" value={data.nb_achats.toString()} />
          <Stat
            label="Signalts"
            value={data.nb_signalements.toString()}
            warn={data.nb_signalements >= 2}
          />
          <Stat
            label="Score"
            value={`${data.score_abus}/3`}
            warn={data.score_abus >= 2}
            danger={data.score_abus >= 3}
          />
        </div>
      </div>
    </section>
  );
}

function MessageTargetCard({ data }: { data: MessageTarget }) {
  return (
    <section className="bg-white border border-niqo-gray-200 border-l-4 border-l-niqo-gray-500 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-niqo-gray-100 bg-niqo-gray-50">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-niqo-gray-200 text-niqo-gray-800">
          <MessageCircle className="w-4 h-4" strokeWidth={2.2} />
        </span>
        <span className="font-display text-xs font-bold text-niqo-gray-800 uppercase tracking-wider">
          Message signalé
        </span>
        <span className="ml-auto text-[10px] text-niqo-gray-500 font-mono uppercase">
          {data.type}
        </span>
      </div>

      <div className="p-5">
        {/* Bulle de chat */}
        <div className="bg-niqo-coral/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-md mb-3">
          <p className="text-sm text-niqo-black leading-relaxed whitespace-pre-wrap">
            {data.contenu}
          </p>
        </div>
        <p className="text-xs text-niqo-gray-500 mb-4">
          Envoyé le {formatDate(data.created_at)}
        </p>

        {data.expediteur ? (
          <div className="border-t border-niqo-gray-100 pt-3 mt-3">
            <SectionLabel>Expéditeur</SectionLabel>
            <UserMini data={data.expediteur} />
          </div>
        ) : null}

        {data.conversation?.annonce_id ? (
          <p className="text-xs text-niqo-gray-500 mt-3 inline-flex items-center gap-1">
            <ArrowRight className="w-3 h-3" strokeWidth={2.2} />
            Conversation liée à l&apos;annonce{" "}
            <code className="font-mono">
              {data.conversation.annonce_id.slice(0, 8)}
            </code>
          </p>
        ) : null}
      </div>
    </section>
  );
}

function RdvPostTargetCard({
  data,
  motifCategorie,
  roleSignaleur,
  signalementId,
  signalementStatut,
}: {
  data: RdvPostTarget;
  motifCategorie: MotifCategorie | null;
  roleSignaleur: "acheteur" | "vendeur" | null;
  signalementId: string;
  signalementStatut: Statut;
}) {
  const { snapshot, fresh, annonceFresh, annoncePhotos, acheteurUser, vendeurUser } = data;
  const isFraudMotif = motifCategorie ? FRAUD_MOTIFS.includes(motifCategorie) : false;

  // État rencontre actuel (frais si conv encore présente, sinon snapshot)
  const ach = fresh?.rencontre_acheteur ?? snapshot.rencontre_acheteur;
  const vend = fresh?.rencontre_vendeur ?? snapshot.rencontre_vendeur;

  // Annonce statut courant (peut diverger du snapshot)
  const annonceStatutNow = annonceFresh?.statut ?? snapshot.annonce_statut ?? "?";
  const annonceWasSuspendue = annonceStatutNow === "suspendue";

  // Mig 95 — bouton revert visible quand :
  //   - motif non-fraude (fraude → auto-suspend par mig 91)
  //   - signalement déjà traité (admin a décidé)
  //   - annonce encore en `en_cours` (pas vendue/suspendue/expiree/active)
  //   - annonce existe en DB (pas supprimée)
  const canRevertAnnonce =
    !isFraudMotif &&
    signalementStatut === "traite" &&
    annonceFresh?.statut === "en_cours";

  return (
    <section className="bg-white border border-niqo-gray-200 border-l-4 border-l-niqo-warning rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-niqo-gray-100 bg-niqo-warning/5">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-niqo-warning/15 text-niqo-warning">
          <CalendarX className="w-4 h-4" strokeWidth={2.2} />
        </span>
        <span className="font-display text-xs font-bold text-niqo-warning uppercase tracking-wider">
          RDV signalé
        </span>
        {isFraudMotif ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-niqo-danger">
            <AlertTriangle className="w-3 h-3" strokeWidth={2.4} />
            Motif fraude
          </span>
        ) : null}
      </div>

      <div className="p-5 space-y-4">
        {/* Motif typé */}
        {motifCategorie ? (
          <div>
            <SectionLabel>Motif typé</SectionLabel>
            <p
              className={`font-display text-base font-bold ${
                isFraudMotif ? "text-niqo-danger" : "text-niqo-black"
              }`}
            >
              {MOTIF_CATEGORIE_LABEL[motifCategorie]}
            </p>
            {roleSignaleur ? (
              <p className="text-xs text-niqo-gray-500 mt-1">
                Signalé par le{" "}
                <span className="font-medium text-niqo-gray-800">{roleSignaleur}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Annonce concernée */}
        <div className="border-t border-niqo-gray-100 pt-4">
          <SectionLabel>Annonce</SectionLabel>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <p className="font-display text-sm font-bold text-niqo-black flex-1 min-w-0 truncate">
              {snapshot.annonce_titre ?? "Annonce supprimée"}
            </p>
            {snapshot.annonce_prix !== null ? (
              <p className="font-mono text-xs text-niqo-coral font-medium shrink-0">
                {snapshot.annonce_prix.toLocaleString("fr-FR")} FCFA
              </p>
            ) : null}
          </div>
          <p className="text-[11px] text-niqo-gray-500 inline-flex items-center gap-1.5 uppercase font-mono">
            Statut : <span className="text-niqo-gray-800">{annonceStatutNow}</span>
            {annonceWasSuspendue ? (
              <span className="text-niqo-danger font-medium">· suspendue</span>
            ) : null}
          </p>

          {/* Galerie photos annonce — utile pour comparer vs preuves rencontre */}
          {annoncePhotos.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider mb-1.5">
                Photos de l&apos;annonce ({annoncePhotos.length})
              </p>
              <div className="grid grid-cols-4 gap-2">
                {annoncePhotos.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square rounded-lg overflow-hidden bg-niqo-gray-100 border border-niqo-gray-200 hover:border-niqo-coral transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Photo annonce ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-niqo-gray-500 mt-1.5 italic">
                Click → ouvrir en plein écran (nouvel onglet).
              </p>
            </div>
          ) : annonceFresh ? (
            <p className="text-[11px] text-niqo-gray-500 italic mt-2">
              Aucune photo sur l&apos;annonce.
            </p>
          ) : null}

          {/* Bouton revert (mig 95) — uniquement signalement traité non-fraude + annonce en_cours */}
          {canRevertAnnonce && annonceFresh ? (
            <div className="mt-4 pt-3 border-t border-niqo-gray-100">
              <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider mb-2">
                Action sur l&apos;annonce
              </p>
              <RevertAnnonceButton
                annonceId={annonceFresh.id}
                annonceTitre={annonceFresh.titre}
                signalementId={signalementId}
              />
              <p className="text-[10px] text-niqo-gray-500 italic mt-2 leading-relaxed">
                Le motif n&apos;est pas typé fraude → l&apos;annonce n&apos;a pas été
                auto-suspendue. Tu peux la libérer du gel{" "}
                <span className="font-mono">en_cours</span> si la situation
                t&apos;y autorise.
              </p>
            </div>
          ) : null}
        </div>

        {/* RDV : date + lieu */}
        <div className="border-t border-niqo-gray-100 pt-4">
          <SectionLabel>Rendez-vous</SectionLabel>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-niqo-gray-500 uppercase tracking-wider mb-1">
                Date
              </p>
              <p className="font-mono text-niqo-black">
                {snapshot.rdv_date
                  ? formatDate(snapshot.rdv_date)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-niqo-gray-500 uppercase tracking-wider mb-1">
                Lieu
              </p>
              <p className="text-niqo-black">{snapshot.rdv_lieu ?? "—"}</p>
            </div>
          </div>
        </div>

        {/* État rencontre (frais si dispo, sinon snapshot) */}
        <div className="border-t border-niqo-gray-100 pt-4">
          <SectionLabel>État rencontre</SectionLabel>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <RencontreSide
              label={`Acheteur (${snapshot.acheteur_prenom ?? "?"})`}
              state={ach}
            />
            <RencontreSide
              label={`Vendeur (${snapshot.vendeur_prenom ?? "?"})`}
              state={vend}
            />
          </div>
          {fresh && fresh !== null
            ? null
            : snapshot.rencontre_decided_at && (
                <p className="text-[10px] text-niqo-gray-500 mt-2 italic">
                  État au moment du signalement (conv plus accessible)
                </p>
              )}
        </div>

        {/* Parties — mini cards score abus */}
        <div className="border-t border-niqo-gray-100 pt-4">
          <SectionLabel>Parties impliquées</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {acheteurUser ? (
              <div>
                <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider mb-1">
                  Acheteur
                </p>
                <UserMini data={acheteurUser} />
              </div>
            ) : null}
            {vendeurUser ? (
              <div>
                <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider mb-1">
                  Vendeur
                </p>
                <UserMini data={vendeurUser} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Photos preuves (mig 92) */}
        {data.photos.length > 0 ? (
          <div className="border-t border-niqo-gray-100 pt-4">
            <SectionLabel>
              Preuves photo · {data.photos.length}
            </SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {data.photos.map((photo) => (
                <a
                  key={photo.id}
                  href={photo.signedUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${photo.role_auteur} · ${formatDate(photo.created_at)}`}
                  className="group relative block aspect-square rounded-lg overflow-hidden bg-niqo-gray-100 border border-niqo-gray-200 hover:border-niqo-coral transition-colors"
                >
                  {photo.signedUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={photo.signedUrl}
                      alt={`Preuve ${photo.role_auteur}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-[10px] text-niqo-gray-500">
                        URL expirée
                      </span>
                    </div>
                  )}
                  <span
                    className={`absolute bottom-1 left-1 inline-flex items-center h-5 px-1.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      photo.role_auteur === "acheteur"
                        ? "bg-niqo-success/90 text-white"
                        : "bg-niqo-black/80 text-white"
                    }`}
                  >
                    {photo.role_auteur}
                  </span>
                </a>
              ))}
            </div>
            <p className="text-[10px] text-niqo-gray-500 mt-2 italic">
              Click image → ouvrir en plein écran (nouvel onglet, signed URL 1h).
            </p>
          </div>
        ) : null}

        {/* Snapshot info banner */}
        <div className="rounded-lg bg-niqo-gray-50 border border-niqo-gray-200 p-3 inline-flex items-start gap-2">
          <Info
            className="w-3.5 h-3.5 text-niqo-gray-500 mt-0.5 shrink-0"
            strokeWidth={2.2}
          />
          <p className="text-[11px] text-niqo-gray-800 leading-relaxed">
            Ce signalement contient un{" "}
            <span className="font-medium">snapshot immuable</span> du RDV au moment
            où il a été soumis (
            <span className="font-mono">{formatDate(snapshot.snapshot_at)}</span>).
            Les données ci-dessus restent consultables même si la conv ou
            l&apos;annonce est supprimée par la suite.
          </p>
        </div>

        {isFraudMotif ? (
          <div className="rounded-lg bg-niqo-danger/5 border border-niqo-danger/30 p-3 inline-flex items-start gap-2">
            <AlertTriangle
              className="w-3.5 h-3.5 text-niqo-danger mt-0.5 shrink-0"
              strokeWidth={2.4}
            />
            <p className="text-[11px] text-niqo-danger leading-relaxed">
              <span className="font-bold uppercase tracking-wider">
                Auto-action si traité :
              </span>{" "}
              le motif est typé{" "}
              <span className="font-mono">{motifCategorie}</span>, donc l&apos;annonce
              concernée sera automatiquement passée en{" "}
              <span className="font-mono">suspendue</span> par le trigger
              fn_signalement_check_threshold (mig 91).
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RencontreSide({
  label,
  state,
}: {
  label: string;
  state: boolean | null;
}) {
  const config =
    state === true
      ? {
          icon: <CalendarCheck className="w-3 h-3" strokeWidth={2.4} />,
          text: "On s'est vus",
          tone: "text-niqo-success",
        }
      : state === false
      ? {
          icon: <XCircle className="w-3 h-3" strokeWidth={2.4} />,
          text: "Ne s'est pas vu",
          tone: "text-niqo-danger",
        }
      : {
          icon: <Clock className="w-3 h-3" strokeWidth={2.4} />,
          text: "Pas répondu",
          tone: "text-niqo-gray-500",
        };
  return (
    <div className="bg-niqo-gray-50 rounded-lg p-2.5">
      <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider mb-1.5 truncate">
        {label}
      </p>
      <p className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.tone}`}>
        {config.icon}
        {config.text}
      </p>
    </div>
  );
}

function UserMini({ data }: { data: UserMiniData }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar
        url={data.avatar_url}
        prenom={data.prenom}
        nom={data.nom}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-niqo-black truncate">
          {displayName(data.prenom, data.nom)}
        </p>
        <p className="text-xs text-niqo-gray-500 inline-flex items-center gap-2">
          <span>
            {data.nb_signalements}{" "}
            {data.nb_signalements > 1 ? "signalements" : "signalement"}
          </span>
          <span>·</span>
          <span
            className={
              data.score_abus >= 2
                ? "text-niqo-danger font-medium"
                : "text-niqo-gray-500"
            }
          >
            score {data.score_abus}/3
          </span>
        </p>
      </div>
      {!data.is_active ? (
        <span className="inline-flex items-center h-5 px-1.5 rounded bg-niqo-danger/10 text-niqo-danger text-[10px] font-bold uppercase tracking-wider">
          Suspendu
        </span>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  danger,
}: {
  label: string;
  value: string;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="bg-niqo-gray-50 rounded-lg px-2.5 py-2">
      <p className="text-[10px] text-niqo-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p
        className={`font-mono text-sm font-medium mt-0.5 ${
          danger
            ? "text-niqo-danger"
            : warn
            ? "text-niqo-coral"
            : "text-niqo-black"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

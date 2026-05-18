import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import type { AdminKpisAlerts } from "@/lib/admin/kpis";

interface AlertBandProps {
  alerts: AdminKpisAlerts;
}

interface AlertItem {
  count: number;
  label: string;
  href: string;
}

/**
 * Bande "actions en attente" au-dessus des panels KPIs.
 *
 * Pourquoi P0 (cf. audit UX 2026-05-11) : Dom regarde /admin/kpis chaque
 * matin. Avant de lire les chiffres, il doit savoir s'il y a des trucs
 * urgents à traiter (signalements stale, KYC en attente). Sinon il loupe
 * les SLAs 24h/48h.
 *
 * Si `total === 0` : affiche une bande "tout est sous contrôle" en
 * niqo-success (renforce le feedback positif quand l'admin est à jour).
 */
export function AlertBand({ alerts }: AlertBandProps) {
  const items: AlertItem[] = [
    {
      count: alerts.signalements_pending_24h_plus,
      label: alerts.signalements_pending_24h_plus > 1
        ? "signalements en attente >24h"
        : "signalement en attente >24h",
      href: "/admin/signalements",
    },
    {
      count: alerts.kyc_pending_48h_plus,
      label: alerts.kyc_pending_48h_plus > 1
        ? "vérifications KYC en attente >48h"
        : "vérification KYC en attente >48h",
      href: "/admin/verifications",
    },
    {
      count: alerts.boosts_stuck_pending,
      label: alerts.boosts_stuck_pending > 1
        ? "paiements boost stuck (webhook PawaPay non-arrivé)"
        : "paiement boost stuck (webhook PawaPay non-arrivé)",
      href: "/admin/observability",
    },
    {
      count: alerts.suspended_30d,
      label: "comptes suspendus (30 derniers jours, info)",
      href: "/admin/signalements?statut=traite",
    },
  ].filter((i) => i.count > 0);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-niqo-success/30 bg-niqo-success/5 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-niqo-success" strokeWidth={2.2} />
        <p className="text-sm text-niqo-gray-800">
          <span className="font-medium text-niqo-success">Aucune action en attente.</span>
          {" "}Tout est sous contrôle ce matin.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-niqo-coral" strokeWidth={2.2} />
        <p className="text-sm font-semibold text-niqo-black">
          {alerts.total} action{alerts.total > 1 ? "s" : ""} en attente
        </p>
      </div>
      <ul className="space-y-1.5 pl-7">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-sm">
            <span className="font-mono font-semibold tabular-nums text-niqo-coral">
              {item.count}
            </span>
            <span className="text-niqo-gray-800">{item.label}</span>
            <Link
              href={item.href}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-niqo-coral transition-colors hover:underline"
            >
              Traiter <ArrowRight className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

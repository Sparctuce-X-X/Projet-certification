"use client";

import { useEffect, useState } from "react";

interface TimeAgoProps {
  iso: string;
}

/**
 * "il y a Xs/Xmin/Xh" relatif maintenant. Mis à jour toutes les 30s.
 * Client component (Date.now() doit être dynamique).
 */
export function TimeAgo({ iso }: TimeAgoProps) {
  const [label, setLabel] = useState(() => formatRelative(iso));

  useEffect(() => {
    const tick = () => setLabel(formatRelative(iso));
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [iso]);

  return <span suppressHydrationWarning>{label}</span>;
}

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "à l'instant";
  if (diff < 60) return `il y a ${diff}s`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

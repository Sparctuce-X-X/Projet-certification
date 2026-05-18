import Image from "next/image";

interface AvatarProps {
  url: string | null;
  prenom: string | null;
  nom: string | null;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

const SIZE_PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 32,
  md: 40,
  lg: 48,
};

function initials(prenom: string | null, nom: string | null): string {
  const p = (prenom?.[0] ?? "U").toUpperCase();
  const n = nom && nom !== "—" ? nom[0]!.toUpperCase() : "";
  return `${p}${n}`;
}

/**
 * Avatar utilisateur — affiche la photo si avatar_url est défini,
 * fallback sur les initiales (bulle noire) sinon.
 *
 * `unoptimized` car les avatars Supabase Storage sont déjà compressés
 * côté upload (cf. lib/profile.ts uploadAvatar) et l'optimization Next.js
 * Image n'apporte rien de plus en admin (volume faible).
 */
export function Avatar({ url, prenom, nom, size = "sm" }: AvatarProps) {
  if (url) {
    return (
      <Image
        src={url}
        alt={`${prenom ?? ""} ${nom !== "—" ? nom ?? "" : ""}`.trim() || "Avatar"}
        width={SIZE_PX[size]}
        height={SIZE_PX[size]}
        className={`${SIZE_CLASS[size]} rounded-full object-cover bg-niqo-gray-100 shrink-0`}
        unoptimized
      />
    );
  }
  return (
    <span
      className={`${SIZE_CLASS[size]} rounded-full bg-niqo-black text-white font-semibold flex items-center justify-center shrink-0`}
    >
      {initials(prenom, nom)}
    </span>
  );
}

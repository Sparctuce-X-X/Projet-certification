"use client";

import { X, ZoomIn } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

interface CniPhoto {
  url: string;
  label: string;
}

interface CniViewerProps {
  photos: CniPhoto[];
}

/**
 * Affiche les 3 photos CNI/CNI/selfie en grid vertical avec zoom au click.
 * Le zoom ouvre une lightbox plein écran (Escape ferme, click outside ferme).
 *
 * Les URLs sont des signed URLs Supabase TTL 60s — si l'admin reste plus de
 * 60s sur la page sans recharger, les images expirent. Acceptable pour MVP.
 */
export function CniViewer({ photos }: CniViewerProps) {
  const [zoomedIndex, setZoomedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (zoomedIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomedIndex(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [zoomedIndex]);

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {photos.map((photo, idx) => (
          <button
            key={photo.label}
            type="button"
            onClick={() => setZoomedIndex(idx)}
            className="group relative bg-niqo-gray-100 border border-niqo-gray-200 rounded-xl overflow-hidden cursor-pointer hover:border-niqo-coral/40 transition-colors duration-200 h-[280px]"
            aria-label={`Zoom ${photo.label}`}
          >
            <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
              {photo.label}
            </div>
            <div className="absolute top-2 right-2 z-10 w-7 h-7 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <ZoomIn className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
            </div>
            <Image
              src={photo.url}
              alt={photo.label}
              fill
              sizes="(min-width: 1024px) 280px, 33vw"
              className="object-contain"
              unoptimized
            />
          </button>
        ))}
      </div>

      <p className="mt-2.5 text-xs text-niqo-gray-500 text-center">
        Clique sur une photo pour zoomer en plein écran.
      </p>

      {zoomedIndex !== null ? (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setZoomedIndex(null);
          }}
        >
          <button
            type="button"
            onClick={() => setZoomedIndex(null)}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5 text-white" strokeWidth={2.4} />
          </button>
          <div className="absolute top-4 left-4 bg-white/10 backdrop-blur-sm text-white text-sm font-semibold px-3 py-1.5 rounded-full">
            {photos[zoomedIndex]?.label}
          </div>
          <Image
            src={photos[zoomedIndex]!.url}
            alt={photos[zoomedIndex]!.label}
            width={1600}
            height={1200}
            className="max-h-[90vh] max-w-[90vw] w-auto h-auto object-contain"
            unoptimized
          />
        </div>
      ) : null}
    </>
  );
}

"use client";

import Image from "next/image";
import { motion } from "framer-motion";

type ScreenKind = "home" | "chat" | "profile";

const SCREEN_ALT: Record<ScreenKind, string> = {
  home: "Écran d'accueil de l'app Niqo — annonces près de Brazzaville",
  chat: "Conversation Niqo entre acheteur et vendeur, RDV organisé",
  profile: "Profil vendeur vérifié sur Niqo",
};

export function PhoneMockup({
  className,
  screen = "home",
  delay = 0.3,
  priority = false,
}: {
  className?: string;
  screen?: ScreenKind;
  delay?: number;
  priority?: boolean;
}) {
  return (
    <motion.div
      initial={{ y: 60, rotateY: -8 }}
      whileInView={{ y: 0, rotateY: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 1, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      style={{ perspective: 1000 }}
    >
      <div className="relative mx-auto w-[290px] sm:w-[310px]">
        <div className="relative bg-niqo-black rounded-[3rem] p-3 shadow-2xl shadow-niqo-coral/25">
          <div className="relative bg-niqo-black rounded-[2.4rem] overflow-hidden aspect-[9/19.5]">
            <Image
              src={`/screenshots/${screen}.png`}
              alt={SCREEN_ALT[screen]}
              fill
              priority={priority}
              sizes="(min-width: 640px) 310px, 290px"
              className="object-cover object-top"
            />
          </div>
        </div>
        <div
          className="absolute -inset-4 bg-gradient-to-b from-niqo-coral/25 via-niqo-coral/10 to-transparent rounded-[4rem] blur-2xl -z-10"
          aria-hidden
        />
      </div>
    </motion.div>
  );
}

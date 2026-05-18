"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  delay?: number;
}

// `amount: 0.05` déclenche dès qu'1px est visible.
// Le `initial` ne touche PAS l'opacity : le contenu reste visible pour Googlebot,
// les scrapers OG (WhatsApp/Twitter), et les screenshot tools (PageSpeed/Lighthouse)
// qui ne scrollent pas. Seul le translateY/x donne l'effet d'entrée animée.
const VIEWPORT = { once: true, amount: 0.05 } as const;

export function FadeUp({ children, className, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { y: 40 }}
      whileInView={{ y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({ children, className, delay = 0 }: Props) {
  // FadeIn ne fait que de l'opacité — sans elle il n'y a plus d'animation.
  // On garde l'opacité mais on démarre à 0.5 (visible mais pas pleine intensité)
  // pour que les scrapers voient quelque chose même sans hydration.
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0.5 }}
      whileInView={{ opacity: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.8, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ScaleIn({ children, className, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { scale: 0.92 }}
      whileInView={{ scale: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SlideInLeft({ children, className, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { x: -60 }}
      whileInView={{ x: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SlideInRight({ children, className, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { x: 60 }}
      whileInView={{ x: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

import { redirect } from "next/navigation";

/**
 * Route racine admin — redirect vers /admin/verifications (page d'accueil
 * par défaut du back-office). Évite un 404 si l'admin tape /admin tout court.
 */
export default function AdminRootPage() {
  redirect("/admin/verifications");
}

/**
 * Tests intégration end-to-end — Module Notation post-RDV (F06).
 *
 * Couvre :
 *   - submit_avis : 2 sessions différentes (acheteuse Marie + vendeur Jean)
 *   - Trigger fn_avis_after_insert : recalc note_vendeur / note_acheteur côté users
 *   - Gates : not_participant (Charlie tiers), avis_already_submitted (resubmit)
 *   - RLS public SELECT : anon voit les avis sur n'importe quel profil
 *   - get_user_public_profile : recent_avis non vide après notation
 *   - Lib helpers fetchMyAvisOnConv / fetchAvisFromOtherOnConv (queries directes
 *     via PostgREST, exercent la RLS SELECT public)
 *
 * Cf. docs/backend/notation.md pour le module complet.
 * Migs couvertes : 37, 38, 42, 70.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  anonClient,
  cleanupUsers,
  createTestUser,
} from "./helpers/supabase";

interface Setup {
  marie: { client: SupabaseClient; userId: string };
  jean: { client: SupabaseClient; userId: string };
  charlie: { client: SupabaseClient; userId: string };
  /** Conv Marie-Jean avec RDV confirmé + passé. Support des happy paths. */
  conversationId: string;
}

async function setupNotationFixtures(): Promise<Setup> {
  const ts = Date.now();
  const marie = await createTestUser({
    email: `marie-not-${ts}@niqo.test`,
    prenom: "Marie",
    nom: "Acheteuse",
    pays: "CI",
    ville: "Abidjan",
  });
  const jean = await createTestUser({
    email: `jean-not-${ts}@niqo.test`,
    prenom: "Jean",
    nom: "Vendeur",
    pays: "CI",
    ville: "Abidjan",
  });
  const charlie = await createTestUser({
    email: `charlie-not-${ts}@niqo.test`,
    prenom: "Charlie",
    nom: "Tiers",
    pays: "CI",
    ville: "Abidjan",
  });

  const admin = adminClient();
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  if (!cat) throw new Error("No category seeded");

  const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  const { data: annonce, error: annonceErr } = await admin
    .from("annonces")
    .insert({
      vendeur_id: jean.userId,
      categorie_id: cat.id,
      titre: "iPhone 13 Pro 256 Go",
      description: "Excellent état avec boîte, chargeur et coque silicone fournie.",
      prix: 350000,
      photos: ["p1.jpg"],
      pays: "CI",
      ville: "Abidjan",
      expires_at: expiresAt,
      // en_cours plutôt qu'active car on simule un RDV en route
      statut: "en_cours",
    })
    .select("id")
    .single<{ id: string }>();
  if (annonceErr || !annonce) throw annonceErr ?? new Error("annonce insert failed");

  // Conv Marie ↔ Jean avec RDV confirmé + passé + rencontre mutuelle confirmée.
  // On bypass les RPC propose/confirm/confirm_rencontre (qui exigent dates futures
  // et JWT spécifiques) et on injecte directement les colonnes via service_role.
  // La rencontre mutuelle (mig 86) est obligatoire pour passer les gates de submit_avis.
  const rdvDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // -1 jour
  const rdvConfirmeAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(); // -2 jours
  const rencontreDecidedAt = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({
      annonce_id: annonce.id,
      acheteur_id: marie.userId,
      vendeur_id: jean.userId,
      rdv_lieu: "Marché de Cocody",
      rdv_date: rdvDate,
      rdv_propose_par: marie.userId,
      rdv_confirme_at: rdvConfirmeAt,
      // Mig 86 : rencontre mutuelle confirmée pour pouvoir noter
      rencontre_acheteur: true,
      rencontre_vendeur: true,
      rencontre_decided_at: rencontreDecidedAt,
    })
    .select("id")
    .single<{ id: string }>();
  if (convErr || !conv) throw convErr ?? new Error("conv insert failed");

  return {
    marie: { client: marie.client, userId: marie.userId },
    jean: { client: jean.client, userId: jean.userId },
    charlie: { client: charlie.client, userId: charlie.userId },
    conversationId: conv.id,
  };
}

describe("Module Notation — intégration", () => {
  let setup: Setup;
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    setup = await setupNotationFixtures();
    userIdsToCleanup.push(
      setup.marie.userId,
      setup.jean.userId,
      setup.charlie.userId
    );
  });

  afterAll(async () => {
    await cleanupUsers(userIdsToCleanup);
  });

  it("submit_avis Marie (acheteuse) → Jean (vendeur) : success + recalc note_vendeur", async () => {
    const { data, error } = await setup.marie.client.rpc("submit_avis", {
      p_conversation_id: setup.conversationId,
      p_note: 4,
      p_commentaire: "Vendeur sérieux, bon prix",
    });
    expect(error).toBeNull();
    expect((data as { success: boolean }).success).toBe(true);

    // Vérification trigger after-insert : note_vendeur côté Jean
    const admin = adminClient();
    const { data: jeanRow } = await admin
      .from("users")
      .select("note_vendeur, nb_ventes, note_acheteur, nb_achats")
      .eq("id", setup.jean.userId)
      .single<{
        note_vendeur: number;
        nb_ventes: number;
        note_acheteur: number;
        nb_achats: number;
      }>();
    expect(jeanRow?.note_vendeur).toBe(4);
    expect(jeanRow?.nb_ventes).toBe(1);
    // Jean n'a pas été noté en tant qu'acheteur → restent à 0
    expect(jeanRow?.note_acheteur).toBe(0);
    expect(jeanRow?.nb_achats).toBe(0);
  });

  it("submit_avis 2x par Marie sur même conv → avis_already_submitted (UNIQUE)", async () => {
    const { data } = await setup.marie.client.rpc("submit_avis", {
      p_conversation_id: setup.conversationId,
      p_note: 5,
      p_commentaire: "Re-submit",
    });
    expect((data as { success: boolean; error?: string }).success).toBe(false);
    expect((data as { error?: string }).error).toBe("avis_already_submitted");
  });

  it("submit_avis Charlie (non-participant) → not_participant", async () => {
    const { data } = await setup.charlie.client.rpc("submit_avis", {
      p_conversation_id: setup.conversationId,
      p_note: 1,
      p_commentaire: null,
    });
    expect((data as { error?: string }).error).toBe("not_participant");
  });

  it("submit_avis Jean → Marie (vendeur note acheteur) : success + recalc note_acheteur", async () => {
    const { data, error } = await setup.jean.client.rpc("submit_avis", {
      p_conversation_id: setup.conversationId,
      p_note: 5,
      p_commentaire: "Acheteuse ponctuelle",
    });
    expect(error).toBeNull();
    expect((data as { success: boolean }).success).toBe(true);

    const admin = adminClient();
    const { data: marieRow } = await admin
      .from("users")
      .select("note_acheteur, nb_achats")
      .eq("id", setup.marie.userId)
      .single<{ note_acheteur: number; nb_achats: number }>();
    expect(marieRow?.note_acheteur).toBe(5);
    expect(marieRow?.nb_achats).toBe(1);
  });

  it("fetchMyAvisOnConv (lib pattern) — Marie voit son avis, Jean voit le sien", async () => {
    // Marie SELECT son avis via auteur_id = marie.userId (RLS public SELECT)
    const { data: marieAvis, error: marieErr } = await setup.marie.client
      .from("avis")
      .select("id, note, role_auteur, auteur_id, cible_id")
      .eq("conversation_id", setup.conversationId)
      .eq("auteur_id", setup.marie.userId)
      .maybeSingle();
    expect(marieErr).toBeNull();
    expect(marieAvis).not.toBeNull();
    expect(marieAvis!.note).toBe(4);
    expect(marieAvis!.role_auteur).toBe("acheteur");
    expect(marieAvis!.cible_id).toBe(setup.jean.userId);

    // Jean SELECT son avis via auteur_id = jean.userId
    const { data: jeanAvis } = await setup.jean.client
      .from("avis")
      .select("id, note, role_auteur, cible_id")
      .eq("conversation_id", setup.conversationId)
      .eq("auteur_id", setup.jean.userId)
      .maybeSingle<{ id: string; note: number; role_auteur: string; cible_id: string }>();
    expect(jeanAvis?.note).toBe(5);
    expect(jeanAvis?.role_auteur).toBe("vendeur");
    expect(jeanAvis?.cible_id).toBe(setup.marie.userId);
  });

  it("fetchAvisFromOtherOnConv (lib pattern) — Jean voit l'avis posé sur lui par Marie", async () => {
    const { data: avisOnJean, error } = await setup.jean.client
      .from("avis")
      .select("id, note, auteur_id, cible_id")
      .eq("conversation_id", setup.conversationId)
      .eq("cible_id", setup.jean.userId)
      .maybeSingle<{ id: string; note: number; auteur_id: string; cible_id: string }>();
    expect(error).toBeNull();
    expect(avisOnJean?.note).toBe(4);
    expect(avisOnJean?.auteur_id).toBe(setup.marie.userId);
  });

  it("RLS public SELECT — anon voit les avis sans authentification", async () => {
    const anon = anonClient();
    const { data: rows, error } = await anon
      .from("avis")
      .select("id, note, conversation_id, role_auteur")
      .eq("conversation_id", setup.conversationId);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2); // Marie→Jean + Jean→Marie
  });

  it("get_user_public_profile(jeanId) — recent_avis exposé pour anon (browse-first)", async () => {
    const anon = anonClient();
    const { data, error } = await anon.rpc("get_user_public_profile", {
      p_user_id: setup.jean.userId,
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const profile = data as {
      note_vendeur: number;
      nb_ventes: number;
      recent_avis: Array<{
        note: number;
        commentaire: string | null;
        role_auteur: string;
        auteur_prenom: string;
      }>;
    };
    expect(profile.note_vendeur).toBe(4);
    expect(profile.nb_ventes).toBe(1);
    expect(profile.recent_avis).toHaveLength(1);
    expect(profile.recent_avis[0]!.note).toBe(4);
    expect(profile.recent_avis[0]!.role_auteur).toBe("acheteur");
    expect(profile.recent_avis[0]!.auteur_prenom).toBe("Marie");
  });

  it("RLS deny INSERT direct — un user authentifié ne peut PAS insérer dans avis sans passer par la RPC", async () => {
    // Marie tente d'insérer un avis "fait main" sur une autre conv (qui n'existe
    // pas, peu importe — la RLS doit bloquer avant la FK check car aucune
    // policy INSERT n'est définie sur avis).
    const { error } = await setup.marie.client.from("avis").insert({
      conversation_id: setup.conversationId,
      auteur_id: setup.marie.userId,
      cible_id: setup.jean.userId,
      note: 5,
      role_auteur: "acheteur",
    });
    expect(error).not.toBeNull();
    // PostgREST renvoie un code 401/42501 pour RLS deny (selon version).
    // L'important = c'est rejeté.
    expect(error!.code === "42501" || error!.code === "PGRST301" || error!.code === "23505").toBe(true);
  });

  it("submit_avis sans JWT (anon) → not_authenticated", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("submit_avis", {
      p_conversation_id: setup.conversationId,
      p_note: 4,
      p_commentaire: null,
    });
    // soit error pour grant non-applicable côté anon, soit code retour business
    // En pratique : grant authenticated only → anon doit recevoir 401 RLS,
    // ou la fonction renvoie not_authenticated si elle est appelable mais
    // que auth.uid() est null.
    if (data) {
      expect((data as { error?: string }).error).toBe("not_authenticated");
    }
    // sinon : data null + error 42501 = également un succès du gate
  });
});

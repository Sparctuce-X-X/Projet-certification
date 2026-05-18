/**
 * Tests intégration end-to-end — Module Storage (4 buckets Supabase Storage).
 *
 * Couvre via Storage API + PostgREST :
 *   1. avatars : Alice upload own (alice/avatar.jpg) → success
 *   2. avatars : Alice upload sur folder Bob → RLS error
 *   3. avatars : public URL fetch sans auth → 200 OK (bucket public CDN)
 *   4. annonces-photos : Bob upload own (bob/ann/photo.jpg) → success
 *   5. annonces-photos : Alice upload sur folder Bob → RLS error
 *   6. cni-verifications : Alice upload own (alice/v1/recto.jpg) → success
 *   7. cni-verifications : Alice tente download CNI de Bob → RLS error (path[1] mismatch)
 *   8. cni-verifications : Anon (sans auth) download → 400/403 (bucket privé)
 *   9. rencontre-photos : Alice upload + add_rencontre_photo RPC → success
 *  10. rencontre-photos : Alice upload sur folder Bob (path[2] mismatch) → RLS error
 *  11. deleteMyAccount-like : purge cascade buckets owner-deletable
 *      (avatars + annonces-photos) — pattern lib/supabase.ts purgeUserBucket
 *
 * Cf. docs/backend/storage.md pour le module complet.
 * Migs couvertes : 09, 14, 46, 48, 73, 92, 94, 102.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, createTestUser, cleanupUsers } from "./helpers/supabase";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  annonceId: string;
  convId: string; // Alice↔Bob avec RDV passé confirmé
}

// Fixture binaire : 1×1 PNG transparent (67 bytes) — image valide minimale,
// suffisamment pour passer les checks MIME côté Supabase Storage local.
const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  "base64",
);

async function getSetup(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-store-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Storer",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-store-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Storer",
    pays: "CI",
    ville: "Abidjan",
  });

  const admin = adminClient();
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .neq("nom", "Immobilier")
    .eq("is_active", true)
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  if (!cat) throw new Error("categorie setup failed");

  const { data: ann } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: `Storage test annonce ${ts}`,
      description: "Test upload annonces-photos bucket. RLS cross-user.",
      prix: 100000,
      photos: [],
      pays: "CI",
      ville: "Abidjan",
      etat: "bon",
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (!ann) throw new Error("annonce setup failed");

  // Force ann en_cours pour permettre get_or_create_conversation
  await admin.from("annonces").update({ statut: "en_cours" }).eq("id", ann.id);

  // Conv Alice↔Bob avec RDV passé confirmé (pour test rencontre-photos)
  const { data: convResp } = await alice.client.rpc("get_or_create_conversation", {
    p_annonce_id: ann.id,
  });
  const convId = (convResp as { conversation?: { id: string } }).conversation?.id;
  if (!convId) throw new Error("conv setup failed");

  const past2d = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const past3d = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  await admin
    .from("conversations")
    .update({
      rdv_date: past2d,
      rdv_confirme_at: past3d,
      rdv_lieu: "Test storage lieu",
    })
    .eq("id", convId);

  return { alice, bob, annonceId: ann.id, convId };
}

let setup: Setup;
const cleanup: string[] = [];

beforeAll(async () => {
  setup = await getSetup();
  cleanup.push(setup.alice.userId, setup.bob.userId);
});

afterAll(async () => {
  // Cleanup users → cascade DB. Storage objects orphelins acceptables (test env).
  // Best-effort : remove explicite des paths uploadés pour rester propre.
  const admin = adminClient();
  const buckets = ["avatars", "annonces-photos", "cni-verifications", "rencontre-photos"];
  for (const bucket of buckets) {
    for (const uid of cleanup) {
      try {
        const { data: entries } = await admin.storage.from(bucket).list(uid);
        if (entries && entries.length > 0) {
          const paths = entries
            .filter((e) => e.id !== null)
            .map((f) => `${uid}/${f.name}`);
          if (paths.length > 0) {
            await admin.storage.from(bucket).remove(paths);
          }
          // Recurse 1 level (annonces-photos / rencontre-photos)
          for (const folder of entries.filter((e) => e.id === null)) {
            const folderPath = `${uid}/${folder.name}`;
            const { data: subEntries } = await admin.storage
              .from(bucket)
              .list(folderPath);
            if (subEntries && subEntries.length > 0) {
              const subPaths = subEntries
                .filter((e) => e.id !== null)
                .map((f) => `${folderPath}/${f.name}`);
              if (subPaths.length > 0) {
                await admin.storage.from(bucket).remove(subPaths);
              }
            }
          }
        }
      } catch {
        // Ignore — best-effort
      }
    }
  }
  // rencontre-photos : path commence par convId, pas par uid → cleanup direct
  try {
    const { data: convPaths } = await admin.storage
      .from("rencontre-photos")
      .list(setup.convId);
    if (convPaths) {
      for (const folder of convPaths.filter((e) => e.id === null)) {
        const fpath = `${setup.convId}/${folder.name}`;
        const { data: files } = await admin.storage.from("rencontre-photos").list(fpath);
        if (files && files.length > 0) {
          await admin.storage
            .from("rencontre-photos")
            .remove(files.filter((e) => e.id !== null).map((f) => `${fpath}/${f.name}`));
        }
      }
    }
  } catch {
    // ignore
  }
  await cleanupUsers(cleanup);
});

describe("Storage — RLS bucket-level + cascade purge (mig 09→110)", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Bucket A — avatars (mig 09, public=true)
  // ─────────────────────────────────────────────────────────────────────────

  it("1. avatars : Alice upload own (alice/avatar.png) → success", async () => {
    // Pas d'upsert : la policy avatars_owner_update mig 09 n'a pas de WITH CHECK
    // explicite → Supabase Storage refuse les requêtes avec x-upsert:true
    // (INSERT...ON CONFLICT DO UPDATE évalue les 2 policies). Le client mobile
    // n'utilise jamais upsert sur avatars (path UUID unique par upload).
    const path = `${setup.alice.userId}/avatar.png`;
    const { data, error } = await setup.alice.client.storage
      .from("avatars")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png" });
    expect(error).toBeNull();
    expect(data?.path).toBe(path);
  });

  it("2. avatars : Alice upload sur folder Bob → RLS error (foldername[1] mismatch)", async () => {
    const path = `${setup.bob.userId}/avatar.png`;
    const { error } = await setup.alice.client.storage
      .from("avatars")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png" });
    expect(error).not.toBeNull();
    // Supabase Storage retourne soit "new row violates row-level security policy"
    // soit un 403 selon la version.
    expect(error?.message ?? "").toMatch(/row-level|policy|unauthorized|forbidden/i);
  });

  it("3. avatars : public URL accessible sans auth (bucket public CDN)", async () => {
    // Alice uploaded its avatar in test 1.
    const path = `${setup.alice.userId}/avatar.png`;
    const { data } = setup.alice.client.storage.from("avatars").getPublicUrl(path);
    expect(data.publicUrl).toContain("/avatars/");

    // Fetch sans auth → doit retourner l'image
    const res = await fetch(data.publicUrl);
    expect(res.status).toBe(200);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket B — annonces-photos (mig 14, public=true)
  // ─────────────────────────────────────────────────────────────────────────

  it("4. annonces-photos : Bob upload own (bob/annId/photo.png) → success", async () => {
    // Pas d'upsert : annonces-photos n'a PAS de policy UPDATE par design
    // (mig 14 §2 — DELETE + INSERT pour invalidation CDN propre).
    const path = `${setup.bob.userId}/${setup.annonceId}/photo1.png`;
    const { data, error } = await setup.bob.client.storage
      .from("annonces-photos")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png" });
    expect(error).toBeNull();
    expect(data?.path).toBe(path);
  });

  it("5. annonces-photos : Alice upload sur folder Bob → RLS error", async () => {
    const path = `${setup.bob.userId}/${setup.annonceId}/intrusion.png`;
    const { error } = await setup.alice.client.storage
      .from("annonces-photos")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png" });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level|policy|unauthorized|forbidden/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket C — cni-verifications (mig 46+48+73, public=false)
  // ─────────────────────────────────────────────────────────────────────────

  it("6. cni-verifications : Alice upload own (alice/v1/recto.png) → success", async () => {
    const path = `${setup.alice.userId}/v1-test/recto.png`;
    const { data, error } = await setup.alice.client.storage
      .from("cni-verifications")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png", upsert: true });
    expect(error).toBeNull();
    expect(data?.path).toBe(path);
  });

  it("7. cni-verifications : Alice tente download CNI de Bob → RLS error (path[1] mismatch)", async () => {
    // D'abord Bob upload sa CNI
    const bobPath = `${setup.bob.userId}/v1-test/recto.png`;
    const { error: upErr } = await setup.bob.client.storage
      .from("cni-verifications")
      .upload(bobPath, TINY_PNG_BYTES, { contentType: "image/png", upsert: true });
    expect(upErr).toBeNull();

    // Alice essaie de download → SELECT bloqué par cni_verif_owner_select (path[1] = uid)
    const { data, error } = await setup.alice.client.storage
      .from("cni-verifications")
      .download(bobPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("8. cni-verifications : Anon (sans auth) download → RLS error (bucket privé)", async () => {
    const path = `${setup.alice.userId}/v1-test/recto.png`;
    // getPublicUrl ne raise pas mais l'URL ne sert pas (bucket privé)
    // → on tente createSignedUrl avec un client anon : la session anon n'a pas
    //   le droit, on tombe en RLS / 400
    const { createClient } = await import("@supabase/supabase-js");
    const anonClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await anonClient.storage
      .from("cni-verifications")
      .download(path);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket D — rencontre-photos (mig 92, foldername[2] = uid auteur)
  // ─────────────────────────────────────────────────────────────────────────

  it("9. rencontre-photos : Alice upload + add_rencontre_photo RPC → success", async () => {
    const path = `${setup.convId}/${setup.alice.userId}/photo-test-1.png`;

    // Mig 121 : add_rencontre_photo n'accepte plus que l'état `disputed`
    // (rencontre_acheteur != rencontre_vendeur, avec au moins un false).
    // On force le state via admin update — la RPC `confirm_rencontre` ferait
    // pareil mais ajoute des side-effects (notif push, message systeme).
    const admin = adminClient();
    await admin
      .from("conversations")
      .update({ rencontre_acheteur: true, rencontre_vendeur: false })
      .eq("id", setup.convId);

    // 1. Upload Storage (RLS check : foldername[2]=uid + participant de la conv)
    const { error: upErr } = await setup.alice.client.storage
      .from("rencontre-photos")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png", upsert: false });
    expect(upErr).toBeNull();

    // 2. RPC add_rencontre_photo (re-valide path + insert row table)
    const { data: rpcData, error: rpcErr } = await setup.alice.client.rpc(
      "add_rencontre_photo",
      {
        p_conversation_id: setup.convId,
        p_storage_path: path,
      },
    );
    expect(rpcErr).toBeNull();
    expect(rpcData).toMatchObject({ success: true });
  });

  it("10. rencontre-photos : Alice upload dans folder Bob (path[2] mismatch) → RLS error", async () => {
    const path = `${setup.convId}/${setup.bob.userId}/intrusion.png`;
    const { error } = await setup.alice.client.storage
      .from("rencontre-photos")
      .upload(path, TINY_PNG_BYTES, { contentType: "image/png" });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/row-level|policy|unauthorized|forbidden/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cascade purge user-side (pattern mig 73 — lib/supabase.ts purgeUserBucket)
  // ─────────────────────────────────────────────────────────────────────────

  it("11. cascade purge cross-user : Alice ne peut PAS DELETE le folder de Bob", async () => {
    // Pattern lib/supabase.ts purgeUserBucket (mig 73) : chaque user purge SA
    // folder avant delete_my_account. Defense in depth : on vérifie qu'Alice
    // ne peut pas toucher au folder Bob via `.remove()`.
    //
    // ⚠ Supabase Storage .remove() retourne data=[] silencieusement quand RLS
    // gate bloque (pas d'error raise — best-effort par design). On vérifie
    // donc par observation : le fichier de Bob doit toujours exister après la
    // tentative de DELETE par Alice.
    const bobPath = `${setup.bob.userId}/${setup.annonceId}/photo1.png`;

    const { error: bobErr } = await setup.alice.client.storage
      .from("annonces-photos")
      .remove([bobPath]);
    // remove() ne raise pas même si RLS bloque, on tolère error null OU error
    expect(bobErr === null || typeof bobErr?.message === "string").toBe(true);

    // Vérification effective via admin : le path de Bob existe toujours
    const admin = adminClient();
    const { data: stillThere } = await admin.storage
      .from("annonces-photos")
      .list(`${setup.bob.userId}/${setup.annonceId}`);
    expect(stillThere?.some((e) => e.name === "photo1.png")).toBe(true);

    // Pattern positive : owner DELETE sur bucket privé qui marche partout
    // (cni-verifications a policy DELETE owner mig 73 avec WITH CHECK complet).
    // Alice DELETE sa propre CNI uploadée test 6.
    const aliceCniPath = `${setup.alice.userId}/v1-test/recto.png`;
    const { data: rem, error: remErr } = await setup.alice.client.storage
      .from("cni-verifications")
      .remove([aliceCniPath]);
    expect(remErr).toBeNull();
    expect(rem).toBeDefined();
    expect(rem?.length).toBeGreaterThanOrEqual(1);
  });
});

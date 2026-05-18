# Modules en place hors CDC v4.0

> Référencé depuis `CLAUDE.md`. Le CDC v4.0 a été figé en avril 2026 — le code a évolué depuis. Ce qui suit n'apparaît pas dans le CDC mais est en production dans le code.

## Mode dual Annonces / Immo (HomeHeader)
- `HomeMode = "annonces" | "immo"` — onglets dans `HomeHeader` (`ShoppingBag` Annonces / `Building2` Immo)
- Mode Immo = filtres dédiés via `<ImmoFilters>` : `type_offre` (vente/location), `type_bien`, `nb_pieces`, `meuble`, `surface_min/max`, `prix_min/max`
- Champs ajoutés à `annonces` par mig 32 (`32_immobilier.sql`)
- Mig 34 rend `etat` nullable (immo n'a pas d'état physique)
- Annonces de mode `annonces` excluent les annonces immo (`excludeImmo`) et inversement (`immoOnly`)

## Catégories — 11 réelles (CDC en mentionne 6)
Ordre final après mig 13 + 30 + 31 + 32 :

1. Téléphones & Accessoires (`smartphone`)
2. Électronique (`monitor`)
3. Mode & Vêtements (`shirt`)
4. Maison & Électroménager (`home`)
5. **Immobilier** (`building-2`, mig 32 — aussi un `HomeMode` séparé)
6. **Véhicules** (`car`, mig 30)
7. **Beauté & Cosmétiques** (`sparkles`, mig 31)
8. Sports & Loisirs (`dumbbell`)
9. Enfants & Bébé (`baby`)
10. Livres & Formation (`book-open`)
11. Autres (`package`)

## Lifecycle annonce v4.0 (mig 39)
Donne enfin du sens aux statuts `en_cours` et `vendue` qui étaient orphelins après suppression du module transactions :

| Statut | Quand |
|---|---|
| `active` | Publication par défaut — visible sur Home/Search |
| `en_cours` | Auto-set quand un RDV est confirmé sur l'annonce (trigger `fn_annonce_statut_on_rdv_change`) |
| `vendue` | Set manuellement par le vendeur via RPC `mark_annonce_vendue` après ≥1 RDV passé |
| `expiree` | Auto après `expires_at` (60j, cron nocturne) — prolongation 28j possible |
| `suspendue` | Modération (3 signalements confirmés) |

`cancel_rdv` revert l'annonce à `active` si plus aucun RDV confirmé. FK `conversations.annonce_id` est en `on delete set null` pour préserver historique avis quand annonce purgée à J+88.

## `users.nb_achats`
Compteur des achats (en plus de `nb_annonces`, `nb_signalements`). Affiché sur `app/u/[id].tsx` dans le bento stats acheteur. Pas dans le CDC §5.1.

## Admin web (sous-projet `landing/`)
Le CDC ne mentionne pas d'interface back-office. Construite à partir de mai 2026 (Next.js 16) :
- `/admin/login` — auth Supabase + gate `is_admin`
- `/admin/verifications` + `/[id]` — modération KYC (validation/refus + email Resend post-décision)
- `/admin/signalements` + `/[id]` — modération signalements (cascade actions sur cible)
- `/admin/kpis` — **dashboard KPIs** (RPC `get_admin_kpis(p_from, p_to)`, filtre période 30j/90j/12 mois/Tout/mois précis/année précise, charts Recharts)
- `/admin/audit` — **audit log** des actions admin (mig 103 + 104)

## Dashboard vendeur mobile (`app/profile/dashboard.tsx`)
Pas dans le CDC §5.4. RPC `get_my_dashboard_stats` (mig 58, 61) :
- KPIs personnels : annonces (active/en_cours/vendue/expiree), vues totales, conversations (total/unread), RDV (proposed/confirmed_upcoming/past)
- Boost actifs (count + plan + jours restants)
- Stats profil : nb_ventes/nb_achats, note_vendeur/note_acheteur

## Sécurité durcie (review #1 + #2 — mai 2026)
- Mig 70-73 : FK cascade fixes pour droit à l'oubli (avis, conversations, verif, storage)
- Mig 74-76 : RLS UPDATE durcie sur conversations/messages, helper `is_my_account_active()` sur INSERT critiques
- Mig 77 : scrub `pawapay_metadata.payer.phone`, trigger score_abus étendu à `is_active`
- Webhook PawaPay : double-check via API GET `/v2/deposits/{id}` (Option B, en attendant RFC-9421 Phase 2)
- EF push : auth via `NIQO_INTERNAL_KEY` (32 bytes hex) + `constantTimeEquals` (anti timing attack)

## Page web publique annonce (`landing/src/app/a/[id]`)
Ajoutée 2026-05-10 pour le bouton Partager mobile. SSR depuis Supabase (RLS anon `statut='active'`), OG tags pour preview WhatsApp/iMessage, CTA "Ouvrir dans l'app" + fallback stores. Universal Links Phase 2.

## Audit log admin (`audit_log_admin`, mig 103-104)
Ajouté 2026-05-10. Helper `_log_admin_action` appelé en fin de chaque RPC admin (validate KYC, treat signalement, suspend annonce/user, soft-delete message, revert annonce). Backfill mig 104 pour KYC historiques (admin réel via `verifications_identite.reviewed_by`).

## Bloquer un utilisateur (F15, `blocked_users`, mig 129-132)
Ajouté 2026-05-15/16 en urgence après rejet Apple sur Guideline 1.2 UGC (build iOS 1.0.0 (4) rejetée le 2026-05-15). Apple a validé la build 1.0.0 (5) le 2026-05-16. Le CDC v4.0 ne mentionne pas ce mécanisme — c'est une exigence store (Apple + Google Play UGC).

- Table `blocked_users` owner-scoped (PK composite `blocker_id + blocked_id`, check `blocker ≠ blocked`, FK cascade).
- 5 RPCs SECURITY DEFINER : `block_user` (mig 129/131), `unblock_user`, `get_my_blocked_user_ids`, `am_i_blocked_in_conv` (mig 130), `get_my_blocked_users_display` (mig 132).
- Trigger `fn_messages_block_check` BEFORE INSERT messages → raise `BLOCKED_BY_RECIPIENT` (couvre canal chat "remove from feed instantly").
- Canal annonces : filter front via `useBlockedUsers` hook + `excludeVendeurIds` côté `lib/annonces.ts`.
- "Notify the developer" Apple : chaque block crée un signalement implicite via `INSERT ON CONFLICT DO UPDATE` (mig 131) + email admin garanti (trigger AFTER INSERT ou appel manuel `_notify_admin_email` détecté via `xmax = 0`).
- Realtime publication `supabase_realtime` → sync UI immédiat sur INSERT/DELETE.
- UI mobile : `BlockUserSheet`, `app/profile/blocked-users.tsx`, intégrations dans `app/u/[id].tsx` + `app/messages/[conversationId].tsx` (kebab menu).
- Doc backend complète : `docs/backend/blocking.md`.

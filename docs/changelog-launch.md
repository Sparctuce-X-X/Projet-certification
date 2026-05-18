# Changelog — Phase 1 launch iOS (mai 2026)

> Historique détaillé des étapes de lancement iOS, déplacé hors `CLAUDE.md` pour performance.
>
> Pour l'état **actuel** des features et du planning, voir `CLAUDE.md` sections "Fonctionnalités MVP" et "Planning de référence".

---

## 2026-05-10 — Setup admin + observabilité

Société Rwanda enregistrée, PawaPay compte prod, compte Apple Developer, compte Google Play Developer, Vercel deploy `landing/`, mig 105 (RLS `mots_interdits`), pack légal v1.1 (6 docs canoniques + rendu mobile + web + footer + sync), **stack observabilité complet** (Sentry 3 surfaces + `niqo_event_log` + dashboard `/admin/observability` + alertes email digest Resend + 10 crons DB instrumentés — mig 106-109).

## 2026-05-14 — Build TestFlight + ASC listing

- Build EAS iOS 1.0.0 (3) production + auto-submit TestFlight
- Apple Sign In confirmé OK sur TestFlight
- Page `niqo.africa/support` créée (`landing/src/app/support/page.tsx`, 5 contacts email + 6 FAQ)
- Script SQL `scripts/sql/pre-approve-apple-review.sql` (compte demo `apple-review@niqo.africa` pré-vérifié pour Apple Review)
- ASC listing rempli intégralement : App Information + App Privacy questionnaire 12 items + DSA Niqo LTD Trader + age rating 13+ + Pricing Free monde entier + screenshots iPhone 6.5" 6/10 + Review Notes + demo account
- APK Android preview envoyé à Google pour validation package `com.niqo.africa` (config plugin `plugins/with-adi-registration.js` utilisé puis supprimé 18h15 avant build prod Android — dossier `plugins/` vidé)
- **Sentry mobile temporairement désactivé** (`lib/sentry.ts` no-op + plugin retiré `app.json`) — à restaurer post-launch

## 2026-05-15 — Rejet Apple Guideline 1.2 UGC + implémentation Block

- Build EAS iOS 1.0.0 (4) soumis à Apple → **rejet Guideline 1.2 UGC** ("missing mechanism to block abusive users")
- Implémentation complète feature Block en journée :
  - Mig 129 : table `blocked_users` + 4 RPCs (`block_user`, `unblock_user`, `get_my_blocked_user_ids`, `am_i_blocked_in_conv`)
  - Mig 130 : trigger `fn_messages_block_check` BEFORE INSERT raise `BLOCKED_BY_RECIPIENT`
  - Mig 131 : fix `unique_violation` admin notif via `INSERT ON CONFLICT DO UPDATE`
  - Mig 132 : RPC `get_my_blocked_users_display` SECURITY DEFINER bypass RLS users
- UI mobile : `components/blocking/BlockUserSheet.tsx`, `app/profile/blocked-users.tsx`, intégrations `app/u/[id].tsx` + `app/messages/[conversationId].tsx`
- Filter feed via `lib/hooks/useBlockedUsers.ts` + paramètre `excludeVendeurIds` dans `lib/annonces.ts`
- Validation Google package `com.niqo.africa` reçue

## 2026-05-16 — Re-validation Apple 24h

🎉 **Apple a validé la build 1.0.0 (6) en 24h.** Release déclenchée à 21h12 (auto-release scheduled). Réponse Apple Resolution Center envoyée avec screencast 10s démontrant le flow Block. JWT client_secret Apple Sign In rotaté (incident hygiène mineur résolu). Migrations 129-132 appliquées en prod Supabase.

## 2026-05-17 — LIVE App Store iOS

🎉 **Niqo est LIVE sur l'App Store iOS** — propagation CDN Apple complète, statut "Ready for Distribution" vert.

- Lien public : `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032` (App ID `6769410032`)
- Distribution : **147 pays** (CI + CG + RW + reste Afrique + Amériques + Asie + UK + Suisse + Norvège)
- **UE exclue** — DSA Trader info publique (téléphone + email) à compléter avant d'ouvrir les 27 pays UE (cf. task #40 Phase 2)
- Landing `niqo.africa` + page web annonce `niqo.africa/a/[id]` mis à jour avec le vrai lien App Store (placeholders `"#"` remplacés)
- **Tentative OTA fix UX échouée** : `eas update --channel production` poussé pour fix clavier paiement/chat + immo dupliqué, mais le binaire 1.0.0(6) embed un `updates.url` figé vers un ancien projectId Expo (`cdbe4f8b...`) — l'update n'atteint jamais l'app live. Diagnostic : 404 "no channel named production" côté serveur Expo (cf. `docs/gotchas.md` section EAS Update). Conséquence : rebuild **1.0.1** obligatoire avec `react-native-keyboard-controller` + cleanup `updates.url` → en cours via EAS Build + auto-submit Apple.
- Setup closed testing Play Console pour Android — 12 testeurs actifs, jour 1 / 14j Google rule.

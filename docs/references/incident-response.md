# Niqo — Plan de réponse aux incidents (data breach)

> Procédure à suivre en cas de fuite, accès non autorisé, ou perte de données personnelles.
> Délai légal de notification autorité : **72 heures** (CI art. 34 loi 2024-30, CG art. 28 loi 2023-15, Rwanda 2021-058, RGPD UE art. 33).

---

## Définition d'un incident

Tout événement qui compromet la **confidentialité**, **intégrité** ou **disponibilité** des données personnelles :
- Accès non autorisé à `public.users`, `auth.users`, `vault.secrets`
- Fuite de la `service_role` key Supabase
- Compromission compte admin Dominique
- Bug SQL exposant des données cross-user (RLS bypass)
- Perte/vol d'un device admin avec session active
- Réponse positive à un test pentest non corrigé en prod
- Demande d'extorsion / ransom
- Fuite via tiers (Supabase, PawaPay) — devoir d'enquête côté Niqo

Si doute → traiter comme incident.

---

## Phases

### 1. Détection (T0)

**Sources de signal** :
- Supabase Audit Logs (anomalie d'accès ?)
- Sentry / logs applicatifs (erreurs en cascade ?)
- Email d'un user signalant un comportement étrange (accès à son compte par un tiers, données affichées qui ne sont pas les siennes)
- Notification d'un tiers (Supabase, PawaPay nous prévient)
- Signal externe (chercheur sécurité, bug bounty)

**Action immédiate** :
- Logger T0 (date + heure UTC) dans le post-mortem
- Identifier qui a découvert et quand
- **Ne pas modifier le système avant snapshot** (preuves)

### 2. Confinement (T+0 à T+1h)

**Objectif** : empêcher l'incident de s'étendre.

**Actions selon scénario** :
- Fuite `service_role` key → rotater immédiatement (Supabase Dashboard → Settings → API → Reset)
- Compte admin compromis → reset password + 2FA + invalider toutes sessions (Auth → Users → Sign out user)
- RLS bypass identifié → patch immédiat (DROP POLICY puis CREATE plus restrictif), redéployer
- Vault key compromise (extrême) → nouvelle clé + re-encrypt all `telephone` rows en batch
- Endpoint Edge Function vulnérable → unpublish ou patch

🔴 **Préserver les logs avant tout** : `pg_dump` partiel des tables impactées, capture Supabase logs UI.

### 3. Évaluation (T+1h à T+24h)

**Questions à répondre** :
- Quelles données ? (préciser : email, telephone clair OU bytea, etc.)
- Combien d'utilisateurs ? (count via SQL si la donnée le permet)
- Pays concernés ? (CI / CG / autre — détermine l'autorité à notifier)
- Données chiffrées au repos ou en clair ? (impact sur la gravité)
- Probabilité d'exploitation effective ? (key leakée + scan public = haute, log interne accédé par 1 employé → faible)
- Reproductible ? Bug isolé ou faille systémique ?

**Documentation** : remplir `incident-YYYY-MM-DD.md` dans `docs/incidents/` (à créer au premier incident) avec template ci-dessous.

### 4. Notification (T+24h à T+72h)

**À l'autorité** (obligation légale 72h max) :
- 🇨🇮 **ARTCI** (Côte d'Ivoire) — formulaire en ligne sur `artci.ci` ou email officiel
- 🇨🇬 **ANRTIC** (Congo Brazzaville) — `anrtic.cg`
- 🇷🇼 **NCSA** (Rwanda) — `ncsa.gov.rw`
- 🇪🇺 **CNIL** (si users EU touchés) — formulaire `cnil.fr/notification-incident`

**Contenu de la notification** (RGPD art. 33 + lois locales équivalentes) :
1. Nature de la violation (résumé technique)
2. Catégories de données + nombre approximatif d'enregistrements
3. Catégories de personnes + nombre approximatif d'individus
4. Nom + coordonnées du DPO ou point de contact (Dominique Huang)
5. Conséquences probables
6. Mesures prises ou proposées pour atténuer

Si délai 72h dépassé → motiver le retard.

**Aux utilisateurs impactés** (RGPD art. 34, lois locales équivalentes) :
- Notification individuelle si **risque élevé** pour les droits et libertés (donnée sensible exposée, fraude probable, etc.)
- Pour MVP Niqo : email + push notif + bandeau in-app au prochain login
- Template ci-dessous.

### 5. Remédiation (T+72h à T+1 mois)

- Patch définitif du root cause
- Tests de non-régression
- Code review élargie sur les fichiers similaires
- Rotation des secrets si applicable (clés API, mots de passe DB)
- Renforcement du monitoring (alertes Supabase, dashboards)

### 6. Post-mortem (T+1 mois max)

- Document `incident-YYYY-MM-DD-postmortem.md`
- Rédigé en **blameless** (focus système, pas individu)
- Sections : Timeline, Root cause, Impact, What went well, What went badly, Action items
- Partagé avec l'équipe (admin uniquement pour MVP)
- Action items trackés jusqu'à completion

---

## Template — Notification à l'autorité

```
Objet : Notification de violation de données personnelles — Niqo

Identité du responsable du traitement :
  Niqo (entité légale : Société enregistrée au Rwanda)
  Représentant : Dominique Huang
  Contact : support@niqo.africa
  Adresse : [à compléter]

Date et heure de la violation : [T0 UTC]
Date et heure de la découverte : [T_detect UTC]
Date de la présente notification : [T_notif UTC]

Nature de la violation :
  [Brève description technique non sensible]
  [Type : confidentialité / intégrité / disponibilité]

Données concernées :
  - [Liste des champs : email, prénom, nom, téléphone (chiffré ou clair ?), …]
  - Nombre d'enregistrements affectés : [N approximatif]
  - Nombre de personnes affectées : [M approximatif]
  - Pays de résidence des personnes : [CI / CG / …]

Conséquences probables :
  [Phishing, usurpation d'identité, fraude paiement, …]

Mesures prises :
  - [Confinement appliqué]
  - [Notifications envoyées]
  - [Plan de remédiation]

Contact DPO / référent :
  Dominique Huang — support@niqo.africa
```

---

## Template — Notification utilisateur

```
Objet : Information importante concernant tes données Niqo

Bonjour [prenom],

Le [date], nous avons identifié un incident de sécurité ayant pu affecter
ton compte Niqo. Nous t'écrivons en toute transparence pour t'informer.

Ce qui s'est passé :
[Description simple, non technique]

Données potentiellement concernées :
- [Liste claire]

Données NON concernées :
- Ton mot de passe (chiffré, jamais accessible)
- Ton numéro de téléphone (chiffré au repos via Vault Supabase)
[etc.]

Ce que nous avons fait :
- [Confinement]
- [Patch]
- [Notification ARTCI / ANRTIC en cours]

Ce que tu peux faire :
- [Action 1, ex: change ton mot de passe]
- [Action 2, ex: surveille les SMS suspects, ne réponds pas aux demandes de code de confirmation]
- Contacte-nous : support@niqo.africa

Nous prenons cette situation très au sérieux et travaillons à renforcer
notre sécurité pour qu'elle ne se reproduise pas.

L'équipe Niqo
```

---

## Contacts utiles

| Autorité | Pays | URL / Email |
|---|---|---|
| ARTCI | 🇨🇮 CI | `artci.ci` |
| ANRTIC | 🇨🇬 CG | `anrtic.cg` |
| NCSA | 🇷🇼 RW | `ncsa.gov.rw` |
| CNIL | 🇫🇷 FR (si users EU) | `cnil.fr/notification-incident` |
| Supabase Security | — | `security@supabase.io` |
| PawaPay Support | — | À compléter (S1-2) |

---

## Checklist post-incident (à valider avant clôture)

- [ ] Cause racine identifiée
- [ ] Patch déployé en prod
- [ ] Tests de non-régression passés
- [ ] Notification autorité envoyée (avec accusé réception)
- [ ] Notification utilisateurs envoyée (si risque élevé)
- [ ] Post-mortem rédigé
- [ ] Action items créés et assignés
- [ ] Documentation interne mise à jour (CLAUDE.md, rgpd-audit.md, schéma)
- [ ] Monitoring / alerte ajoutée pour détection précoce
- [ ] Si secrets rotés : tous les services consommateurs mis à jour

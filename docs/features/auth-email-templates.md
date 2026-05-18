# Niqo — Templates d'emails Auth (Supabase)

> Templates HTML français pour Supabase Auth.
> À copier-coller dans **Dashboard → Authentication → Emails → [template]**.
> Tous respectent la charte Niqo : coral CTA, mobile-first, ton francophone Afrique.

> **Version 2** (2026-04-28) — audit `ui-ux-pro-max` appliqué : viewport mobile, contraste WCAG AA (footer #5A5A57 au lieu de #888780), CTA 17px/700 pour passer "large bold", `role="presentation"` sur tables de layout, footer unifié, copy reset raccourci.

---

## Variables Supabase utilisables

- `{{ .ConfirmationURL }}` — l'URL avec token (à mettre dans le `href` du bouton)
- `{{ .Email }}` — email du destinataire
- `{{ .SiteURL }}` — Site URL configuré (= `niqo://auth/callback`)
- `{{ .Data.* }}` — variables custom passées dans `signUp({ options.data })` (ex: `{{ .Data.prenom }}`)

⚠ Les fonts Google (Space Grotesk, Inter) ne sont pas supportées dans la majorité des clients mail (Gmail strip les `<link>` externes). On utilise `Arial, sans-serif` en fallback.

⚠ Outlook Windows ne supporte pas `border-radius` → la card et le bouton seront carrés sur Outlook desktop. Acceptable pour MVP (Outlook desktop ≈ 0% du public Niqo en Afrique francophone mobile).

---

## Bloc légal obligatoire (Rwanda Law 007/2021 + RGPD)

> **Obligation de conformité** : chaque template doit inclure le bloc HTML ci-dessous avant `</body>`. Ce bloc est statique (pas d'import possible dans le Dashboard Supabase) — il doit être copié-collé en dur dans chacun des 3 templates actifs. Ne pas l'omettre sous peine de non-conformité Rwanda Law 007/2021 et RGPD.

```html
<hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:480px;">
<div style="max-width:480px;margin:0 auto;text-align:center;">
  <p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:#5A5A57;font-family:Arial,sans-serif;text-align:center;">
    <strong style="color:#1A1A1A;">NIQO LTD</strong> · TIN 150644832<br>
    Société de droit rwandais — Private Company Limited By Shares<br>
    KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda<br>
    Capital social : 1 000 000 RWF<br>
    Contact : <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
  </p>
</div>
```

---

## 1. Confirm signup

**Sujet :**
```
Confirme ton inscription Niqo
```

**Body (HTML) :**
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;padding:32px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;">
                niqo<span style="color:#D85A30;">.</span>
              </p>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.3;">
                Bienvenue sur Niqo
              </h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:#444441;">
                Tu y es presque. Tape sur le bouton ci-dessous pour confirmer ton inscription et commencer à acheter ou vendre en toute sécurité.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Confirmer mon inscription
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                Ce lien expire dans 24 heures. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email — aucun compte ne sera créé.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
          Niqo — La marketplace de confiance en Afrique.<br>
          Une question ? Écris-nous à <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
        </p>
        <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:480px;">
        <div style="max-width:480px;margin:0 auto;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#5A5A57;font-family:Arial,sans-serif;text-align:center;">
            <strong style="color:#1A1A1A;">NIQO LTD</strong> · TIN 150644832<br>
            Société de droit rwandais — Private Company Limited By Shares<br>
            KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda<br>
            Capital social : 1 000 000 RWF<br>
            Contact : <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
          </p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 2. Reset password

**Sujet :**
```
Réinitialise ton mot de passe Niqo
```

**Body (HTML) :**
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;padding:32px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;">
                niqo<span style="color:#D85A30;">.</span>
              </p>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.3;">
                Réinitialiser ton mot de passe
              </h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:#444441;">
                Tu as demandé à changer ton mot de passe. Tape sur le bouton ci-dessous pour en choisir un nouveau.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Réinitialiser mon mot de passe
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email — ton mot de passe restera inchangé.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
          Niqo — La marketplace de confiance en Afrique.<br>
          Une question ? Écris-nous à <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
        </p>
        <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:480px;">
        <div style="max-width:480px;margin:0 auto;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#5A5A57;font-family:Arial,sans-serif;text-align:center;">
            <strong style="color:#1A1A1A;">NIQO LTD</strong> · TIN 150644832<br>
            Société de droit rwandais — Private Company Limited By Shares<br>
            KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda<br>
            Capital social : 1 000 000 RWF<br>
            Contact : <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
          </p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 3. Change email address

**Sujet :**
```
Confirme ton nouvel email Niqo
```

**Body (HTML) :**
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;padding:32px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;">
                niqo<span style="color:#D85A30;">.</span>
              </p>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.3;">
                Confirme ton nouvel email
              </h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:#444441;">
                Tu as demandé à utiliser <strong style="word-break:break-all;">{{ .Email }}</strong> comme nouvelle adresse pour ton compte Niqo. Tape sur le bouton pour confirmer le changement.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Confirmer le changement
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                Ce lien expire dans 24 heures. Si tu n'es pas à l'origine de cette demande, ignore cet email et ton ancien email restera actif.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
          Niqo — La marketplace de confiance en Afrique.<br>
          Une question ? Écris-nous à <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
        </p>
        <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:480px;">
        <div style="max-width:480px;margin:0 auto;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#5A5A57;font-family:Arial,sans-serif;text-align:center;">
            <strong style="color:#1A1A1A;">NIQO LTD</strong> · TIN 150644832<br>
            Société de droit rwandais — Private Company Limited By Shares<br>
            KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda<br>
            Capital social : 1 000 000 RWF<br>
            Contact : <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
          </p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 4. Magic link (optionnel — pas utilisé en MVP)

> Niqo MVP n'utilise pas le magic link (parcours email = signup avec password). Ce template est livré au cas où on l'active en Phase 2 comme fallback en zone réseau instable.

**Sujet :**
```
Ton lien de connexion Niqo
```

**Body (HTML) :**
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;padding:32px 24px;">
          <tr>
            <td>
              <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;">
                niqo<span style="color:#D85A30;">.</span>
              </p>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.3;">
                Ton lien de connexion
              </h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:#444441;">
                Tape sur le bouton ci-dessous pour te connecter à ton compte Niqo. Pas besoin de mot de passe.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Me connecter
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                Ce lien expire dans 1 heure et ne peut être utilisé qu'une seule fois. Si tu n'es pas à l'origine de cette demande, ignore cet email.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#5A5A57;">
          Niqo — La marketplace de confiance en Afrique.<br>
          Une question ? Écris-nous à <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## Procédure d'application

1. **Dashboard Supabase** → projet Niqo → **Authentication → Emails**
2. Pour chaque template (Confirm signup, Reset password, Change email, Magic link) :
   - Copier le **sujet** dans le champ **Subject heading**
   - Copier le **body HTML** dans le champ **Message body**
   - Cliquer **Save**
3. **Tester** : déclencher un signup réel (avec Confirm email ON) ou un reset → vérifier l'email reçu
4. Cocher la case correspondante dans `docs/auth-todo.md`

## Vérifications post-application

- [ ] Le rendu mobile (Gmail iOS / Mail iOS / Gmail Android) est correct (test sur device)
- [ ] Le bouton "Confirmer/Réinitialiser/etc." est bien tappable (target ≥ 44px de hauteur grâce au padding 14px + font 17px)
- [ ] Le wordmark `niqo.` s'affiche en noir avec le `.` coral
- [ ] Pas de fond blanc cassé sur dark mode (le fond `#FAFAF9` est neutre)
- [ ] Le lien `{{ .ConfirmationURL }}` redirige bien vers `niqo://auth/callback?...` (en Dev Client / standalone uniquement)
- [ ] Footer texte à 13px / #5A5A57 reste lisible sur Tecno/Itel

## Évolution

Si la charte de marque évolue (cf. `CLAUDE.md` §5) :
1. Mettre à jour les couleurs/copy ici
2. Re-coller dans Supabase
3. Cocher dans `docs/auth-todo.md`

Le rendu d'emails est conservateur (Arial fallback, pas de webfont) pour maximiser le support cross-client. Évolution vers une font webfont (Space Grotesk) = à débattre quand on aura un domaine envoi `@niqo.africa` configuré (DKIM/SPF) — pas avant.

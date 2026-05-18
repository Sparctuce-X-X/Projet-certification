import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AUTH_TIMEOUT_MS,
  supabase,
  withTimeout,
  type PublicUser,
} from "@/lib/supabase";
import { authErrorToFr } from "@/lib/auth/errors";
import type { Session } from "@supabase/supabase-js";

export type AuthGateReason =
  | "sell"
  | "messages"
  | "profile"
  | "favorite"
  | "contact";

export type OAuthProvider = "google" | "apple" | "email";

interface AuthState {
  session: Session | null;
  profile: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * `true` quand un user est connecté ET son profil est incomplet (typiquement
   * post-signup OAuth Google/Apple : pas de telephone collecté). Le caller
   * doit forcer la nav vers /auth/complete-profile tant que ce flag est true.
   */
  needsProfileCompletion: boolean;
  gateReason: AuthGateReason | null;
  authError: string | null;
  /**
   * Returns true if authenticated; otherwise opens the gate modal with the
   * given reason and returns false. Returns false (without opening the gate)
   * while isLoading to avoid a flash of the modal during cold-start hydration.
   */
  requireAuth: (reason: AuthGateReason) => boolean;
  closeGate: () => void;
  clearAuthError: () => void;
  /**
   * Real Supabase OAuth (browser flow). Throws for "email" — the email auth
   * lives on its own screen at /auth/email (form is too complex for a sheet).
   */
  signIn: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Refresh the local profile state. With no argument, re-fetches the
   * public.users row for the current session (one SELECT round-trip) —
   * use it after complete_my_profile() pour rafraîchir
   * `needsProfileCompletion`. If `prefetched` is passed (e.g. row returned
   * from an UPDATE … RETURNING RPC), uses it directly to skip the round-trip.
   */
  refreshProfile: (prefetched?: PublicUser) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

const SUPPORT_EMAIL = "support@niqo.africa";

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [gateReason, setGateReason] = useState<AuthGateReason | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  const closeGate = useCallback(() => setGateReason(null), []);
  const clearAuthError = useCallback(() => setAuthError(null), []);

  const fetchProfile = useCallback(
    async (userId: string): Promise<PublicUser | null> => {
      // `select *` ramène la colonne telephone en bytea (hex string ou null).
      // On NE garde PAS le contenu chiffré côté client — on dérive juste un
      // booléen has_phone et on strip la valeur. Pour récupérer le téléphone
      // décrypté (écran /profile), passer par getMyPhone() (RPC dédiée).
      //
      // Retry x3 avec backoff (600 ms / 1 200 ms) pour absorber les
      // erreurs réseau transitoires sur Tecno/Itel en 3G/Edge.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          await new Promise<void>((r) => setTimeout(r, attempt * 600));
        }
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .single<Record<string, unknown>>();
        if (!error && data) {
          const { telephone, ...rest } = data;
          return {
            ...(rest as Omit<PublicUser, "has_phone">),
            has_phone: telephone !== null && telephone !== undefined,
          };
        }
      }
      return null;
    },
    []
  );

  const handleSession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setIsProfileLoading(false);
        // Clear favorites cache on signout to prevent stale data
        // on next login with a different account.
        try {
          const { clearFavoritesCache } = await import("@/lib/favorites");
          clearFavoritesCache();
        } catch {
          // Module not yet loaded — ok, nothing to clear.
        }
        return;
      }
      setIsProfileLoading(true);
      try {
        const fetched = await fetchProfile(nextSession.user.id);
        if (!isMountedRef.current) return;
        if (!fetched) {
          // 3 tentatives épuisées — réseau ou trigger handle_new_user raté.
          // Tente une réparation automatique via repair_my_profile() avant
          // de déconnecter : si le trigger a planté, la RPC recrée le profil
          // depuis raw_user_meta_data (même logique que le trigger).
          try {
            const { data: repaired } = await supabase.rpc("repair_my_profile");
            if (repaired && isMountedRef.current) {
              const { telephone, ...rest } = repaired as Record<string, unknown>;
              const repairedProfile: PublicUser = {
                ...(rest as Omit<PublicUser, "has_phone">),
                has_phone: telephone !== null && telephone !== undefined,
              };
              if (!repairedProfile.is_active) {
                setAuthError(`Ton compte a été suspendu. Contacte ${SUPPORT_EMAIL}.`);
                await supabase.auth.signOut();
                return;
              }
              setProfile(repairedProfile);
              setGateReason(null);
              return;
            }
          } catch {
            // repair_my_profile() injoignable (réseau) — fall through signOut.
          }
          setAuthError(
            `Erreur de chargement du profil. Réessaie ou contacte ${SUPPORT_EMAIL}.`
          );
          await supabase.auth.signOut();
          return;
        }
        if (!fetched.is_active) {
          setAuthError(
            `Ton compte a été suspendu. Contacte ${SUPPORT_EMAIL}.`
          );
          await supabase.auth.signOut();
          return;
        }
        // OAuth signup: cgu_accepted_at can't be set by the trigger (Supabase
        // overwrites raw_user_meta_data with provider claims). Record it now
        // on first login via RPC (timestamp serveur, pas client).
        if (!fetched.cgu_accepted_at) {
          try {
            const { LEGAL_LAST_UPDATED } = await import("@/lib/legal");
            await supabase.rpc("accept_auth_cgu", { p_version: LEGAL_LAST_UPDATED });
          } catch {
            // Non-bloquant — le backfill migration 21 rattrape
          }
        }
        setProfile(fetched);
        // Auto-dismiss the gate now that auth succeeded.
        setGateReason(null);
      } finally {
        if (isMountedRef.current) setIsProfileLoading(false);
      }
    },
    [fetchProfile]
  );

  // Initial hydration + subscription to auth state changes.
  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMountedRef.current) return;
      await handleSession(data.session);
      if (isMountedRef.current) setIsLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void handleSession(next);
    });

    return () => {
      isMountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, [handleSession]);

  // ── Push notifications : register quand profile chargé, unregister au logout
  // Best-effort — n'échoue jamais le flow auth si la registration plante.
  useEffect(() => {
    if (!profile?.is_active) return;
    void (async () => {
      try {
        const { registerForPushNotifications } = await import("@/lib/push");
        await registerForPushNotifications();
      } catch {
        // Silent — push notif non-bloquant pour le login
      }
    })();
  }, [profile?.id, profile?.is_active]);

  // ── Check is_active au retour foreground (suspension en temps réel) ─────
  // Si l'admin suspend un compte pendant que l'user utilise l'app, le check
  // se déclenche au prochain retour foreground (switch app, écran veille, etc.)
  // Aussi check toutes les 30s quand l'app est au premier plan.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    let suspended = false;

    const checkActive = async () => {
      if (suspended) return;
      try {
        const { data } = await supabase
          .from("users")
          .select("is_active")
          .eq("id", uid)
          .single<{ is_active: boolean }>();

        if (data && !data.is_active) {
          suspended = true;
          setAuthError(`Ton compte a été suspendu. Contacte ${SUPPORT_EMAIL}.`);
          setProfile(null);
          await supabase.auth.signOut();
        }
      } catch {
        // Réseau down — on retry au prochain cycle
      }
    };

    // Check immédiat au mount
    void checkActive();

    // Check au retour foreground
    const { AppState } = require("react-native");
    const appSub = AppState.addEventListener("change", (state: string) => {
      if (state === "active") void checkActive();
    });

    // Check périodique toutes les 30s (fallback si l'user ne switch pas d'app)
    const interval = setInterval(() => void checkActive(), 30_000);

    return () => {
      appSub.remove();
      clearInterval(interval);
    };
  }, [session?.user?.id]);

  const isAuthenticated = session !== null && profile?.is_active === true;

  // Profil OAuth incomplet : signed-in mais pas de téléphone. Email signup
  // pousse toujours un téléphone via le wizard step 3 → toujours false.
  // OAuth Google/Apple → true tant que l'user n'a pas complété /auth/complete-profile.
  const needsProfileCompletion = isAuthenticated && profile?.has_phone === false;

  const requireAuth = useCallback(
    (reason: AuthGateReason): boolean => {
      // Don't open the gate during cold-start hydration (avoid flash) OR
      // during the post-signin profile fetch (avoid wrong-context gate
      // re-opening when user just signed up and tapped the next gated CTA).
      if (isLoading || isProfileLoading) return false;
      if (isAuthenticated) return true;
      setGateReason(reason);
      return false;
    },
    [isAuthenticated, isLoading, isProfileLoading]
  );

  const signIn = useCallback(async (provider: OAuthProvider) => {
    if (provider === "email") {
      throw new Error(
        "Email auth doit passer par /auth/email — pas par signIn(). Cf. AuthGate.tsx."
      );
    }

    setAuthError(null);

    try {
      const country = await AsyncStorage.getItem("niqo_country");
      const redirectTo = Linking.createURL("/auth/callback");

      const { data, error } = await withTimeout(
        supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
            // Critical : sans ça supabase-js essaie d'assigner window.location
            // (no-op + warning en RN). On ouvre nous-mêmes via WebBrowser.
            skipBrowserRedirect: true,
            queryParams: {
              pays: country ?? "CI",
            },
          },
        }),
        AUTH_TIMEOUT_MS,
        "signInWithOAuth"
      );

      if (error || !data?.url) {
        setAuthError(authErrorToFr(error));
        return;
      }

      // Ouvre ASWebAuthenticationSession (iOS) / Custom Tabs (Android),
      // résolve quand le redirect match `redirectTo`.
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo
      );

      // Cancel / dismiss = action volontaire de l'user, pas une erreur.
      // On reste silencieux (pas de banner rouge) — cf. auth-todo §Bugs UX.
      if (result.type === "cancel" || result.type === "dismiss") {
        return;
      }
      if (result.type !== "success") {
        setAuthError(authErrorToFr(null));
        return;
      }

      // Parse `?code=...` du redirect URL et échange contre une session.
      // PKCE flow : Supabase signe le code, on l'échange via le SDK qui
      // calcule le PKCE verifier stocké en SecureStore.
      const url = new URL(result.url);
      const code = url.searchParams.get("code");
      if (!code) {
        setAuthError(authErrorToFr(null));
        return;
      }

      const { error: exchangeError } = await withTimeout(
        supabase.auth.exchangeCodeForSession(code),
        AUTH_TIMEOUT_MS,
        "exchangeCodeForSession"
      );
      if (exchangeError) {
        setAuthError(authErrorToFr(exchangeError));
        return;
      }
      // onAuthStateChange fire SIGNED_IN → handleSession update tout.
    } catch (e) {
      setAuthError(authErrorToFr(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    // Désinscrit le push token AVANT signOut (RLS owner DELETE exige session).
    try {
      const { unregisterPushTokenForCurrentDevice } = await import("@/lib/push");
      await unregisterPushTokenForCurrentDevice();
    } catch {
      // Best-effort, n'empêche pas le logout
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // Offline/server down — force-clear local state.
      setSession(null);
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(
    async (prefetched?: PublicUser) => {
      if (prefetched) {
        if (isMountedRef.current) setProfile(prefetched);
        return;
      }
      if (!session) return;
      const fetched = await fetchProfile(session.user.id);
      if (!isMountedRef.current) return;
      if (fetched) setProfile(fetched);
    },
    [session, fetchProfile]
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      isAuthenticated,
      isLoading,
      needsProfileCompletion,
      gateReason,
      authError,
      requireAuth,
      closeGate,
      clearAuthError,
      signIn,
      signOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      isAuthenticated,
      isLoading,
      needsProfileCompletion,
      gateReason,
      authError,
      requireAuth,
      closeGate,
      clearAuthError,
      signIn,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

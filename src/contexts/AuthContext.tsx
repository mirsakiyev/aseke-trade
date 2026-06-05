import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { safeErrorMessage, sanitizePlainText, validateEmail, validatePassword } from "../lib/validation";
import type { Profile } from "../types/content";

interface AuthActionResult {
  ok: boolean;
  message: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isConfigured: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (fullName: string, email: string, password: string, termsAccepted: boolean) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthActionResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function profileHasPremium(profile: Profile | null): boolean {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "premium") return true;
  if (!profile.premium_until) return false;
  return new Date(profile.premium_until).getTime() > Date.now();
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,username,role,premium_until,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (nextSession?.user) {
      setProfile(await fetchProfile(nextSession.user.id));
    } else {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      await applySession(data.session);
      setIsLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession).finally(() => {
        if (isMounted) setIsLoading(false);
      });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    setProfile(await fetchProfile(user.id));
  }, [user]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { ok: false, message: "Connect Supabase environment variables before using authentication." };
    }

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError || passwordError) return { ok: false, message: emailError ?? passwordError };

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) return { ok: false, message: safeErrorMessage(error) };
    return { ok: true, message: null };
  }, []);

  const signUp = useCallback(
    async (
      fullName: string,
      email: string,
      password: string,
      termsAccepted: boolean
    ): Promise<AuthActionResult> => {
      if (!supabase) {
        return { ok: false, message: "Connect Supabase environment variables before creating accounts." };
      }

      const cleanedName = sanitizePlainText(fullName, 120);
      const emailError = validateEmail(email);
      const passwordError = validatePassword(password);

      if (!cleanedName) return { ok: false, message: "Full name is required." };
      if (emailError || passwordError) return { ok: false, message: emailError ?? passwordError };
      if (!termsAccepted) return { ok: false, message: "You must accept the Terms of Agreement to continue." };

      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: cleanedName,
            terms_accepted: true
          }
        }
      });

      if (error) return { ok: false, message: safeErrorMessage(error) };

      return {
        ok: true,
        message: "Account created. If email verification is enabled, check your inbox before signing in."
      };
    },
    []
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { ok: false, message: "Connect Supabase environment variables before using password reset." };
    }

    const emailError = validateEmail(email);
    if (emailError) return { ok: false, message: emailError };

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`
    });

    if (error) return { ok: false, message: safeErrorMessage(error) };
    return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      profile,
      isLoading,
      isConfigured: isSupabaseConfigured,
      isAdmin: profile?.role === "admin",
      isPremium: profileHasPremium(profile),
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshProfile
    }),
    [isLoading, profile, refreshProfile, resetPassword, session, signIn, signOut, signUp, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}

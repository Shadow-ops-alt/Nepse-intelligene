import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

interface HostedAuthValue {
  hosted: boolean;
  session: Session | null;
  signOut: () => Promise<void>;
}

const HostedAuthContext = createContext<HostedAuthValue>({
  hosted: false,
  session: null,
  signOut: async () => undefined,
});

export function useHostedAuth(): HostedAuthValue {
  return useContext(HostedAuthContext);
}

function LoginScreen({
  client,
  onSignedIn,
}: {
  client: SupabaseClient;
  onSignedIn: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: authError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw new Error(authError.message);
      if (!data.session) throw new Error("Sign in did not return a session.");
      onSignedIn(data.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hosted-auth">
      <div className="hosted-auth-card">
        <div className="hosted-auth-brand">
          <span className="hosted-auth-mark" aria-hidden="true">
            N
          </span>
          <div>
            <strong>NEPSE Terminal</strong>
            <span className="muted small">Cloud account</span>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="muted small">
          Use the email and password provided by the operator. Accounts are
          invite-only.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p className="hosted-auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted tiny">
          Market data is read from the local data pack. The account stores your
          watchlist, portfolio, plans and journal in Supabase.
        </p>
      </div>
    </div>
  );
}

/**
 * Wraps the app when /hosted-config.json exists. Without a session it shows
 * the invite-only login; the rest of the app is untouched.
 */
export function HostedApp({
  client,
  children,
}: {
  client: SupabaseClient;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  if (session === undefined) {
    return (
      <div className="hosted-auth">
        <div className="hosted-auth-loading">
          <span className="hosted-auth-mark" aria-hidden="true">
            N
          </span>
          <p className="muted">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen client={client} onSignedIn={setSession} />;
  }

  return (
    <HostedAuthContext.Provider
      value={{
        hosted: true,
        session,
        signOut: async () => {
          await client.auth.signOut();
        },
      }}
    >
      {children}
    </HostedAuthContext.Provider>
  );
}

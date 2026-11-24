import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { HostedConfig } from "./config";

let client: SupabaseClient | null = null;

export function createHostedClient(config: HostedConfig): SupabaseClient {
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "nepse-terminal-hosted-auth",
    },
  });
  return client;
}

export function setHostedClient(next: SupabaseClient | null): void {
  client = next;
}

export function getHostedClient(): SupabaseClient | null {
  return client;
}

export function isHostedMode(): boolean {
  return client !== null;
}

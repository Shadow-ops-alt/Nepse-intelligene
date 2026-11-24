export interface HostedConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  packManifestUrl?: string;
}

/**
 * The Android shell serves this file when hosted mode is configured. Desktop
 * and dev mode have no such file, so a failed fetch means local-only mode.
 */
export async function loadHostedConfig(): Promise<HostedConfig | null> {
  try {
    const response = await fetch("/hosted-config.json", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<HostedConfig>;
    if (
      typeof body.supabaseUrl !== "string" ||
      typeof body.supabaseAnonKey !== "string" ||
      !/^https?:\/\//i.test(body.supabaseUrl) ||
      body.supabaseAnonKey.length < 20
    ) {
      return null;
    }
    return {
      supabaseUrl: body.supabaseUrl.replace(/\/+$/, ""),
      supabaseAnonKey: body.supabaseAnonKey,
      ...(typeof body.packManifestUrl === "string"
        ? { packManifestUrl: body.packManifestUrl }
        : {}),
    };
  } catch {
    return null;
  }
}

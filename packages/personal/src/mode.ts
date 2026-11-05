/**
 * Guard rails for the free-source data path.
 *
 * This path is used by the Free Edition and by explicit development runs. It
 * is not a substitute for a licensed data agreement.
 */

export const PERSONAL_MODE_BANNER = [
  "FREE-SOURCE DATA MODE",
  "Data source: unofficial / terms unverified / not production-ready",
  "Do not redistribute this data or publish a database containing it.",
  "Derived analytics are research output, not investment advice.",
].join("\n");

export interface PersonalModeCheck {
  environment: string;
  edition: string;
  unofficialAllowed: boolean;
}

export function personalModeStatus(
  env: NodeJS.ProcessEnv = process.env,
): PersonalModeCheck {
  return {
    environment: env.NODE_ENV ?? "development",
    edition: env.DATA_EDITION === "free" ? "free" : "licensed",
    unofficialAllowed:
      env.DATA_EDITION === "free" || env.ALLOW_UNOFFICIAL_DATA === "true",
  };
}

/**
 * Throws unless the process is explicitly in the free edition or a
 * development/test personal run.
 */
export function assertPersonalMode(env: NodeJS.ProcessEnv = process.env): void {
  const status = personalModeStatus(env);

  // The free edition is a deliberate product edition, not a dev-only run.
  if (status.edition === "free") return;

  if (status.environment === "production") {
    throw new Error(
      "Personal research mode is disabled in production. Set DATA_EDITION=free for the free edition, or use a licensed provider.",
    );
  }

  if (!status.unofficialAllowed) {
    throw new Error(
      "Personal research mode requires ALLOW_UNOFFICIAL_DATA=true or DATA_EDITION=free.",
    );
  }
}

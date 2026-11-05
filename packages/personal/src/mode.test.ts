import { describe, expect, it } from "vitest";
import { assertPersonalMode, personalModeStatus } from "./mode";

describe("personal mode guard", () => {
  it("refuses production", () => {
    expect(() =>
      assertPersonalMode({
        NODE_ENV: "production",
        ALLOW_UNOFFICIAL_DATA: "true",
      }),
    ).toThrow(/disabled in production/);
  });

  it("requires the explicit unofficial-data acknowledgement", () => {
    expect(() =>
      assertPersonalMode({ NODE_ENV: "development" }),
    ).toThrow(/ALLOW_UNOFFICIAL_DATA=true/);
  });

  it("allows the free edition in production", () => {
    expect(() =>
      assertPersonalMode({
        NODE_ENV: "production",
        DATA_EDITION: "free",
      }),
    ).not.toThrow();

    expect(
      personalModeStatus({
        NODE_ENV: "production",
        DATA_EDITION: "free",
      }),
    ).toEqual({
      environment: "production",
      edition: "free",
      unofficialAllowed: true,
    });
  });

  it("allows an acknowledged development run", () => {
    expect(() =>
      assertPersonalMode({
        NODE_ENV: "development",
        ALLOW_UNOFFICIAL_DATA: "true",
      }),
    ).not.toThrow();

    expect(
      personalModeStatus({
        NODE_ENV: "development",
        ALLOW_UNOFFICIAL_DATA: "true",
      }),
    ).toEqual({
      environment: "development",
      edition: "licensed",
      unofficialAllowed: true,
    });
  });
});

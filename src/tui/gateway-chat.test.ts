import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadConfigMock as loadConfig,
  pickPrimaryLanIPv4Mock as pickPrimaryLanIPv4,
  pickPrimaryTailnetIPv4Mock as pickPrimaryTailnetIPv4,
  resolveGatewayPortMock as resolveGatewayPort,
} from "../gateway/gateway-connection.test-mocks.js";
import { captureEnv, withEnvAsync } from "../test-utils/env.js";

vi.mock("../infra/tls/gateway.js", () => ({
  loadGatewayTlsRuntime: vi.fn().mockResolvedValue(undefined),
}));

const { resolveGatewayConnection } = await import("./gateway-chat.js");

describe("resolveGatewayConnection", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_PASSWORD"]);
    loadConfig.mockClear();
    resolveGatewayPort.mockClear();
    pickPrimaryTailnetIPv4.mockClear();
    pickPrimaryLanIPv4.mockClear();
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    pickPrimaryLanIPv4.mockReturnValue(undefined);
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_GATEWAY_PASSWORD;
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("throws when url override is missing explicit credentials", async () => {
    loadConfig.mockReturnValue({ gateway: { mode: "local" } });

    await expect(resolveGatewayConnection({ url: "wss://override.example/ws" })).rejects.toThrow(
      "explicit credentials",
    );
  });

  it.each([
    {
      label: "token",
      auth: { token: "explicit-token" },
      expected: { token: "explicit-token", password: undefined },
    },
    {
      label: "password",
      auth: { password: "explicit-password" },
      expected: { token: undefined, password: "explicit-password" },
    },
  ])("uses explicit $label when url override is set", async ({ auth, expected }) => {
    loadConfig.mockReturnValue({ gateway: { mode: "local" } });

    const result = await resolveGatewayConnection({
      url: "wss://override.example/ws",
      ...auth,
    });

    expect(result).toEqual({
      url: "wss://override.example/ws",
      ...expected,
      tlsFingerprint: undefined,
    });
  });

  it.each([
    {
      label: "tailnet",
      bind: "tailnet",
      setup: () => pickPrimaryTailnetIPv4.mockReturnValue("100.64.0.1"),
    },
    {
      label: "lan",
      bind: "lan",
      setup: () => pickPrimaryLanIPv4.mockReturnValue("192.168.1.42"),
    },
  ])("uses loopback host when local bind is $label", async ({ bind, setup }) => {
    loadConfig.mockReturnValue({ gateway: { mode: "local", bind } });
    resolveGatewayPort.mockReturnValue(18800);
    setup();

    const result = await resolveGatewayConnection({});

    expect(result.url).toBe("ws://127.0.0.1:18800");
  });

  it("uses OPENCLAW_GATEWAY_TOKEN for local mode", async () => {
    loadConfig.mockReturnValue({ gateway: { mode: "local" } });

    await withEnvAsync({ OPENCLAW_GATEWAY_TOKEN: "env-token" }, async () => {
      const result = await resolveGatewayConnection({});
      expect(result.token).toBe("env-token");
    });
  });

  it("falls back to config auth token when env token is missing", async () => {
    loadConfig.mockReturnValue({ gateway: { mode: "local", auth: { token: "config-token" } } });

    const result = await resolveGatewayConnection({});
    expect(result.token).toBe("config-token");
  });

  it("prefers OPENCLAW_GATEWAY_PASSWORD over remote password fallback", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        remote: {
          url: "wss://remote.example/ws",
          token: "remote-token",
          password: "remote-pass",
        },
      },
    });

    await withEnvAsync({ OPENCLAW_GATEWAY_PASSWORD: "env-pass" }, async () => {
      const result = await resolveGatewayConnection({});
      expect(result.password).toBe("env-pass");
    });
  });
});

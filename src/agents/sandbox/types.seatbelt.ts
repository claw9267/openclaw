export type SandboxSeatbeltProxyConfig = {
  /** Whether the proxy is enabled for this agent. Default: true */
  enabled: boolean;
  /** Port to use. 0 = auto-assign. */
  port: number;
  /** Default policy: "allow" passes all traffic, "deny" blocks unless allowlisted. */
  defaultPolicy: "allow" | "deny";
  /** Domains to allow when defaultPolicy is "deny". Supports wildcards: "*.example.com" */
  allowedDomains: string[];
  /** Domains to deny when defaultPolicy is "allow". Supports wildcards. */
  deniedDomains: string[];
  /** Per-agent auth token for proxy impersonation prevention. Auto-generated. */
  token?: string;
};

export type SandboxSeatbeltConfig = {
  /** Path to the .sb profile file. */
  profile: string;
  /** Directory containing .sb profile files. */
  profileDir: string;
  /** Parameters to pass to sandbox-exec via -D. Merged with auto-generated params. */
  params?: Record<string, string>;
  /** Network proxy configuration for domain-level filtering. */
  proxy: SandboxSeatbeltProxyConfig;
};

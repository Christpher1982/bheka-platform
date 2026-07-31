// Typed errors for all Vault operation failure modes.
// Per ADR-002: callers receive a typed error — never a silent fallback.
// bheka-gateway maps these to RFC 9457 application/problem+json responses.

export class VaultError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

// Thrown when VAULT_ENDPOINT is not configured.
// Surfaces as HTTP 503. Indicates Eride Vault has not been deployed yet
// or the environment variable has not been set for this environment.
export class VaultNotDeployedError extends VaultError {
  constructor() {
    super(
      "vault.not_deployed",
      "Eride Vault is not configured. Set VAULT_ENDPOINT, VAULT_TLS_CERT_PATH, " +
        "VAULT_TLS_KEY_PATH, and VAULT_TLS_CA_PATH to enable Vault operations.",
    );
    this.name = "VaultNotDeployedError";
  }
}

// Thrown when the gRPC channel is configured but the Vault is unreachable.
// Surfaces as HTTP 503. Indicates a network or deployment issue.
export class VaultUnavailableError extends VaultError {
  constructor(cause?: Error) {
    super(
      "vault.unavailable",
      `Eride Vault is unreachable: ${cause?.message ?? "unknown error"}`,
    );
    this.name = "VaultUnavailableError";
    if (cause) this.cause = cause;
  }
}

// Thrown when the requested tenant or key version does not exist in the Vault.
// Surfaces as HTTP 404.
export class VaultKeyNotFoundError extends VaultError {
  constructor(tenantId: string, keyVersion?: string) {
    super(
      "vault.key_not_found",
      keyVersion
        ? `Tenant ${tenantId} key version "${keyVersion}" not found in Vault`
        : `No active key found for tenant ${tenantId}`,
    );
    this.name = "VaultKeyNotFoundError";
  }
}

// Thrown when the calling service's mTLS certificate is rejected by the Vault.
// Surfaces as HTTP 500 (internal: the gateway cert is misconfigured).
export class VaultAuthError extends VaultError {
  constructor(detail: string) {
    super("vault.auth_error", `Vault rejected gateway mTLS certificate: ${detail}`);
    this.name = "VaultAuthError";
  }
}

// Thrown when a shred is requested for a key version that has already been shredded.
// Surfaces as HTTP 409 (the idempotency check in tenant_keys catches this first).
export class VaultAlreadyShreddedError extends VaultError {
  constructor(keyVersion: string) {
    super(
      "vault.already_shredded",
      `Key version "${keyVersion}" has already been shredded and cannot be shredded again`,
    );
    this.name = "VaultAlreadyShreddedError";
  }
}

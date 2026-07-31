// TypeScript types for all Eride Vault gRPC operations.
// Derived from CANON sections 2 and 6, and schemas/grpc/vault.proto.
// Per ADR-002: shapes are inferred from CANON; GUIDE-02 may add fields when available.

// ── GetTenantPublicKey ──────────────────────────────────────────────────────

export interface GetTenantPublicKeyRequest {
  tenantId: string;
  // Optional: empty string means "active version". Provide an explicit version
  // only when re-provisioning an agent against a specific historical key.
  keyVersion?: string;
}

export interface GetTenantPublicKeyResponse {
  keyVersion: string;
  // base64url-encoded X25519 public key. Agent uses this with HPKE (RFC 9180)
  // to seal per-blob DEKs before upload (CANON section 2).
  publicKeyX25519B64: string;
}

// ── UnwrapDek ───────────────────────────────────────────────────────────────

export interface UnwrapDekRequest {
  tenantId: string;
  // Exact key version under which the agent sealed this DEK.
  keyVersion: string;
  // base64url-encoded HPKE ciphertext produced by the agent.
  sealedDekB64: string;
}

export interface UnwrapDekResponse {
  // base64url-encoded AES-256 DEK. Handle in memory only — never persist.
  // The caller decrypts the evidence payload in memory and discards this value.
  // Routing bulk payload through the Vault is prohibited (CANON section 6, ADR-011).
  plaintextDekB64: string;
}

// ── RotateTenantKey ─────────────────────────────────────────────────────────

export interface RotateTenantKeyRequest {
  tenantId: string;
}

export interface RotateTenantKeyResponse {
  newKeyVersion: string;
  // base64url-encoded X25519 public key for the new version.
  // Next-enrolling agents must use this key. Existing DEKs sealed under the
  // previous version remain decryptable until that version is shredded.
  newPublicKeyX25519B64: string;
}

// ── ShredTenantKey ──────────────────────────────────────────────────────────

export interface ShredTenantKeyRequest {
  tenantId: string;
  // The exact key version to destroy. Must match a tenant_keys.key_version row.
  keyVersion: string;
}

// Intentionally empty: success is the only meaningful response.
// Failure surfaces as a VaultError subtype.
export type ShredTenantKeyResponse = Record<never, never>;

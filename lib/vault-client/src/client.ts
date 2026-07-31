// VaultClient interface and VaultGrpcClient stub implementation.
// Per ADR-002: VaultGrpcClient throws VaultNotDeployedError when VAULT_ENDPOINT
// is absent. When configured, it is intended to make real gRPC/mTLS calls to
// Eride Vault (Rust service). The gRPC call bodies are marked for GUIDE-02
// integration — they are structured stubs, not silent mocks.

import type {
  GetTenantPublicKeyRequest,
  GetTenantPublicKeyResponse,
  UnwrapDekRequest,
  UnwrapDekResponse,
  RotateTenantKeyRequest,
  RotateTenantKeyResponse,
  ShredTenantKeyRequest,
  ShredTenantKeyResponse,
} from "./types.js";
import {
  VaultNotDeployedError,
  VaultUnavailableError,
} from "./errors.js";

// ── VaultClient interface ───────────────────────────────────────────────────

export interface VaultClient {
  getTenantPublicKey(
    req: GetTenantPublicKeyRequest,
  ): Promise<GetTenantPublicKeyResponse>;

  unwrapDek(req: UnwrapDekRequest): Promise<UnwrapDekResponse>;

  rotateTenantKey(
    req: RotateTenantKeyRequest,
  ): Promise<RotateTenantKeyResponse>;

  shredTenantKey(req: ShredTenantKeyRequest): Promise<ShredTenantKeyResponse>;
}

// ── VaultConfig ─────────────────────────────────────────────────────────────

interface VaultConfig {
  endpoint: string;        // e.g. "vault.internal.eride.tech:50051"
  tlsCertPath: string;     // PEM file path for gateway client certificate
  tlsKeyPath: string;      // PEM file path for gateway client private key
  tlsCaPath: string;       // PEM file path for Vault CA certificate
}

function loadConfig(): VaultConfig | null {
  const endpoint = process.env.VAULT_ENDPOINT;
  const tlsCertPath = process.env.VAULT_TLS_CERT_PATH;
  const tlsKeyPath = process.env.VAULT_TLS_KEY_PATH;
  const tlsCaPath = process.env.VAULT_TLS_CA_PATH;

  if (!endpoint || !tlsCertPath || !tlsKeyPath || !tlsCaPath) {
    return null;
  }
  return { endpoint, tlsCertPath, tlsKeyPath, tlsCaPath };
}

// ── VaultGrpcClient ─────────────────────────────────────────────────────────

// Structured stub: when Vault is not deployed, every method throws
// VaultNotDeployedError immediately. When deployed, the gRPC call bodies
// require GUIDE-02 integration (see comment blocks below each method).
//
// Implementation contract per ADR-002:
// - Never return fabricated/fake data. Either succeed via a real gRPC call
//   or throw a typed VaultError.
// - mTLS certificate paths are read from env vars (see loadConfig).
// - The proto contract is at schemas/grpc/vault.proto.

export class VaultGrpcClient implements VaultClient {
  private readonly config: VaultConfig | null;

  constructor() {
    this.config = loadConfig();
  }

  private assertDeployed(): VaultConfig {
    if (!this.config) {
      throw new VaultNotDeployedError();
    }
    return this.config;
  }

  async getTenantPublicKey(
    req: GetTenantPublicKeyRequest,
  ): Promise<GetTenantPublicKeyResponse> {
    const cfg = this.assertDeployed();
    // GUIDE-02 integration point:
    // 1. Obtain gRPC channel with mTLS using cfg (see schemas/grpc/vault.proto).
    // 2. Call VaultService.GetTenantPublicKey with { tenant_id, key_version }.
    // 3. Return { keyVersion, publicKeyX25519B64 } from the response.
    // 4. Map gRPC status NOT_FOUND → VaultKeyNotFoundError(req.tenantId).
    throw new VaultUnavailableError(
      new Error(
        `gRPC call to ${cfg.endpoint} requires GUIDE-02 integration ` +
          `(see schemas/grpc/vault.proto GetTenantPublicKey)`,
      ),
    );
  }

  async unwrapDek(req: UnwrapDekRequest): Promise<UnwrapDekResponse> {
    const cfg = this.assertDeployed();
    // GUIDE-02 integration point:
    // 1. Obtain gRPC channel with mTLS using cfg.
    // 2. Call VaultService.UnwrapDek with { tenant_id, key_version, sealed_dek_b64 }.
    // 3. Return { plaintextDekB64 } from the response.
    // 4. Map NOT_FOUND → VaultKeyNotFoundError, UNAUTHENTICATED → VaultAuthError.
    throw new VaultUnavailableError(
      new Error(
        `gRPC call to ${cfg.endpoint} requires GUIDE-02 integration ` +
          `(see schemas/grpc/vault.proto UnwrapDek)`,
      ),
    );
  }

  async rotateTenantKey(
    req: RotateTenantKeyRequest,
  ): Promise<RotateTenantKeyResponse> {
    const cfg = this.assertDeployed();
    // GUIDE-02 integration point:
    // 1. Obtain gRPC channel with mTLS using cfg.
    // 2. Call VaultService.RotateTenantKey with { tenant_id }.
    // 3. Return { newKeyVersion, newPublicKeyX25519B64 } from the response.
    // 4. Persist new public key to tenant_keys via withTenantContext before returning.
    throw new VaultUnavailableError(
      new Error(
        `gRPC call to ${cfg.endpoint} requires GUIDE-02 integration ` +
          `(see schemas/grpc/vault.proto RotateTenantKey)`,
      ),
    );
  }

  async shredTenantKey(
    req: ShredTenantKeyRequest,
  ): Promise<ShredTenantKeyResponse> {
    const cfg = this.assertDeployed();
    // GUIDE-02 integration point:
    // 1. Obtain gRPC channel with mTLS using cfg.
    // 2. Call VaultService.ShredTenantKey with { tenant_id, key_version }.
    // 3. On success: set tenant_keys.shred_at = now() for this key_version.
    // 4. Map NOT_FOUND → VaultKeyNotFoundError,
    //    ALREADY_EXISTS (idempotent shred attempt) → VaultAlreadyShreddedError.
    throw new VaultUnavailableError(
      new Error(
        `gRPC call to ${cfg.endpoint} requires GUIDE-02 integration ` +
          `(see schemas/grpc/vault.proto ShredTenantKey)`,
      ),
    );
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

// One VaultGrpcClient per process. Config is read once at module load time.
export const vaultClient: VaultClient = new VaultGrpcClient();

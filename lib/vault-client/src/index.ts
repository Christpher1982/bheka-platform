export type {
  GetTenantPublicKeyRequest,
  GetTenantPublicKeyResponse,
  IssueAgentCertRequest,
  IssueAgentCertResponse,
  UnwrapDekRequest,
  UnwrapDekResponse,
  RotateTenantKeyRequest,
  RotateTenantKeyResponse,
  ShredTenantKeyRequest,
  ShredTenantKeyResponse,
} from "./types.js";

export {
  VaultError,
  VaultNotDeployedError,
  VaultUnavailableError,
  VaultKeyNotFoundError,
  VaultAuthError,
  VaultAlreadyShreddedError,
} from "./errors.js";

export type { VaultClient } from "./client.js";
export { VaultGrpcClient, vaultClient } from "./client.js";

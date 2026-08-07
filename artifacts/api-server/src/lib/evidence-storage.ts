// Evidence image storage: filesystem-backed, encrypted-at-rest.
//
// Replaces the previous stopgap of storing screenshot_capture's
// screenshotImageBase64 directly inside activity_events.metadata (a jsonb
// column) — see the comment at the top of routes/v1/agent-events.ts. Callers
// write/read plaintext Buffers; this module handles encryption, filesystem
// layout, and key derivation.
//
// Storage backend choice: plain filesystem under EVIDENCE_STORAGE_DIR, not
// S3/MinIO. Nothing in this repo wires up an S3 client or MinIO today (no
// @aws-sdk dependency, no MINIO_* env vars, no docker-compose service) — the
// evidence.ts schema's s3Bucket/s3Key columns describe the target design for
// when bheka-case + Eride Vault are built, but that infrastructure does not
// exist yet. Inventing it here (spinning up a new S3-compatible dependency)
// would be new infra the task explicitly says to avoid. Filesystem storage
// under a dedicated directory is the documented fallback and is trivial to
// swap out later: everything reading/writing image bytes goes through the
// three functions below, so a future S3-backed implementation only has to
// change this one file.
//
// Encryption: AES-256-GCM, one key per tenant, derived via HKDF-SHA256 from
// EVIDENCE_MASTER_KEY + the tenant's id as salt. This is an intentionally
// simple stand-in for the full HPKE/Vault-issued-DEK scheme described in
// evidence.ts (sealedDekB64/keyVersion) and lib/vault-client — that scheme
// requires a deployed Eride Vault gRPC service (ADR-002: VaultGrpcClient must
// never fabricate key material), which is out of scope here. Deriving a
// distinct key per tenant (rather than one global key) still gives a
// meaningful security boundary — compromising one tenant's derived key does
// not expose another tenant's images — and the evidence_images row shape
// (keyVersion, ivBase64, authTagBase64) matches the target design closely
// enough that migrating to real Vault-issued DEKs later is a data migration,
// not a schema change.
//
// Layout on disk: EVIDENCE_STORAGE_DIR/<tenantId>/<yyyy>/<mm>/<dd>/<uuid>.bin
// Date-partitioned so no single directory accumulates unbounded file counts.

import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV, standard for GCM.
export const CURRENT_KEY_VERSION = "v1";

// ── Key derivation ───────────────────────────────────────────────────────────

// One AES-256 key per (tenantId, keyVersion) pair, derived deterministically
// so no key material is persisted anywhere — it is always re-derived from
// EVIDENCE_MASTER_KEY on demand. Same approach as the "derive, don't store"
// principle in lib/vault-client's HPKE design, just without the gRPC hop.
function deriveTenantKey(tenantId: string, keyVersion: string): Buffer {
  const salt = createHash("sha256").update(`${tenantId}:${keyVersion}`).digest();
  const derived = hkdfSync(
    "sha256",
    Buffer.from(config.EVIDENCE_MASTER_KEY, "utf8"),
    salt,
    Buffer.from("bheka-evidence-image-key", "utf8"),
    32,
  );
  return Buffer.from(derived);
}

// ── Storage key layout ───────────────────────────────────────────────────────

function buildStorageKey(tenantId: string, occurredAt: Date, id: string): string {
  const yyyy = occurredAt.getUTCFullYear().toString().padStart(4, "0");
  const mm = (occurredAt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = occurredAt.getUTCDate().toString().padStart(2, "0");
  // storageKey is always forward-slash-joined and relative — never absolute,
  // and never contains ".." — resolveStoragePath re-validates this at read
  // time regardless of what produced the key.
  return [tenantId, yyyy, mm, dd, `${id}.bin`].join("/");
}

function resolveStoragePath(storageKey: string): string {
  const root = path.resolve(config.EVIDENCE_STORAGE_DIR);
  const resolved = path.resolve(root, storageKey);
  // Defence in depth against path traversal: a storageKey is only ever
  // produced by buildStorageKey above, but every read/delete re-validates
  // that the resolved path still lives under the storage root.
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Refusing to resolve evidence storage path outside root: ${storageKey}`);
  }
  return resolved;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface EncryptedImageRef {
  storageKey: string;
  ivBase64: string;
  authTagBase64: string;
  keyVersion: string;
  contentHashSha256: string;
  byteSize: number;
}

// Encrypts `plaintext` and writes it to disk under a tenant/date-partitioned
// path. Returns everything the evidence_images row needs to later decrypt it.
export async function writeEvidenceImage(params: {
  tenantId: string;
  id: string;
  occurredAt: Date;
  plaintext: Buffer;
}): Promise<EncryptedImageRef> {
  const { tenantId, id, occurredAt, plaintext } = params;
  const keyVersion = CURRENT_KEY_VERSION;
  const key = deriveTenantKey(tenantId, keyVersion);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const storageKey = buildStorageKey(tenantId, occurredAt, id);
  const filePath = resolveStoragePath(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, ciphertext, { mode: 0o600 });

  return {
    storageKey,
    ivBase64: iv.toString("base64"),
    authTagBase64: authTag.toString("base64"),
    keyVersion,
    contentHashSha256: createHash("sha256").update(plaintext).digest("hex"),
    byteSize: plaintext.length,
  };
}

// Reads and decrypts an evidence image given its stored reference. Throws if
// the file is missing or the auth tag fails to verify (tampered/corrupted
// ciphertext, or wrong key — e.g. a keyVersion mismatch).
export async function readEvidenceImage(params: {
  tenantId: string;
  storageKey: string;
  ivBase64: string;
  authTagBase64: string;
  keyVersion: string;
}): Promise<Buffer> {
  const { tenantId, storageKey, ivBase64, authTagBase64, keyVersion } = params;
  const filePath = resolveStoragePath(storageKey);
  const ciphertext = await readFile(filePath);

  const key = deriveTenantKey(tenantId, keyVersion);
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Deletes the underlying file. Used by crypto-shred / retention enforcement
// paths (not yet wired to a route in this change, but exposed for that
// future caller to use rather than reaching into the filesystem directly).
export async function deleteEvidenceImage(storageKey: string): Promise<void> {
  const filePath = resolveStoragePath(storageKey);
  await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

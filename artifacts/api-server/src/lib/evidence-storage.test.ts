// Unit tests for the evidence image storage module. No database or Redis
// required — this exercises only the filesystem + AES-256-GCM layer, using a
// throwaway EVIDENCE_STORAGE_DIR under the OS temp directory so runs never
// collide with real data or with each other.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "bheka-evidence-test-"));
  process.env.EVIDENCE_STORAGE_DIR = tempDir;
  process.env.EVIDENCE_MASTER_KEY =
    "test-only-evidence-master-key-at-least-32-chars-long";
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// Imported after env vars are set (config.ts reads them at module-load time
// via a top-level Zod parse), so this must be a dynamic import inside a test
// rather than a static top-of-file import.
async function loadStorageModule() {
  return import("./evidence-storage.js");
}

describe("evidence-storage", () => {
  const tenantIdA = "00000000-0000-7000-8000-0000000000a1";
  const tenantIdB = "00000000-0000-7000-8000-0000000000b2";

  it("round-trips plaintext through write then read", async () => {
    const { writeEvidenceImage, readEvidenceImage } = await loadStorageModule();
    const plaintext = Buffer.from("fake jpeg bytes for testing, not a real image");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c1",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    expect(ref.byteSize).toBe(plaintext.length);
    expect(ref.keyVersion).toBe("v1");
    expect(ref.storageKey).toContain(tenantIdA);
    expect(ref.storageKey).toContain("2026/01/15");

    const decrypted = await readEvidenceImage({
      tenantId: tenantIdA,
      storageKey: ref.storageKey,
      ivBase64: ref.ivBase64,
      authTagBase64: ref.authTagBase64,
      keyVersion: ref.keyVersion,
    });

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("stores ciphertext on disk, not plaintext", async () => {
    const { writeEvidenceImage } = await loadStorageModule();
    const plaintext = Buffer.from("this exact string must never appear on disk");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c2",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    const onDisk = await readFile(path.join(tempDir, ref.storageKey));
    expect(onDisk.includes(plaintext)).toBe(false);
    expect(onDisk.equals(plaintext)).toBe(false);
  });

  it("computes contentHashSha256 over the plaintext", async () => {
    const { writeEvidenceImage } = await loadStorageModule();
    const { createHash } = await import("node:crypto");
    const plaintext = Buffer.from("hash me");
    const expectedHash = createHash("sha256").update(plaintext).digest("hex");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c3",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    expect(ref.contentHashSha256).toBe(expectedHash);
  });

  it("derives different keys for different tenants, so cross-tenant decryption fails", async () => {
    const { writeEvidenceImage, readEvidenceImage } = await loadStorageModule();
    const plaintext = Buffer.from("tenant A's private screenshot bytes");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c4",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    // Attempting to decrypt tenant A's ciphertext under tenant B's derived
    // key must fail the GCM auth tag check, not silently return garbage.
    await expect(
      readEvidenceImage({
        tenantId: tenantIdB,
        storageKey: ref.storageKey,
        ivBase64: ref.ivBase64,
        authTagBase64: ref.authTagBase64,
        keyVersion: ref.keyVersion,
      }),
    ).rejects.toThrow();
  });

  it("fails decryption if the auth tag has been tampered with", async () => {
    const { writeEvidenceImage, readEvidenceImage } = await loadStorageModule();
    const plaintext = Buffer.from("integrity-checked bytes");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c5",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    const tamperedAuthTag = Buffer.from(ref.authTagBase64, "base64");
    tamperedAuthTag[0] = tamperedAuthTag[0]! ^ 0xff;

    await expect(
      readEvidenceImage({
        tenantId: tenantIdA,
        storageKey: ref.storageKey,
        ivBase64: ref.ivBase64,
        authTagBase64: tamperedAuthTag.toString("base64"),
        keyVersion: ref.keyVersion,
      }),
    ).rejects.toThrow();
  });

  it("rejects a storageKey that attempts path traversal outside the storage root", async () => {
    const { readEvidenceImage } = await loadStorageModule();

    await expect(
      readEvidenceImage({
        tenantId: tenantIdA,
        storageKey: "../../../etc/passwd",
        ivBase64: Buffer.alloc(12).toString("base64"),
        authTagBase64: Buffer.alloc(16).toString("base64"),
        keyVersion: "v1",
      }),
    ).rejects.toThrow();
  });

  it("deleteEvidenceImage removes the file and is idempotent", async () => {
    const { writeEvidenceImage, deleteEvidenceImage, readEvidenceImage } =
      await loadStorageModule();
    const plaintext = Buffer.from("to be deleted");

    const ref = await writeEvidenceImage({
      tenantId: tenantIdA,
      id: "00000000-0000-7000-8000-0000000000c6",
      occurredAt: new Date("2026-01-15T10:30:00Z"),
      plaintext,
    });

    await deleteEvidenceImage(ref.storageKey);

    await expect(
      readEvidenceImage({
        tenantId: tenantIdA,
        storageKey: ref.storageKey,
        ivBase64: ref.ivBase64,
        authTagBase64: ref.authTagBase64,
        keyVersion: ref.keyVersion,
      }),
    ).rejects.toThrow();

    // Deleting an already-deleted file must not throw (ENOENT is swallowed).
    await expect(deleteEvidenceImage(ref.storageKey)).resolves.toBeUndefined();
  });
});

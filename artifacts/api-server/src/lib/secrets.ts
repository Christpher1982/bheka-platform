// Secret retrieval abstraction.
// Production (Tier A/B tenants): AWS Secrets Manager, referenced by ARN.
// Development: treat the stored value as an environment variable name.
// GUIDE-01 section 3.2: client secrets are stored in Secrets Manager, referenced by ARN.
// Phase 2 replaces the AWS stub with the real SecretsManagerClient call.

import { logger } from "./logger.js";

export async function getSecretValue(arnOrEnvName: string): Promise<string> {
  if (arnOrEnvName.startsWith("arn:aws:secretsmanager:")) {
    return resolveFromSecretsManager(arnOrEnvName);
  }
  const value = process.env[arnOrEnvName];
  if (!value) {
    throw new Error(
      `Secret not found: environment variable "${arnOrEnvName}" is not set. ` +
        `Set this variable or provide an AWS Secrets Manager ARN.`,
    );
  }
  return value;
}

async function resolveFromSecretsManager(arn: string): Promise<string> {
  // AWS Secrets Manager integration is deferred to Phase 2 (Eride Vault setup).
  // Replace this function body with:
  //   const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  //   const client = new SecretsManagerClient({ region: "af-south-1" });
  //   const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  //   return SecretString!;
  logger.error(
    { arn },
    "AWS Secrets Manager is not yet integrated — Phase 2 required",
  );
  throw new Error(
    `AWS Secrets Manager ARN resolution is not available in Phase 1. ` +
      `Store the secret value in an environment variable and reference it by name instead.`,
  );
}

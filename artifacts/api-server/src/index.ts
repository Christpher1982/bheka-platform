import app from "./app.js";
import { logger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import { connectNats, drainNats } from "@workspace/nats-client";

const port = config.PORT;

async function main() {
  // Connect to NATS JetStream when configured. Absence is not an error —
  // publishEvent() silently no-ops until a connection exists.
  if (config.NATS_URL) {
    try {
      await connectNats(config.NATS_URL);
      logger.info({ url: config.NATS_URL }, "NATS JetStream connected");
    } catch (err) {
      // Non-fatal: server still starts but events will be dropped until NATS recovers.
      logger.warn({ err }, "NATS connection failed at startup — events will be dropped");
    }
  } else {
    logger.info("NATS_URL not set — event publishing disabled (no-op mode)");
  }

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Graceful shutdown: drain NATS before closing the HTTP server.
  // SIGTERM is sent by container orchestrators (e.g. Kubernetes) before SIGKILL.
  // SIGINT handles Ctrl-C in local development.
  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutdown signal received — draining…");
    server.close(async () => {
      try {
        await drainNats();
        logger.info("NATS drained");
      } catch (err) {
        logger.warn({ err }, "Error draining NATS");
      }
      logger.info("Server closed");
      process.exit(0);
    });
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

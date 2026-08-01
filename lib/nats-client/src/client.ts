// NATS JetStream publish client for bheka-gateway.
// Design invariants:
//   1. NATS_URL is optional — when absent, publishEvent is a no-op.
//      The server boots and serves HTTP normally without NATS.
//   2. publishEvent never throws — errors are logged and the event is dropped.
//      The HTTP response must never fail because of the event bus.
//   3. drainNats() is called on SIGTERM/SIGINT so in-flight publishes complete
//      before the process exits (010_EVENT_BUS_AND_TOPICS section 3).

import { connect, StringCodec, type NatsConnection, type JetStreamClient } from "nats";
import type { BhekaEvent } from "./types.js";

const sc = StringCodec();

let _nc: NatsConnection | null = null;
let _js: JetStreamClient | null = null;

/**
 * Connect to NATS JetStream. Call once at server startup when NATS_URL is set.
 * Idempotent — subsequent calls are ignored if already connected.
 */
export async function connectNats(url: string): Promise<void> {
  if (_nc) return;
  _nc = await connect({ servers: url });
  _js = _nc.jetstream();
}

/**
 * Drain in-flight publishes and close the connection.
 * Must be called during graceful shutdown before process.exit().
 */
export async function drainNats(): Promise<void> {
  if (!_nc) return;
  const nc = _nc;
  _nc = null;
  _js = null;
  await nc.drain();
}

/**
 * Publish a typed Bheka event to NATS JetStream.
 * Subject = schema_version (e.g. "bheka.case.opened.v1").
 * No-op when NATS is not connected. Never throws.
 */
export async function publishEvent(event: BhekaEvent): Promise<void> {
  if (!_js) return;
  const subject = event.schema_version;
  try {
    await _js.publish(subject, sc.encode(JSON.stringify(event)));
  } catch (err) {
    // Best-effort delivery: log and drop. Do not propagate to the HTTP layer.
    // TODO: route to a dead-letter store once bheka-ingest DLQ is available.
    console.error(
      JSON.stringify({ msg: "NATS publish failed — event dropped", subject, err: String(err) }),
    );
  }
}

/** Returns true when a NATS connection is active. Useful for health checks. */
export function isNatsConnected(): boolean {
  return _nc !== null && !_nc.isClosed();
}

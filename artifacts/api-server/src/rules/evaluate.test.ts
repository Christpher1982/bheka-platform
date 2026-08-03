// Regression tests for the v0 rule engine, added alongside the fix for the
// screenshot_capture HTTP 500 regression introduced in commit 8eb601c.
//
// The actual crash that produced the HTTP 500 in production was NOT in this
// file (sensitiveKeyword already guarded metadata.capturedText / metadata.ocrText
// with `typeof x === "string"` checks before calling string methods on them) —
// it was body-parser's default 100kb express.json() limit in app.ts rejecting
// the (much larger) real screenshot payload with a PayloadTooLargeError that
// the top-level error handler collapsed into a generic 500 instead of a 413.
// See src/app.test.ts for a regression test of that specific failure mode.
//
// These tests exist because rules/evaluate.ts is the MOST LIKELY place a
// similar bug could hide (it is the one code path that reads screenshot-only
// vs keystroke-only fields off the same generic RuleInput), so it is worth
// locking down exactly the behaviour the bug report called out:
//   - a screenshot_capture event whose OCR text contains a sensitive keyword
//     must produce a match (a detection, once wired through agent-events.ts).
//   - a screenshot_capture event whose OCR text has no sensitive keyword must
//     not match, and must not throw.
//   - a screenshot_capture event with ocrText: null (the agent's
//     Tesseract-not-installed case) must not throw and must not match.
//   - keystroke_batch events keep behaving exactly as before (capturedText
//     path unaffected by the additive ocrText change).

import { describe, expect, it } from "vitest";
import { evaluateEvent } from "./evaluate.js";
import type { ActivityEventMetadata } from "@workspace/db";

function input(eventType: string, metadata: ActivityEventMetadata) {
  return {
    eventType,
    // Fixed to a known in-hours instant (10:00 Africa/Johannesburg) so
    // off_hours_activity never fires and masks the sensitive_keyword result
    // we're asserting on.
    occurredAt: new Date("2026-08-03T08:00:00Z"),
    metadata,
  };
}

describe("evaluateEvent — screenshot_capture", () => {
  it("matches sensitive_keyword when ocrText contains a sensitive keyword", () => {
    const match = evaluateEvent(
      input("screenshot_capture", {
        ocrText:
          "Login page open. Please enter your password to continue signing in.",
        screenshotImageBase64: "ZmFrZS1qcGVnLWJ5dGVz",
        screenshotWidth: 1280,
        screenshotHeight: 720,
      }),
    );

    expect(match).not.toBeNull();
    expect(match?.ruleName).toBe("sensitive_keyword");
    expect(match?.summary).toContain("password");
    expect(match?.summary).toContain("Screenshot OCR text");
  });

  it("does not match and does not throw when ocrText has no sensitive keyword", () => {
    const match = evaluateEvent(
      input("screenshot_capture", {
        ocrText: "Quarterly sales chart showing steady growth across regions.",
        screenshotImageBase64: "ZmFrZS1qcGVnLWJ5dGVz",
      }),
    );

    expect(match).toBeNull();
  });

  it("does not throw when ocrText is null (Tesseract not installed on the agent)", () => {
    expect(() =>
      evaluateEvent(
        input("screenshot_capture", {
          ocrText: null,
          screenshotImageBase64: "ZmFrZS1qcGVnLWJ5dGVz",
          screenshotWidth: 1280,
          screenshotHeight: 720,
        }),
      ),
    ).not.toThrow();

    const match = evaluateEvent(
      input("screenshot_capture", {
        ocrText: null,
        screenshotImageBase64: "ZmFrZS1qcGVnLWJ5dGVz",
      }),
    );
    expect(match).toBeNull();
  });

  it("does not throw when ocrText is entirely absent from metadata", () => {
    expect(() =>
      evaluateEvent(
        input("screenshot_capture", {
          screenshotImageBase64: "ZmFrZS1qcGVnLWJ5dGVz",
        }),
      ),
    ).not.toThrow();
  });
});

describe("evaluateEvent — app_usage_session (new eventType, no rule matches it yet)", () => {
  // app_usage_session is a visibility/context event (active application /
  // website usage tracking) — it carries no captured text, no OCR text, and
  // no keystroke count, so none of the v0 rules (sensitive_keyword,
  // off_hours_activity during working hours, high_volume_keystrokes) should
  // fire on it. This locks down the "no crash, no false match" contract the
  // same way the screenshot regression tests above do for null/absent
  // fields.
  it("does not throw and does not match any rule for a well-formed app_usage_session event", () => {
    expect(() =>
      evaluateEvent(
        input("app_usage_session", {
          processName: "chrome.exe",
          windowTitle: "Bheka Console - Activity",
          isBrowser: true,
          startedAt: "2026-08-03T07:59:18Z",
          endedAt: "2026-08-03T08:00:00Z",
          durationSeconds: 42,
        }),
      ),
    ).not.toThrow();

    const match = evaluateEvent(
      input("app_usage_session", {
        processName: "chrome.exe",
        windowTitle: "Bheka Console - Activity",
        isBrowser: true,
        startedAt: "2026-08-03T07:59:18Z",
        endedAt: "2026-08-03T08:00:00Z",
        durationSeconds: 42,
      }),
    );
    expect(match).toBeNull();
  });

  it("does not throw when app_usage_session fields are entirely absent from metadata", () => {
    expect(() => evaluateEvent(input("app_usage_session", {}))).not.toThrow();
    expect(evaluateEvent(input("app_usage_session", {}))).toBeNull();
  });
});

describe("evaluateEvent — keystroke_batch (unaffected by the screenshot change)", () => {
  it("still matches sensitive_keyword via capturedText", () => {
    const match = evaluateEvent(
      input("keystroke_batch", {
        keystrokeCount: 12,
        capturedText: "my new password is Summer2026!",
      }),
    );

    expect(match).not.toBeNull();
    expect(match?.ruleName).toBe("sensitive_keyword");
    expect(match?.summary).toContain("Captured text");
  });

  it("does not match when capturedText has no sensitive keyword", () => {
    const match = evaluateEvent(
      input("keystroke_batch", {
        keystrokeCount: 12,
        capturedText: "just typing a normal sentence here",
      }),
    );

    expect(match).toBeNull();
  });
});

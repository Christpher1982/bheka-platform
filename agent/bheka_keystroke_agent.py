#!/usr/bin/env python3
"""
Bheka Keystroke Capture Agent (proof-of-concept)
==================================================

IMPORTANT — CONSENT & AUTHORIZATION
------------------------------------
This is a proof-of-concept endpoint agent for testing Bheka's own detection
pipeline end-to-end (capture -> ingest -> rule engine -> Detections page).

Only run this on a machine you own or are explicitly authorized to monitor.
It captures every keystroke typed while it is running and sends batches of
that text to the Bheka API server. Do not install this on a device belonging
to someone else, or without their informed consent.

WHAT IT DOES
------------
- Hooks keyboard input using `pynput` (works without admin rights on Windows
  in normal cases).
- Buffers captured text + a keystroke counter, and best-effort captures the
  active window title via `pygetwindow`.
- Every ~10 seconds, OR whenever 50 keystrokes have been buffered (whichever
  happens first), POSTs one batch to the Bheka ingest endpoint:

    POST {BHEKA_API_URL}/api/v1/agent/events
    Header: X-Agent-Token: {AGENT_TOKEN}
    Body: {
      "tenantSlug": "...",
      "siteId": "...",
      "subjectUserId": "...",
      "sourceAgentId": "...",
      "eventType": "keystroke_batch",
      "occurredAt": "2026-08-01T20:30:00Z",
      "metadata": {
        "keystrokeCount": 37,
        "activeWindowTitle": "Gmail - Compose",
        "capturedText": "hello this is a test..."
      }
    }

  The server runs a v0 rule engine synchronously on each event (sensitive
  keyword match, off-hours activity, high keystroke volume) and may create a
  Detection, visible on the Bheka console's Detections page.

REQUIRED ENVIRONMENT VARIABLES
-------------------------------
  BHEKA_API_URL     e.g. http://192.168.1.50:8080
                    (Use the LAN IP of the machine running the API server —
                     "localhost" will NOT work if this agent runs on a
                     different PC than the API server.)
  AGENT_TOKEN       The shared secret matching AGENT_INGEST_TOKEN set on the
                    API server.
  SITE_ID           The seeded site UUID (e.g. the "Head Office" site under
                    tenant eride-technologies).
  SUBJECT_USER_ID   The user UUID this activity is attributed to (e.g. the
                    seeded admin user admin@eride-technologies.test).

OPTIONAL ENVIRONMENT VARIABLES
-------------------------------
  TENANT_SLUG       Defaults to "eride-technologies".
  SOURCE_AGENT_ID   A stable id for this agent install. If unset, a random
                    UUID is generated once at startup.

SETUP
-----
  pip install -r requirements.txt

RUN (Windows, cmd.exe)
-----------------------
  set BHEKA_API_URL=http://192.168.1.50:8080
  set AGENT_TOKEN=your-shared-secret
  set SITE_ID=<site-uuid>
  set SUBJECT_USER_ID=<user-uuid>
  python bheka_keystroke_agent.py

RUN (PowerShell)
-----------------
  $env:BHEKA_API_URL="http://192.168.1.50:8080"
  $env:AGENT_TOKEN="your-shared-secret"
  $env:SITE_ID="<site-uuid>"
  $env:SUBJECT_USER_ID="<user-uuid>"
  python bheka_keystroke_agent.py

RUN (bash / WSL)
-----------------
  export BHEKA_API_URL="http://192.168.1.50:8080"
  export AGENT_TOKEN="your-shared-secret"
  export SITE_ID="<site-uuid>"
  export SUBJECT_USER_ID="<user-uuid>"
  python3 bheka_keystroke_agent.py

WHAT YOU'LL SEE
----------------
On start:
  Bheka keystroke agent started. Reporting to http://192.168.1.50:8080 every
  ~10s or 50 keystrokes. Tenant=eride-technologies Site=<id> Subject=<id>

On each send:
  [12:04:31] Sent 37 keystrokes (window: 'Gmail - Compose') -> HTTP 201.
  Detection created: True (id=abcd-1234). Preview: "hello this is a test..."

On error:
  [12:04:41] ERROR sending batch: ConnectionError(...). If BHEKA_API_URL
  points to localhost but you're running this on a different PC than the
  API server, use the API server machine's LAN IP address instead.

Stop with Ctrl+C — any remaining buffered text is flushed and sent before exit.
"""

import os
import sys
import time
import uuid
import threading
import datetime as dt

try:
    import requests
except ImportError:
    print("Missing dependency 'requests'. Run: pip install -r requirements.txt")
    sys.exit(1)

try:
    from pynput import keyboard
except ImportError:
    print("Missing dependency 'pynput'. Run: pip install -r requirements.txt")
    sys.exit(1)

try:
    import pygetwindow as gw
except ImportError:
    gw = None  # Optional — we degrade gracefully without it.


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BHEKA_API_URL = os.environ.get("BHEKA_API_URL", "").rstrip("/")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
SITE_ID = os.environ.get("SITE_ID", "")
SUBJECT_USER_ID = os.environ.get("SUBJECT_USER_ID", "")
TENANT_SLUG = os.environ.get("TENANT_SLUG", "eride-technologies")
SOURCE_AGENT_ID = os.environ.get("SOURCE_AGENT_ID", str(uuid.uuid4()))

FLUSH_INTERVAL_SECONDS = 10
FLUSH_KEYSTROKE_THRESHOLD = 50

INGEST_PATH = "/api/v1/agent/events"


def _validate_config():
    missing = []
    if not BHEKA_API_URL:
        missing.append("BHEKA_API_URL")
    if not AGENT_TOKEN:
        missing.append("AGENT_TOKEN")
    if not SITE_ID:
        missing.append("SITE_ID")
    if not SUBJECT_USER_ID:
        missing.append("SUBJECT_USER_ID")
    if missing:
        print("ERROR: missing required environment variable(s): " + ", ".join(missing))
        print("See the top of this script (or README.md) for setup instructions.")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_buffer_chars = []
_keystroke_count = 0
_stop_event = threading.Event()


SPECIAL_KEY_TOKENS = {
    "Key.enter": "[ENTER]",
    "Key.tab": "[TAB]",
    "Key.space": " ",
    "Key.backspace": "[BACKSPACE]",
    "Key.esc": "[ESC]",
    "Key.shift": "",
    "Key.shift_r": "",
    "Key.ctrl_l": "",
    "Key.ctrl_r": "",
    "Key.alt_l": "",
    "Key.alt_r": "",
    "Key.caps_lock": "",
    "Key.cmd": "",
}


def _key_to_text(key):
    """Convert a pynput key event into a readable text fragment."""
    try:
        # Regular character keys have a .char attribute.
        if hasattr(key, "char") and key.char is not None:
            return key.char
    except Exception:
        pass
    token = SPECIAL_KEY_TOKENS.get(str(key))
    if token is not None:
        return token
    # Any other special key (F-keys, arrows, etc.) — represent generically.
    name = str(key).replace("Key.", "").upper()
    return f"[{name}]"


def _get_active_window_title():
    if gw is None:
        return "unknown"
    try:
        win = gw.getActiveWindow()
        if win and win.title:
            return win.title
        return "unknown"
    except Exception:
        return "unknown"


def _now_iso_utc():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _send_batch(text, count, window_title):
    url = f"{BHEKA_API_URL}{INGEST_PATH}"
    headers = {
        "Content-Type": "application/json",
        "X-Agent-Token": AGENT_TOKEN,
    }
    body = {
        "tenantSlug": TENANT_SLUG,
        "siteId": SITE_ID,
        "subjectUserId": SUBJECT_USER_ID,
        "sourceAgentId": SOURCE_AGENT_ID,
        "eventType": "keystroke_batch",
        "occurredAt": _now_iso_utc(),
        "metadata": {
            "keystrokeCount": count,
            "activeWindowTitle": window_title,
            "capturedText": text,
        },
    }
    ts = time.strftime("%H:%M:%S")
    preview = text[:60] + ("..." if len(text) > 60 else "")
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=10)
        detection_created = None
        detection_id = None
        try:
            data = resp.json()
            detection_created = data.get("detectionCreated")
            detection_id = data.get("detectionId")
        except Exception:
            pass
        print(
            f"[{ts}] Sent {count} keystrokes (window: '{window_title}') "
            f"-> HTTP {resp.status_code}. Detection created: {detection_created}"
            + (f" (id={detection_id})" if detection_id else "")
            + f'. Preview: "{preview}"'
        )
    except requests.exceptions.RequestException as exc:
        print(f"[{ts}] ERROR sending batch: {exc}")
        print(
            "If BHEKA_API_URL points to localhost but you're running this on a "
            "different PC than the API server, use the API server machine's "
            "LAN IP address instead."
        )


def _flush(force_label=None):
    global _buffer_chars, _keystroke_count
    with _lock:
        if not _buffer_chars:
            return
        text = "".join(_buffer_chars)
        count = _keystroke_count
        _buffer_chars = []
        _keystroke_count = 0
    window_title = _get_active_window_title()
    _send_batch(text, count, window_title)


def _flush_timer_loop():
    while not _stop_event.is_set():
        _stop_event.wait(FLUSH_INTERVAL_SECONDS)
        if _stop_event.is_set():
            break
        _flush()


def _on_press(key):
    global _keystroke_count
    fragment = _key_to_text(key)
    should_flush = False
    with _lock:
        if fragment:
            _buffer_chars.append(fragment)
        _keystroke_count += 1
        if _keystroke_count >= FLUSH_KEYSTROKE_THRESHOLD:
            should_flush = True
    if should_flush:
        _flush()


def main():
    _validate_config()

    print(
        f"Bheka keystroke agent started. Reporting to {BHEKA_API_URL} every "
        f"~{FLUSH_INTERVAL_SECONDS}s or {FLUSH_KEYSTROKE_THRESHOLD} keystrokes. "
        f"Tenant={TENANT_SLUG} Site={SITE_ID} Subject={SUBJECT_USER_ID} "
        f"AgentId={SOURCE_AGENT_ID}"
    )
    print("Press Ctrl+C to stop.")

    timer_thread = threading.Thread(target=_flush_timer_loop, daemon=True)
    timer_thread.start()

    listener = keyboard.Listener(on_press=_on_press)
    listener.start()

    try:
        while listener.is_alive():
            listener.join(timeout=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        _stop_event.set()
        listener.stop()
        print("Stopping agent, flushing final buffer...")
        _flush()
        print("Stopped.")


if __name__ == "__main__":
    main()

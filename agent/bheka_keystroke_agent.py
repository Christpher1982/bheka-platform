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

- Runs a SECOND, independent loop on its own thread that periodically takes a
  full-screen screenshot (every `SCREENSHOT_INTERVAL_SECONDS`, default 60),
  runs 100% local OCR on it via `pytesseract` (no cloud OCR API — screenshot
  bytes and OCR text never leave the machine except to the tenant's own Bheka
  API server), downscales + JPEG-compresses the image, and POSTs it as a
  separate ingest event:

    POST {BHEKA_API_URL}/api/v1/agent/events
    Header: X-Agent-Token: {AGENT_TOKEN}
    Body: {
      "tenantSlug": "...",
      "siteId": "...",
      "subjectUserId": "...",
      "sourceAgentId": "...",
      "eventType": "screenshot_capture",
      "occurredAt": "2026-08-01T20:31:00Z",
      "metadata": {
        "ocrText": "text recognized in the screenshot, or null",
        "activeWindowTitle": "Gmail - Compose",
        "screenshotImageBase64": "<base64 JPEG bytes>",
        "screenshotWidth": 1280,
        "screenshotHeight": 800
      }
    }

  The server runs a v0 rule engine synchronously on each event (sensitive
  keyword match — checked against both keystroke text and screenshot OCR
  text, off-hours activity, high keystroke volume) and may create a
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
  TENANT_SLUG                  Defaults to "eride-technologies".
  SOURCE_AGENT_ID              A stable id for this agent install. If unset,
                                a random UUID is generated once at startup.
  SCREENSHOT_INTERVAL_SECONDS  How often the screenshot+OCR loop captures and
                                sends a screenshot. Defaults to 60.

SETUP
-----
  pip install -r requirements.txt

  Screenshot OCR is 100% local via Tesseract (through the `pytesseract`
  Python binding) — no cloud OCR API is ever called, so screenshot images
  and OCR text never leave the tenant's own infrastructure via a third
  party. `pip install` only installs the `pytesseract` Python wrapper; the
  Tesseract OCR *binary* itself is a separate, non-pip install:
    Windows: https://github.com/UB-Mannheim/tesseract/wiki
  If the binary isn't found, this agent still runs and still sends
  screenshots — it just sends them with ocrText: null and prints a one-line
  warning once.

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

  [12:05:00] Sent screenshot (window: 'Gmail - Compose') -> HTTP 201. OCR
  chars: 412. Detection created: False.

On error:
  [12:04:41] ERROR sending batch: ConnectionError(...). If BHEKA_API_URL
  points to localhost but you're running this on a different PC than the
  API server, use the API server machine's LAN IP address instead.

Stop with Ctrl+C — any remaining buffered text is flushed, the screenshot
loop is stopped, and both are sent/joined before exit.
"""

import base64
import io
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

# Screenshot capture + local OCR. Both are optional at import time so a
# missing dependency degrades the screenshot loop instead of crashing the
# whole agent (the keystroke loop must keep working either way).
try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import mss
except ImportError:
    mss = None

try:
    import pytesseract
except ImportError:
    pytesseract = None


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

SCREENSHOT_INTERVAL_SECONDS = int(os.environ.get("SCREENSHOT_INTERVAL_SECONDS", "60"))
SCREENSHOT_MAX_WIDTH = 1280
SCREENSHOT_JPEG_QUALITY = 55

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

# Screenshot/OCR loop state. Separate lock is unnecessary since these are
# only touched from the single screenshot thread, but the "warned once" flag
# is a simple module-level bool guarded implicitly by that same thread.
_tesseract_warned = False


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


# ---------------------------------------------------------------------------
# Screenshot capture + local OCR (runs on its own thread; must never block or
# be blocked by the keystroke capture loop above).
# ---------------------------------------------------------------------------


def _capture_screenshot_raw():
    """Capture the full screen and return a PIL Image, or None if no capture
    backend is available. Prefers `mss` (fast, cross-platform, no extra native
    deps beyond the wheel); falls back to `PIL.ImageGrab` (Windows/macOS
    only) if `mss` is not installed."""
    if Image is None:
        return None

    if mss is not None:
        with mss.mss() as sct:
            # Monitor 0 is "all monitors combined"; grab the primary monitor
            # (index 1) if available, else fall back to the combined virtual
            # screen.
            monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            shot = sct.grab(monitor)
            return Image.frombytes("RGB", shot.size, shot.rgb)

    try:
        from PIL import ImageGrab

        return ImageGrab.grab().convert("RGB")
    except Exception:
        return None


def _run_ocr(image):
    """Run local Tesseract OCR on a full-resolution PIL Image. Returns the
    recognized text, or None if Tesseract/pytesseract is unavailable or OCR
    fails for any reason. Never raises — the screenshot must still be sent
    even when OCR is broken or not installed.

    OCR is 100% local: pytesseract shells out to the Tesseract binary on this
    machine. No image or text is ever sent to a third-party OCR API.
    """
    global _tesseract_warned
    if pytesseract is None:
        if not _tesseract_warned:
            print(
                "WARNING: pytesseract is not installed — screenshots will be "
                "sent without OCR text. Run: pip install -r requirements.txt"
            )
            _tesseract_warned = True
        return None
    try:
        return pytesseract.image_to_string(image)
    except Exception as exc:
        if not _tesseract_warned:
            print(
                "WARNING: Tesseract not found — screenshots will be sent "
                "without OCR text; install from "
                "https://github.com/UB-Mannheim/tesseract/wiki "
                f"({exc})"
            )
            _tesseract_warned = True
        return None


def _downscale_and_encode(image):
    """Downscale to a max width of SCREENSHOT_MAX_WIDTH (preserving aspect
    ratio), compress as JPEG at SCREENSHOT_JPEG_QUALITY, and return
    (base64_str, width, height) of the ENCODED (downscaled) image."""
    width, height = image.size
    if width > SCREENSHOT_MAX_WIDTH:
        new_width = SCREENSHOT_MAX_WIDTH
        new_height = round(height * (SCREENSHOT_MAX_WIDTH / width))
        image = image.resize((new_width, new_height))
        width, height = new_width, new_height

    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=SCREENSHOT_JPEG_QUALITY)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return encoded, width, height


def _send_screenshot(ocr_text, window_title, image_b64, width, height):
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
        "eventType": "screenshot_capture",
        "occurredAt": _now_iso_utc(),
        "metadata": {
            "ocrText": ocr_text,
            "activeWindowTitle": window_title,
            "screenshotImageBase64": image_b64,
            "screenshotWidth": width,
            "screenshotHeight": height,
        },
    }
    ts = time.strftime("%H:%M:%S")
    ocr_chars = len(ocr_text) if ocr_text else 0
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=15)
        detection_created = None
        detection_id = None
        try:
            data = resp.json()
            detection_created = data.get("detectionCreated")
            detection_id = data.get("detectionId")
        except Exception:
            pass
        print(
            f"[{ts}] Sent screenshot (window: '{window_title}') "
            f"-> HTTP {resp.status_code}. OCR chars: {ocr_chars}. "
            f"Detection created: {detection_created}"
            + (f" (id={detection_id})" if detection_id else "")
            + "."
        )
    except requests.exceptions.RequestException as exc:
        print(f"[{ts}] ERROR sending screenshot: {exc}")
        print(
            "If BHEKA_API_URL points to localhost but you're running this on a "
            "different PC than the API server, use the API server machine's "
            "LAN IP address instead."
        )


def _capture_and_send_screenshot():
    if Image is None:
        # Pillow itself is missing — nothing this loop can do; the caller
        # already prints a startup warning in this case.
        return
    raw_image = _capture_screenshot_raw()
    if raw_image is None:
        ts = time.strftime("%H:%M:%S")
        print(f"[{ts}] WARNING: screenshot capture failed (no backend available).")
        return

    # OCR runs on the pre-downscale, full-resolution image for best accuracy;
    # downscaling happens afterwards, only for the copy we transmit.
    ocr_text = _run_ocr(raw_image)
    image_b64, width, height = _downscale_and_encode(raw_image)
    window_title = _get_active_window_title()
    _send_screenshot(ocr_text, window_title, image_b64, width, height)


def _screenshot_timer_loop():
    while not _stop_event.is_set():
        _stop_event.wait(SCREENSHOT_INTERVAL_SECONDS)
        if _stop_event.is_set():
            break
        try:
            _capture_and_send_screenshot()
        except Exception as exc:
            # This loop must never take the process down — the keystroke
            # loop has to keep running regardless of screenshot/OCR errors.
            ts = time.strftime("%H:%M:%S")
            print(f"[{ts}] ERROR in screenshot loop: {exc}")


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
    print(
        f"Screenshot + local OCR loop enabled: capturing every "
        f"~{SCREENSHOT_INTERVAL_SECONDS}s (SCREENSHOT_INTERVAL_SECONDS)."
    )
    if Image is None:
        print(
            "WARNING: Pillow is not installed — the screenshot loop is "
            "disabled. Run: pip install -r requirements.txt"
        )
    elif mss is None:
        print(
            "NOTE: 'mss' is not installed — falling back to PIL.ImageGrab "
            "for screenshot capture."
        )
    print("Press Ctrl+C to stop.")

    timer_thread = threading.Thread(target=_flush_timer_loop, daemon=True)
    timer_thread.start()

    # Screenshot capture runs on its own thread so a slow OCR pass or a
    # large upload can never delay keystroke batch delivery.
    screenshot_thread = threading.Thread(target=_screenshot_timer_loop, daemon=True)
    screenshot_thread.start()

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
        screenshot_thread.join(timeout=2)
        print("Stopped.")


if __name__ == "__main__":
    main()

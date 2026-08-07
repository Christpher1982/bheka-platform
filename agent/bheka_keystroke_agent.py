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

- Runs a THIRD, independent loop on its own thread that tracks active
  application / website usage — separate from the keystroke agent, with much
  lower overhead, and intended to run always-on. Every
  `APP_USAGE_POLL_SECONDS` (default 5) it polls the current foreground
  window's title and owning process name. It keeps an in-memory "current
  session" for as long as the (processName, windowTitle) pair stays the
  same; the instant that pair changes (user switches window/app), the
  previous session is closed out (duration = now - session start) and a new
  session begins. Sessions shorter than `APP_USAGE_MIN_SESSION_SECONDS`
  (default 2) are discarded as noise (e.g. a quick alt-tab). Each closed
  session is POSTed immediately as its own ingest event:

    POST {BHEKA_API_URL}/api/v1/agent/events
    Header: X-Agent-Token: {AGENT_TOKEN}
    Body: {
      "tenantSlug": "...",
      "siteId": "...",
      "subjectUserId": "...",
      "sourceAgentId": "...",
      "eventType": "app_usage_session",
      "occurredAt": "2026-08-01T20:32:00Z",
      "metadata": {
        "processName": "chrome.exe",
        "windowTitle": "Bheka Console - Activity",
        "isBrowser": true,
        "startedAt": "2026-08-01T20:31:18Z",
        "endedAt": "2026-08-01T20:32:00Z",
        "durationSeconds": 42
      }
    }

  This is a best-effort "website usage" signal via window title (which often
  contains the page title, and sometimes the site name, for browsers) — it
  does NOT extract real URLs. True per-URL tracking would require a browser
  extension and is explicitly out of scope here. No rule currently matches
  this event type; it exists purely as a visibility/context feature in the
  raw Activity feed, same as a plain keystroke batch with no sensitive
  content.

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
  APP_USAGE_POLL_SECONDS       How often the app/website usage loop polls the
                                foreground window. Defaults to 5.
  APP_USAGE_MIN_SESSION_SECONDS  Sessions shorter than this are discarded as
                                noise (e.g. a quick alt-tab). Defaults to 2.

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

  [12:05:42] Sent app usage session (process: 'chrome.exe', window: 'Gmail -
  Compose', duration: 42s) -> HTTP 201.

On error:
  [12:04:41] ERROR sending batch: ConnectionError(...). If BHEKA_API_URL
  points to localhost but you're running this on a different PC than the
  API server, use the API server machine's LAN IP address instead.

Stop with Ctrl+C — any remaining buffered text is flushed, the screenshot
loop is stopped, the app-usage loop flushes whatever session is currently
open (if it meets the minimum duration), and all three are sent/joined
before exit.
"""

import base64
import io
import os
import sys
import time
import uuid
import threading
import datetime as dt

# ---------------------------------------------------------------------------
# Force UTF-8 encoding on stdout/stderr so that captured keystrokes or window
# titles containing characters outside the legacy Windows ANSI codepage
# (e.g. zero-width space U+200B, smart quotes, emoji, non-Latin scripts) do
# not crash print() calls when stdout/stderr are redirected to a file — which
# is exactly what happens when the agent runs as a headless Scheduled Task via
# the run_agent.ps1 wrapper (stdout falls back to cp1252 in that case).
# errors='replace' substitutes un-encodable characters with U+FFFD rather
# than raising UnicodeEncodeError.
# reconfigure() was added in Python 3.7; the hasattr guard is belt-and-
# suspenders for any unusual embedded runtime that might lack it.
# ---------------------------------------------------------------------------
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass  # Non-fatal: if reconfigure fails, we continue with whatever encoding is active.

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

# App/website usage loop: resolving the *process name* that owns the
# foreground window needs more than pygetwindow alone exposes, so on Windows
# we pair `psutil` (PID -> process name) with a small ctypes call into
# user32/kernel32 (foreground window handle -> owning PID). Both are optional
# at import time — a missing dependency disables just this third loop instead
# of crashing the whole agent.
try:
    import psutil
except ImportError:
    psutil = None

try:
    import ctypes
    from ctypes import wintypes
except ImportError:  # pragma: no cover - ctypes is stdlib; defensive only.
    ctypes = None
    wintypes = None

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

# App/website usage loop. Polling is cheap (a couple of Win32/psutil calls),
# so a short default interval is fine — much lower overhead than the
# keystroke or screenshot loops, which is the point of this third loop.
APP_USAGE_POLL_SECONDS = int(os.environ.get("APP_USAGE_POLL_SECONDS", "5"))
APP_USAGE_MIN_SESSION_SECONDS = int(
    os.environ.get("APP_USAGE_MIN_SESSION_SECONDS", "2")
)

# Best-effort "is this a browser" signal, by owning process name. This is NOT
# real per-URL website tracking (that needs a browser extension, out of scope
# here) — it just flags sessions where the window title is likely to be a
# page title so the console can label them distinctly.
BROWSER_PROCESS_NAMES = {
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "iexplore.exe",
}

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

# App/website usage loop state. Only ever touched from the single app-usage
# thread (plus a final flush from the main thread during shutdown, after that
# thread has already been signalled to stop), so no separate lock is needed.
_app_usage_session = None  # dict with processName/windowTitle/startedAt, or None
_app_usage_warned = False


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
        try:
            _flush()
        except Exception as exc:
            # This loop must NEVER die from an exception in one flush cycle
            # (e.g. a UnicodeEncodeError from print(), a transient network
            # hiccup that wasn't caught below, etc.) — catching here ensures
            # the loop continues and the next interval's flush still runs.
            ts = time.strftime("%H:%M:%S")
            try:
                print(f"[{ts}] ERROR in keystroke flush loop: {exc}")
            except Exception:
                pass  # If even the error print fails, swallow silently.


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


# ---------------------------------------------------------------------------
# Active application / website usage tracking (runs on its own thread; must
# never block or be blocked by the keystroke or screenshot loops above).
#
# This is intentionally the lowest-overhead of the three loops: it does not
# capture any content (no keystrokes, no screenshots, no OCR) — just the
# foreground window's title and owning process name on a short timer — which
# is what makes it suitable to run always-on.
# ---------------------------------------------------------------------------


def _get_foreground_pid():
    """Return the PID owning the current foreground window on Windows, or
    None if unavailable (e.g. not running on Windows, or no foreground
    window). Uses ctypes to call user32.GetForegroundWindow +
    user32.GetWindowThreadProcessId directly, since pygetwindow does not
    expose the owning process."""
    if ctypes is None or wintypes is None:
        return None
    try:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    except AttributeError:
        # Not running on Windows (ctypes.windll only exists there).
        return None
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value or None
    except Exception:
        return None


def _get_foreground_process_name():
    """Return the owning process's executable name (e.g. 'chrome.exe'), or
    'unknown' if it cannot be determined (missing psutil, non-Windows
    sandbox, permission error, or the process has already exited)."""
    global _app_usage_warned
    if psutil is None:
        if not _app_usage_warned:
            print(
                "WARNING: psutil is not installed — app usage sessions will "
                "report processName as 'unknown'. Run: pip install -r "
                "requirements.txt"
            )
            _app_usage_warned = True
        return "unknown"
    pid = _get_foreground_pid()
    if not pid:
        return "unknown"
    try:
        return psutil.Process(pid).name() or "unknown"
    except Exception:
        return "unknown"


def _send_app_usage_session(process_name, window_title, is_browser, started_at, ended_at):
    duration_seconds = max(0, round((ended_at - started_at).total_seconds()))
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
        "eventType": "app_usage_session",
        "occurredAt": _now_iso_utc(),
        "metadata": {
            "processName": process_name,
            "windowTitle": window_title,
            "isBrowser": is_browser,
            "startedAt": started_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endedAt": ended_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "durationSeconds": duration_seconds,
        },
    }
    ts = time.strftime("%H:%M:%S")
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=10)
        print(
            f"[{ts}] Sent app usage session (process: '{process_name}', "
            f"window: '{window_title}', duration: {duration_seconds}s) "
            f"-> HTTP {resp.status_code}."
        )
    except requests.exceptions.RequestException as exc:
        print(f"[{ts}] ERROR sending app usage session: {exc}")
        print(
            "If BHEKA_API_URL points to localhost but you're running this on a "
            "different PC than the API server, use the API server machine's "
            "LAN IP address instead."
        )


def _close_app_usage_session(session, ended_at):
    """Close out a session dict and send it, unless it is shorter than
    APP_USAGE_MIN_SESSION_SECONDS (treated as noise, e.g. a quick alt-tab)."""
    duration_seconds = (ended_at - session["startedAt"]).total_seconds()
    if duration_seconds < APP_USAGE_MIN_SESSION_SECONDS:
        return
    _send_app_usage_session(
        session["processName"],
        session["windowTitle"],
        session["isBrowser"],
        session["startedAt"],
        ended_at,
    )


def _poll_app_usage_once():
    """Poll the current foreground (process, window) pair once and update the
    in-memory session: closes/sends the previous session when the pair has
    changed, and (re)starts a session for the current pair."""
    global _app_usage_session
    process_name = _get_foreground_process_name()
    window_title = _get_active_window_title()
    now = dt.datetime.now(dt.timezone.utc)

    current = _app_usage_session
    if (
        current is not None
        and current["processName"] == process_name
        and current["windowTitle"] == window_title
    ):
        # Same (process, window) pair as last poll — session continues.
        return

    if current is not None:
        _close_app_usage_session(current, now)

    _app_usage_session = {
        "processName": process_name,
        "windowTitle": window_title,
        "isBrowser": process_name.lower() in BROWSER_PROCESS_NAMES,
        "startedAt": now,
    }


def _app_usage_timer_loop():
    while not _stop_event.is_set():
        try:
            _poll_app_usage_once()
        except Exception as exc:
            # This loop must never take the process down — the keystroke and
            # screenshot loops have to keep running regardless of app-usage
            # polling errors.
            ts = time.strftime("%H:%M:%S")
            print(f"[{ts}] ERROR in app usage loop: {exc}")
        _stop_event.wait(APP_USAGE_POLL_SECONDS)


def _flush_app_usage_session_on_shutdown():
    """Send whatever session is currently open (if it meets the minimum
    duration) so the last session isn't silently dropped on Ctrl+C."""
    global _app_usage_session
    session = _app_usage_session
    _app_usage_session = None
    if session is None:
        return
    _close_app_usage_session(session, dt.datetime.now(dt.timezone.utc))


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
    print(
        f"App/website usage loop enabled: polling the foreground window "
        f"every ~{APP_USAGE_POLL_SECONDS}s (APP_USAGE_POLL_SECONDS), "
        f"discarding sessions under {APP_USAGE_MIN_SESSION_SECONDS}s "
        f"(APP_USAGE_MIN_SESSION_SECONDS)."
    )
    if psutil is None:
        print(
            "NOTE: 'psutil' is not installed — app usage sessions will "
            "report processName as 'unknown'. Run: pip install -r "
            "requirements.txt"
        )
    print("Press Ctrl+C to stop.")

    timer_thread = threading.Thread(target=_flush_timer_loop, daemon=True)
    timer_thread.start()

    # Screenshot capture runs on its own thread so a slow OCR pass or a
    # large upload can never delay keystroke batch delivery.
    screenshot_thread = threading.Thread(target=_screenshot_timer_loop, daemon=True)
    screenshot_thread.start()

    # App/website usage tracking also runs on its own thread — independent of
    # (and much lower overhead than) both loops above, so it can stay
    # always-on without adding meaningful load.
    app_usage_thread = threading.Thread(target=_app_usage_timer_loop, daemon=True)
    app_usage_thread.start()

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
        app_usage_thread.join(timeout=2)
        _flush_app_usage_session_on_shutdown()
        print("Stopped.")


if __name__ == "__main__":
    main()

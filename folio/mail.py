"""Details shared by the desktop windows when an invoice is emailed."""

import os
import re
import sys
import time
import uuid
from pathlib import Path


def pdf_name(number):
    cleaned = re.sub(r'[\\/:*?"<>|]+', "-", str(number or "").strip())
    return f"{cleaned or 'invoice'}.pdf"


def valid_address(value):
    if not isinstance(value, str):
        return False
    if not value or len(value) > 254 or value.startswith("-"):
        return False
    if any(char.isspace() or ord(char) < 32 for char in value):
        return False
    local, sep, domain = value.partition("@")
    return bool(sep and local and domain and "@" not in domain)


def email_fields(message):
    if not isinstance(message, dict):
        return None
    to = str(message.get("to") or "").strip()
    subject = " ".join(str(message.get("subject") or "").split())
    body = str(message.get("body") or "").replace("\r\n", "\n").replace("\r", "\n")
    if not valid_address(to) or not subject:
        return None
    return to, subject, body or " ", message.get("number")


def mail_cache():
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Local"
        folder = root / "Folio" / "mail"
    else:
        base = os.environ.get("XDG_CACHE_HOME")
        root = Path(base) if base else Path.home() / ".cache"
        folder = root / "folio"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def mail_pdf_path(number):
    folder = mail_cache()
    cutoff = time.time() - 7 * 24 * 60 * 60
    for path in folder.glob("*.pdf"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass
    stem = Path(pdf_name(number)).stem
    return folder / f"{stem}-{uuid.uuid4().hex[:8]}.pdf"

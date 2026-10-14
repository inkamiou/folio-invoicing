"""Details shared by the desktop windows when an invoice is emailed."""

import os
import re
import shutil
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


def downloads_folder():
    if sys.platform == "win32":
        folder = Path.home() / "Downloads"
    else:
        folder = xdg_user_dir("XDG_DOWNLOAD_DIR", Path.home() / "Downloads")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def xdg_user_dir(key, fallback):
    config_home = os.environ.get("XDG_CONFIG_HOME")
    config = Path(config_home) if config_home else Path.home() / ".config"
    try:
        lines = (config / "user-dirs.dirs").read_text(encoding="utf-8").splitlines()
    except OSError:
        return fallback
    for line in lines:
        text = line.strip()
        if not text.startswith(f"{key}="):
            continue
        value = text.split("=", 1)[1].strip().strip('"').strip("'")
        value = value.replace("$HOME", str(Path.home()))
        return Path(os.path.expanduser(os.path.expandvars(value)))
    return fallback


def save_download(source, number):
    source = Path(source)
    destination = downloads_folder() / pdf_name(number)
    if source.resolve() != destination.resolve():
        shutil.copyfile(source, destination)
    return destination


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

"""Windows window. The screen is the same page; Edge's web view shows it."""

import json
import mimetypes
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from folio.db import load_desk, save_desk

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"


def index_page():
    desk = json.dumps(load_desk()).replace("<", "\\u003c")
    html = INDEX.read_text(encoding="utf-8")
    script = f"<script>window.__FOLIO_DESK__ = {desk}; window.__FOLIO_WIN__ = true;</script>"
    return html.replace("<head>", "<head>" + script, 1).encode("utf-8")


def project_file(url_path):
    relative = Path(unquote(url_path).lstrip("/"))
    if relative.is_absolute() or ".." in relative.parts:
        return None
    candidate = (ROOT / relative).resolve()
    root = ROOT.resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


class PageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            try:
                body = index_page()
            except Exception as exc:
                print(f"Folio could not open the database: {exc}", file=sys.stderr)
                self._send(500, "text/plain; charset=utf-8", b"Folio could not open the database.")
                return
            self._send(200, "text/html; charset=utf-8", body)
            return
        file = project_file(path)
        if file is None:
            self._send(404, "text/plain; charset=utf-8", b"Not found")
            return
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        self._send(200, mime, file.read_bytes())

    def _send(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class FolioApi:
    def save(self, desk):
        if isinstance(desk, str):
            try:
                desk = json.loads(desk)
            except json.JSONDecodeError:
                print("Folio ignored an unreadable save from the window", file=sys.stderr)
                return
        try:
            save_desk(desk)
        except Exception as exc:
            print(f"Folio could not save the desk: {exc}", file=sys.stderr)

    def export(self, desk):
        import webview

        if isinstance(desk, str):
            try:
                desk = json.loads(desk)
            except json.JSONDecodeError:
                return "Folio could not read this backup."
        if not isinstance(desk, dict):
            return "Folio could not read this backup."
        window = webview.active_window()
        kind = webview.FileDialog.SAVE if hasattr(webview, "FileDialog") else webview.SAVE_DIALOG
        selection = window.create_file_dialog(
            kind,
            save_filename="folio-backup.json",
            file_types=("JSON (*.json)",),
        )
        if not selection:
            return ""
        path = Path(selection if isinstance(selection, str) else selection[0])
        try:
            path.write_text(json.dumps(desk, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        except OSError as exc:
            return f"Folio could not save the backup. {exc}"
        return ""

    def openMail(self, url):
        if not isinstance(url, str) or not url.lower().startswith("mailto:"):
            return
        try:
            os.startfile(url)
        except OSError as exc:
            print(f"Folio could not open the mail client: {exc}", file=sys.stderr)


def main():
    try:
        import webview
    except ImportError:
        print("Folio on Windows needs pywebview. Install it with: python -m pip install pywebview", file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer(("127.0.0.1", 0), PageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        webview.create_window("Folio", f"http://127.0.0.1:{port}/", js_api=FolioApi(), width=1180, height=800)
        webview.start(gui="edgechromium")
    finally:
        server.shutdown()

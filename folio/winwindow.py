"""Windows window. The screen is the same page; Edge's web view shows it."""

import ctypes
import json
import mimetypes
import os
import subprocess
import sys
import threading
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlencode, urlparse

from folio.db import load_desk, save_desk
from folio.mail import downloads_folder, email_fields, mail_pdf_path, save_download

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


def copy_download_path(path):
    try:
        subprocess.run(["clip"], input=str(path), text=True, check=False, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return


def show_download(path):
    try:
        target = Path(path).resolve()
    except (OSError, TypeError):
        return False
    if not target.is_file():
        return False
    try:
        root = downloads_folder().resolve()
    except OSError:
        return False
    if not target.is_relative_to(root):
        return False
    try:
        subprocess.Popen(["explorer", f"/select,{target}"], stdin=subprocess.DEVNULL)
    except OSError:
        return False
    return True


def open_mailto(to, subject, body):
    try:
        os.startfile(f"mailto:{quote(to)}?{urlencode({'subject': subject, 'body': body}, quote_via=quote)}")
    except OSError as exc:
        print(f"Folio could not open the mail client: {exc}", file=sys.stderr)


def find_edge():
    roots = [
        os.environ.get("PROGRAMFILES(X86)", ""),
        os.environ.get("PROGRAMFILES", ""),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    for root in roots:
        if not root:
            continue
        candidate = Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
        if candidate.is_file():
            return candidate
    return None


def render_windows_pdf(sheet, number):
    if not isinstance(sheet, str) or "<article" not in sheet:
        return None
    edge = find_edge()
    if edge is None:
        return None
    try:
        css = (ROOT / "css" / "styles.css").read_text(encoding="utf-8").replace("</style", "<\\/style")
        document = (
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<style>{css}</style></head><body>{sheet}</body></html>"
        )
        pdf = mail_pdf_path(number)
        html_path = pdf.with_suffix(".html")
        html_path.write_text(document, encoding="utf-8")
        subprocess.run(
            [
                str(edge),
                "--headless",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}",
                html_path.resolve().as_uri(),
            ],
            check=False,
            timeout=45,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if pdf.is_file() and pdf.stat().st_size > 0:
        return pdf
    return None


def mapi_send(to, subject, body, attachment):
    try:
        mapi = ctypes.WinDLL("mapi32")
    except OSError:
        return 2
    wide = hasattr(mapi, "MAPISendMailW")
    text = ctypes.c_wchar_p if wide else ctypes.c_char_p

    def native(value):
        return value if wide else value.encode("mbcs", errors="replace")

    class Recip(ctypes.Structure):
        _fields_ = [
            ("ulReserved", wintypes.ULONG),
            ("ulRecipClass", wintypes.ULONG),
            ("lpszName", text),
            ("lpszAddress", text),
            ("ulEIDSize", wintypes.ULONG),
            ("lpEntryID", ctypes.c_void_p),
        ]

    class FileDesc(ctypes.Structure):
        _fields_ = [
            ("ulReserved", wintypes.ULONG),
            ("flFlags", wintypes.ULONG),
            ("nPosition", wintypes.ULONG),
            ("lpszPathName", text),
            ("lpszFileName", text),
            ("lpFileType", ctypes.c_void_p),
        ]

    class Message(ctypes.Structure):
        _fields_ = [
            ("ulReserved", wintypes.ULONG),
            ("lpszSubject", text),
            ("lpszNoteText", text),
            ("lpszMessageType", text),
            ("lpszDateReceived", text),
            ("lpszConversationID", text),
            ("flFlags", wintypes.ULONG),
            ("lpOriginator", ctypes.c_void_p),
            ("nRecipCount", wintypes.ULONG),
            ("lpRecips", ctypes.POINTER(Recip)),
            ("nFileCount", wintypes.ULONG),
            ("lpFiles", ctypes.POINTER(FileDesc)),
        ]

    recip = Recip(0, 1, native(to), native(f"SMTP:{to}"), 0, None)
    file_desc = FileDesc(0, 0, 0xFFFFFFFF, native(str(attachment)), native(attachment.name), None)
    mail = Message(
        0,
        native(subject),
        native(body),
        None,
        None,
        None,
        0,
        None,
        1,
        ctypes.pointer(recip),
        1,
        ctypes.pointer(file_desc),
    )
    send = mapi.MAPISendMailW if wide else mapi.MAPISendMail
    send.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(Message), wintypes.ULONG, wintypes.ULONG]
    send.restype = wintypes.ULONG
    return int(send(None, 0, ctypes.pointer(mail), 0x8 | 0x1, 0))


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

    def emailInvoice(self, message):
        if isinstance(message, str):
            try:
                message = json.loads(message)
            except json.JSONDecodeError:
                return "error:Folio could not read the email."
        fields = email_fields(message)
        if fields is None:
            return "error:Folio could not read the email."
        to, subject, body, number = fields
        sheet = message.get("html") if isinstance(message, dict) else ""
        pdf = render_windows_pdf(sheet, number)
        if pdf is None:
            open_mailto(to, subject, body)
            return "opened:Folio opened the message without the PDF."
        try:
            pdf = save_download(pdf, number)
        except OSError as exc:
            print(f"Folio could not save the invoice in Downloads: {exc}", file=sys.stderr)
        result = mapi_send(to, subject, body, pdf)
        if result == 0:
            return ""
        if result == 1:
            return "error:The email was cancelled."
        open_mailto(to, subject, body)
        copy_download_path(pdf)
        if show_download(pdf):
            return f"opened:The invoice PDF is in Downloads: {pdf}. That folder is open, and the path is copied."
        return f"opened:The invoice PDF is in Downloads: {pdf}. The path is copied."

    def revealInvoice(self, path):
        if show_download(path):
            return ""
        return "error:Folio could not open the invoice folder."


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

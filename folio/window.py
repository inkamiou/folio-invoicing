"""Desktop window that shows the invoicing screen and writes to the database."""

import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2

from folio.db import load_desk, save_desk
from folio.mail import email_fields, mail_pdf_path, pdf_name

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
ICON = ROOT / "assets" / "folio_logo.svg"


def launcher_text():
    return f"""[Desktop Entry]
Type=Application
Version=1.0
Name=Folio
GenericName=Invoicing
Comment=Write invoices and keep them on this computer
Exec=/usr/bin/python3 -m folio
Path={ROOT}
Icon={ICON}
Terminal=false
Categories=Office;Finance;
StartupWMClass=folio
"""


def install_launcher():
    destination = Path.home() / ".local" / "share" / "applications" / "folio.desktop"
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(launcher_text(), encoding="utf-8")
    except OSError as exc:
        print(f"Folio could not install the application menu entry: {exc}", file=sys.stderr)


def on_script_message(_manager, result, webview):
    try:
        message = json.loads(result.get_js_value().to_json(0))
    except Exception:
        print("Folio ignored an unreadable message from the window", file=sys.stderr)
        return
    if not isinstance(message, dict):
        return
    if message.get("type") == "save":
        try:
            save_desk(message.get("desk"))
        except Exception as exc:
            print(f"Folio could not save the desk: {exc}", file=sys.stderr)
        return
    if message.get("type") == "export":
        GLib.idle_add(export_backup, webview, message.get("desk"))
        return
    if message.get("type") == "print":
        GLib.idle_add(print_invoice, webview, message.get("number"))
        return
    if message.get("type") == "mailto":
        GLib.idle_add(open_mailto, webview, message.get("url"))
        return
    if message.get("type") == "email":
        GLib.idle_add(email_invoice, webview, message)


def export_backup(webview, desk):
    if not isinstance(desk, dict):
        return False
    window = webview.get_toplevel()
    dialog = Gtk.FileChooserDialog(
        title="Export backup",
        transient_for=window if isinstance(window, Gtk.Window) else None,
        action=Gtk.FileChooserAction.SAVE,
    )
    dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
    dialog.add_button("Save", Gtk.ResponseType.ACCEPT)
    dialog.set_default_response(Gtk.ResponseType.ACCEPT)
    dialog.set_current_name("folio-backup.json")
    dialog.set_do_overwrite_confirmation(True)
    response = dialog.run()
    path = dialog.get_filename() if response == Gtk.ResponseType.ACCEPT else None
    dialog.destroy()
    if not path:
        return False
    try:
        Path(path).write_text(json.dumps(desk, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError as exc:
        report = Gtk.MessageDialog(
            transient_for=window if isinstance(window, Gtk.Window) else None,
            buttons=Gtk.ButtonsType.OK,
            message_type=Gtk.MessageType.ERROR,
            text="Folio could not save the backup.",
        )
        report.format_secondary_text(str(exc))
        report.run()
        report.destroy()
    return False


def print_invoice(webview, number):
    window = webview.get_toplevel()
    parent = window if isinstance(window, Gtk.Window) else None
    dialog = Gtk.FileChooserDialog(
        title="Save invoice",
        transient_for=parent,
        action=Gtk.FileChooserAction.SELECT_FOLDER,
    )
    dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
    dialog.add_button("Save", Gtk.ResponseType.ACCEPT)
    dialog.set_default_response(Gtk.ResponseType.ACCEPT)
    response = dialog.run()
    folder = dialog.get_filename() if response == Gtk.ResponseType.ACCEPT else None
    dialog.destroy()
    if not folder:
        return False
    destination = Path(folder) / pdf_name(number)
    if destination.exists() and not confirm_replace(parent, destination.name):
        return False
    settings = Gtk.PrintSettings()
    settings.set_printer("Print to File")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, destination.resolve().as_uri())
    operation = WebKit2.PrintOperation.new(webview)
    page = Gtk.PageSetup()
    page.set_paper_size(Gtk.PaperSize.new(Gtk.PAPER_NAME_A4))
    page.set_top_margin(0, Gtk.Unit.MM)
    page.set_bottom_margin(0, Gtk.Unit.MM)
    page.set_left_margin(0, Gtk.Unit.MM)
    page.set_right_margin(0, Gtk.Unit.MM)
    operation.set_page_setup(page)
    operation.set_print_settings(settings)

    def on_failed(_operation, error):
        report_error(parent, "Folio could not save the invoice.", str(error))

    operation.connect("failed", on_failed)
    operation.print_()
    return False


_mail_jobs = []
_mail_generation = 0


def email_invoice(webview, message):
    global _mail_generation
    fields = email_fields(message)
    window = webview.get_toplevel() if webview is not None else None
    parent = window if isinstance(window, Gtk.Window) else None
    if fields is None:
        clear_mail_sheet(webview)
        report_error(parent, "Folio could not open the mail client.", "The message was missing an email address.")
        return False
    to, subject, body, number = fields
    _mail_generation += 1
    generation = _mail_generation
    destination = mail_pdf_path(number)

    def finished(ok, detail):
        def complete():
            if generation != _mail_generation:
                return False
            clear_mail_sheet(webview)
            if not ok:
                report_error(parent, "Folio could not attach the invoice.", detail or "The PDF was not created.")
                return False
            launch_composed_mail(parent, to, subject, body, destination)
            return False

        GLib.idle_add(complete)

    GLib.timeout_add(150, lambda: write_invoice_pdf(webview, destination, finished) or False)
    return False


def write_invoice_pdf(webview, destination, done):
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        done(False, str(exc))
        return False
    settings = Gtk.PrintSettings()
    settings.set_printer("Print to File")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf")
    settings.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, destination.resolve().as_uri())
    operation = WebKit2.PrintOperation.new(webview)
    _mail_jobs.append(operation)
    page = Gtk.PageSetup()
    page.set_paper_size(Gtk.PaperSize.new(Gtk.PAPER_NAME_A4))
    page.set_top_margin(0, Gtk.Unit.MM)
    page.set_bottom_margin(0, Gtk.Unit.MM)
    page.set_left_margin(0, Gtk.Unit.MM)
    page.set_right_margin(0, Gtk.Unit.MM)
    operation.set_page_setup(page)
    operation.set_print_settings(settings)
    state = {"done": False}

    def finish(ok, detail):
        if state["done"]:
            return
        state["done"] = True
        if operation in _mail_jobs:
            _mail_jobs.remove(operation)
        ready = ok and destination.is_file() and destination.stat().st_size > 0
        done(ready, None if ready else detail or "The PDF was not created.")

    operation.connect("finished", lambda *_args: finish(True, None))
    operation.connect("failed", lambda _operation, error: finish(False, str(error)))
    try:
        operation.print_()
    except GLib.Error as exc:
        finish(False, str(exc))
    return False


def clear_mail_sheet(webview):
    if webview is None:
        return
    webview.run_javascript("clearMailSheet()", None, _ignore_js, None)


def _ignore_js(webview, result, _data):
    try:
        webview.run_javascript_finish(result)
    except Exception:
        return


def launch_composed_mail(parent, to, subject, body, attachment):
    handler = mailto_desktop()
    if "evolution" in handler:
        try:
            launched = Gio.AppInfo.launch_default_for_uri(evolution_mailto(to, subject, body, attachment), None)
        except GLib.Error as exc:
            report_error(parent, "Folio could not open the mail client.", str(exc))
            return
        if not launched:
            report_error(parent, "Folio could not open the mail client.", "No mail application is available for this link.")
        return
    if mail_handler_is_browser(handler):
        explain_browser_attachment(parent, attachment)
        command = ["xdg-email", "--utf8", "--subject", subject, "--body", body, to]
    else:
        command = ["xdg-email", "--utf8", "--attach", str(attachment), "--subject", subject, "--body", body, to]
    try:
        subprocess.Popen(command, start_new_session=True, stdin=subprocess.DEVNULL)
    except OSError as exc:
        report_error(
            parent,
            "Folio could not open the mail client.",
            f"{exc}\nThe invoice PDF is saved at {attachment}",
        )


def mailto_desktop():
    try:
        completed = subprocess.run(
            ["xdg-mime", "query", "default", "x-scheme-handler/mailto"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return completed.stdout.strip().lower()


def mail_handler_is_browser(handler):
    names = ("firefox", "chrome", "chromium", "brave", "vivaldi", "epiphany", "waterfox", "librewolf", "opera", "edge")
    return any(name in handler for name in names)


def evolution_mailto(to, subject, body, attachment):
    file_uri = quote(attachment.resolve().as_uri(), safe=":/")
    query = "&".join(
        (
            f"subject={quote(subject)}",
            f"body={quote(body)}",
            f"attach={file_uri}",
        )
    )
    return f"mailto:{quote(to)}?{query}"


def explain_browser_attachment(parent, attachment):
    clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    clipboard.set_text(str(attachment), -1)
    report_notice(
        parent,
        "Attach the invoice PDF to the message.",
        f"This mail program cannot take the file automatically. The path is copied:\n{attachment}",
    )


def confirm_replace(parent, name):
    dialog = Gtk.MessageDialog(
        transient_for=parent,
        buttons=Gtk.ButtonsType.OK_CANCEL,
        message_type=Gtk.MessageType.QUESTION,
        text=f"Replace {name}?",
    )
    response = dialog.run()
    dialog.destroy()
    return response == Gtk.ResponseType.OK


def report_error(parent, text, detail):
    report_notice(parent, text, detail, Gtk.MessageType.ERROR)


def report_notice(parent, text, detail, kind=Gtk.MessageType.INFO):
    report = Gtk.MessageDialog(
        transient_for=parent,
        buttons=Gtk.ButtonsType.OK,
        message_type=kind,
        text=text,
    )
    report.format_secondary_text(detail)
    report.run()
    report.destroy()


_last_mailto = {"uri": "", "when": 0.0}


def open_mailto(webview, uri):
    if not isinstance(uri, str) or not uri.lower().startswith("mailto:"):
        return False
    now = time.monotonic()
    if uri == _last_mailto["uri"] and now - _last_mailto["when"] < 1.5:
        return False
    _last_mailto["uri"] = uri
    _last_mailto["when"] = now
    window = webview.get_toplevel() if webview is not None else None
    parent = window if isinstance(window, Gtk.Window) else None
    try:
        launched = Gio.AppInfo.launch_default_for_uri(uri, None)
    except GLib.Error as exc:
        report_error(parent, "Folio could not open the mail client.", str(exc))
        return False
    if not launched:
        report_error(parent, "Folio could not open the mail client.", "No mail application is available for this link.")
    return False


def on_load_failed(webview, _event, uri, error):
    target = str(uri or "")
    blocked = target.lower().startswith("mailto:") or getattr(error, "code", None) == 101
    if not blocked:
        return False
    if target.lower().startswith("mailto:"):
        GLib.idle_add(open_mailto, webview, target)
    return True


def on_create(webview, action):
    try:
        uri = action.get_request().get_uri() or ""
    except Exception:
        return None
    if str(uri).lower().startswith("mailto:"):
        GLib.idle_add(open_mailto, webview, uri)
    return None


def on_decide_policy(webview, decision, decision_type):
    if decision_type not in (
        WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
        WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
    ):
        return False
    action = decision.get_navigation_action()
    uri = action.get_request().get_uri() if action is not None else ""
    if not str(uri or "").lower().startswith("mailto:"):
        return False
    decision.ignore()
    GLib.idle_add(open_mailto, webview, uri)
    return True


def build_webview():
    manager = WebKit2.UserContentManager()
    manager.register_script_message_handler("folio")
    script = WebKit2.UserScript.new(
        "window.__FOLIO_DESK__ = " + json.dumps(load_desk()) + ";",
        WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserScriptInjectionTime.START,
        None,
        None,
    )
    manager.add_script(script)
    webview = WebKit2.WebView.new_with_user_content_manager(manager)
    webview.connect("decide-policy", on_decide_policy)
    webview.connect("load-failed", on_load_failed)
    webview.connect("create", on_create)
    manager.connect("script-message-received::folio", on_script_message, webview)
    settings = webview.get_settings()
    settings.set_allow_file_access_from_file_urls(True)
    settings.set_enable_write_console_messages_to_stdout(True)
    webview.load_uri(INDEX.resolve().as_uri())
    return webview


class FolioApplication(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="com.folio.desk", flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

    def do_startup(self):
        Gtk.Application.do_startup(self)
        install_launcher()

    def do_activate(self):
        window = self.get_active_window()
        if window is None:
            window = Gtk.ApplicationWindow(application=self, title="Folio")
            window.set_default_size(1180, 800)
            if ICON.exists():
                window.set_icon_from_file(str(ICON))
            window.add(build_webview())
            window.show_all()
        window.present()


def main():
    GLib.set_prgname("folio")
    app = FolioApplication()
    sys.exit(app.run(sys.argv))

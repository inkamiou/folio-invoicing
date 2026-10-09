"""Desktop window that shows the invoicing screen and writes to the database."""

import json
import re
import sys
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gio, GLib, Gtk, WebKit2

from folio.db import load_desk, save_desk

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
ICON = ROOT / "assets" / "folio.png"


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


def pdf_name(number):
    cleaned = re.sub(r'[\\/:*?"<>|]+', "-", str(number or "").strip())
    return f"{cleaned or 'invoice'}.pdf"


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
    report = Gtk.MessageDialog(
        transient_for=parent,
        buttons=Gtk.ButtonsType.OK,
        message_type=Gtk.MessageType.ERROR,
        text=text,
    )
    report.format_secondary_text(detail)
    report.run()
    report.destroy()


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

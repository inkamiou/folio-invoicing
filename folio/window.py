"""Desktop window that shows the invoicing screen and writes to the database."""

import json
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

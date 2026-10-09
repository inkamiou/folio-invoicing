# Folio

A small invoicing desk. It keeps invoices, clients, and your business details on this computer.

## Preconditions

**Linux**

- Python 3
- GTK 3 and WebKitGTK 4.1, with their Python bindings (PyGObject)

On Debian or Ubuntu those are `python3`, `python3-gi`, `gir1.2-gtk-3.0`, and `gir1.2-webkit2-4.1`.

**Windows**

- Windows 10 or 11
- Python 3, with pip
- The Edge web view, which current Windows 10 and 11 already include
- The `pywebview` package, installed with the command below

**Browser**

- A current browser
- No Python install and no server

## Linux

Open Folio from the application menu, or from this folder:

```bash
python3 -m folio
```

Invoices are stored in `~/.local/share/folio/folio.db`. Restarting the computer leaves that file in place.

## Windows

From this folder:

```bash
python -m pip install pywebview
python -m folio
```

Windows opens Folio in the Edge web view. Invoices are stored in `%LOCALAPPDATA%\Folio\folio.db`. This does not add a Start menu entry. Run the command each time you want to open Folio.

## Browser

Open `index.html` in a browser, from this folder.

The browser copy is saved in that browser only. Clearing the browser's site data removes it. The sidebar notes this. Use Export backup on the Business screen if you want a file you can import into the Folio window later.

## What it does

- Write invoices with line items, tax, and due dates
- Keep a client list and your business details
- Mark invoices draft, sent, or paid
- Print an invoice, or save it as PDF from the print dialog
- Export and import a JSON backup from the Business screen
# Folio

A lightweight, local-first desktop and browser invoicing application designed for personal use and small-scale freelancers. Folio keeps your invoices, clients, and business details completely private and secure.

---

## Features

- **Invoice Management:** Create invoices with custom line items, taxes, discounts, and due dates.
- **Status Tracking:** Easily toggle invoice states (Draft, Sent, Paid).
- **Client & Business Profiles:** Maintain a clean directory of your clients and save your own business details.
- **PDF Export:** Print invoices or save them directly as PDFs using your system's native print dialog.
- **Data Portability:** Full JSON backup export and import functionality from the Business screen.
- **Strict Numbering:** Sequential, gapless invoice numbering (`MAX + 1`) with manual override options.

---

## Installation & Running
**Linux Preconditions**

- Python 3
- GTK 3 and WebKitGTK 4.1, with their Python bindings (PyGObject)

On Debian or Ubuntu those are `python3`, `python3-gi`, `gir1.2-gtk-3.0`, and `gir1.2-webkit2-4.1`.

**Windows Preconditions**

- Windows 10 or 11
- Python 3, with pip
- The Edge web view, which current Windows 10 and 11 already include
- The `pywebview` package, installed with the command below

**Browser**

- A current browser
- No Python install and no server

## Linux

Open Folio from the application menu, or from project's folder:

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

The browser copy is saved in that browser only. Clearing the browser's site data removes the application's data. Use Export backup on the Business screen if you want a file you can import later into the Folio desktop.
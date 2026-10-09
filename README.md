# Folio

A small invoicing desk that runs as its own window. Invoices, clients, and your business details are stored in a SQLite database on this computer.

## Run

Open Folio from the application menu, or from this folder:

```bash
python3 -m folio
```

The database file is `~/.local/share/folio/folio.db`. Restarting the computer leaves it in place. Clearing browser data does not remove it.

## Windows

Install Python 3, then from this folder:

```bash
python -m pip install pywebview
python -m folio
```

Windows opens Folio in the Edge web view that comes with Windows 10 and 11. Invoices are stored in `%LOCALAPPDATA%\Folio\folio.db`.

## What it does

- Write invoices with line items, tax, and due dates
- Keep a client list and your business details
- Mark invoices draft, sent, or paid
- Print an invoice, or save it as PDF from the print dialog
- Export and import a JSON backup from the Business screen

# Folio

Folio is a local invoicing desk for a freelancer or a small practice. It keeps clients, businesses, and invoices on the computer that runs it. There is a Linux app, a Windows app, and a browser copy of the same screen.

Invoice data is not uploaded. The desktop apps write a SQLite file. The browser copy uses that browser’s storage. The screen loads its typefaces from Google Fonts when the computer is online, and falls back to local fonts when it is not.

## What you can do

- Keep more than one business, each with its own logo, tax details, bank accounts, currency, and invoice series.
- Keep a client list with name, email, address, registration number, and tax ID.
- Write a sales invoice or an expense reimbursement, with line items, quantities, rates, discounts, and tax.
- Give each business a number template. `{nr}` is the sequence. With no template, numbers look like `INV-2026-001`.
- Track draft, sent, paid, and cancelled invoices. A sent invoice past its due date shows as overdue.
- See outstanding invoices, and how much was paid in the current year.
- Filter the list by status, business, issue dates, or a search across number and client.
- Open the default mail client with a short message and the invoice PDF attached. The client needs an email address. A draft is marked sent when that message is handed to the mail program. Folio does not send the message itself. A web browser set as the mail program cannot take the file. Folio still opens the message, saves the PDF in Downloads, and copies that path so you can find it and attach it. The browser copy of Folio fills in the message and does not attach the PDF.
- Save a PDF. On Linux, choose a folder and Folio writes `<invoice-number>.pdf`. On Windows and in the browser, use the print dialog.
- Export the whole desk as JSON from the Business screen, and import a backup later. Import replaces the invoices, clients, and businesses on that copy of Folio.

## Requirements

Python 3.9 or newer for the desktop apps. The browser copy needs no Python.

**Linux:** Python 3, GTK 3, WebKitGTK 4.1, and PyGObject. On Debian or Ubuntu:

```bash
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

**Windows:** Windows 10 or 11, Python 3 with pip, and the Edge WebView2 runtime that current Windows 10 and 11 already include.

**Browser:** a current browser.

## Run

Clone the repository and work from that folder. Folio is not installed as a package. The desktop command expects the `folio` folder to be the current directory.

```bash
git clone https://github.com/inkamiou/folio-invoicing.git
cd folio-invoicing
```

### Linux

```bash
python3 -m folio
```

The first launch adds a Folio entry to the application menu. That entry points at this clone, so moving or deleting the folder removes the menu item until you run the command again from the new location.

### Windows

```bash
python -m pip install -r requirements-windows.txt
python -m folio
```

Windows opens the same page in the Edge web view. It does not add a Start menu entry. Run the command when you want to open Folio.

### Browser

Open `index.html` in a browser.

That copy is saved in the browser only, under the local storage key `folio.invoices.v1`. Clearing site data for the page removes it. Export a backup from the Business screen before you do that if you want to import the desk into the desktop app later.

## Where the data lives

| App | Location |
| --- | --- |
| Linux | `~/.local/share/folio/folio.db`, or `$XDG_DATA_HOME/folio/folio.db` when that variable is set |
| Windows | `%LOCALAPPDATA%\Folio\folio.db` |
| Browser | local storage in the browser that opened `index.html` |

Set `FOLIO_DB` to a full file path when you want the desktop database somewhere else. Folio creates the parent folder if it can.

Restarting the computer leaves the database file in place. Uninstalling Python or the system libraries does not delete it.

## Project layout

```
index.html          the screen
css/styles.css      layout and the invoice sheet
js/                 invoices, clients, business details, and the preview
folio/window.py     Linux window (GTK and WebKitGTK) and the menu entry
folio/winwindow.py  Windows window (Edge, through pywebview)
folio/db.py         the SQLite file
assets/             the logo
```

The page talks to the desktop window only to save, export a backup, write a PDF, and open a mail link. Opened on its own, it does those jobs in the browser instead.

## License

[MIT](LICENSE)

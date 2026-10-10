"""SQLite ledger for invoices, clients, and business details."""

import json
import os
import re
import sqlite3
import sys
import uuid
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS business (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  registration_number TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EUR',
  extra_currencies TEXT NOT NULL DEFAULT '[]',
  tax_rate REAL NOT NULL DEFAULT 0,
  invoice_template TEXT NOT NULL DEFAULT '',
  number_length INTEGER NOT NULL DEFAULT 3,
  date_format TEXT NOT NULL DEFAULT 'iso'
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  registration_number TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EUR',
  extra_currencies TEXT NOT NULL DEFAULT '[]',
  tax_rate REAL NOT NULL DEFAULT 0,
  invoice_template TEXT NOT NULL DEFAULT '',
  number_length INTEGER NOT NULL DEFAULT 3,
  date_format TEXT NOT NULL DEFAULT 'iso',
  next_number INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  registration_number TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  tax_rate REAL NOT NULL DEFAULT 0,
  issued INTEGER NOT NULL DEFAULT 0,
  date_format TEXT NOT NULL DEFAULT 'iso',
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL,
  rate REAL,
  discount REAL,
  tax REAL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  bic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def data_folder():
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else Path.home() / "AppData" / "Local"
        return root / "Folio"
    base = os.environ.get("XDG_DATA_HOME")
    root = Path(base) if base else Path.home() / ".local" / "share"
    return root / "folio"


def database_path():
    override = os.environ.get("FOLIO_DB")
    if override:
        path = Path(override)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
    folder = data_folder()
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "folio.db"


def connect():
    connection = sqlite3.connect(database_path())
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def ensure_columns(connection):
    additions = (
        ("business", "registration_number", "TEXT NOT NULL DEFAULT ''"),
        ("business", "logo", "TEXT NOT NULL DEFAULT ''"),
        ("business", "extra_currencies", "TEXT NOT NULL DEFAULT '[]'"),
        ("business", "invoice_template", "TEXT NOT NULL DEFAULT ''"),
        ("business", "number_length", "INTEGER NOT NULL DEFAULT 3"),
        ("business", "date_format", "TEXT NOT NULL DEFAULT 'iso'"),
        ("invoices", "date_format", "TEXT NOT NULL DEFAULT 'iso'"),
        ("clients", "registration_number", "TEXT NOT NULL DEFAULT ''"),
        ("clients", "tax_id", "TEXT NOT NULL DEFAULT ''"),
        ("invoices", "issued", "INTEGER NOT NULL DEFAULT 0"),
        ("invoices", "business_id", "TEXT NOT NULL DEFAULT ''"),
        ("bank_accounts", "business_id", "TEXT NOT NULL DEFAULT ''"),
        ("invoice_items", "tax", "REAL"),
    )
    for table, column, definition in additions:
        names = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if column not in names:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    connection.execute("UPDATE invoices SET issued = 1 WHERE status != 'draft' AND issued = 0")


def ensure_item_shape(connection):
    columns = {row["name"]: row for row in connection.execute("PRAGMA table_info(invoice_items)")}
    if not columns:
        return
    ready = (
        "code" in columns
        and "unit" in columns
        and "discount" in columns
        and "tax" in columns
        and not columns["qty"]["notnull"]
        and not columns["rate"]["notnull"]
    )
    if ready:
        return
    connection.execute("ALTER TABLE invoice_items RENAME TO invoice_items_old")
    connection.execute(
        """
        CREATE TABLE invoice_items (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          code TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT '',
          qty REAL,
          rate REAL,
          discount REAL,
          tax REAL,
          position INTEGER NOT NULL
        )
        """
    )
    code = "code" if "code" in columns else "''"
    unit = "unit" if "unit" in columns else "''"
    discount = "discount" if "discount" in columns else "NULL"
    tax = "tax" if "tax" in columns else "NULL"
    connection.execute(
        f"""
        INSERT INTO invoice_items (
          id, invoice_id, code, description, unit, qty, rate, discount, tax, position
        )
        SELECT id, invoice_id, {code}, description, {unit}, qty, rate, {discount}, {tax}, position
        FROM invoice_items_old
        """
    )
    connection.execute("DROP TABLE invoice_items_old")


def fold_vat_into_tax_id(connection):
    business_columns = {row["name"] for row in connection.execute("PRAGMA table_info(business)")}
    if "vat_code" in business_columns and "tax_id" in business_columns:
        connection.execute(
            """
            UPDATE business
            SET tax_id = vat_code
            WHERE TRIM(tax_id) = '' AND TRIM(COALESCE(vat_code, '')) != ''
            """
        )
    client_columns = {row["name"] for row in connection.execute("PRAGMA table_info(clients)")}
    if "vat_code" in client_columns and "tax_id" in client_columns:
        connection.execute(
            """
            UPDATE clients
            SET tax_id = vat_code
            WHERE TRIM(COALESCE(tax_id, '')) = '' AND TRIM(COALESCE(vat_code, '')) != ''
            """
        )


def migrate_businesses(connection):
    if connection.execute("SELECT COUNT(*) AS n FROM businesses").fetchone()["n"]:
        return
    row = connection.execute("SELECT * FROM business WHERE id = 1").fetchone()
    if row is None:
        return
    accounts = connection.execute("SELECT COUNT(*) AS n FROM bank_accounts").fetchone()["n"]
    meaningful = accounts or any(str(row[key] or "").strip() for key in ("name", "email", "phone", "address", "tax_id", "registration_number", "logo"))
    if not meaningful:
        return
    meta = connection.execute("SELECT value FROM meta WHERE key = 'legacyBusinessId'").fetchone()
    business_id = meta["value"] if meta else str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO meta (key, value) VALUES ('legacyBusinessId', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (business_id,),
    )
    next_row = connection.execute("SELECT value FROM meta WHERE key = 'nextNumber'").fetchone()
    try:
        next_number = int(next_row["value"]) if next_row else 1
    except (TypeError, ValueError):
        next_number = 1
    connection.execute(
        """
        INSERT INTO businesses (
          id, name, email, phone, address, tax_id, registration_number, logo, currency, extra_currencies,
          tax_rate, invoice_template, number_length, date_format, next_number, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (
            business_id,
            row["name"],
            row["email"],
            row["phone"],
            row["address"],
            row["tax_id"],
            row["registration_number"],
            row["logo"],
            row["currency"],
            row["extra_currencies"],
            row["tax_rate"],
            row["invoice_template"],
            row["number_length"],
            row["date_format"],
            next_number,
        ),
    )
    connection.execute(
        "UPDATE bank_accounts SET business_id = ? WHERE TRIM(COALESCE(business_id, '')) = ''",
        (business_id,),
    )
    connection.execute(
        "UPDATE invoices SET business_id = ? WHERE TRIM(COALESCE(business_id, '')) = ''",
        (business_id,),
    )


def init():
    connection = connect()
    try:
        connection.executescript(SCHEMA)
        ensure_columns(connection)
        ensure_item_shape(connection)
        fold_vat_into_tax_id(connection)
        migrate_businesses(connection)
        connection.commit()
    finally:
        connection.close()


def empty_desk():
    return {
        "business": {
            "name": "",
            "email": "",
            "phone": "",
            "address": "",
            "taxId": "",
            "registrationNumber": "",
            "logo": "",
            "currency": "EUR",
            "extraCurrencies": [],
            "taxRate": 0,
            "invoiceTemplate": "",
            "numberLength": 3,
            "dateFormat": "iso",
            "accounts": [],
        },
        "businesses": [],
        "clients": [],
        "invoices": [],
        "nextNumber": 1,
    }


def _text(value):
    return "" if value is None else str(value)


BUILTIN_CURRENCIES = {"EUR", "USD", "JPY", "GBP", "CNY", "AUD", "CAD", "CHF", "HKD", "SGD"}


def _currency(value):
    code = re.sub(r"[^A-Za-z0-9]", "", _text(value)).upper()
    return code if 2 <= len(code) <= 12 else "EUR"


def _currencies(value):
    raw = value
    if isinstance(value, str):
        try:
            raw = json.loads(value) if value.strip() else []
        except json.JSONDecodeError:
            raw = []
    if not isinstance(raw, list):
        return []
    codes = []
    for item in raw:
        code = re.sub(r"[^A-Za-z0-9]", "", _text(item)).upper()
        if 2 <= len(code) <= 12 and code not in codes and code not in BUILTIN_CURRENCIES:
            codes.append(code)
    return codes


def _logo(value):
    text = _text(value).strip()
    if re.fullmatch(r"data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+", text):
        return text
    return ""


def _template(value):
    text = re.sub(r"[\x00-\x1f]", "", _text(value)).strip()
    return text[:80]


def _date_format(value):
    text = _text(value).strip()
    return text if text in {"iso", "dmy", "mdy"} else "iso"


def _number_length(value):
    try:
        length = int(value)
    except (TypeError, ValueError):
        return 3
    return min(12, max(1, length))


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _optional_number(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _number_out(value):
    return "" if value is None else value


def _identity(value):
    text = _text(value).strip()
    return text or str(uuid.uuid4())


def _business_out(row, accounts):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "address": row["address"],
        "taxId": row["tax_id"],
        "registrationNumber": row["registration_number"],
        "logo": _logo(row["logo"]),
        "currency": _currency(row["currency"]),
        "extraCurrencies": _currencies(row["extra_currencies"]),
        "taxRate": row["tax_rate"],
        "invoiceTemplate": _template(row["invoice_template"]),
        "numberLength": _number_length(row["number_length"]),
        "dateFormat": _date_format(row["date_format"]),
        "nextNumber": row["next_number"] if row["next_number"] else 1,
        "accounts": accounts,
    }


def _account_out(row):
    return {"id": row["id"], "bank": row["bank"], "account": row["account"], "bic": row["bic"]}


def load_desk():
    init()
    connection = connect()
    try:
        account_rows = connection.execute("SELECT * FROM bank_accounts ORDER BY position").fetchall()
        business_rows = connection.execute("SELECT * FROM businesses ORDER BY position, name").fetchall()
        businesses = [
            _business_out(
                row,
                [_account_out(account) for account in account_rows if account["business_id"] == row["id"]],
            )
            for row in business_rows
        ]
        if businesses and any(not account["business_id"] for account in account_rows):
            businesses[0]["accounts"].extend(_account_out(account) for account in account_rows if not account["business_id"])
        business = businesses[0] if businesses else empty_desk()["business"]
        clients = [
            {
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
                "address": row["address"],
                "registrationNumber": row["registration_number"],
                "taxId": row["tax_id"],
            }
            for row in connection.execute("SELECT * FROM clients ORDER BY position, name")
        ]
        invoices = []
        for invoice in connection.execute("SELECT * FROM invoices ORDER BY position"):
            items = [
                {
                    "id": item["id"],
                    "code": item["code"],
                    "description": item["description"],
                    "unit": item["unit"],
                    "qty": _number_out(item["qty"]),
                    "rate": _number_out(item["rate"]),
                    "discount": _number_out(item["discount"]),
                    "tax": invoice["tax_rate"] if item["tax"] is None else _number_out(item["tax"]),
                }
                for item in connection.execute(
                    "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position",
                    (invoice["id"],),
                )
            ]
            invoices.append(
                {
                    "id": invoice["id"],
                    "number": invoice["number"],
                    "clientId": invoice["client_id"],
                    "issueDate": invoice["issue_date"],
                    "dueDate": invoice["due_date"],
                    "status": invoice["status"],
                    "notes": invoice["notes"],
                    "taxRate": invoice["tax_rate"],
                    "issued": bool(invoice["issued"]),
                    "dateFormat": _date_format(invoice["date_format"]),
                    "businessId": invoice["business_id"],
                    "items": items,
                }
            )
        next_row = connection.execute("SELECT value FROM meta WHERE key = 'nextNumber'").fetchone()
        try:
            next_number = int(next_row["value"]) if next_row else 1
        except (TypeError, ValueError):
            next_number = 1
        if businesses:
            next_number = businesses[0].get("nextNumber") or next_number
        return {
            "business": business,
            "businesses": businesses,
            "clients": clients,
            "invoices": invoices,
            "nextNumber": next_number,
        }
    finally:
        connection.close()


def save_desk(desk):
    if not isinstance(desk, dict):
        raise ValueError("The desk must be an object")
    business = desk.get("business")
    clients = desk.get("clients")
    invoices = desk.get("invoices")
    if not isinstance(business, dict) or not isinstance(clients, list) or not isinstance(invoices, list):
        raise ValueError("The desk is missing business, clients, or invoices")

    init()
    connection = connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM invoice_items")
        connection.execute("DELETE FROM invoices")
        connection.execute("DELETE FROM clients")
        connection.execute("DELETE FROM bank_accounts")
        connection.execute("DELETE FROM businesses")
        connection.execute(
            """
            INSERT INTO business (
              id, name, email, phone, address, tax_id, registration_number, logo, currency, extra_currencies, tax_rate,
              invoice_template, number_length, date_format
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              email = excluded.email,
              phone = excluded.phone,
              address = excluded.address,
              tax_id = excluded.tax_id,
              registration_number = excluded.registration_number,
              logo = excluded.logo,
              currency = excluded.currency,
              extra_currencies = excluded.extra_currencies,
              tax_rate = excluded.tax_rate,
              invoice_template = excluded.invoice_template,
              number_length = excluded.number_length,
              date_format = excluded.date_format
            """,
            (
                _text(business.get("name")),
                _text(business.get("email")),
                _text(business.get("phone")),
                _text(business.get("address")),
                _text(business.get("taxId")),
                _text(business.get("registrationNumber")),
                _logo(business.get("logo")),
                _currency(business.get("currency")),
                json.dumps(_currencies(business.get("extraCurrencies"))),
                _number(business.get("taxRate")),
                _template(business.get("invoiceTemplate")),
                _number_length(business.get("numberLength")),
                _date_format(business.get("dateFormat")),
            ),
        )
        businesses = desk.get("businesses") if isinstance(desk.get("businesses"), list) else [business]
        stored = []
        for position, item in enumerate(businesses):
            if not isinstance(item, dict):
                continue
            if not any(str(item.get(key) or "").strip() for key in ("name", "email", "phone", "address", "taxId", "registrationNumber", "logo")) and not (
                isinstance(item.get("accounts"), list)
                and any(str(account.get(key) or "").strip() for account in item["accounts"] if isinstance(account, dict) for key in ("bank", "account", "bic"))
            ):
                continue
            business_id = _identity(item.get("id"))
            stored.append(item)
            try:
                item_next = int(item.get("nextNumber") or 1)
            except (TypeError, ValueError):
                item_next = 1
            connection.execute(
                """
                INSERT INTO businesses (
                  id, name, email, phone, address, tax_id, registration_number, logo, currency, extra_currencies,
                  tax_rate, invoice_template, number_length, date_format, next_number, position
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    business_id,
                    _text(item.get("name")),
                    _text(item.get("email")),
                    _text(item.get("phone")),
                    _text(item.get("address")),
                    _text(item.get("taxId")),
                    _text(item.get("registrationNumber")),
                    _logo(item.get("logo")),
                    _currency(item.get("currency")),
                    json.dumps(_currencies(item.get("extraCurrencies"))),
                    _number(item.get("taxRate")),
                    _template(item.get("invoiceTemplate")),
                    _number_length(item.get("numberLength")),
                    _date_format(item.get("dateFormat")),
                    item_next,
                    position,
                ),
            )
            accounts = item.get("accounts") if isinstance(item.get("accounts"), list) else []
            for account_position, account in enumerate(accounts):
                if not isinstance(account, dict):
                    continue
                connection.execute(
                    """
                    INSERT INTO bank_accounts (id, business_id, bank, account, bic, position)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _identity(account.get("id")),
                        business_id,
                        _text(account.get("bank")),
                        _text(account.get("account")),
                        _text(account.get("bic")),
                        account_position,
                    ),
                )
        mirror = stored[0] if stored else business
        connection.execute(
            """
            UPDATE business SET
              name = ?, email = ?, phone = ?, address = ?, tax_id = ?, registration_number = ?, logo = ?,
              currency = ?, extra_currencies = ?, tax_rate = ?, invoice_template = ?, number_length = ?, date_format = ?
            WHERE id = 1
            """,
            (
                _text(mirror.get("name")),
                _text(mirror.get("email")),
                _text(mirror.get("phone")),
                _text(mirror.get("address")),
                _text(mirror.get("taxId")),
                _text(mirror.get("registrationNumber")),
                _logo(mirror.get("logo")),
                _currency(mirror.get("currency")),
                json.dumps(_currencies(mirror.get("extraCurrencies"))),
                _number(mirror.get("taxRate")),
                _template(mirror.get("invoiceTemplate")),
                _number_length(mirror.get("numberLength")),
                _date_format(mirror.get("dateFormat")),
            ),
        )
        for position, client in enumerate(clients):
            if not isinstance(client, dict):
                continue
            connection.execute(
                """
                INSERT INTO clients (
                  id, name, email, address, registration_number, tax_id, position
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _identity(client.get("id")),
                    _text(client.get("name")),
                    _text(client.get("email")),
                    _text(client.get("address")),
                    _text(client.get("registrationNumber")),
                    _text(client.get("taxId")),
                    position,
                ),
            )
        for position, invoice in enumerate(invoices):
            if not isinstance(invoice, dict):
                continue
            invoice_id = _identity(invoice.get("id"))
            connection.execute(
                """
                INSERT INTO invoices (
                  id, number, client_id, issue_date, due_date, status, notes, tax_rate, issued, date_format, business_id, position
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    invoice_id,
                    _text(invoice.get("number")),
                    _text(invoice.get("clientId")),
                    _text(invoice.get("issueDate")),
                    _text(invoice.get("dueDate")),
                    _text(invoice.get("status")) or "draft",
                    _text(invoice.get("notes")),
                    _number(invoice.get("taxRate")),
                    1 if invoice.get("issued") or (_text(invoice.get("status")) or "draft") != "draft" else 0,
                    _date_format(invoice.get("dateFormat")),
                    _text(invoice.get("businessId")),
                    position,
                ),
            )
            items = invoice.get("items") if isinstance(invoice.get("items"), list) else []
            for item_position, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                connection.execute(
                    """
                    INSERT INTO invoice_items (
                      id, invoice_id, code, description, unit, qty, rate, discount, tax, position
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _identity(item.get("id")),
                        invoice_id,
                        _text(item.get("code")),
                        _text(item.get("description")),
                        _text(item.get("unit")),
                        _optional_number(item.get("qty")),
                        _optional_number(item.get("rate")),
                        _optional_number(item.get("discount")),
                        _optional_number(item.get("tax")),
                        item_position,
                    ),
                )
        try:
            next_number = int((mirror or {}).get("nextNumber") or desk.get("nextNumber") or 1)
        except (TypeError, ValueError):
            next_number = 1
        connection.execute(
            """
            INSERT INTO meta (key, value) VALUES ('nextNumber', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(next_number),),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

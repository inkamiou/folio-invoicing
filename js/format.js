var CURRENCIES = [
  ["EUR", "Euro"],
  ["USD", "US dollar"],
  ["JPY", "Yen"],
  ["GBP", "Pound"],
  ["CNY", "Yuan"],
  ["AUD", "Australian dollar"],
  ["CAD", "Canadian dollar"],
  ["CHF", "Swiss franc"],
  ["HKD", "Hong Kong dollar"],
  ["SGD", "Singapore dollar"],
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function knownDateFormat(value) {
  return value === "dmy" || value === "mdy" ? value : "iso";
}

function dateFormat() {
  return knownDateFormat(data.business.dateFormat);
}

function invoiceDateFormat(invoice) {
  return knownDateFormat(invoice?.dateFormat);
}

function formatDate(value, format) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const [, year, month, day] = match;
  const chosen = knownDateFormat(format);
  if (chosen === "mdy") return `${month}/${day}/${year}`;
  if (chosen === "dmy") return `${day}.${month}.${year}`;
  return `${year}-${month}-${day}`;
}

function parseDate(value, format) {
  const text = String(value || "").trim();
  if (!text) return "";
  const chosen = knownDateFormat(format);
  const parts =
    chosen === "mdy"
      ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
      : chosen === "dmy"
        ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
        : null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const year = Number(parts ? parts[3] : iso?.[1]);
  const month = Number(parts ? (chosen === "mdy" ? parts[1] : parts[2]) : iso?.[2]);
  const day = Number(parts ? (chosen === "mdy" ? parts[2] : parts[1]) : iso?.[3]);
  if (!parts && !iso) return null;
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datePattern(format) {
  const chosen = knownDateFormat(format);
  if (chosen === "mdy") return "MM/DD/YYYY";
  if (chosen === "dmy") return "DD.MM.YYYY";
  return "YYYY-MM-DD";
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uid() {
  return crypto.randomUUID();
}

function defaultTax() {
  const rate = Number(data.business.taxRate);
  return Number.isFinite(rate) ? rate : 0;
}

function blankItem() {
  return { id: uid(), code: "", description: "", unit: "", qty: "", rate: "", discount: "", tax: defaultTax() };
}

function blankAccount() {
  return { id: uid(), bank: "", account: "", bic: "" };
}

function logoSrc(value) {
  const text = String(value || "").trim();
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(text) ? text : "";
}

function hasMark(value) {
  return /[0-9A-Za-z]/.test(String(value ?? ""));
}

function marked(label, value) {
  if (!hasMark(value)) return "";
  return label ? `${label} ${value}` : String(value);
}

function paymentDays(invoice) {
  if (!invoice.issueDate || !invoice.dueDate) return null;
  const issued = invoice.issueDate.split("-").map(Number);
  const due = invoice.dueDate.split("-").map(Number);
  if (issued.length !== 3 || due.length !== 3 || issued.some(Number.isNaN) || due.some(Number.isNaN)) return null;
  const start = Date.UTC(issued[0], issued[1] - 1, issued[2]);
  const end = Date.UTC(due[0], due[1] - 1, due[2]);
  return Math.round((end - start) / 86400000);
}

function paymentTerms(invoice) {
  const days = paymentDays(invoice);
  if (days === null || days < 0) return "";
  if (days === 0) return "Payment due on the issue date.";
  if (days === 1) return "Payment due within 1 day.";
  return `Payment due within ${days} days.`;
}

function isGeneratedPaymentNote(notes) {
  const text = String(notes || "").trim();
  return text === "Payment due on the issue date." || /^Payment due within \d+ days?\.$/.test(text);
}

function clearGeneratedPaymentNote(invoice) {
  if (!isGeneratedPaymentNote(invoice.notes)) return false;
  invoice.notes = "";
  return true;
}

function knownCurrency(code) {
  return CURRENCIES.some(([item]) => item === code);
}

function currencyCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return code.length >= 2 && code.length <= 12 ? code : "";
}

function extraCurrencies() {
  return Array.isArray(data.business.extraCurrencies) ? data.business.extraCurrencies : [];
}

function currencyChoices() {
  const codes = CURRENCIES.map(([code]) => code);
  for (const code of extraCurrencies()) {
    if (!codes.includes(code)) codes.push(code);
  }
  const selected = currencyCode(data.business.currency) || "EUR";
  if (!codes.includes(selected)) codes.push(selected);
  return codes;
}

function roundMoney(value) {
  const places = knownCurrency(data.business.currency || "EUR") ? 2 : 8;
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function money(amount) {
  const currency = currencyCode(data.business.currency) || "EUR";
  const value = roundMoney(amount);
  if (!knownCurrency(currency)) {
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
    return `${number} ${currency}`;
  }
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

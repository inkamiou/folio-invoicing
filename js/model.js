function clientById(id) {
  return data.clients.find((client) => client.id === id) || null;
}

function businessById(id) {
  return data.businesses.find((business) => business.id === id) || null;
}

function businessFor(invoice) {
  return businessById(invoice?.businessId);
}

function businessHasData(business) {
  if (!business) return false;
  if (["name", "email", "phone", "address", "registrationNumber", "taxId"].some((key) => hasMark(business[key]))) return true;
  if (logoSrc(business.logo)) return true;
  return (business.accounts || []).some((account) => [account.bank, account.account, account.bic].some((value) => hasMark(value)));
}

function blankBusiness() {
  return normalizeBusiness({ nextNumber: 1 }, 1);
}

function lineGross(item) {
  const qty = Number(item.qty);
  const rate = Number(item.rate);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0;
  return qty * rate;
}

function lineDiscountAmount(item) {
  if (!hasMark(item.discount)) return 0;
  const discount = Number(item.discount);
  if (!Number.isFinite(discount)) return 0;
  return roundMoney(lineGross(item) * (discount / 100));
}

function lineAmount(item) {
  if (!lineGross(item)) return 0;
  return roundMoney(lineGross(item) - lineDiscountAmount(item));
}

function lineTaxRate(item) {
  if (!hasMark(item.tax)) return null;
  const tax = Number(item.tax);
  return Number.isFinite(tax) ? tax : null;
}

function lineTaxAmount(item) {
  const tax = lineTaxRate(item);
  if (tax == null) return 0;
  return roundMoney(lineAmount(item) * (tax / 100));
}

function taxRows(lines) {
  const groups = new Map();
  lines.forEach((item) => {
    const rate = lineTaxRate(item);
    if (rate == null) return;
    const key = String(rate);
    groups.set(key, (groups.get(key) || 0) + lineTaxAmount(item));
  });
  return [...groups.entries()].map(([rate, amount]) => ({ rate, amount: roundMoney(amount) }));
}

function lineHasData(item) {
  return ["code", "description", "unit", "qty", "rate", "discount"].some((key) => hasMark(item[key]));
}

function lineOnInvoice(item) {
  return hasMark(item.description) && hasMark(item.rate);
}

function invoiceLines(invoice) {
  return invoice.items.filter(lineOnInvoice);
}

function totals(invoice) {
  const lines = invoiceLines(invoice);
  const discount = roundMoney(lines.reduce((sum, item) => sum + lineDiscountAmount(item), 0));
  const subtotal = roundMoney(lines.reduce((sum, item) => sum + lineAmount(item), 0));
  const tax = roundMoney(lines.reduce((sum, item) => sum + lineTaxAmount(item), 0));
  return { discount, subtotal, tax, total: roundMoney(subtotal + tax) };
}

function isOverdue(invoice) {
  return invoice.status === "sent" && invoice.dueDate && invoice.dueDate < today();
}

function statusLabel(invoice) {
  return isOverdue(invoice) ? "overdue" : invoice.status;
}

function outstandingTotal() {
  return data.invoices
    .filter((invoice) => invoice.status === "sent")
    .reduce((sum, invoice) => sum + totals(invoice).total, 0);
}

function paidTotal() {
  return data.invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + totals(invoice).total, 0);
}

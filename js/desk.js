const STORAGE_KEY = "folio.invoices.v1";

function emptyDesk() {
  return {
    business: {
      name: "",
      email: "",
      phone: "",
      address: "",
      taxId: "",
      registrationNumber: "",
      logo: "",
      currency: "EUR",
      extraCurrencies: [],
      taxRate: 0,
      invoiceTemplate: "",
      numberLength: 3,
      dateFormat: "iso",
      accounts: [],
    },
    businesses: [],
    clients: [],
    invoices: [],
    nextNumber: 1,
  };
}

function deskIsBlank(desk) {
  const businesses = Array.isArray(desk.businesses) && desk.businesses.length ? desk.businesses : [desk.business || {}];
  return !desk.clients?.length && !desk.invoices?.length && !businesses.some((business) => businessHasData(business));
}

function readBrowserDesk() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.invoices) && saved.business) return saved;
  } catch {
    /* keep going if the browser copy is unreadable */
  }
  return null;
}

function adoptTaxId(party) {
  if (!party) return;
  if (!hasMark(party.taxId) && hasMark(party.vatCode)) party.taxId = party.vatCode;
  delete party.vatCode;
}

function normalizeBusiness(raw, fallbackNumber) {
  const business = {
    id: raw?.id || uid(),
    name: raw?.name || "",
    email: raw?.email || "",
    phone: raw?.phone || "",
    address: raw?.address || "",
    taxId: raw?.taxId || "",
    registrationNumber: raw?.registrationNumber || "",
    logo: raw?.logo || "",
    currency: raw?.currency || "EUR",
    extraCurrencies: Array.isArray(raw?.extraCurrencies) ? raw.extraCurrencies : [],
    taxRate: Number(raw?.taxRate) || 0,
    invoiceTemplate: raw?.invoiceTemplate || "",
    numberLength: raw?.numberLength || 3,
    dateFormat: knownDateFormat(raw?.dateFormat),
    nextNumber: Math.max(1, Math.round(Number(raw?.nextNumber ?? fallbackNumber)) || 1),
    accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
  };
  adoptTaxId(business);
  return business;
}

function prepareDesk(desk) {
  if (!desk) return desk;
  const fallbackNumber = Number(desk.nextNumber) || 1;
  if (!Array.isArray(desk.businesses) || !desk.businesses.length) {
    desk.businesses = businessHasData(desk.business) ? [normalizeBusiness(desk.business, fallbackNumber)] : [];
  } else {
    desk.businesses = desk.businesses.map((business) => normalizeBusiness(business, fallbackNumber));
  }
  desk.business = desk.businesses[0] || normalizeBusiness(desk.business, fallbackNumber);
  desk.nextNumber = desk.business.nextNumber || fallbackNumber;
  adoptTaxId(desk.business);
  (desk.clients || []).forEach(adoptTaxId);
  (desk.invoices || []).forEach((invoice) => {
    invoice.issued = Boolean(invoice.issued) || invoice.status !== "draft";
    invoice.type = invoice.type === "expense" ? "expense" : "invoice";
    invoice.dateFormat = knownDateFormat(invoice.dateFormat);
    (invoice.items || []).forEach((item) => {
      if (item.tax == null || item.tax === "") item.tax = Number(invoice.taxRate) || 0;
    });
  });
  return desk;
}

function load() {
  const injected = prepareDesk(window.__FOLIO_DESK__);
  if (injected && Array.isArray(injected.invoices) && injected.business) {
    if (deskIsBlank(injected)) {
      const browserCopy = prepareDesk(readBrowserDesk());
      if (browserCopy && !deskIsBlank(browserCopy)) return browserCopy;
    }
    return injected;
  }
  return prepareDesk(readBrowserDesk()) || emptyDesk();
}

function save() {
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) bridge.postMessage({ type: "save", desk: data });
  else if (window.__FOLIO_WIN__ && window.pywebview?.api?.save) window.pywebview.api.save(data);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  paintStats();
}

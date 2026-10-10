function blankClient() {
  return { id: uid(), name: "", email: "", address: "", registrationNumber: "", taxId: "" };
}

function clientHasName(client) {
  return Boolean(String(client?.name || "").trim());
}

function discardUnsavedClient() {
  if (!ui.creatingClient || !ui.editingClientId) return;
  data.clients = data.clients.filter((client) => client.id !== ui.editingClientId || clientHasName(client));
  ui.editingClientId = null;
  ui.creatingClient = false;
}

function prepareClientView() {
  if (!Array.isArray(data.clients)) data.clients = [];
  data.clients = data.clients.filter((client) => clientHasName(client) || client.id === ui.editingClientId);
  if (!data.clients.some(clientHasName)) {
    let editing = data.clients.find((client) => client.id === ui.editingClientId);
    if (!editing) {
      editing = blankClient();
      data.clients = [editing];
      ui.editingClientId = editing.id;
      ui.creatingClient = true;
    }
  }
}

function renderClients() {
  prepareClientView();
  const hasClients = data.clients.some(clientHasName);
  main.innerHTML = `
    <div class="panel">
      <h2>Clients</h2>
      <p class="lede">People and companies you bill.</p>
      <div class="client-tools">
        <button type="button" class="btn btn-quiet" id="show-client-search" ${ui.clientQuery || !hasClients ? "hidden" : ""}>Search</button>
        <input id="client-search" class="search" type="search" placeholder="Name, email, or tax ID" value="${esc(ui.clientQuery)}" ${ui.clientQuery ? "" : "hidden"} />
      </div>
      <div class="client-list" id="client-list"></div>
      <button type="button" class="btn btn-quiet" id="add-client" ${hasClients ? "" : "hidden"}>Add client</button>
      <form id="client-form" class="stack" hidden>
        <label><span>Name</span><input name="name" type="text" required /></label>
        <label><span>Email</span><input name="email" type="email" /></label>
        <label><span>Address</span><textarea name="address"></textarea></label>
        <div class="grid-2">
          <label><span>Registration no.</span><input name="registrationNumber" type="text" /></label>
          <label><span>Tax ID</span><input name="taxId" type="text" /></label>
        </div>
        <div class="line-summary-actions">
          <button type="button" class="btn" id="cancel-client">Cancel</button>
          <button class="btn btn-primary" type="submit" id="client-submit">${ui.creatingClient ? "Create" : "Save changes"}</button>
        </div>
      </form>
    </div>
  `;
  const form = main.querySelector("#client-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = form.name.value.trim();
    if (!name) {
      form.name.focus();
      return;
    }
    const details = {
      name,
      email: form.email.value.trim(),
      address: form.address.value.trim(),
      registrationNumber: form.registrationNumber.value.trim(),
      taxId: form.taxId.value.trim(),
    };
    const existing = data.clients.find((client) => client.id === ui.editingClientId);
    if (existing) Object.assign(existing, details);
    else {
      data.clients.unshift({ id: uid(), ...details });
    }
    ui.editingClientId = null;
    ui.creatingClient = false;
    save();
    render();
  });
  main.querySelector("#cancel-client").addEventListener("click", () => {
    if (ui.creatingClient) data.clients = data.clients.filter((client) => client.id !== ui.editingClientId);
    ui.editingClientId = null;
    ui.creatingClient = false;
    render();
  });
  main.querySelector("#add-client").addEventListener("click", () => {
    if (ui.editingClientId) {
      form.name.focus();
      return;
    }
    const created = blankClient();
    data.clients.unshift(created);
    ui.editingClientId = created.id;
    ui.creatingClient = true;
    render();
    main.querySelector("#client-form [name=name]")?.focus();
  });
  main.querySelector("#show-client-search").addEventListener("click", () => {
    const button = main.querySelector("#show-client-search");
    const field = main.querySelector("#client-search");
    button.hidden = true;
    field.hidden = false;
    field.focus();
  });
  main.querySelector("#client-search").addEventListener("input", (event) => {
    ui.clientQuery = event.target.value;
    paintClients();
  });
  paintClients();
  if (ui.editingClientId) main.querySelector("#client-form [name=name]")?.focus();
}

function visibleClients() {
  const query = ui.clientQuery.trim().toLowerCase();
  const clients = data.clients.filter((client) => client.id === ui.editingClientId || clientHasName(client));
  if (!query) return clients;
  return clients.filter((client) => {
    if (client.id === ui.editingClientId) return true;
    return [client.name, client.email, client.address, client.registrationNumber, client.taxId]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function fillClientForm(client) {
  const form = main.querySelector("#client-form");
  if (!form || !client) return;
  form.name.value = client.name || "";
  form.email.value = client.email || "";
  form.address.value = client.address || "";
  form.registrationNumber.value = client.registrationNumber || "";
  form.taxId.value = client.taxId || "";
}

function paintClients() {
  const list = main.querySelector("#client-list");
  const form = main.querySelector("#client-form");
  if (!list || !form) return;
  const keepValues = Boolean(form.closest("#client-slot"));
  if (form.parentElement) form.remove();
  form.hidden = true;
  const clients = visibleClients();
  const named = data.clients.some(clientHasName);
  if (!named && !ui.editingClientId) {
    list.innerHTML = `<div class="empty"><h3>No clients yet</h3><p>Add one before you send an invoice.</p></div>`;
  } else if (!clients.length) {
    list.innerHTML = `<div class="empty"><h3>No matches</h3><p>Try a different name, email, or tax ID.</p></div>`;
  } else {
    list.innerHTML = clients
      .map((client) => {
        if (client.id === ui.editingClientId) return `<div class="client-form" id="client-slot"></div>`;
        return `
      <article class="client-card">
        <div>
          <strong>${esc(client.name)}</strong>
          <p>
            ${[client.email, client.address, client.registrationNumber && `Reg. no. ${client.registrationNumber}`, client.taxId && `Tax ID ${client.taxId}`]
              .filter(Boolean)
              .map((line) => sheetText(line))
              .join("")}
          </p>
        </div>
        <div class="client-actions">
          <button type="button" class="btn" data-edit-client="${client.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-remove-client="${client.id}">Remove</button>
        </div>
      </article>`;
      })
      .join("");
  }
  const slot = list.querySelector("#client-slot");
  const add = main.querySelector("#add-client");
  if (slot) {
    form.hidden = false;
    slot.append(form);
    if (!keepValues) fillClientForm(data.clients.find((client) => client.id === ui.editingClientId));
  } else if (add) add.before(form);
  list.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = data.clients.find((client) => client.id === ui.editingClientId);
      if (current && ui.creatingClient && !clientHasName(current)) {
        data.clients = data.clients.filter((client) => client.id !== current.id);
      }
      ui.creatingClient = false;
      ui.editingClientId = button.dataset.editClient;
      render();
      main.querySelector("#client-form [name=name]")?.focus();
    });
  });
  list.querySelectorAll("[data-remove-client]").forEach((button) => {
    button.addEventListener("click", () => {
      const used = data.invoices.some((invoice) => invoice.clientId === button.dataset.removeClient);
      if (used) {
        alert("This client is on an invoice. Reassign those invoices before removing them.");
        return;
      }
      data.clients = data.clients.filter((client) => client.id !== button.dataset.removeClient);
      if (ui.editingClientId === button.dataset.removeClient) {
        ui.editingClientId = null;
        ui.creatingClient = false;
      }
      save();
      render();
    });
  });
}

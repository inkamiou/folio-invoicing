function renderClients() {
  main.innerHTML = `
    <div class="panel">
      <h2>Clients</h2>
      <p class="lede">People and companies you bill.</p>
      <form id="client-form" class="stack" style="margin-top:18px">
        <label><span>Name</span><input name="name" type="text" required /></label>
        <label><span>Email</span><input name="email" type="email" /></label>
        <label><span>Address</span><textarea name="address"></textarea></label>
        <div class="grid-2">
          <label><span>Registration no.</span><input name="registrationNumber" type="text" /></label>
          <label><span>Tax ID</span><input name="taxId" type="text" /></label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit" id="client-submit">Add client</button>
          <button type="button" class="btn" id="cancel-client" hidden>Cancel</button>
        </div>
      </form>
      <div class="client-tools">
        <button type="button" class="btn btn-quiet" id="show-client-search" ${ui.clientQuery ? "hidden" : ""}>Search</button>
        <input id="client-search" class="search" type="search" placeholder="Name, email, or tax ID" value="${esc(ui.clientQuery)}" ${ui.clientQuery ? "" : "hidden"} />
      </div>
      <div class="client-list" id="client-list"></div>
    </div>
  `;
  paintClients();
  main.querySelector("#client-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.name.value.trim();
    if (!name) return;
    const details = {
      name,
      email: form.email.value.trim(),
      address: form.address.value.trim(),
      registrationNumber: form.registrationNumber.value.trim(),
      taxId: form.taxId.value.trim(),
    };
    const existing = data.clients.find((client) => client.id === ui.editingClientId);
    if (existing) Object.assign(existing, details);
    else data.clients.push({ id: uid(), ...details });
    ui.editingClientId = null;
    save();
    resetClientForm();
    paintClients();
  });
  main.querySelector("#cancel-client").addEventListener("click", () => {
    ui.editingClientId = null;
    resetClientForm();
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
}

function visibleClients() {
  const query = ui.clientQuery.trim().toLowerCase();
  if (!query) return data.clients;
  return data.clients.filter((client) =>
    [client.name, client.email, client.address, client.registrationNumber, client.taxId]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function resetClientForm() {
  const form = main.querySelector("#client-form");
  if (!form) return;
  form.reset();
  const submit = main.querySelector("#client-submit");
  const cancel = main.querySelector("#cancel-client");
  if (submit) submit.textContent = "Add client";
  if (cancel) cancel.hidden = true;
}

function editClient(id) {
  const client = data.clients.find((item) => item.id === id);
  const form = main.querySelector("#client-form");
  if (!client || !form) return;
  ui.editingClientId = client.id;
  form.name.value = client.name || "";
  form.email.value = client.email || "";
  form.address.value = client.address || "";
  form.registrationNumber.value = client.registrationNumber || "";
  form.taxId.value = client.taxId || "";
  main.querySelector("#client-submit").textContent = "Save changes";
  main.querySelector("#cancel-client").hidden = false;
  form.name.focus();
}

function paintClients() {
  const list = main.querySelector("#client-list");
  if (!list) return;
  const clients = visibleClients();
  if (!data.clients.length) {
    list.innerHTML = `<div class="empty"><h3>No clients yet</h3><p>Add one before you send an invoice.</p></div>`;
    return;
  }
  if (!clients.length) {
    list.innerHTML = `<div class="empty"><h3>No matches</h3><p>Try a different name, email, or tax ID.</p></div>`;
    return;
  }
  list.innerHTML = clients
    .map(
      (client) => `
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
      </article>`
    )
    .join("");
  list.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => editClient(button.dataset.editClient));
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
        resetClientForm();
      }
      save();
      paintClients();
    });
  });
}

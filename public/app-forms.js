/**
 * @fileoverview RescueRoute modal editors, form builders, and intake extraction UI.
 * Exposes `window.createAppForms(deps)` for use by `public/app.js`.
 */
window.createAppForms = function createAppForms({
  $,
  esc,
  time,
  minutes,
  nice,
  state,
  managed,
  find,
  api,
  action,
}) {
  const field = (name, label, value = "", type = "text", extra = "") =>
    `<div><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;

  const select = (name, label, value, options, extra = "") =>
    `<div><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" ${extra}>${options.map(([v, text]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></div>`;

  const checkbox = (name, label, checked = false) =>
    `<label class="checkbox-label"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span>${label}</span></label>`;

  function openEditor(title, content) {
    $("editor-title").textContent = title;
    $("editor-content").innerHTML = content;
    $("editor").showModal();
  }

  const formEnd = (label = "Save record") =>
    `<p id="form-error" class="form-error" role="alert"></p><button class="button dark full" type="submit">${label}</button></form>`;

  function renderIntakeResult(result) {
    const local = result.mode !== "live";
    const source = local ? "Local contextual draft" : "Gemini JSON draft";
    const facts = Object.entries(result.evidence || {})
      .map(
        ([fieldName, fact]) =>
          `<div><dt>${esc(nice(fieldName))}</dt><dd>${esc(JSON.stringify(result.draft[fieldName]))}<small>Source: ${esc(fact.text)}${fact.kind === "derived-from-clock" ? " (derived from the simulation clock)" : ""}</small></dd></div>`,
      )
      .join("");
    $("extract-result").innerHTML =
      `<div class="intake-review"><strong>${source}</strong><p>${esc(result.fallback?.message || `Requested model: ${result.configuredModel}. Reported model: ${result.actualModel || "not supplied by provider"}.`)}</p><p>${result.completeness.known} of ${result.completeness.total} fields supported. Human review is still required.</p>${result.warnings.length ? `<ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${result.questions.length ? `<ul>${result.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}<details><summary>View the source facts</summary><dl class="intake-evidence">${facts || "<p>No supported facts were found.</p>"}</dl></details><p>Confirm the organisation, location, use-by, and handling requirements before saving.</p></div>`;
  }

  function buildProfileFields(kind, r) {
    const placement = r.geo ||
      state.data.mapData?.entities.find((e) => e.id === r.id)?.coordinates || [
        6.917, 79.877,
      ];
    let fields =
      field("name", "Name", r.name, "text", 'required maxlength="120"') +
      field(
        "contact",
        "Contact email or phone",
        r.contact,
        "text",
        'required maxlength="120"',
      ) +
      select(
        "locationMode",
        "Map placement",
        r.geo ? "manual" : "demo",
        [
          ["demo", "Illustrative demo placement"],
          ["manual", "Use the coordinates below"],
        ],
        "required",
      ) +
      field(
        "locationLabel",
        "Address or location label (optional)",
        r.locationLabel || "",
        "text",
        'maxlength="180"',
      ) +
      field(
        "latitude",
        "Latitude",
        placement[0],
        "number",
        'required min="-85" max="85" step="any"',
      ) +
      field(
        "longitude",
        "Longitude",
        placement[1],
        "number",
        'required min="-180" max="180" step="any"',
      );
    if (kind === "volunteers") {
      fields +=
        field(
          "vehicle",
          "Vehicle",
          r.vehicle || "Car",
          "text",
          'required maxlength="120"',
        ) +
        field(
          "capacity",
          "Meal capacity per trip",
          r.capacity || 30,
          "number",
          'required min="1" max="500" step="1"',
        ) +
        field(
          "available",
          "Available from",
          time(r.available ?? state.data.settings.now),
          "time",
          "required",
        ) +
        field("until", "Shift ends", time(r.until ?? 1080), "time", "required");
    }
    return (
      `<div class="form-grid">${fields}</div>` +
      (kind === "volunteers"
        ? checkbox(
            "chilled",
            "This vehicle can meet the donor’s declared chilled handling requirements.",
            r.chilled,
          )
        : "") +
      checkbox(
        "active",
        kind === "volunteers"
          ? "Available for new assignments"
          : "Organisation is active",
        r.active ?? true,
      )
    );
  }

  function buildOrderFields(kind, r, old) {
    const offer = kind === "offers";
    const parents = state.data[offer ? "donors" : "recipients"].filter(
      (x) => x.active || x.id === r[offer ? "donorId" : "recipientId"],
    );
    const parentId =
      r[offer ? "donorId" : "recipientId"] ||
      (managed() ? parents[0]?.id : state.data.user.entityId);
    const parent = select(
      offer ? "donorId" : "recipientId",
      offer ? "Donor organisation" : "Recipient organisation",
      parentId,
      parents.map((x) => [x.id, x.name]),
      `required ${old || !managed() ? "disabled" : ""}`,
    );
    let fields =
      parent +
      (offer
        ? field(
            "food",
            "Food description",
            r.food,
            "text",
            'required maxlength="120"',
          )
        : "") +
      field(
        "meals",
        "Meal portions",
        r.meals,
        "number",
        'required min="1" max="1000" step="1"',
      ) +
      field(
        "deadline",
        offer ? "Collection complete by" : "Delivery complete by",
        typeof r.deadline === "string" ? r.deadline : time(r.deadline ?? 1050),
        "time",
        `required min="${time(state.data.settings.now)}"`,
      );
    if (offer) {
      fields +=
        field(
          "ready",
          "Ready for collection",
          time(r.ready ?? state.data.settings.now),
          "time",
          "required",
        ) +
        field(
          "deliverBy",
          "Donor-declared delivery use-by",
          time(r.deliverBy ?? 1080),
          "time",
          "required",
        ) +
        field(
          "maxTransitMinutes",
          "Maximum transit + handover (minutes)",
          r.maxTransitMinutes ?? 60,
          "number",
          'required min="1" max="240" step="1"',
        ) +
        select(
          "handling",
          "Required transport",
          r.handling || "",
          [
            ["", "Confirm with donor"],
            ["ambient", "Ambient"],
            ["chilled", "Chilled"],
          ],
          "required",
        ) +
        field(
          "allergens",
          "Declared allergens (comma separated, or “none”)",
          Array.isArray(r.allergens) ? r.allergens.join(", ") || "none" : "",
          "text",
          'required maxlength="250"',
        );
    } else {
      fields +=
        field(
          "excludes",
          "Excluded allergens (comma separated, or “none”)",
          r.excludes?.join(", ") || "none",
          "text",
          'required maxlength="250"',
        ) +
        select(
          "priority",
          "Declared priority",
          String(r.priority || 2),
          [
            ["1", "1 · Standard"],
            ["2", "2 · Elevated"],
            ["3", "3 · Urgent"],
          ],
          "required",
        );
    }
    return (
      `<div class="form-grid">${fields}</div>` +
      `<label for="field-notes">Coordination notes</label><textarea id="field-notes" name="notes" maxlength="1000" rows="2">${esc(r.notes || "")}</textarea>` +
      (offer
        ? checkbox(
            "donorConfirmed",
            "The donor has confirmed quantities, ingredients and declared allergens, food suitability, location, use-by, and handling requirements.",
            r.donorConfirmed,
          )
        : "") +
      (managed()
        ? checkbox(
            "approve",
            "I reviewed these details. Approve this record for planning.",
            old?.status === "approved",
          )
        : '<p class="fine-print">Your submission will enter the coordinator review queue. Editing an approved record requires review again.</p>')
    );
  }

  function serializeEntityForm(kind, formElement, old, openedRevision) {
    const f = new FormData(formElement);
    const input = Object.fromEntries(f);
    input.revision = openedRevision;
    if (old) input.id = old.id;
    if (["donors", "recipients", "volunteers"].includes(kind)) {
      input.point = old?.point || [3, 3];
      input.geo =
        input.locationMode === "manual"
          ? [Number(input.latitude), Number(input.longitude)]
          : null;
      input.active = f.has("active");
    }
    if (kind === "volunteers") {
      input.capacity = Number(input.capacity);
      input.available = minutes(input.available);
      input.until = minutes(input.until);
      input.chilled = f.has("chilled");
    }
    if (kind === "offers" || kind === "requests") {
      const parentField = kind === "offers" ? "donorId" : "recipientId";
      input[parentField] =
        old?.[parentField] || input[parentField] || state.data.user.entityId;
      input.meals = Number(input.meals);
      input.deadline = minutes(input.deadline);
      input.approve = f.has("approve");
      const key = kind === "offers" ? "allergens" : "excludes";
      input[key] = /^none$/i.test(input[key].trim())
        ? []
        : input[key]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      if (kind === "offers") {
        input.ready = minutes(input.ready);
        input.deliverBy = minutes(input.deliverBy);
        input.maxTransitMinutes = Number(input.maxTransitMinutes);
        input.donorConfirmed = f.has("donorConfirmed");
      } else {
        input.priority = Number(input.priority);
      }
    }
    return input;
  }

  function wireIntakeControls() {
    if ($("fill-sample")) {
      $("fill-sample").addEventListener(
        "click",
        () =>
          ($("intake-message").value =
            "Donor: The Green Table\nFood: Roasted vegetable meal boxes\nWe have 15 meals available. Collect by 17:30.\nHandling: ambient\nAllergens: none"),
      );
    }
    if ($("extract-offer")) {
      $("extract-offer").addEventListener("click", async () => {
        const b = $("extract-offer");
        const output = $("extract-result");
        const form = $("record-form");
        b.disabled = true;
        output.setAttribute("aria-busy", "true");
        output.innerHTML =
          '<div class="intake-processing"><progress aria-label="Extracting and checking donation facts"></progress><span>Extracting and validating supplied facts...</span></div>';
        try {
          const result = await api("/api/intake", {
            message: $("intake-message").value,
          });
          if (!b.isConnected || !$("editor").open) return;
          const confirmation = form?.querySelector('[name="donorConfirmed"]');
          if (confirmation) confirmation.checked = false;
          for (const [key, value] of Object.entries(result.draft)) {
            if (key === "name") continue;
            const el = $(`field-${key}`);
            if (el) {
              el.value =
                value === null
                  ? ""
                  : Array.isArray(value)
                    ? value.join(", ") || "none"
                    : value;
            }
          }
          renderIntakeResult(result);
        } catch (e) {
          if (b.isConnected) output.textContent = e.message;
        } finally {
          b.disabled = false;
          output.setAttribute("aria-busy", "false");
        }
      });
    }
  }

  /** Opens the create/edit modal for a donor, recipient, volunteer, offer, or request. */
  function editEntity(kind, id, draft = {}) {
    const old = id && find(kind, id);
    const r = old || draft;
    const openedRevision = state.data.revision;
    const fields = ["donors", "recipients", "volunteers"].includes(kind)
      ? buildProfileFields(kind, r)
      : buildOrderFields(kind, r, old);
    const intake =
      kind === "offers" && !old
        ? `<details class="intake-details"><summary>✳ Start from a donor message</summary><p>${state.session.intake === "live" ? "Gemini JSON extraction sends this message to Google. Local fallback is available if the request fails. Use fictional data." : "Local contextual mode. Explicit facts and the simulation clock support extraction; conflicting or missing facts require clarification."}</p><label for="intake-message">Donor message</label><textarea id="intake-message" maxlength="3000" rows="4"></textarea><div class="intake-tools"><button class="text-button" id="fill-sample" type="button">Use sample</button><button class="button secondary" type="button" id="extract-offer">Extract details</button></div><div id="extract-result" role="status"></div></details>`
        : "";
    openEditor(
      `${old ? "Edit" : "Add"} ${kind === "offers" ? "food offer" : kind === "requests" ? "recipient request" : kind.slice(0, -1)}`,
      intake +
        `<form id="record-form">${fields}${formEnd(["offers", "requests"].includes(kind) ? "Save reviewed details" : "Save profile")}`,
    );
    $("record-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = serializeEntityForm(
        kind,
        event.currentTarget,
        old,
        openedRevision,
      );
      await action(
        `/api/entities/${kind}`,
        input,
        "Record saved. The planning state has been updated.",
        { close: true },
      );
    });
    wireIntakeControls();
  }

  /** Opens the create/manage modal for user accounts. */
  function editUser(id) {
    const u = id && find("users", id);
    const openedRevision = state.data.revision;
    openEditor(
      u ? "Manage user account" : "Create user account",
      `<form id="user-form"><div class="form-grid">${field("name", "Display name", u?.name, "text", 'required maxlength="120"')}${field("email", "Email address", u?.email, "email", 'required maxlength="120"')}${select(
        "role",
        "Role (fixed after creation)",
        u?.role || "coordinator",
        ["admin", "coordinator", "donor", "recipient", "volunteer"].map((r) => [
          r,
          nice(r),
        ]),
        u ? "disabled" : "",
      )}${select("entityId", "Linked profile (for participant roles)", u?.entityId || "", [["", "Network-wide / choose role first"], ...["donors", "recipients", "volunteers"].flatMap((k) => state.data[k].map((x) => [x.id, `${k.slice(0, -1)} · ${x.name}`]))], u ? "disabled" : "")}</div>${field("password", u ? "New password (leave blank to keep existing)" : "Initial password", "", "password", `minlength="10" maxlength="128" autocomplete="new-password" ${u ? "" : "required"}`)}${checkbox("active", "Account can sign in", u?.active ?? true)}${formEnd("Save account")}</form>`,
    );
    $("user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      await action(
        "/api/users",
        {
          ...Object.fromEntries(f),
          id: u?.id,
          revision: openedRevision,
          active: f.has("active"),
        },
        "Account saved.",
        { close: true },
      );
    });
  }

  /** Opens a confirmation modal for destructive or state-wide actions. */
  function confirmAction(title, description, callback, label = "Confirm") {
    openEditor(
      title,
      `<form id="confirmation-form"><p class="confirmation-copy">${esc(description)}</p>${formEnd(label)}`,
    );
    $("confirmation-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await callback();
    });
  }

  /** Opens the planner decision-explanation modal. */
  function explain() {
    openEditor(
      "A plan you can understand.",
      '<div class="explain-copy"><p>AI extracts donor messages into drafts. A human reviews missing facts. A deterministic planner then selects trips from approved, unreserved supply and demand.</p><ol><li>Exclude unapproved offers, unavailable volunteers, and declared allergen conflicts.</li><li>Require chilled capability, donor readiness, collection deadlines, donor use-by and transit limits, recipient windows, and driver shift limits.</li><li>Score feasible trips by urgency, priority, load size, travel distance, and scarce chilled capacity.</li><li>Update quantities and each driver’s position after every selection.</li><li>Independently audit the plan and recheck it when a coordinator confirms.</li></ol><p>Confirmation reserves stock. Pickup begins transport. Recipient receipt counts the meals as delivered. Cancelling releases only uncollected reservations.</p><p>The heuristic is not globally optimal. Routes use geographic straight-line distances at an assumed 24 km/h with 4-minute handovers; they are not road directions. Donor declarations are not an independent food-safety certificate.</p></div>',
    );
  }

  return {
    field,
    openEditor,
    formEnd,
    editEntity,
    editUser,
    confirmAction,
    explain,
  };
};

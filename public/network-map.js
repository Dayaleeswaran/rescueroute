/* Real basemap and accessible entity details. Leaflet is vendored locally. */
(() => {
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const clock = (n) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  let map,
    layer,
    accuracyLayer,
    payload,
    api,
    selectedKey = null,
    search = "",
    shown = new Set(["donor", "recipient", "volunteer"]),
    rememberedView;
  const key = (e) => `${e.kind}:${e.id}`;
  const coordinate = (e) => e.fix?.coordinates || e.coordinates;
  const elapsed = (f) =>
    Math.max(0, Math.floor((Date.now() - f.receivedAt) / 1000));
  const fixLabel = (e) =>
    e.fix
      ? `${e.fix.mode === "gps" ? "Shared GPS" : "DEMO movement"} · ${elapsed(e.fix)}s ago${elapsed(e.fix) > 120 ? " · STALE" : ""}`
      : e.locationType === "demo"
        ? "Demo placement · not a real address"
        : "Manually entered coordinates · not live GPS";
  function markup(full = false) {
    return `<div class="network-widget ${full ? "network-full" : ""}"><div class="network-toolbar"><div class="network-filters">${["donor", "recipient", "volunteer"].map((kind) => `<label><input type="checkbox" data-map-kind="${kind}" ${shown.has(kind) ? "checked" : ""}><i class="network-dot ${kind}"></i>${kind[0].toUpperCase() + kind.slice(1)}s</label>`).join("")}</div><button class="button secondary" data-map-fit type="button">Fit network</button></div><div class="network-layout"><div class="network-map-wrap"><div id="network-map-canvas" class="network-map-canvas" aria-label="Interactive OpenStreetMap network map"></div><p id="map-tiles-error" class="map-error" hidden>Map tiles could not load. Check your internet connection; the entity list remains available.</p><div class="network-map-note">Real basemap · Demo placements labelled · Lines show planning links, not roads</div></div><aside class="network-detail" aria-label="Map entity details"><label for="network-search" class="sr-only">Search the network</label><input id="network-search" type="search" placeholder="Find a donor, recipient, volunteer…" value="${esc(search)}"><div id="network-entity-list" class="network-entity-list"></div><div id="network-selected" class="network-selected" aria-live="polite"></div></aside></div><div class="network-footer"><span id="network-stream-status">Connecting to network updates…</span><span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></span></div><div class="network-demo-note">Seeded organisations are fictional, with illustrative placements near Colombo. Enter profile coordinates to place your own records.</div><div id="network-tracking-controls"></div></div>`;
  }
  function visible() {
    return (payload?.entities || []).filter(
      (e) =>
        shown.has(e.kind) &&
        (!search ||
          `${e.name} ${e.locationLabel || ""}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
  }
  function choose(entity, pan = true) {
    selectedKey = key(entity);
    details();
    if (map && pan) map.panTo(coordinate(entity));
    list();
  }
  function list() {
    const el = document.getElementById("network-entity-list");
    if (!el) return;
    el.innerHTML =
      visible()
        .map(
          (e) =>
            `<button type="button" class="network-entity ${key(e) === selectedKey ? "selected" : ""}" data-map-entity="${esc(key(e))}"><i class="network-dot ${e.kind}"></i><span><strong>${esc(e.name)}</strong><small>${esc(fixLabel(e))}</small></span><span aria-hidden="true">›</span></button>`,
        )
        .join("") || '<p class="network-empty">No matching entities.</p>';
  }
  function details() {
    const target = document.getElementById("network-selected");
    if (!target) return;
    const e =
      selectedKey && payload.entities.find((e) => key(e) === selectedKey);
    if (!e) {
      target.innerHTML =
        '<p class="network-empty">Select a marker or an entity to see contact details, available food, needs, or tracking status.</p>';
      return;
    }
    const c = coordinate(e);
    const fact = (label, value) =>
      `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
    const rows =
      e.kind === "donor"
        ? e.offers
            .map(
              (o) =>
                `<article><strong>${esc(o.food)}</strong><p>${o.meals} offered · ${o.reserved} reserved · ${o.delivered} delivered</p><p>${esc(o.status)} · collect by ${clock(o.deadline)} · ${esc(o.handling)}</p><p>Declared allergens: ${esc(o.allergens.join(", ") || "none")}</p></article>`,
            )
            .join("")
        : e.kind === "recipient"
          ? e.requests
              .map(
                (r) =>
                  `<article><strong>${r.meals} portions requested</strong><p>${r.reserved} reserved · ${r.delivered} received</p><p>${esc(r.status)} · delivery by ${clock(r.deadline)} · priority ${r.priority}</p><p>Excludes: ${esc(r.excludes.join(", ") || "none")}</p></article>`,
              )
              .join("")
          : `<article><strong>${esc(e.vehicle)}</strong><p>${e.capacity} meals per trip · ${e.chilled ? "Chilled capable" : "Ambient only"}</p><p>Shift ${clock(e.available)}–${clock(e.until)} · ${e.active ? "Available" : "Unavailable"}</p></article>`;
    target.innerHTML = `<span class="eyebrow">${esc(e.kind.toUpperCase())}</span><h3>${esc(e.name)}</h3><span class="tracking-source ${e.fix?.mode === "gps" ? "gps-source" : ""}">${esc(fixLabel(e))}</span><dl>${fact("Contact", e.contact || "Contact your coordinator")}${e.locationLabel ? fact("Location label", e.locationLabel) : ""}${fact("Coordinates", `${c[0].toFixed(6)}, ${c[1].toFixed(6)}`)}${e.fix?.accuracy !== null && e.fix?.accuracy !== undefined ? fact("Reported accuracy", `±${Math.round(e.fix.accuracy)} metres`) : ""}${e.fix ? fact("Last update", new Date(e.fix.receivedAt).toLocaleString()) : ""}</dl>${rows || "<p>No food records in this view.</p>"}<a class="text-button network-osm-link" href="https://www.openstreetmap.org/?mlat=${c[0]}&mlon=${c[1]}#map=16/${c[0]}/${c[1]}" target="_blank" rel="noopener noreferrer">Open these coordinates in OpenStreetMap ↗</a>`;
  }
  function controls() {
    const target = document.getElementById("network-tracking-controls");
    if (!target) return;
    const role = api.role;
    if (role === "volunteer")
      target.innerHTML = `<div class="location-controls"><div><strong>Your location. Your choice.</strong><p>Sharing sends your browser location and accuracy to your coordinators and recipients/donors with an active assigned delivery. Fixes stay in server memory for up to 10 minutes; no location history is saved.</p></div><button type="button" class="button dark" data-gps-start>Share my location</button><button type="button" class="button secondary" data-gps-stop>Stop sharing</button><span id="gps-message" role="status">${esc(api.gpsStatus())}</span></div>`;
    else if (["admin", "coordinator"].includes(role))
      target.innerHTML = `<div class="location-controls"><div><strong>Judge’s demo tracker</strong><p>Move a labelled demo marker without changing deliveries, stock, or the planning clock. Real GPS fixes cannot be replaced by demo movement.</p></div><label for="demo-driver" class="sr-only">Volunteer to simulate</label><select id="demo-driver">${payload.entities
        .filter((e) => e.kind === "volunteer" && e.active)
        .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`)
        .join(
          "",
        )}</select><button class="button secondary" type="button" data-demo-start>Run demo movement</button><button class="button secondary" type="button" data-demo-stop>Stop demo movement</button><span id="gps-message" role="status">${esc(api.gpsStatus())}</span></div>`;
  }
  function draw() {
    if (!map) {
      list();
      details();
      return;
    }
    layer.clearLayers();
    accuracyLayer.clearLayers();
    for (const link of payload.links)
      window.L.polyline(link.points, {
        color: "#53775d",
        weight: 3,
        dashArray: "7 6",
        opacity: 0.6,
      })
        .bindTooltip(esc(link.label))
        .addTo(layer);
    for (const e of visible()) {
      const freshness = !e.fix || elapsed(e.fix) > 120 ? "stale" : "fresh";
      const label =
        e.kind === "donor"
          ? "D"
          : e.kind === "recipient"
            ? "R"
            : e.fix?.mode === "gps"
              ? "GPS"
              : "V";
      const icon = window.L.divIcon({
        className: "network-leaflet-marker",
        html: `<span class="network-pin ${e.kind} ${freshness} ${e.fix?.mode === "demo" ? "demo-pin" : ""}">${label}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const marker = window.L.marker(coordinate(e), {
        icon,
        title: `${e.name}: ${fixLabel(e)}`,
        alt: e.name,
        keyboard: true,
      }).addTo(layer);
      marker.bindTooltip(esc(e.name));
      marker.on("click", () => choose(e));
      if (e.fix?.mode === "gps" && e.fix.accuracy > 0)
        window.L.circle(coordinate(e), {
          radius: e.fix.accuracy,
          weight: 1,
          color: "#407d9b",
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(accuracyLayer);
    }
    list();
    details();
  }
  function fit() {
    if (!map) return;
    const points = visible().map(coordinate);
    if (points.length)
      map.fitBounds(window.L.latLngBounds(points), {
        padding: [35, 35],
        maxZoom: 14,
      });
  }
  function mount(data, options) {
    const root = document.querySelector(".network-widget");
    if (!root) return;
    payload = data;
    api = options;
    const canvas = document.getElementById("network-map-canvas");
    if (window.L) {
      map = window.L.map(canvas, {
        scrollWheelZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
      }).setView([6.94, 79.89], 12);
      window.L.tileLayer(data.tileUrl, {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      })
        .on("tileerror", () => {
          const error = document.getElementById("map-tiles-error");
          if (error) error.hidden = false;
        })
        .addTo(map);
      layer = window.L.featureGroup().addTo(map);
      accuracyLayer = window.L.featureGroup().addTo(map);
      if (rememberedView)
        map.setView(rememberedView.center, rememberedView.zoom);
      else fit();
    } else
      canvas.innerHTML =
        '<p class="network-empty">The map renderer could not load. Use the searchable entity list for all network details.</p>';
    root.addEventListener("click", async (event) => {
      const b = event.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-map-entity")) {
        const e = payload.entities.find((e) => key(e) === b.dataset.mapEntity);
        if (e) choose(e);
      }
      if (b.hasAttribute("data-map-fit")) fit();
      if (b.hasAttribute("data-gps-start")) api.startGps();
      if (b.hasAttribute("data-gps-stop")) api.stopGps();
      if (b.hasAttribute("data-demo-start"))
        api.startDemo(document.getElementById("demo-driver").value);
      if (b.hasAttribute("data-demo-stop")) api.stopDemo();
    });
    root.addEventListener("change", (event) => {
      const kind = event.target.dataset.mapKind;
      if (!kind) return;
      if (event.target.checked) shown.add(kind);
      else shown.delete(kind);
      draw();
    });
    document
      .getElementById("network-search")
      .addEventListener("input", (event) => {
        search = event.target.value;
        draw();
      });
    draw();
    controls();
    options.streamStatus();
  }
  function update(data) {
    if (!document.querySelector(".network-widget")) return;
    payload = data;
    draw();
  }
  function destroy() {
    if (map) {
      rememberedView = { center: map.getCenter(), zoom: map.getZoom() };
      map.remove();
    }
    map = null;
    layer = null;
    accuracyLayer = null;
  }
  window.RescueMap = {
    markup,
    mount,
    update,
    destroy,
    reset: () => {
      destroy();
      payload = null;
      selectedKey = null;
      rememberedView = null;
      search = "";
      shown = new Set(["donor", "recipient", "volunteer"]);
    },
    tick: () => {
      if (payload) {
        let expired = false;
        for (const e of payload.entities)
          if (e.fix && elapsed(e.fix) > 600) {
            e.fix = null;
            expired = true;
          }
        if (expired) {
          draw();
          return;
        }
        list();
        details();
      }
    },
  };
})();

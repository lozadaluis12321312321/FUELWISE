(async () => {
  "use strict";

  const platform = window.FuelWisePlatform || {
    native: false,
    get: async (key) => localStorage.getItem(key),
    set: async (key, value) => localStorage.setItem(key, value),
  };
  const STORAGE_KEY = "fuelwise.v1";
  const RISK_WEIGHT = 0.1;
  const THEME_KEY = "fuelwise.theme.v1";
  const systemTheme = matchMedia("(prefers-color-scheme: dark)");
  const themeToggle = document.querySelector("#themeToggle");
  const themeStatus = document.querySelector("#themeStatus");
  let themePreference = null;
  let themeWrites = Promise.resolve();
  let systemBarUpdates = Promise.resolve();
  try {
    const saved = await platform.get(THEME_KEY);
    if (["light", "dark"].includes(saved)) themePreference = saved;
  } catch {}
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#111111" : "#f7f7f7";
    const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
    systemBarUpdates = systemBarUpdates.then(() => platform.setTheme?.(theme)).catch(() => {
      console.warn("Native system bar appearance could not be updated.");
    });
  }
  applyTheme(themePreference || (systemTheme.matches ? "dark" : "light"));
  themeToggle.disabled = false;
  themeToggle.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    themePreference = theme;
    applyTheme(theme);
    themeStatus.className = "sr-only";
    themeStatus.textContent = `${theme === "dark" ? "Dark" : "Light"} mode enabled.`;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    themeWrites = themeWrites.then(() => platform.set(THEME_KEY, theme)).catch(() => {
      themeStatus.className = "app-status";
      themeStatus.textContent = "Theme changed for this session, but the preference could not be saved.";
    });
  });
  systemTheme.addEventListener("change", () => {
    if (!themePreference) applyTheme(systemTheme.matches ? "dark" : "light");
  });

  const demoState = () => ({
    vehicle: {
      tank: 40, fuel: 5, eff: 12, currency: "$", speed: 40, timeValue: 0,
      fillMode: "full", fillAmount: 20, reserve: 10, returnTrip: true,
    },
    stations: [
      { id: uid(), name: "QuickFuel (corner)", price: 1.89, distance: 0.8 },
      { id: uid(), name: "Highway Petro", price: 1.74, distance: 6.5 },
      { id: uid(), name: "BudgetGas Depot", price: 1.62, distance: 14 },
      { id: uid(), name: "City Shell", price: 1.81, distance: 2.4 },
    ],
    log: [],
  });

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function validateState(data) {
    const number = (n, min = 0, max = 1000000000) => Number.isFinite(n) && n >= min && n <= max;
    const text = (s, max = 100) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
    if (!data || !data.vehicle || !Array.isArray(data.stations) || !Array.isArray(data.log ?? [])) throw new Error("Invalid backup format");
    const v = { ...demoState().vehicle, ...data.vehicle };
    if (!number(v.tank, 1, 10000) || !number(v.fuel, 0, v.tank) || !number(v.eff, 0.1, 1000) ||
        !number(v.speed, 1, 500) || !number(v.timeValue) || !number(v.fillAmount, 1, 10000) ||
        !number(v.reserve, 0, 50) || !text(v.currency, 3) || !["full", "fixed"].includes(v.fillMode) ||
        typeof v.returnTrip !== "boolean") throw new Error("Invalid vehicle values");
    const stations = data.stations;
    const log = data.log ?? [];
    if (stations.length > 1000 || log.length > 10000) throw new Error("Backup has too many records");
    const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
    if (stations.some((s) => !s || !validId(s.id) || !text(s.name) || !number(s.price, 0.01, 1000000) || !number(s.distance, 0, 100000)) ||
        new Set(stations.map((s) => s.id)).size !== stations.length) throw new Error("Invalid station records");
    if (log.some((e) => !e || !validId(e.id) || typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
        !number(e.odometer) || !number(e.liters, 0.1, 10000) || !number(e.price, 0.01, 1000000) ||
        typeof e.full !== "boolean" || typeof e.stationId !== "string" || (e.stationName && !text(e.stationName))) ||
        new Set(log.map((e) => e.id)).size !== log.length) throw new Error("Invalid fill-up records");
    return { vehicle: v, stations, log };
  }

  async function load() {
    const raw = await platform.get(STORAGE_KEY);
    if (raw) return validateState(JSON.parse(raw));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        const migrated = validateState(saved);
        await platform.set(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (_) { /* fall through to demo data */ }
    return demoState();
  }

  let state = await load();
  let saveQueue = Promise.resolve();
  const save = (next = state) => {
    const snapshot = JSON.stringify(next);
    const operation = saveQueue.then(() => platform.set(STORAGE_KEY, snapshot));
    saveQueue = operation.catch(() => {});
    return operation.then(() => {
      document.querySelector("#appStatus").textContent = "";
      return true;
    }, () => {
      document.querySelector("#appStatus").textContent = "Could not save changes. Keep the app open and export a backup before closing.";
      return false;
    });
  };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => `${esc(state.vehicle.currency)}${n.toFixed(2)}`;
  const km = (n) => `${n.toFixed(1)} km`;

  /* ---------------- Decision engine ---------------- */

  function analyze() {
    const v = state.vehicle;
    const k = v.returnTrip ? 2 : 1;
    const reserveL = (v.reserve / 100) * v.tank;
    const baseLiters = v.fillMode === "full" ? Math.max(0, v.tank - v.fuel) : v.fillAmount;
    const timePerKm = v.speed > 0 ? v.timeValue / v.speed : 0;

    const results = state.stations.map((s) => {
      const arrival = v.fuel - s.distance / v.eff;
      const reachable = arrival >= 0;
      const risk = reachable && reserveL > 0 && arrival < reserveL ? (reserveL - arrival) / reserveL : 0;
      const tripLiters = (k * s.distance) / v.eff;
      const fuelCost = baseLiters * s.price;
      const tripCost = tripLiters * s.price;
      const timeCost = k * s.distance * timePerKm;
      const trueCost = fuelCost + tripCost + timeCost;
      return {
        ...s, arrival, reachable, risk, tripLiters, fuelCost, tripCost, timeCost, trueCost,
        adjusted: trueCost * (1 + RISK_WEIGHT * risk),
        perKmCost: k * (s.price / v.eff + timePerKm),
      };
    });

    const reachable = results.filter((r) => r.reachable).sort((a, b) => a.adjusted - b.adjusted);
    const nearest = [...results].filter((r) => r.reachable).sort((a, b) => a.distance - b.distance)[0];
    const cheapest = [...reachable].sort((a, b) => a.price - b.price || a.distance - b.distance)[0];

    results.forEach((r) => {
      r.breakEven = nearest && r.price < nearest.price ? (nearest.trueCost - baseLiters * r.price) / r.perKmCost : null;
    });

    return { results, ranked: reachable, best: reachable[0], nearest, cheapest, baseLiters, reserveL, k };
  }

  /* ---------------- Rendering ---------------- */

  function renderVehicle() {
    const v = state.vehicle;
    const form = $("#vehicleForm");
    for (const [key, val] of Object.entries(v)) {
      const el = form.elements[key];
      if (!el || el === document.activeElement) continue;
      if (el.type === "checkbox") el.checked = !!val; else el.value = val;
    }
    $("#fillAmountLabel").classList.toggle("hidden", v.fillMode !== "fixed");
    document.querySelectorAll(".return-note").forEach((n) => n.classList.toggle("hidden", !v.returnTrip));

    const pct = Math.max(0, Math.min(100, (v.fuel / v.tank) * 100));
    const fill = $("#gaugeFill");
    fill.style.width = `${pct}%`;
    fill.style.background = pct <= v.reserve ? "var(--danger)" : pct <= 25 ? "var(--warn)" : "var(--accent)";
    $("#gaugeText").textContent = `${pct.toFixed(0)}% (${v.fuel.toFixed(1)} L)`;

    const range = v.fuel * v.eff;
    $("#summaryRange").textContent = km(range);
    $("#summaryFuel").textContent = `${v.fuel.toFixed(1)} L remaining · ${v.eff.toFixed(1)} km/L`;
    const safeRange = Math.max(0, (v.fuel - (v.reserve / 100) * v.tank) * v.eff);
    $("#rangeText").textContent = `Estimated range: ${km(range)} (${km(safeRange)} before dipping into your ${v.reserve}% reserve).`;

    const banner = $("#lowFuelBanner");
    banner.classList.toggle("hidden", pct > 25);
    banner.classList.toggle("warn", pct > v.reserve);
    banner.textContent = pct <= v.reserve
      ? `Fuel critical: only ~${km(range)} of range left. Refuel now - see the AI pick below.`
      : `Low fuel: ~${km(range)} of range left. Time to plan your stop.`;
  }

  function renderRecommendation(a) {
    const box = $("#recommendation");
    if (!state.stations.length) {
      box.innerHTML = `<p class="empty">Add at least one station to get a recommendation.</p>`;
      return;
    }
    if (!a.best) {
      const closest = [...a.results].sort((x, y) => x.distance - y.distance)[0];
      box.innerHTML = `<div class="winner"><div class="medal">!</div><div><h3>No station in range</h3>
        <div class="sub">Your estimated range is ${km(state.vehicle.fuel * state.vehicle.eff)}.</div></div></div>
        <ul class="reasons"><li>Even the closest station, <b>${esc(closest.name)}</b> (${km(closest.distance)}), is outside your estimated range. Stop somewhere safe and arrange roadside assistance or fuel delivery rather than trying to reach it.</li>
        <li>Verify your actual fuel level. Range is an estimate, not a guarantee.</li></ul>`;
      return;
    }

    const { best, nearest, cheapest, ranked } = a;
    const second = ranked[1];
    const gap = second ? (second.adjusted - best.adjusted) / best.adjusted : 1;
    const conf = gap > 0.05 ? ["high", "High confidence"] : gap > 0.01 ? ["medium", "Medium confidence"] : ["low", "Near tie - pick the most convenient"];
    const worst = ranked[ranked.length - 1];

    const reasons = [];
    if (nearest && best.id !== nearest.id) {
      const extra = best.distance - nearest.distance;
      reasons.push(`It's ${km(extra)} further than <b>${esc(nearest.name)}</b>, but ${money(nearest.price - best.price)}/L cheaper, saving you <b>${money(nearest.trueCost - best.trueCost)}</b> even after the extra driving.`);
    } else if (cheapest && best.id !== cheapest.id) {
      const be = cheapest.breakEven;
      reasons.push(`<b>${esc(cheapest.name)}</b> is ${money(best.price - cheapest.price)}/L cheaper, but at ${km(cheapest.distance)} away the detour eats the savings` +
        (be !== null && be > 0 ? ` (it would only pay off within ${km(be)}).` : "."));
    } else {
      reasons.push(`It's both the closest and the cheapest reachable option - an easy call.`);
    }
    if (worst && worst.id !== best.id) {
      reasons.push(`Compared to the worst option (<b>${esc(worst.name)}</b>) you save <b>${money(worst.trueCost - best.trueCost)}</b>.`);
    }
    reasons.push(`You'll arrive with about <b>${best.arrival.toFixed(1)} L</b> left and buy ~${(a.baseLiters + best.distance / state.vehicle.eff).toFixed(1)} L there.`);
    if (best.risk > 0) reasons.push(`Heads up: you'll dip into your safety reserve getting there. The AI already penalised this, and it still wins.`);
    const risky = ranked.filter((r) => r.risk > 0 && r.id !== best.id && r.trueCost < best.trueCost);
    if (risky.length) reasons.push(`<b>${esc(risky[0].name)}</b> is slightly cheaper on paper, but reaching it cuts too close to empty.`);
    if (state.vehicle.timeValue > 0) reasons.push(`Your time is valued at ${money(state.vehicle.timeValue)}/h, which is included in the cost.`);

    box.innerHTML = `
      <div class="winner">
        <div class="medal" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg></div>
        <div>
          <h3>${esc(best.name)}</h3>
          <div class="sub">${money(best.price)}/L &middot; ${km(best.distance)} away</div>
          <span class="confidence ${conf[0]}">${conf[1]}</span>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>True cost</span><b>${money(best.trueCost)}</b></div>
        <div class="stat"><span>Detour fuel</span><b>${best.tripLiters.toFixed(2)} L</b></div>
        <div class="stat"><span>Saved vs nearest</span><b>${money(nearest ? nearest.trueCost - best.trueCost : 0)}</b></div>
      </div>
      ${best.risk > 0 ? `<p class="hint">Safety reserve warning: estimated arrival fuel is ${best.arrival.toFixed(1)} L, below your ${a.reserveL.toFixed(1)} L reserve.</p>` : ""}
      <details class="reason-details"><summary>Why this station?</summary><ul class="reasons">${reasons.map((r) => `<li>${r}</li>`).join("")}</ul></details>`;
  }

  function renderStations(a) {
    const list = $("#stationList");
    const byDistance = [...a.results].sort((x, y) => x.distance - y.distance);
    list.innerHTML = byDistance.map((r) => {
      const isBest = a.best && r.id === a.best.id;
      const tags = [
        isBest ? `<span class="tag best">AI pick</span>` : "",
        !r.reachable ? `<span class="tag no">Out of range</span>` : r.risk > 0 ? `<span class="tag risk">Low margin</span>` : "",
      ].join("");
      const be = r.breakEven !== null && r.breakEven > 0 ? ` &middot; worth it within ${km(r.breakEven)}` : "";
      return `<li class="${isBest ? "best" : ""} ${r.reachable ? "" : "unreachable"}">
        <div>
          <div class="name">${esc(r.name)}${tags}</div>
          <div class="meta">${money(r.price)}/L &middot; ${km(r.distance)} &middot; true cost ${money(r.trueCost)}${be}</div>
        </div>
        <div class="row-actions">
          <button class="btn small ghost" data-edit="${r.id}">Edit</button>
          <button class="btn small danger" data-del="${r.id}" aria-label="Remove ${esc(r.name)}">&times;</button>
        </div>
      </li>`;
    }).join("") || `<li class="empty">No stations yet.</li>`;

    const select = $("#logForm").elements.stationId;
    const current = select.value;
    select.innerHTML = `<option value="">Station (optional)</option>` +
      state.stations.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    select.value = current;
  }

  function renderChart(a) {
    const rows = [...a.results].sort((x, y) => (y.reachable - x.reachable) || x.adjusted - y.adjusted);
    const max = Math.max(...rows.map((r) => r.trueCost), 0.01);
    $("#chart").innerHTML = rows.map((r) => {
      const pct = (n) => `${(n / max) * 100}%`;
      const isBest = a.best && r.id === a.best.id;
      return `<div class="bar-row ${isBest ? "best" : ""} ${r.reachable ? "" : "unreachable"}" title="${esc(r.name)}">
        <span class="label">${esc(r.name)}</span>
        <div class="bar">
          <div class="fuel" style="width:${pct(r.fuelCost)}" title="Fuel ${money(r.fuelCost)}"></div>
          <div class="trip" style="width:${pct(r.tripCost)}" title="Detour ${money(r.tripCost)}"></div>
          <div class="time" style="width:${pct(r.timeCost)}" title="Time ${money(r.timeCost)}"></div>
        </div>
        <span class="total">${money(r.trueCost)}</span>
      </div>`;
    }).join("") || `<p class="empty">No data yet.</p>`;
  }

  /* ---------------- Fill-up log & efficiency learning ---------------- */

  function computeEfficiencies() {
    const sorted = [...state.log].sort((a, b) => a.odometer - b.odometer);
    const effById = {};
    let lastFull = null;
    let litersSince = 0;
    for (const e of sorted) {
      litersSince += e.liters;
      if (!e.full) continue;
      if (lastFull && e.odometer > lastFull.odometer && litersSince > 0) {
        effById[e.id] = (e.odometer - lastFull.odometer) / litersSince;
      }
      lastFull = e;
      litersSince = 0;
    }
    const recent = sorted.filter((e) => effById[e.id]).slice(-5).map((e) => effById[e.id]);
    const learned = recent.length ? recent.reduce((s, x) => s + x, 0) / recent.length : null;
    return { effById, learned, samples: recent.length };
  }

  function renderLog() {
    const { effById, learned, samples } = computeEfficiencies();
    const names = Object.fromEntries(state.stations.map((s) => [s.id, s.name]));
    const rows = [...state.log].sort((a, b) => b.odometer - a.odometer);
    $("#logBody").innerHTML = rows.map((e) => `<tr>
      <td>${esc(e.date)}</td><td>${e.odometer.toLocaleString()}</td><td>${e.liters.toFixed(2)}${e.full ? "" : " (partial)"}</td>
      <td>${money(e.price)}</td><td>${money(e.liters * e.price)}</td><td>${esc(names[e.stationId] || e.stationName || "-")}</td>
      <td>${effById[e.id] ? effById[e.id].toFixed(2) : "-"}</td>
      <td><button class="btn small danger" data-dellog="${e.id}" aria-label="Delete fill-up on ${esc(e.date)}">&times;</button></td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty">No fill-ups logged yet. Log two full-tank fill-ups and the AI will learn your real km/L.</td></tr>`;

    const box = $("#learned");
    if (learned) {
      const diff = Math.abs(learned - state.vehicle.eff) > 0.05;
      box.innerHTML = `<span>Learned efficiency: <b>${learned.toFixed(2)} km/L</b> (from ${samples} fill-up${samples > 1 ? "s" : ""})</span>` +
        (diff ? `<button class="btn small primary" id="useLearned">Use this value</button>` : `<span class="hint" style="margin:0">In use</span>`);
    } else {
      box.innerHTML = "";
    }
  }

  function render() {
    const a = analyze();
    renderVehicle();
    renderRecommendation(a);
    renderStations(a);
    renderChart(a);
    renderLog();
  }

  /* ---------------- Events ---------------- */

  let currentView = "overview";
  function showView(view, focus = true) {
    if (!["overview", "stations", "vehicle", "activity"].includes(view)) return;
    currentView = view;
    document.querySelectorAll("[data-screen]").forEach((el) => el.classList.toggle("hidden", el.dataset.screen !== view));
    $("#overviewSummary").classList.toggle("hidden", view !== "overview");
    document.querySelectorAll(".bottom-nav button").forEach((button) => {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.body.dataset.view = view;
    if (focus) {
      window.scrollTo(0, 0);
      $("#mainContent").focus({ preventScroll: true });
    }
  }
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  await platform.onBack?.(() => {
    if (currentView !== "overview") showView("overview");
    else platform.minimize();
  });
  showView("overview", false);
  $("#appStatus").textContent = "";
  $("#vehicleForm").addEventListener("submit", (e) => e.preventDefault());
  $("#vehicleForm").addEventListener("input", (e) => {
    const el = e.target;
    if (!el.validity.valid) return;
    const v = { ...state.vehicle };
    v[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    if (v.fuel > v.tank) v.fuel = v.tank;
    try { validateState({ ...state, vehicle: v }); } catch { return; }
    state.vehicle = v;
    save();
    render();
  });
  $("#vehicleForm").addEventListener("focusout", () => renderVehicle());

  const stationForm = $("#stationForm");
  const resetStationForm = () => {
    stationForm.reset();
    stationForm.elements.id.value = "";
    $("#stationSubmit").textContent = "Add";
    $("#stationCancel").classList.add("hidden");
  };

  stationForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = stationForm.elements;
    const data = { name: f.name.value.trim(), price: parseFloat(f.price.value), distance: parseFloat(f.distance.value) };
    if (!data.name || !Number.isFinite(data.price) || data.price <= 0 || !Number.isFinite(data.distance) || data.distance < 0) return;
    if (f.id.value) Object.assign(state.stations.find((s) => s.id === f.id.value), data);
    else state.stations.push({ id: uid(), ...data });
    resetStationForm();
    save();
    render();
  });

  $("#stationCancel").addEventListener("click", resetStationForm);

  $("#stationList").addEventListener("click", (e) => {
    const { edit, del } = e.target.dataset;
    if (edit) {
      const s = state.stations.find((x) => x.id === edit);
      const f = stationForm.elements;
      f.id.value = s.id; f.name.value = s.name; f.price.value = s.price; f.distance.value = s.distance;
      $("#stationSubmit").textContent = "Save";
      $("#stationCancel").classList.remove("hidden");
      f.name.focus();
    } else if (del) {
      if (!confirm("Remove this station? Existing fill-up history will be kept.")) return;
      state.stations = state.stations.filter((s) => s.id !== del);
      if (stationForm.elements.id.value === del) resetStationForm();
      save();
      render();
    }
  });

  const logForm = $("#logForm");
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  logForm.elements.date.value = today();

  logForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = logForm.elements;
    const station = state.stations.find((s) => s.id === f.stationId.value);
    const entry = {
      id: uid(), date: f.date.value, odometer: parseFloat(f.odometer.value), liters: parseFloat(f.liters.value),
      price: parseFloat(f.price.value), stationId: f.stationId.value, stationName: station ? station.name : "", full: f.full.checked,
    };
    if ([entry.odometer, entry.liters, entry.price].some(Number.isNaN)) return;
    state.log.push(entry);
    if (station) station.price = entry.price;
    state.vehicle.fuel = entry.full ? state.vehicle.tank : Math.min(state.vehicle.tank, state.vehicle.fuel + entry.liters);
    logForm.reset();
    f.date.value = today();
    f.full.checked = true;
    save();
    render();
  });

  document.addEventListener("click", (e) => {
    if (e.target.id === "useLearned") {
      state.vehicle.eff = Math.round(computeEfficiencies().learned * 100) / 100;
      save();
      render();
    } else if (e.target.dataset.dellog) {
      if (!confirm("Delete this fill-up record? This will not change your current fuel level.")) return;
      state.log = state.log.filter((x) => x.id !== e.target.dataset.dellog);
      save();
      render();
    }
  });

  $("#exportBtn").addEventListener("click", async () => {
    const data = JSON.stringify(state, null, 2);
    if (platform.native) {
      try { await platform.exportData(data); }
      catch { $("#appStatus").textContent = "Backup sharing was canceled or unavailable. Your saved data has not changed."; }
      return;
    }
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fuelwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5000000) throw new Error("Backup must be smaller than 5 MB");
      const data = validateState(JSON.parse(await file.text()));
      if (confirm("Replace your current stations, vehicle settings, and fill-up history with this backup?") && await save(data)) {
        state = data;
        resetStationForm();
        render();
      }
    } catch (err) {
      alert(`Could not import: ${err.message}`);
    }
    e.target.value = "";
  });

  $("#resetBtn").addEventListener("click", async () => {
    if (!confirm("Replace all your data with the demo data?")) return;
    const demo = demoState();
    if (!await save(demo)) return;
    state = demo;
    resetStationForm();
    render();
  });

  let offlineReady = platform.native;
  const updateOnline = () => {
    $("#offlineBadge").textContent = offlineReady ? (navigator.onLine ? "Offline ready" : "Offline mode") : "On-device advisor";
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();

  if (!platform.native && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(() => {
      offlineReady = true;
      updateOnline();
    }).catch(() => { $("#offlineBadge").textContent = "Offline cache unavailable"; });
  }

  render();
})().catch((error) => {
  console.error("FuelWise initialization failed:", error);
  document.querySelector("#appStatus").textContent = "Unable to load saved data. Close and reopen the app. Your stored data has not been overwritten; do not clear app storage.";
  document.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
});

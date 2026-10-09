(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  /* ---------- decision engine (same shape as the app's core) ---------- */
  const AVG_SPEED_KMH = 25; // Metro Manila traffic, realistically

  function scoreStation({ distanceKm, pricePerL }, car) {
    const fuelCost = pricePerL * car.litres;
    const detourL = (distanceKm / 100) * car.eff;
    const detourCost = detourL * pricePerL;
    const minutes = (distanceKm / AVG_SPEED_KMH) * 60;
    const timeCost = (minutes / 60) * car.timeValue;
    return { fuelCost, detourCost, timeCost, minutes, total: fuelCost + detourCost + timeCost, reachable: distanceKm <= car.range };
  }

  function decide(a, b, car) {
    const sa = scoreStation(a, car), sb = scoreStation(b, car);
    let winner, why, warn = false;
    if (!sa.reachable && !sb.reachable) {
      winner = null; warn = true;
      why = `Neither ${a.brand} nor ${b.brand} is within your ${car.range} km range. Find fuel immediately — any pump beats an empty tank on EDSA.`;
    } else if (!sb.reachable) {
      winner = "A"; warn = true;
      why = `${b.brand} is cheaper, but it's ${b.distanceKm} km away and you only have ${car.range} km of range. Play it safe: fill at ${a.brand}, or top up a few litres there and continue to ${b.brand}.`;
    } else if (!sa.reachable) {
      winner = "B"; warn = true;
      why = `${a.brand} is out of range — but ${b.brand} is reachable and cheaper anyway.`;
    } else {
      const diff = Math.abs(sa.total - sb.total);
      winner = sa.total <= sb.total ? "A" : "B";
      if (diff < 20) {
        why = `It's a wash — within ${money(diff)} either way. Take ${a.brand} and save ${Math.round(Math.abs(sa.minutes - sb.minutes))} minutes in traffic.`;
        winner = "A";
      } else if (winner === "B") {
        why = `The extra ${(b.distanceKm - a.distanceKm).toFixed(1)} km burns ${money(sb.detourCost - sa.detourCost)} in fuel and ${Math.round(sb.minutes - sa.minutes)} min of your time, but ${b.brand}'s lower price saves ${money(sa.fuelCost - sb.fuelCost)} on the fill. Net win: ${money(diff)}.`;
      } else {
        why = `${b.brand} is cheaper per litre, but the detour eats the savings. Staying at ${a.brand} saves ${money(diff)} and ${Math.round(sb.minutes - sa.minutes)} minutes. Don't chase the sign.`;
      }
    }
    return { sa, sb, winner, why, warn };
  }

  /* ---------- map helpers ---------- */
  const routes = { a: $("route-a"), b: $("route-b") };
  const trails = { a: $("route-a-trail"), b: $("route-b-trail") };
  const routeLen = { a: routes.a.getTotalLength(), b: routes.b.getTotalLength() };
  const MAP_MAX_KM = 20; // distance that reaches the end of a drawn road

  function fraction(km) { return Math.min(1, Math.max(0.06, km / MAP_MAX_KM)); }
  function pointAt(k, frac) { return routes[k].getPointAtLength(routeLen[k] * frac); }

  function placePins(aKm, bKm) {
    const fa = fraction(aKm), fb = fraction(bKm);
    const pa = pointAt("a", fa), pb = pointAt("b", fb);
    $("pin-a").setAttribute("transform", `translate(${pa.x} ${pa.y})`);
    $("pin-b").setAttribute("transform", `translate(${pb.x} ${pb.y})`);
    ["a", "b"].forEach((k, i) => {
      const pct = (i === 0 ? fa : fb) * 100;
      routes[k].style.strokeDasharray = `${pct} 100`;
      // repeat a short dash pattern up to pct, then a long gap so the trail ends at the pin
      const dashes = Array(Math.ceil(pct / 4.5)).fill("1.5 3").join(" ");
      trails[k].style.strokeDasharray = `${dashes} 0 200`;
    });
    carState.frac = { a: fa, b: fb };
  }

  /* car: drives from YOU to the winning station, pauses, resets */
  const car = $("car");
  const carState = { route: "b", frac: { a: .1, b: .7 }, t: 0, last: 0 };
  function driveCar(ts) {
    if (!carState.last) carState.last = ts;
    const dt = (ts - carState.last) / 1000; carState.last = ts;
    const k = carState.route;
    if (k) {
      carState.t = (carState.t + dt / 4.5) % 1.25;           // 4.5 s drive + pause
      const prog = Math.min(1, carState.t);
      const eased = prog < 1 ? 1 - Math.pow(1 - prog, 2) : 1;
      const L = routeLen[k] * carState.frac[k];
      const p = routes[k].getPointAtLength(L * eased);
      const q = routes[k].getPointAtLength(Math.min(L, L * eased + 2));
      const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      car.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${ang})`);
      car.style.opacity = prog >= 1 && carState.t > 1.1 ? 0 : 1;
    } else {
      car.setAttribute("transform", "translate(175 215)");
      car.style.opacity = 1;
    }
    requestAnimationFrame(driveCar);
  }
  requestAnimationFrame(driveCar);

  /* HUD clock (Manila time) */
  const tick = () => { $("hud-time").textContent = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" }) + " PHT"; };
  tick(); setInterval(tick, 15000);

  /* ---------- wire up demo ---------- */
  const ids = ["litres", "eff", "range", "time", "da", "pa", "db", "pb"];
  const fmt = { litres: (v) => v, eff: (v) => Number(v).toFixed(1), range: (v) => v, time: (v) => v, da: (v) => Number(v).toFixed(1), pa: (v) => Number(v).toFixed(2), db: (v) => Number(v).toFixed(1), pb: (v) => Number(v).toFixed(2) };

  function update() {
    const v = {};
    ids.forEach((id) => { v[id] = Number($(id).value); $(`o-${id}`).textContent = fmt[id]($(id).value); });
    const brandA = $("ba").value, brandB = $("bb").value;
    const car = { litres: v.litres, eff: v.eff, range: v.range, timeValue: v.time };
    const a = { brand: brandA, distanceKm: v.da, pricePerL: v.pa }, b = { brand: brandB, distanceKm: v.db, pricePerL: v.pb };
    const r = decide(a, b, car);

    $("lbl-a").textContent = brandA.toUpperCase(); $("lbl-b").textContent = brandB.toUpperCase();
    $("bkb-a").textContent = brandA; $("bkb-b").textContent = brandB;

    const fill = (k, s) => {
      $(`t-${k}`).textContent = money(s.total);
      $(`f-${k}`).textContent = money(s.fuelCost);
      $(`d-${k}`).textContent = money(s.detourCost);
      $(`m-${k}`).textContent = `${money(s.timeCost)} · ${Math.round(s.minutes)} min`;
    };
    fill("a", r.sa); fill("b", r.sb);

    const title = r.winner === "A" ? `Fill up at ${brandA} (near)` : r.winner === "B" ? `Drive to ${brandB} (far)` : "Refuel anywhere — now";
    $("v-title").textContent = title;
    $("v-why").textContent = r.why;
    $("verdict").classList.toggle("warn", r.warn);

    ["a", "b"].forEach((k) => {
      const win = r.winner && r.winner.toLowerCase() === k;
      $(`bk-${k}`).classList.toggle("win", win);
      $(`pin-${k}`).classList.toggle("win", win);
      $(`pin-${k}`).classList.toggle("lose", r.winner !== null && !win);
      routes[k].classList.toggle("win", win);
      trails[k].classList.toggle("win", win);
    });
    placePins(v.da, v.db);
    const newRoute = r.winner ? r.winner.toLowerCase() : null;
    if (newRoute !== carState.route) { carState.route = newRoute; carState.t = 0; }
  }
  [...ids, "ba", "bb"].forEach((id) => $(id).addEventListener("input", update));
  $("ba").addEventListener("change", update); $("bb").addEventListener("change", update);
  update();

  /* ---------- waitlist (concept only, nothing is sent) ---------- */
  $("wl-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input");
    if (!input.checkValidity()) return input.reportValidity();
    $("wl-msg").textContent = "You're on the list. We'll ping you once — and only once.";
    e.target.reset();
  });

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const saved = localStorage.getItem("fuelwise.site.theme");
  if (saved) root.dataset.theme = saved;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) root.dataset.theme = "dark";
  $("theme").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("fuelwise.site.theme", next);
  });

  /* ---------- scroll reveal ---------- */
  const io = new IntersectionObserver((entries) => entries.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.12 });
  document.querySelectorAll(".dilemma-card, .steps li, .features article, .demo-controls, .demo-output, .waitlist-inner, .section-head").forEach((el) => { el.classList.add("reveal"); io.observe(el); });

  $("year").textContent = new Date().getFullYear();
})();

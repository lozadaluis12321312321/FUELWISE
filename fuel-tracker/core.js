export const DEFAULT_VEHICLE = Object.freeze({
  tank: 40, fuel: 5, eff: 12, currency: '$', speed: 40, timeValue: 0,
  fillMode: 'full', fillAmount: 20, reserve: 10, returnTrip: true,
});

const EPSILON = 1e-9;
const number = (value, min = 0, max = 1000000000) => Number.isFinite(value) && value >= min && value <= max;
const text = (value, max = 100, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validateVehicle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid vehicle settings.');
  const v = { ...DEFAULT_VEHICLE, ...input };
  if (!number(v.tank, 1, 10000) || !number(v.fuel, 0, v.tank)) throw new Error('Fuel must be between zero and tank capacity (1–10,000 L).');
  if (!number(v.eff, .1, 1000)) throw new Error('Efficiency must be between 0.1 and 1,000 km/L.');
  if (!number(v.speed, 1, 500) || !number(v.timeValue)) throw new Error('Check your speed (1–500 km/h) and nonnegative time value.');
  if (!number(v.fillAmount, 1, 10000) || !['full', 'fixed'].includes(v.fillMode)) throw new Error('Invalid refueling amount or mode.');
  if (!number(v.reserve, 0, 50) || typeof v.returnTrip !== 'boolean' || !text(v.currency, 3)) throw new Error('Invalid reserve, return-trip setting, or currency.');
  return Object.fromEntries(Object.keys(DEFAULT_VEHICLE).map(key => [key, v[key]]));
}

export function validateState(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.stations) || !Array.isArray(data.log ?? [])) throw new Error('Invalid backup format.');
  if (data.schemaVersion !== undefined && ![1, 2].includes(data.schemaVersion)) throw new Error('Unsupported backup version.');
  const vehicle = validateVehicle(data.vehicle);
  if (data.stations.length > 1000 || (data.log?.length ?? 0) > 10000) throw new Error('Maximum 1,000 stations and 10,000 fill-up records.');
  const stations = data.stations.map(s => {
    if (!s || !id(s.id) || !text(s.name) || !number(s.price, .01, 1000000) || !number(s.distance, 0, 100000)) throw new Error('Invalid station: check name, price (0.01–1,000,000), and distance (0–100,000 km).');
    if (s.priceUpdatedAt != null && !timestamp(s.priceUpdatedAt)) throw new Error('Invalid station price timestamp.');
    return { id: s.id, name: s.name.trim(), price: s.price, distance: s.distance, priceUpdatedAt: s.priceUpdatedAt ?? null };
  });
  const log = (data.log ?? []).map(e => {
    if (!e || !id(e.id) || !date(e.date) || !number(e.odometer) || !number(e.liters, .1, 10000) || !number(e.price, .01, 1000000) ||
        typeof e.full !== 'boolean' || !(e.stationId === '' || id(e.stationId)) || !text(e.stationName ?? '', 100, true)) throw new Error('Invalid fill-up: check date, odometer, liters, price, and station.');
    return { id: e.id, date: e.date, odometer: e.odometer, liters: e.liters, price: e.price, full: e.full, stationId: e.stationId, stationName: e.stationName ?? '' };
  });
  if (new Set(stations.map(s => s.id)).size !== stations.length || new Set(log.map(e => e.id)).size !== log.length) throw new Error('Duplicate record IDs.');
  const sorted = [...log].sort((a, b) => a.odometer - b.odometer);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].odometer === sorted[i - 1].odometer) throw new Error('A fill-up already exists at this odometer. Check for duplicate records.');
    if (sorted[i].date < sorted[i - 1].date) throw new Error('Fill-up dates and odometers must be in chronological order.');
  }
  return { schemaVersion: 2, vehicle, stations, log };
}

export function fuelStatus(v) {
  const reserveL = v.tank * v.reserve / 100;
  const pct = v.fuel / v.tank * 100;
  const critical = v.fuel <= reserveL + EPSILON;
  return { reserveL, pct, critical, low: critical || pct <= 25, range: v.fuel * v.eff, safeRange: Math.max(0, v.fuel - reserveL) * v.eff };
}

export function calculateStation(v, s) {
  const outwardLiters = s.distance / v.eff;
  const arrival = v.fuel - outwardLiters;
  const returnLiters = v.returnTrip ? outwardLiters : 0;
  const tripLiters = outwardLiters + returnLiters;
  const purchaseLiters = v.fillMode === 'full' ? Math.max(0, v.tank - arrival) : v.fillAmount;
  const finalFuel = arrival + purchaseLiters - returnLiters;
  const netLiters = purchaseLiters - tripLiters;
  const reachable = s.distance === 0 ? v.fuel >= 0 : arrival > EPSILON;
  const withinCapacity = arrival + purchaseLiters <= v.tank + EPSILON;
  const canReturn = finalFuel > EPSILON;
  const reserveL = v.tank * v.reserve / 100;
  const preservesReserve = (s.distance === 0 || arrival + EPSILON >= reserveL) && finalFuel + EPSILON >= reserveL;
  const pumpCost = purchaseLiters * s.price;
  const timeCost = s.distance * (v.returnTrip ? 2 : 1) / v.speed * v.timeValue;
  const feasible = reachable && withinCapacity && canReturn && netLiters > EPSILON;
  const eligible = feasible && preservesReserve;
  const effectiveCost = feasible ? (pumpCost + timeCost) / netLiters : null;
  const reason = !reachable ? 'Out of range or arrival on empty' : !withinCapacity ? 'Purchase exceeds arrival tank capacity' :
    !canReturn ? 'Not enough fuel for the return trip' : netLiters <= EPSILON ? 'No net fuel gained from this trip' :
    !preservesReserve ? 'Trip would use your safety reserve' : '';
  return {
    ...s, arrival, purchaseLiters, tripLiters, finalFuel, netLiters, pumpCost, timeCost, effectiveCost,
    reachable, feasible, eligible, reason, reserveL,
    fuelRate: feasible ? s.price : 0,
    tripRate: feasible ? tripLiters * s.price / netLiters : 0,
    timeRate: feasible ? timeCost / netLiters : 0,
  };
}

export function analyze(state) {
  const v = state.vehicle;
  const results = state.stations.map(s => calculateStation(v, s));
  const ranked = results.filter(r => r.eligible).sort((a, b) => a.effectiveCost - b.effectiveCost || a.distance - b.distance || a.id.localeCompare(b.id));
  const nearest = [...ranked].sort((a, b) => a.distance - b.distance || a.effectiveCost - b.effectiveCost || a.id.localeCompare(b.id))[0];
  const k = v.returnTrip ? 2 : 1;
  for (const r of results) {
    const quantity = v.fillMode === 'full' ? v.tank - v.fuel : v.fillAmount;
    const denominator = v.fillMode === 'full'
      ? r.price / v.eff + k * v.timeValue / v.speed + (nearest?.effectiveCost ?? 0) * (k - 1) / v.eff
      : k * ((nearest?.effectiveCost ?? 0) / v.eff + v.timeValue / v.speed);
    r.breakEven = nearest && r.price < nearest.effectiveCost && quantity > 0 && denominator > 0
      ? quantity * (nearest.effectiveCost - r.price) / denominator : null;
  }
  return { results, ranked, nearest, best: ranked[0], reserveL: v.tank * v.reserve / 100 };
}

export function computeEfficiencies(log) {
  const sorted = [...log].sort((a, b) => a.odometer - b.odometer);
  const effById = Object.create(null);
  const intervals = [];
  let lastFull = null, litersSince = 0, ignored = 0;
  for (const e of sorted) {
    if (lastFull) litersSince += e.liters;
    if (!e.full) continue;
    if (lastFull) {
      const distance = e.odometer - lastFull.odometer;
      const efficiency = distance / litersSince;
      if (distance > 0 && number(efficiency, .1, 1000)) {
        effById[e.id] = efficiency;
        intervals.push({ distance, liters: litersSince });
      } else ignored++;
    }
    lastFull = e;
    litersSince = 0;
  }
  const recent = intervals.slice(-5);
  const learned = recent.length ? recent.reduce((sum, e) => sum + e.distance, 0) / recent.reduce((sum, e) => sum + e.liters, 0) : null;
  return { effById, learned, samples: recent.length, ignored };
}

export function addFillUp(state, entry, { applyCurrent = false, today = localDate(), now = new Date().toISOString() } = {}) {
  const next = validateState({ ...state, log: [...state.log, entry] });
  if (entry.date > today) throw new Error('Fill-ups cannot be dated in the future.');
  if (entry.liters > next.vehicle.tank + EPSILON) throw new Error('Purchased liters exceed tank capacity.');
  if (applyCurrent) {
    if (entry.date !== today) throw new Error('Only a fill-up dated today can update current fuel and station price. Choose history only for past records.');
    if (state.log.some(e => e.odometer >= entry.odometer)) throw new Error('A current fill-up must have the latest odometer reading.');
    const fuel = entry.full ? next.vehicle.tank : next.vehicle.fuel + entry.liters;
    if (fuel > next.vehicle.tank + EPSILON) throw new Error('Fuel after this purchase exceeds tank capacity. Update the remaining fuel first or choose history only.');
    next.vehicle.fuel = Math.min(next.vehicle.tank, fuel);
    const selected = next.stations.find(s => s.id === entry.stationId);
    if (selected) { selected.price = entry.price; selected.priceUpdatedAt = now; }
  }
  return validateState(next);
}

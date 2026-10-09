import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VEHICLE, validateState, analyze, calculateStation, computeEfficiencies, addFillUp, fuelStatus } from '../core.js';

const vehicle = (overrides = {}) => ({ ...DEFAULT_VEHICLE, tank: 40, fuel: 10, eff: 10, reserve: 0, timeValue: 0, ...overrides });
const station = (overrides = {}) => ({ id: 'station-1', name: 'Local Fuel', price: 2, distance: 10, ...overrides });
const state = (overrides = {}) => ({ vehicle: vehicle(), stations: [station()], log: [], ...overrides });
const entry = (overrides = {}) => ({ id: 'log-1', date: '2026-01-01', odometer: 1000, liters: 20, price: 2, full: true, stationId: 'station-1', stationName: 'Local Fuel', ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('fixed purchase is exact, with no double-counted detour fuel', () => {
  const result = calculateStation(vehicle({ fillMode: 'fixed', fillAmount: 20 }), station());
  close(result.arrival, 9);
  close(result.purchaseLiters, 20);
  close(result.finalFuel, 28);
  close(result.netLiters, 18);
  close(result.pumpCost, 40);
  close(result.effectiveCost, 40 / 18);
  close(result.fuelRate + result.tripRate + result.timeRate, result.effectiveCost);
});

test('full tank purchases reflect arrival fuel and final fuel after returning', () => {
  const result = calculateStation(vehicle(), station());
  close(result.purchaseLiters, 31);
  close(result.pumpCost, 62);
  close(result.finalFuel, 39);
  close(result.netLiters, 29);
  close(result.effectiveCost, 62 / 29);
});

test('one-way trips omit return fuel and time', () => {
  const result = calculateStation(vehicle({ returnTrip: false, timeValue: 30, speed: 30 }), station());
  close(result.finalFuel, 40);
  close(result.netLiters, 30);
  close(result.timeCost, 10);
  close(result.effectiveCost, 72 / 30);
});

test('fixed purchases exceeding arrival capacity are excluded, not silently reduced', () => {
  const result = calculateStation(vehicle({ fuel: 35, fillMode: 'fixed', fillAmount: 10 }), station());
  assert.equal(result.eligible, false);
  assert.match(result.reason, /capacity/i);
});

test('outbound reachability is not enough for a fixed-purchase return trip', () => {
  const result = calculateStation(vehicle({ fuel: 5, fillMode: 'fixed', fillAmount: 1 }), station({ distance: 40 }));
  assert.equal(result.reachable, true);
  assert.equal(result.eligible, false);
  assert.match(result.reason, /return/i);
});

test('arrival exactly on empty is excluded even with zero reserve', () => {
  assert.equal(calculateStation(vehicle({ fuel: 1 }), station()).reachable, false);
  const atPump = calculateStation(vehicle({ fuel: 0, reserve: 10 }), station({ distance: 0 }));
  assert.equal(atPump.eligible, true);
});

test('safety reserve is required for arrival and the end of the trip', () => {
  const v = vehicle({ fuel: 5, reserve: 10, fillMode: 'fixed', fillAmount: 3 });
  const result = calculateStation(v, station({ distance: 10 }));
  close(result.arrival, 4);
  assert.equal(result.eligible, true);
  assert.equal(calculateStation(v, station({ distance: 11 })).eligible, false);
  const longReturn = calculateStation(vehicle({ fuel: 30, reserve: 50, fillMode: 'fixed', fillAmount: 1 }), station({ distance: 90 }));
  assert.equal(longReturn.eligible, false);
});

test('cheap stations that violate reserve cannot outrank eligible stations', () => {
  const result = analyze(state({ vehicle: vehicle({ fuel: 5, reserve: 10 }), stations: [station({ id: 'near', distance: 1 }), station({ id: 'far', distance: 40, price: .5 })] }));
  assert.equal(result.best.id, 'near');
  assert.equal(result.ranked.length, 1);
});

test('ranking uses cost per net liter rather than a smaller pump bill', () => {
  const result = analyze(state({ stations: [station({ id: 'near', distance: 1, price: 2 }), station({ id: 'far', distance: 80, price: 1.5 })] }));
  assert.equal(result.best.id, 'near');
  assert.ok(result.results[1].pumpCost < result.results[0].pumpCost);
});

test('ties prefer the shorter trip and full tanks do not trigger pointless refueling', () => {
  const atPump = station({ id: 'pump', distance: 0, price: 2 });
  const other = station({ id: 'other', distance: 0, price: 2 });
  assert.equal(analyze(state({ stations: [other, atPump] })).best.id, 'other');
  assert.equal(analyze(state({ vehicle: vehicle({ fuel: 40 }) })).best, undefined);
});

test('break-even matches the new effective-cost calculation in both modes', () => {
  for (const fillMode of ['full', 'fixed']) {
    for (const returnTrip of [false, true]) {
      const v = vehicle({ fillMode, fillAmount: 20, returnTrip, timeValue: 12 });
      const result = analyze(state({ vehicle: v, stations: [station({ id: 'near', distance: 1, price: 2 }), station({ id: 'far', distance: 10, price: 1.8 })] }));
      const far = result.results[1];
      close(calculateStation(v, { ...far, distance: far.breakEven }).effectiveCost, result.nearest.effectiveCost);
    }
  }
});

test('a reserve larger than the low-fuel threshold still triggers a critical warning', () => {
  const status = fuelStatus(vehicle({ fuel: 15, reserve: 50 }));
  assert.equal(status.critical, true);
  assert.equal(status.low, true);
});

test('old backups are normalized without losing records; future schemas are rejected', () => {
  const normalized = validateState(state({ log: [entry()] }));
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.log.length, 1);
  assert.throws(() => validateState({ ...state(), schemaVersion: 99 }), /version/i);
});

test('all stored values must be finite, bounded, and real dates', () => {
  for (const eff of [NaN, Infinity, 0, 1001]) assert.throws(() => validateState(state({ vehicle: vehicle({ eff }) })));
  assert.throws(() => validateState(state({ stations: [station({ price: 1000001 })] })));
  assert.throws(() => validateState(state({ log: [entry({ date: '2026-02-30' })] })));
  assert.throws(() => validateState(state({ log: [entry(), entry({ id: 'log-2' })] })), /odometer/i);
  assert.throws(() => validateState(state({ log: [entry(), entry({ id: 'log-2', odometer: 1100, date: '2025-01-01' })] })), /chronolog/i);
});

test('historical fill-ups never change present fuel or station prices', () => {
  const before = state();
  const after = addFillUp(before, entry({ price: .5 }), { today: '2026-02-01' });
  assert.equal(after.vehicle.fuel, before.vehicle.fuel);
  assert.equal(after.stations[0].price, before.stations[0].price);
  assert.equal(after.log.length, 1);
  assert.equal(before.log.length, 0);
});

test('explicit current fill-ups update fuel and price only for today/latest odometer', () => {
  const after = addFillUp(state(), entry({ date: '2026-02-01', price: 1.5 }), { applyCurrent: true, today: '2026-02-01', now: '2026-02-01T12:00:00.000Z' });
  assert.equal(after.vehicle.fuel, 40);
  assert.equal(after.stations[0].price, 1.5);
  assert.equal(after.stations[0].priceUpdatedAt, '2026-02-01T12:00:00.000Z');
  assert.throws(() => addFillUp(state(), entry(), { applyCurrent: true, today: '2026-02-01' }), /today/i);
  assert.throws(() => addFillUp(state({ log: [entry({ id: 'existing', odometer: 2000, date: '2026-02-01' })] }), entry({ date: '2026-02-01' }), { applyCurrent: true, today: '2026-02-01' }), /latest/i);
});

test('over-capacity, future-dated, and duplicate fill-ups are rejected', () => {
  assert.throws(() => addFillUp(state(), entry({ liters: 41 }), { today: '2026-02-01' }), /capacity/i);
  assert.throws(() => addFillUp(state({ vehicle: vehicle({ fuel: 30 }) }), entry({ full: false }), { applyCurrent: true, today: '2026-01-01' }), /capacity/i);
  assert.throws(() => addFillUp(state(), entry({ date: '2026-03-01' }), { today: '2026-02-01' }), /future/i);
  assert.throws(() => addFillUp(state({ log: [entry()] }), entry({ id: 'duplicate' }), { today: '2026-02-01' }), /odometer/i);
});

test('efficiency includes partial purchases and uses weighted recent intervals', () => {
  const records = [entry({ id: 'start', odometer: 1000 }), entry({ id: 'partial', odometer: 1100, liters: 5, full: false }), entry({ id: 'end', odometer: 1200, liters: 5 }), entry({ id: 'end-2', odometer: 1300, liters: 20 })];
  const result = computeEfficiencies(records);
  close(result.effById.end, 20);
  close(result.effById['end-2'], 5);
  close(result.learned, 300 / 30);
  assert.equal(result.samples, 2);
});

test('invalid efficiency intervals are ignored without poisoning later intervals', () => {
  const result = computeEfficiencies([entry({ id: 'start', odometer: 1000 }), entry({ id: 'bad', odometer: 2000, liters: .1 }), entry({ id: 'good', odometer: 2300, liters: 30 })]);
  assert.equal(result.effById.bad, undefined);
  close(result.learned, 10);
  assert.equal(result.ignored, 1);
});

test('eligible results obey fuel conservation and finite cost decomposition', () => {
  for (const fillMode of ['full', 'fixed']) for (const returnTrip of [true, false]) for (const distance of [0, .8, 10, 30, 80, 200]) {
    const v = vehicle({ fillMode, returnTrip, fuel: 20 });
    const r = calculateStation(v, station({ distance }));
    if (!r.eligible) continue;
    assert.ok(r.finalFuel > 0 && r.finalFuel <= v.tank + 1e-9);
    assert.ok(r.arrival >= 0 && r.arrival + r.purchaseLiters <= v.tank + 1e-9);
    close(v.fuel + r.purchaseLiters - r.tripLiters, r.finalFuel);
    close(r.effectiveCost, r.fuelRate + r.tripRate + r.timeRate);
  }
});

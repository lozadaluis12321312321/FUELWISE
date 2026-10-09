import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VEHICLE } from '../core.js';
import { createStore, STATE_KEY, BACKUP_KEY, RECOVERY_KEY } from '../storage.js';

const state = fuel => ({ vehicle: { ...DEFAULT_VEHICLE, fuel }, stations: [], log: [] });
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return { values, writes, get: async key => values.get(key) ?? null, set: async (key, value) => { writes.push(key); values.set(key, value); } };
}

test('startup never writes or silently replaces corrupt/unsupported data', async () => {
  for (const raw of ['{broken', '', JSON.stringify({ ...state(5), schemaVersion: 99 })]) {
    const adapter = memory({ [STATE_KEY]: raw });
    const store = createStore(adapter);
    await assert.rejects(store.load());
    assert.equal(store.getRaw(), raw);
    assert.deepEqual(adapter.writes, []);
  }
});

test('rapid saves remain ordered and preserve the previous valid snapshot', async () => {
  const adapter = memory({ [STATE_KEY]: JSON.stringify(state(5)) });
  const store = createStore(adapter);
  await store.load();
  await Promise.all([store.save(state(6)), store.save(state(7)), store.save(state(8))]);
  assert.equal(JSON.parse(adapter.values.get(STATE_KEY)).vehicle.fuel, 8);
  assert.equal(JSON.parse(adapter.values.get(BACKUP_KEY)).vehicle.fuel, 7);
});

test('invalid writes never reach storage', async () => {
  const adapter = memory();
  const store = createStore(adapter);
  assert.throws(() => store.save(state(100)));
  assert.deepEqual(adapter.writes, []);
});

test('failed writes retain the last known good state and do not poison the queue', async () => {
  const adapter = memory({ [STATE_KEY]: JSON.stringify(state(5)) });
  const original = adapter.set;
  adapter.set = async (key, value) => {
    if (key === STATE_KEY && JSON.parse(value).vehicle.fuel === 6) throw new Error('Storage full');
    return original(key, value);
  };
  const store = createStore(adapter);
  await store.load();
  await assert.rejects(store.save(state(6)), /Storage full/);
  assert.equal(JSON.parse(adapter.values.get(STATE_KEY)).vehicle.fuel, 5);
  await store.save(state(7));
  assert.equal(JSON.parse(adapter.values.get(BACKUP_KEY)).vehicle.fuel, 5);
  assert.equal(JSON.parse(adapter.values.get(STATE_KEY)).vehicle.fuel, 7);
});

test('recovery archives unreadable bytes before replacing primary data', async () => {
  const adapter = memory({ [STATE_KEY]: '{corrupted', [BACKUP_KEY]: JSON.stringify(state(5)) });
  const store = createStore(adapter);
  await assert.rejects(store.load());
  const backup = await store.getBackup();
  await store.restore(backup);
  assert.equal(adapter.values.get(RECOVERY_KEY), '{corrupted');
  assert.equal(JSON.parse(adapter.values.get(STATE_KEY)).vehicle.fuel, 5);
});

test('an unavailable storage read never causes a demo write', async () => {
  const adapter = memory();
  adapter.get = async () => { throw new Error('Unavailable'); };
  await assert.rejects(createStore(adapter).load(), /Unavailable/);
  assert.deepEqual(adapter.writes, []);
});

test('legacy browser fallback is validated and not overwritten during migration', async () => {
  const adapter = memory();
  const store = createStore(adapter, async () => JSON.stringify(state(8)));
  assert.equal((await store.load()).vehicle.fuel, 8);
  assert.deepEqual(adapter.writes, []);
  await store.save(state(9));
  assert.equal(JSON.parse(adapter.values.get(BACKUP_KEY)).vehicle.fuel, 8);
});

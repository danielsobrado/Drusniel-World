import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMiniCampaignFixture,
  createSimulationWorld,
} from '../src/sim/index.js';

function createSimulation() {
  return createSimulationWorld({ campaign: createMiniCampaignFixture() });
}

test('replay into a fresh world reserves replayed command IDs for subsequent commands', () => {
  const source = createSimulation();
  source.initializeSystems();
  const snapshot = source.snapshot();
  const settlementId = [...source.state.settlements.keys()][0];
  const first = source.promotePerson({ settlementId, name: 'First', role: 'merchant' });
  const second = source.promotePerson({ settlementId, name: 'Second', role: 'merchant' });
  const target = createSimulation();
  assert.equal(target.replayFromSnapshot(snapshot, [first.command, second.command]).ok, true);
  const next = target.promotePerson({ settlementId, name: 'Third', role: 'merchant' });
  assert.equal(next.ok, true);
  assert.equal(target.promotePerson({ settlementId, name: 'Fourth', role: 'merchant' }).ok, true);
  const ids = target.getJournal().map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(target.state.characters.get(first.result.characterId).data.name, 'First');
});

test('snapshot-only replay preserves command sequence after rejected commands', () => {
  const source = createSimulation();
  source.initializeSystems();
  const settlementId = [...source.state.settlements.keys()][0];
  source.promotePerson({ settlementId: 'missing', name: 'Rejected', role: 'merchant' });
  const first = source.promotePerson({ settlementId, name: 'First', role: 'merchant' });
  const target = createSimulation();
  assert.equal(target.replayFromSnapshot(source.snapshot(), []).ok, true);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(target.promotePerson({ settlementId, name: `New ${i}`, role: 'merchant' }).ok, true);
  }
  assert.equal(target.state.characters.get(first.result.characterId).data.name, 'First');
});

test('replay replaces live runtime history and derives LOD from the snapshot', () => {
  const simulation = createSimulation();
  assert.equal(simulation.initializeSystems().ok, true);
  const snapshot = simulation.snapshot();
  const settlementId = [...simulation.state.settlements.keys()][0];

  const promoted = simulation.promoteSettlement(settlementId, 'C');
  assert.equal(promoted.ok, true);
  assert.equal(simulation.demoteSettlement(settlementId, 'A').ok, true);
  simulation.ledger.record({ tick: 999, type: 'stale' });
  simulation.reasonLog.push({ code: 'stale_reason' });
  simulation.scheduler.scheduleJob({
    id: 'stale-job',
    type: 'test.stale',
    dueTick: simulation.clock.getTick() + 1,
  });

  const replayed = simulation.replayFromSnapshot(snapshot, [promoted.command]);

  assert.equal(replayed.ok, true);
  assert.deepEqual(simulation.getJournal().map((command) => command.id), [promoted.command.id]);
  assert.deepEqual(simulation.ledger.list(), []);
  assert.deepEqual(
    simulation.reasonLog.map((reason) => reason.code),
    ['sim_tier_promoted'],
  );
  assert.equal(simulation.lod.getTier(settlementId), 'C');
  assert.equal(simulation.state.settlements.get(settlementId).data.simTier, 'C');
  assert.deepEqual(simulation.scheduler.serialize().jobs, []);
});

test('load rejects a clock tick that disagrees with the verified snapshot', async () => {
  const simulation = createSimulation();
  assert.equal(simulation.initializeSystems().ok, true);
  await simulation.save('clock-consistency');

  const stored = await simulation.saveStore.load('clock-consistency');
  stored.payload.clockTick += 1;
  const replacement = await simulation.saveStore.beginSave('clock-consistency', stored.payload);
  await simulation.saveStore.commitSave('clock-consistency', replacement.transactionId);

  const before = {
    checksum: simulation.checksum(),
    tick: simulation.clock.getTick(),
    journal: simulation.getJournal(),
  };

  await assert.rejects(
    simulation.load('clock-consistency'),
    /invalid_save_payload:clockTick_mismatch/,
  );

  assert.equal(simulation.checksum(), before.checksum);
  assert.equal(simulation.clock.getTick(), before.tick);
  assert.deepEqual(simulation.getJournal(), before.journal);
});

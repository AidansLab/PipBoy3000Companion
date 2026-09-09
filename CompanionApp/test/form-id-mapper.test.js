import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormIdMapper, formatGameFormId } from '../src/form-id-mapper.js';

const SAMPLE_LOAD_ORDER = [
  { index: 0, name: 'FalloutNV.esm' },
  { index: 1, name: 'DeadMoney.esm' },
  { index: 2, name: 'HonestHearts.esm' },
  { index: 3, name: 'OldWorldBlues.esm' },
  { index: 4, name: 'LonesomeRoad.esm' },
  { index: 5, name: 'GunRunnersArsenal.esm' },
  { index: 6, name: 'YUP - Base Game and DLC.esm' },
];

describe('FormIdMapper load-order remapping', () => {
  it('uses fixed 0x09 high byte for GRA regardless of load-order index', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(SAMPLE_LOAD_ORDER);

    const pipboyId = mapper.resolve('0x05000A09', 'FNV');

    assert.equal(pipboyId, 0x09000a09);
  });

  it('remaps a GRA item when GRA is early in load order (user case)', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder([
      { index: 0, name: 'FalloutNV.esm' },
      { index: 1, name: 'GunRunnersArsenal.esm' },
    ]);

    const pipboyId = mapper.resolve('0x01000867', 'FNV');

    assert.equal(pipboyId, 0x09000867);
  });

  it('leaves base-game items unchanged when delta is zero', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(SAMPLE_LOAD_ORDER);

    const gameId = '0x00015038';
    const pipboyId = mapper.resolve(gameId, 'FNV');

    assert.equal(pipboyId, 0x00015038);
  });

  it('remaps Pip-Boy GRA IDs back to the runtime game mod index', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(SAMPLE_LOAD_ORDER);

    const gameId = mapper.resolveToGame('0x09000a09', 'FNV');

    assert.equal(gameId, 0x05000a09);
  });

  it('remaps Pip-Boy GRA IDs back when GRA is at mod index 1', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder([
      { index: 0, name: 'FalloutNV.esm' },
      { index: 1, name: 'GunRunnersArsenal.esm' },
    ]);

    const gameId = mapper.resolveToGame('0x09000867', 'FNV');

    assert.equal(gameId, 0x01000867);
  });

  it('ignores plugins that are not present on the Pip-Boy database', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(SAMPLE_LOAD_ORDER);

    const pipboyId = mapper.resolve('0x0600ABCD', 'FNV');

    assert.equal(pipboyId, '0x0600ABCD');
  });

  it('does not treat unchanged load order as a change', () => {
    const mapper = new FormIdMapper();
    assert.equal(mapper.setLoadOrder(SAMPLE_LOAD_ORDER), true);
    assert.equal(mapper.setLoadOrder(SAMPLE_LOAD_ORDER), false);
  });
});

const FO3_SAMPLE_LOAD_ORDER = [
  { index: 0, name: 'Fallout3.esm' },
  { index: 1, name: 'Anchorage.esm' },
  { index: 2, name: 'ThePitt.esm' },
  { index: 3, name: 'BrokenSteel.esm' },
  { index: 4, name: 'PointLookout.esm' },
  { index: 5, name: 'Zeta.esm' },
];

describe('FormIdMapper load-order remapping (FO3)', () => {
  it('uses fixed 0x02 high byte for Broken Steel regardless of load-order index', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(FO3_SAMPLE_LOAD_ORDER);

    // BrokenSteel.esm is at mod index 3 in FO3_SAMPLE_LOAD_ORDER, but its
    // fixed Pip-Boy high byte (verified against FW/1.1.6/DATA/F3/*.DAT) is 0x02.
    const pipboyId = mapper.resolve('0x03001234', 'F3');

    assert.equal(pipboyId, 0x02001234);
  });

  it('remaps a DLC item when its load-order index differs from the fixed byte (e.g. GOTY/mod-manager reorder)', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder([
      { index: 0, name: 'Fallout3.esm' },
      { index: 1, name: 'PointLookout.esm' },
    ]);

    // PointLookout.esm loaded at mod index 1, but the Pip-Boy's fixed byte is 0x03.
    const pipboyId = mapper.resolve('0x01000867', 'F3');

    assert.equal(pipboyId, 0x03000867);
  });

  it('leaves base-game F3 items unchanged when delta is zero', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder(FO3_SAMPLE_LOAD_ORDER);

    const gameId = '0x00015038';
    const pipboyId = mapper.resolve(gameId, 'F3');

    assert.equal(pipboyId, 0x00015038);
  });

  it('remaps Pip-Boy DLC IDs back to the runtime game mod index', () => {
    const mapper = new FormIdMapper();
    mapper.setLoadOrder([
      { index: 0, name: 'Fallout3.esm' },
      { index: 1, name: 'PointLookout.esm' },
    ]);

    const gameId = mapper.resolveToGame('0x03000867', 'F3');

    assert.equal(gameId, 0x01000867);
  });
});

describe('formatGameFormId', () => {
  it('formats numeric form IDs as 0x-prefixed hex for the game pipe', () => {
    assert.equal(formatGameFormId(0x05000a09), '0x05000a09');
    assert.equal(formatGameFormId('0x09000867'), '0x09000867');
  });
});

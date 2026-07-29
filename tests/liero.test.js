'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LieroManager } = require('../liero.js');

function startedGame() {
  const manager = new LieroManager(null, new Map(), null);
  const lobby = manager.createLobby(
    'p1',
    'Alice',
    '#fff',
    { mapType: 'caves', scoreLimit: 10 },
    ['default_dagger'],
    null
  );
  assert.ok(lobby);
  assert.ok(manager.joinLobby('p2', lobby.id, 'Bob', '#000', ['default_dagger'], null));
  assert.equal(manager.startGame(lobby.id, 'p1'), true);
  return lobby.game;
}

test('an expiring explosive shield detonates without crashing the game tick', () => {
  const game = startedGame();
  const owner = game.players.get('p1');
  const target = game.players.get('p2');

  owner.x = 100;
  owner.y = 100;
  target.x = 100;
  target.y = 100;
  owner.blocking = true;
  owner.blockTimer = 1;
  owner.blockExplosionDamage = 10;
  owner.blockExplosionRadius = 20;

  assert.doesNotThrow(() => game.tick());
  assert.equal(owner.blocking, false);
  assert.equal(owner.blockExplosionDamage, 0);
  assert.equal(target.hp, 90);
});

test('poison damage-over-time resolves its attacker without crashing the game tick', () => {
  const game = startedGame();
  const target = game.players.get('p2');
  target.buffs.poison = {
    remaining: 5,
    poisonDamage: 7,
    ownerId: 'p1',
  };

  assert.doesNotThrow(() => game.tick());
  assert.equal(target.hp, 93);
  assert.equal(target.buffs.poison.remaining, 3);
});

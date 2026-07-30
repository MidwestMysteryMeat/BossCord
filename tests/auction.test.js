'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AuctionHouse } = require('../auction.js');

function createListing(house, itemType, itemInfo) {
  return house.createListing(
    'seller-key',
    'Seller',
    '#fff',
    itemType,
    'instance-1',
    itemInfo,
    250
  );
}

test('auction listings preserve unique item and card state', () => {
  const itemHouse = new AuctionHouse();
  const item = createListing(itemHouse, 'item', {
    id: 'sword',
    name: 'Sword',
    rarity: 'rare',
    type: 'weapon',
    modifier: 'flaming',
    modifierInfo: { name: 'Flaming' },
    serial: 42,
  });
  assert.equal(item.itemInfo.modifier, 'flaming');
  assert.deepEqual(item.itemInfo.modifierInfo, { name: 'Flaming' });
  assert.equal(item.itemInfo.serial, 42);

  const cardHouse = new AuctionHouse();
  const card = createListing(cardHouse, 'card', {
    id: 'dragon',
    name: 'Dragon',
    rarity: 'mythic',
    type: 'creature',
    rolledStats: { atk: 17, def: 11, hp: 23 },
    shiny: true,
  });
  assert.deepEqual(card.itemInfo.rolledStats, { atk: 17, def: 11, hp: 23 });
  assert.equal(card.itemInfo.shiny, true);
});

test('viewing an expired listing leaves it for the recovery job', () => {
  const house = new AuctionHouse();
  const listing = createListing(house, 'item', {
    id: 'sword',
    name: 'Sword',
    rarity: 'rare',
    type: 'weapon',
  });
  listing.expiresAt = Date.now() - 1;

  assert.deepEqual(house.getListings(), []);
  assert.equal(house.listings.has(listing.id), true);
  assert.deepEqual(house.cleanupExpired(), [listing]);
  assert.equal(house.listings.has(listing.id), false);
});

test('an expired buy attempt cannot consume the seller asset', () => {
  const house = new AuctionHouse();
  const listing = createListing(house, 'item', {
    id: 'sword',
    name: 'Sword',
    rarity: 'rare',
    type: 'weapon',
  });
  listing.expiresAt = Date.now() - 1;

  assert.equal(house.buyListing(listing.id, 'buyer-key', 1000).error, 'Listing expired');
  assert.equal(house.listings.has(listing.id), true);
  assert.deepEqual(house.cleanupExpired(), [listing]);
});

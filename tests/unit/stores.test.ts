// "Nomeou um lugar pra comprar?" pelo formato do pedido — sem lista de lojas.
import { test } from 'node:test';
import assert from 'node:assert';
import { namedPlace, namesStore } from '../../src/renderer/stores.ts';

test('any store named with at/on/from counts, in any country', () => {
  assert.strictEqual(namedPlace('find a ladder larger than 6 ft tall at home depot.'), 'home depot');
  assert.strictEqual(namedPlace("compare cordless drills at lowe's"), "lowe's");
  assert.strictEqual(namedPlace('cheapest kayak at REI for under $500'), 'REI');
  assert.strictEqual(namedPlace('buy a hammer from Mitre 10'), 'Mitre 10');
  assert.strictEqual(namedPlace('find a usb hub on Allegro'), 'Allegro');
  assert.ok(namesStore('find a desk lamp on ikea.com'));
  assert.ok(namesStore('compare drills on bunnings.com.au'));
});

test('times, days and dates after at/on are not stores', () => {
  for (const t of ['find a restaurant open at noon', 'book a table at 7pm', 'find flights on Monday', 'deals this weekend', 'find a hotel on Dec 12', 'what happened at night'])
    assert.strictEqual(namesStore(t), false, t);
  assert.strictEqual(namesStore('what is the tallest building?'), false);
});

test('a movie/album after "from" is not a store ("all the music videos from the movie top gun")', () => {
  assert.equal(namedPlace('find all the music videos from the movie top gun with tom cruise and download them'), null);
  assert.equal(namedPlace('download every song from the album thriller'), null);
  assert.equal(namedPlace('buy running shoes at nike'), 'nike');   // a real store still counts
});

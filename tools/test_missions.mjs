// Plays through the Old Town quests and jobs with no browser. Run: node tools/test_missions.mjs
import { buildPlan, COMPOUND, LAKE, MAHAKALA, lakeValue } from '../public/bbsr_plan.js';
import { createMissions, spotsFromPlan, ITEMS, isNight, levelOf, xpForLevel } from '../public/bbsr_missions.js';
import assert from 'node:assert/strict';

const plan = buildPlan(null);
const spots = spotsFromPlan(plan, { COMPOUND, LAKE, MAHAKALA });

// 1) every spot and every NPC / stall is reachable: not inside a collider or the lake
const hit = (x, z, r = 0.4) => {
  for (const b of plan.boxes) { const c = Math.cos(b.theta), s = Math.sin(b.theta), dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c; const ex = Math.max(Math.abs(lx) - b.hw, 0), ez = Math.max(Math.abs(lz) - b.hd, 0); if (ex * ex + ez * ez < r * r) return 'box'; }
  for (const c of plan.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return 'circle';
  if (lakeValue(x, z) < 1.02) return 'lake';
  return null;
};
for (const [k, p] of Object.entries(spots)) assert.equal(hit(p.x, p.z), null, 'spot ' + k + ' is blocked');
for (const [k, p] of Object.entries(spots)) assert.ok(Math.abs(p.x) < 480 && Math.abs(p.z) < 480, 'spot ' + k + ' out of bounds');
console.log('spots ok:', Object.entries(spots).map(([k, p]) => `${k}(${p.x.toFixed(0)},${p.z.toFixed(0)})`).join(' '));

let H = 10, mem = null;
const mk = (rng) => createMissions({ plan, spots, load: () => mem, save: (s) => { mem = JSON.parse(JSON.stringify(s)); }, hour: () => H, rng });
let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let g = mk(rng);
const show = (tag, lines) => console.log(tag.padEnd(18), lines.join(' | '));

// 2) quest 1
assert.equal(g.currentQuest().id, 'welcome');
show('talk biswa', g.talk('biswa'));
assert.equal(g.objective().x, spots.lingaraja.x);
g.talk('biswa');                                       // out of order talk does nothing
assert.equal(g.state.quest.welcome.step, 1);
show('lingaraja', g.spot('lingaraja'));
show('bindusagar', g.spot('bindusagar'));
show('talk biswa', g.talk('biswa'));
assert.equal(g.currentQuest().id, 'taste');
assert.equal(g.state.coins, 60 + 40);

// 3) quest 2: eat at four stalls
const c0 = g.state.coins;
for (const k of ['dahibara', 'chhena', 'chai']) show('buy ' + k, g.buy(k));
g.state.coins += 20; g.buy('chai');                   // the same stall again does not count
assert.equal(Object.keys(g.state.tasted).length, 3);
assert.equal(g.currentQuest().id, 'taste');
show('buy rasa', g.buy('rasa'));
assert.equal(g.currentQuest().id, 'offering');
assert.ok(g.state.coins < c0 + 50 + 20 + 1, 'food cost coins');
console.log('coins', g.state.coins, 'xp', g.state.xp, 'level', g.level(), g.levelName());

// 4) quest 3: garland
const ok = (n) => assert.ok(n >= 0);
show('buy flowers', g.buy('flowers'));
assert.equal(g.state.bag.flowers, 1);
show('lingaraja', g.spot('lingaraja'));
assert.equal(g.state.bag.flowers, 0);
assert.equal(g.currentQuest().id, 'lights');

// 5) quest 4 only counts after dark
show('ghat by day', g.spot('bindusagar'));
assert.equal(g.currentQuest().id, 'lights');
assert.match(g.objective().text, /sunset/);
H = 20.5; assert.ok(isNight(H));
show('ghat at night', g.spot('bindusagar'));
assert.equal(g.currentQuest().id, 'temples');

// 6) quest 5
show('mahakala', g.spot('mahakala'));
show('ananta', g.spot('ananta'));
assert.equal(g.currentQuest(), null);
assert.equal(g.objective().kind, 'free');

// 7) jobs: Sibu gives a job, you fetch and deliver; repeatable
for (let i = 0; i < 6; i++) {
  H = i % 2 ? 21 : 11;
  const coins = g.state.coins;
  const t = g.talk('sibu'); assert.ok(g.state.job, 'job given');
  const j = g.state.job;
  show('job ' + (i + 1), t);
  const again = g.talk('sibu'); assert.ok(/Still waiting/.test(again[0]), 'second talk repeats the job');
  assert.equal(g.objective().kind, 'job');
  const b = g.buy(j.key); assert.equal(g.state.job.stage, 'carry'); assert.equal(g.state.coins, coins, 'job item is on the tab');
  const r = j.dest.k === 'npc' ? g.talk(j.dest.id) : g.spot(j.dest.id);
  show('  deliver', r);
  assert.equal(g.state.job, null);
  assert.ok(g.state.coins > coins, 'tip paid');
}
assert.equal(g.state.jobsDone, 6);

// 8) not enough coins
g.state.coins = 5; const poor = g.buy('chhena'); show('too poor', poor); assert.equal(g.state.coins, 5);

// 9) save and load, levels
const g2 = mk(rng); assert.equal(g2.state.jobsDone, 6); assert.equal(g2.currentQuest(), null);
assert.equal(levelOf(0), 1); assert.equal(levelOf(xpForLevel(3)), 3); assert.equal(levelOf(xpForLevel(3) - 1), 2);
console.log('xp', g2.state.xp, 'level', g2.level(), g2.levelName());

// 10) the other areas: discovery XP, zone bonus, no Old Town jobs there, tracker points at the next place
import { buildZonePlan, ZONES } from '../public/bbsr_zones.js';
for (const z of ZONES.filter((q) => q.id !== 'oldtown')) {
  const zp = buildZonePlan(z.id); zp.short = z.short;
  const zs = Object.fromEntries(zp.spots.map((s) => [s.id, { x: s.x, z: s.z, r: s.r }]));
  let mem2 = null;
  const zg = createMissions({ plan: zp, spots: zs, load: () => mem2, save: (s) => { mem2 = JSON.parse(JSON.stringify(s)); }, hour: () => 12, rng });
  let o = zg.objective(); assert.equal(o.x, zp.spots[0].x, z.id + ': tracker points at the first place');
  const xp0 = zg.state.xp, c0 = zg.state.coins;
  let lines = [];
  for (const sp of zp.spots) lines.push(...zg.spot(sp.id));
  assert.ok(zg.state.xp > xp0 + 40, z.id + ': discoveries give XP');
  assert.ok(zg.state.coins >= c0 + 40, z.id + ': exploring everything pays the zone bonus');
  assert.ok(lines.some((l) => /^Explored /.test(l) || /Explored/.test(l)), z.id + ': completion message');
  assert.equal(zg.objective().kind, 'free');
  assert.equal(zg.spot(zp.spots[0].id).length, 0, z.id + ': revisiting says nothing');
  const first = zp.stalls[0].key, b = zg.buy(first); assert.ok(/enjoy|Bought/.test(b[0]), z.id + ': stalls sell');
  console.log('zone', z.id.padEnd(11), zp.spots.length, 'places,', zp.stalls.length, 'stalls, xp', zg.state.xp, 'coins', zg.state.coins);
}
console.log('ALL OK');

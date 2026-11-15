// Missions, jobs, coins and XP for the Old Town. Pure logic: no DOM, no three.js, so it can be tested in Node.
// The client reports what the player does (talk, buy, visit a place) and gets back the lines to show.

export const START_COINS = 60;
export const NIGHT_FROM = 18.2, NIGHT_TO = 5.3;
export const isNight = (h) => h >= NIGHT_FROM || h < NIGHT_TO;

// What each stall sells. `eat` items are eaten on the spot; `carry` items go in the bag.
export const ITEMS = {
  dahibara: { name: 'Dahibara-Aloodum', price: 20, eat: true, xp: 4 },
  chhena: { name: 'Chhena Poda', price: 40, eat: true, xp: 6 },
  chai: { name: 'Cutting chai', price: 10, eat: true, xp: 2 },
  flowers: { name: 'Marigold garland', price: 30, carry: true, xp: 0 },
  rasa: { name: 'Pahala Rasagola', price: 25, eat: true, xp: 5 },
  pan: { name: 'Meetha pan', price: 15, eat: true, xp: 2 },
  sweets: { name: 'Box of sweets', price: 35, eat: true, xp: 5 },
  bangles: { name: 'Glass bangles', price: 60, carry: true, xp: 0 },
};
const FIRST_TASTE_XP = 8;                 // the first time you try each stall

export const LEVELS = ['Visitor', 'Local', 'Regular', 'Bazaar Friend', 'Temple Guide', 'Ekamra Native', 'Son of the Soil'];
export const xpForLevel = (lv) => 40 * (lv - 1) * (lv - 1) + 60 * (lv - 1);   // 0, 100, 280, 540, 880 ...
export function levelOf(xp) { let lv = 1; while (xp >= xpForLevel(lv + 1)) lv++; return lv; }
export const levelName = (lv) => LEVELS[Math.min(LEVELS.length - 1, lv - 1)];

// Places you can visit (positions are filled in from the plan by spotsFromPlan)
export const SPOT_LABELS = {
  lingaraja: 'Lingaraja Temple gate',
  bindusagar: 'Bindusagar ghat',
  mahakala: 'Mahakala-Mahakali Temple',
  ananta: 'Ananta Vasudeva Temple',
};

// Each story quest is a list of steps. A step is finished by the first matching event.
// events: {k:'talk', id}  {k:'spot', id}  {k:'buy', key}  {k:'offer', id}
const QUESTS = [
  {
    id: 'welcome', title: 'Namaskar, Bhubaneswar', reward: { coins: 40, xp: 50 },
    intro: 'Biswa is the local guide. Start with him.',
    steps: [
      { text: 'Talk to Biswa, the guide', target: { npc: 'biswa' }, done: (e) => e.k === 'talk' && e.id === 'biswa' },
      { text: 'Look up at the Lingaraja Temple from its gate', target: { spot: 'lingaraja' }, done: (e) => e.k === 'spot' && e.id === 'lingaraja' },
      { text: 'Walk to Bindusagar and stand on the ghat', target: { spot: 'bindusagar' }, done: (e) => e.k === 'spot' && e.id === 'bindusagar' },
      { text: 'Go back and tell Biswa what you saw', target: { npc: 'biswa' }, done: (e) => e.k === 'talk' && e.id === 'biswa' },
    ],
    end: 'Biswa: Now you have seen the heart of Ekamra Kshetra. Welcome, friend!',
  },
  {
    id: 'taste', title: 'A Taste of the Old Town', reward: { coins: 50, xp: 60 },
    intro: 'Try four different stalls in Tala Bazaar.',
    steps: [{ text: 'Eat something at 4 different stalls in Tala Bazaar', target: { stalls: true }, count: 4, done: (e, s) => (e.k === 'recheck' || (e.k === 'buy' && !!ITEMS[e.key].eat)) && countTasted(s) >= 4 }],
    end: 'You have tasted the Old Town. Mausi would be proud.',
  },
  {
    id: 'offering', title: 'Phula for the Lord', reward: { coins: 70, xp: 70 },
    intro: 'Buy a marigold garland and offer it at the Lingaraja Temple.',
    steps: [
      { text: 'Buy a marigold garland at the Phula stall', target: { stall: 'flowers' }, done: (e, s) => (e.k === 'buy' && e.key === 'flowers') || (e.k === 'recheck' && (s.bag.flowers || 0) > 0) },
      { text: 'Offer the garland at the Lingaraja Temple gate', target: { spot: 'lingaraja' }, done: (e) => e.k === 'offer' && e.id === 'lingaraja' },
    ],
    end: 'The garland rests at the gate, a small offering to Lord Lingaraja.',
  },
  {
    id: 'lights', title: 'Evening Lights', reward: { coins: 80, xp: 90 },
    intro: 'Bindusagar is loveliest after dark.',
    steps: [
      { text: 'Stand on the Bindusagar ghat after sunset (6 PM to 5 AM)', target: { spot: 'bindusagar' }, night: true, done: (e, s, h) => e.k === 'spot' && e.id === 'bindusagar' && isNight(h) },
    ],
    end: 'The temple lamps shimmer on the black water of the tank. Worth waiting for.',
  },
  {
    id: 'temples', title: 'City of Temples', reward: { coins: 100, xp: 120 },
    intro: 'Visit the other old temples around the tank.',
    steps: [
      { text: 'Visit the Mahakala-Mahakali Temple', target: { spot: 'mahakala' }, done: (e) => e.k === 'spot' && e.id === 'mahakala' },
      { text: 'Visit the Ananta Vasudeva Temple', target: { spot: 'ananta' }, done: (e) => e.k === 'spot' && e.id === 'ananta' },
    ],
    end: 'Bhubaneswar once had seven thousand temples. You have seen a few of the survivors.',
  },
];
export const QUEST_LIST = QUESTS;
const countTasted = (s) => Object.keys(s.tasted).length;

// Delivery jobs from Sibu (repeatable). He covers the cost; you earn a tip.
const DESTS = [
  { k: 'npc', id: 'biswa', name: 'Biswa the guide' },
  { k: 'npc', id: 'mausi', name: 'Mausi at the dahibara stall' },
  { k: 'spot', id: 'lingaraja', name: 'the Lingaraja Temple gate' },
  { k: 'spot', id: 'bindusagar', name: 'the Bindusagar ghat' },
  { k: 'spot', id: 'mahakala', name: 'the Mahakala-Mahakali Temple' },
];

export function spotsFromPlan(plan, geom) {
  const { COMPOUND, LAKE, MAHAKALA } = geom;
  const av = plan.temples.find((t) => t.id === 'ananta');
  return {
    lingaraja: { x: COMPOUND.cx + COMPOUND.hw + 11, z: COMPOUND.cz, r: 6 },
    bindusagar: { x: LAKE.cx, z: LAKE.cz + LAKE.b + 8, r: 9 },
    mahakala: { x: MAHAKALA.x, z: MAHAKALA.z + 8, r: 5 },
    ananta: { x: av.x - 9, z: av.z, r: 5 },
  };
}

const fresh = () => ({
  coins: START_COINS, xp: 0, tasted: {}, bag: {}, spotsSeen: {},
  quest: {}, // id -> { step, done }
  job: null, jobsDone: 0, lastJobDest: null, seq: 0, zoneDone: {},
});

export function createMissions({ plan, spots, load, save, hour, rng = Math.random }) {
  let s = fresh();
  try { const o = load && load(); if (o && typeof o === 'object') s = Object.assign(fresh(), o); } catch (e) { /* start fresh */ }
  for (const q of QUESTS) if (!s.quest[q.id]) s.quest[q.id] = { step: 0, done: false };
  const oldtown = !plan.zone || plan.zone === 'oldtown';        // quests and Sibu's jobs belong to the Old Town; the other areas have places to discover
  const meta = (id) => (plan.spotInfo && plan.spotInfo[id]) || { label: SPOT_LABELS[id], text: SPOT_TEXT[id], xp: 0 };
  const stalls = new Map(plan.stalls.map((t) => [t.key, t]));
  const npcs = new Map(plan.npcs.map((n) => [n.id, n]));
  const out = [];                 // lines produced by the current call
  const say = (t) => out.push(t);
  const persist = () => { try { save && save(s); } catch (e) { /* ignore */ } };
  const level = () => levelOf(s.xp);

  function give(coins, xp, why) {
    const before = level();
    s.coins += coins; s.xp += xp;
    say(`${why ? why + ': ' : ''}${coins ? '+' + coins + ' coins' : ''}${coins && xp ? ', ' : ''}${xp ? '+' + xp + ' XP' : ''}`);
    if (level() > before) say(`Level up! You are now ${levelName(level())} (level ${level()}).`);
  }

  // ---- story quests ----
  function currentQuest() { return QUESTS.find((q) => !s.quest[q.id].done) || null; }
  function advance(ev) {
    const h = hour();
    for (const q of QUESTS) {
      const st = s.quest[q.id];
      if (st.done) continue;
      // quests are taken in order, but a later one that you happen to satisfy still counts once it is the current one
      if (q !== currentQuest()) continue;
      let guard = 0;
      while (!st.done && guard++ < 6) {
        const step = q.steps[st.step];
        if (!step.done(ev, s, h)) break;
        st.step++;
        if (st.step >= q.steps.length) {
          st.done = true;
          give(q.reward.coins, q.reward.xp, 'Quest complete: ' + q.title);
          say(q.end);
          const n = currentQuest();
          if (n) { say(`New quest: ${n.title}. ${n.intro}`); advance({ k: 'recheck' }); }
          else say('You have finished every quest in Chapter 1. More of Bhubaneswar is coming.');
        } else say('Next: ' + q.steps[st.step].text);
        break;   // one step per event
      }
    }
  }

  // ---- delivery jobs ----
  function newJob() {
    const keys = Object.keys(ITEMS);
    let dest, key, tries = 0;
    do { dest = DESTS[Math.floor(rng() * DESTS.length)]; key = keys[Math.floor(rng() * keys.length)]; tries++; }
    while (tries < 10 && (dest.id === s.lastJobDest || (dest.k === 'npc' && dest.id === 'mausi' && key === 'dahibara')));
    const from = stalls.get(key), to = dest.k === 'npc' ? npcs.get(dest.id) : spots[dest.id];
    const dist = Math.hypot(from.x - to.x, from.z - to.z);
    const tip = Math.round((12 + dist / 12) / 5) * 5;
    s.seq++;
    s.job = { key, dest: { k: dest.k, id: dest.id, name: dest.name }, tip, stage: 'buy', xp: 15 + Math.round(dist / 40) };
    return s.job;
  }

  // ---- what the client calls ----
  function begin() { out.length = 0; return out; }
  const done = () => { persist(); return out.slice(); };

  return {
    state: s,
    level, levelName: () => levelName(level()),
    nextLevelXp: () => xpForLevel(level() + 1),
    thisLevelXp: () => xpForLevel(level()),
    currentQuest,
    quests: () => QUESTS.map((q) => ({ ...q, st: s.quest[q.id] })),
    reset() { s = fresh(); for (const q of QUESTS) s.quest[q.id] = { step: 0, done: false }; this.state = s; persist(); },

    // Buy at a stall. Returns lines to show.
    buy(key) {
      begin();
      const it = ITEMS[key], stall = stalls.get(key);
      if (!it || !stall) return done();
      const jobHere = oldtown && s.job && s.job.stage === 'buy' && s.job.key === key;
      if (jobHere) {
        s.job.stage = 'carry'; s.bag.job = key;
        say(`Sibu's tab: you pick up ${it.name} for ${s.job.dest.name}. Take it there before it gets cold.`);
        return done();
      }
      if (s.coins < it.price) { say(`${it.name} costs ${it.price} coins. You have ${s.coins}. Sibu has delivery jobs if you need money.`); return done(); }
      s.coins -= it.price;
      if (it.carry) {
        s.bag[key] = (s.bag[key] || 0) + 1;
        say(`Bought ${it.name} for ${it.price} coins.`);
      } else {
        const first = !s.tasted[key]; s.tasted[key] = 1;
        const xp = it.xp + (first ? FIRST_TASTE_XP : 0), before = level();
        s.xp += xp;
        say(`You enjoy the ${it.name} (-${it.price} coins, +${xp} XP${first ? ', first time here' : ''}).`);
        if (level() > before) say(`Level up! You are now ${levelName(level())} (level ${level()}).`);
      }
      advance({ k: 'buy', key });
      return done();
    },

    // Arrive at a place of interest (the client calls this once per visit, when you walk into its circle)
    spot(id) {
      begin();
      const first = !s.spotsSeen[id], m = meta(id);
      s.spotsSeen[id] = 1;
      if (first) {
        say(oldtown ? `You reach the ${m.label}.` : `Discovered: ${m.label}.`);
        if (m.text) say(m.text);
        if (!oldtown && m.xp) give(0, m.xp, 'Discovery');
        if (!oldtown && plan.spots.every((sp) => s.spotsSeen[sp.id]) && !s.zoneDone[plan.zone]) {
          s.zoneDone[plan.zone] = 1;
          give(40, 60, 'Explored ' + plan.name);
          say('Find the auto stand to visit another part of Bhubaneswar.');
        }
      }
      if (oldtown && id === 'lingaraja' && (s.bag.flowers || 0) > 0) {
        const inOffering = currentQuest() && currentQuest().id === 'offering';
        s.bag.flowers--;
        say('You lay the marigold garland at the gate with folded hands.');
        if (!inOffering) give(0, 10, 'Blessing');
        advance({ k: 'offer', id });
      }
      if (oldtown) deliver('spot', id);
      advance({ k: 'spot', id });
      return done();
    },

    // Talk to an NPC. Returns lines to show IN ADDITION to the normal chat lines (or null if none).
    talk(id) {
      begin();
      const extra = [];
      if (id === 'sibu') {
        if (!s.job) {
          const j = newJob();
          const from = ITEMS[j.key].name;
          say(`Sibu: Oye, a job for you! Get ${from} from the ${stalls.get(j.key).label} stall and take it to ${j.dest.name}. I'll put it on my tab. ${j.tip} coins tip for you.`);
        } else if (s.job.stage === 'buy') say(`Sibu: Still waiting. ${ITEMS[s.job.key].name} from the ${stalls.get(s.job.key).label} stall, then to ${s.job.dest.name}.`);
        else say(`Sibu: Go go, ${ITEMS[s.job.key].name} is for ${s.job.dest.name}.`);
      }
      deliver('npc', id);
      advance({ k: 'talk', id });
      return done();
    },

    objective() { return objective(); },
    discovered: () => Object.keys(s.spotsSeen).length,
    tick() { return null; },
  };

  function deliver(kind, id) {
    const j = s.job;
    if (!j || j.stage !== 'carry' || j.dest.k !== kind || j.dest.id !== id) return;
    const night = isNight(hour()), bonus = night ? Math.round(j.tip * 0.5 / 5) * 5 : 0;
    delete s.bag.job; s.job = null; s.jobsDone++; s.lastJobDest = id;
    say(`Delivered ${ITEMS[j.key].name} to ${j.dest.name}.`);
    give(j.tip + bonus, j.xp, 'Job done' + (night ? ' (night bonus)' : ''));
    say('Talk to Sibu for another job.');
  }

  function objective() {
    const j = s.job;
    const loc = (t) => {
      if (t.npc) { const n = npcs.get(t.npc); return n && { x: n.x, z: n.z }; }
      if (t.spot) return spots[t.spot];
      if (t.stall) { const st = stalls.get(t.stall); return st && { x: st.x, z: st.z }; }
      return null;
    };
    if (!oldtown) {
      if (j) return { kind: 'job', title: 'Delivery for Sibu', text: 'Your delivery is waiting in the Old Town. Take an auto back there.' };
      const next = plan.spots.find((sp) => !s.spotsSeen[sp.id]);
      const left = plan.spots.filter((sp) => !s.spotsSeen[sp.id]).length;
      if (next) return { kind: 'quest', title: 'Explore ' + (plan.short || plan.name), text: `Discover: ${next.label} (${plan.spots.length - left}/${plan.spots.length})`, x: next.x, z: next.z };
      return { kind: 'free', title: 'Explored ' + (plan.short || plan.name), text: 'Find the auto stand to visit another part of Bhubaneswar', x: plan.travel && plan.travel.x, z: plan.travel && plan.travel.z };
    }
    if (j) {
      if (j.stage === 'buy') { const st = stalls.get(j.key); return { kind: 'job', title: 'Delivery for Sibu', text: `Get ${ITEMS[j.key].name} at the ${st.label} stall`, x: st.x, z: st.z }; }
      const d = j.dest.k === 'npc' ? npcs.get(j.dest.id) : spots[j.dest.id];
      return { kind: 'job', title: 'Delivery for Sibu', text: `Take the ${ITEMS[j.key].name} to ${j.dest.name}`, x: d.x, z: d.z };
    }
    const q = currentQuest();
    if (!q) { const sb = npcs.get('sibu'); return { kind: 'free', title: 'All quests done', text: 'Talk to Sibu at the chai adda for delivery jobs', x: sb.x, z: sb.z }; }
    const st = s.quest[q.id], step = q.steps[st.step];
    let p = loc(step.target);
    if (step.target.stalls) { p = null; }       // "any stall": no single marker
    let text = step.text;
    if (step.count) text += ` (${Math.min(step.count, countTasted(s))}/${step.count})`;
    if (step.night && !isNight(hour())) text = 'Wait for sunset (6 PM), then stand on the Bindusagar ghat';
    return { kind: 'quest', title: q.title, text, x: p ? p.x : undefined, z: p ? p.z : undefined, night: !!step.night };
  }
}

const SPOT_TEXT = {
  lingaraja: 'The Lingaraja tower rises about 55 metres. Built in the 11th century, it is the largest temple of Bhubaneswar.',
  bindusagar: 'Bindusagar, the sacred tank. Legend says it holds a drop of water from every holy river.',
  mahakala: 'The Mahakala-Mahakali Temple, a small old shrine just off the bazaar road.',
  ananta: 'The Ananta Vasudeva Temple, a Vaishnava temple on the eastern bank of the tank.',
};

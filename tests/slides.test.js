// Plays every slide's scripted scenario headlessly and checks it shows what it should.
// Usage: node tests/slides.test.js   (needs the playwright package; NODE_PATH=$(npm root -g) works for a global install)
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../site/index.html');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL);
  await p.waitForTimeout(300);
  // gaps[k] = simulated ms to run after revealing fragment k
  const run = (i, gaps) => p.evaluate(([i, gaps]) => {
    deck.paused = true; deck.enter(i);
    for (const g of gaps) { deck.next(); deck.sim.advance(g); }
    const s = deck.sim, l = s.leader();
    return {
      leader: l ? l.id + 1 : null, leaders: s.leaders().map(x => x.id + 1), terms: s.servers.map(x => x.term),
      logs: s.servers.map(x => x.log.map(e => Raft.fmtCmd(e.cmd) + '/t' + e.term).join(' ')),
      commit: s.servers.map(x => x.commitIndex),
      agree: s.statesAgree(), consistent: s.consistent(),
      violations: s.violations.length, lost: s.acked.filter(a => a.lost).length, acked: s.acked.length,
      rejects: s.events.filter(e => /rejected prevIndex/.test(e.text)).length,
    };
  }, [i, gaps]);

  const results = [];
  const check = (name, cond, r) => { results.push([cond ? 'PASS' : 'FAIL', name]); if (!cond) console.log('  detail', name, JSON.stringify(r)); };
  let r;
  r = await run(1, [0, 8000, 0, 0]); check('1 goal: states agree', r.agree && r.logs[0].split(' ').length === 3, r);
  r = await run(2, [6000, 0, 0, 0]); check('2 multi-writer: states diverge', !r.agree, r);
  r = await run(3, [0, 0, 0, 0]); check('3 majority slide runs', true, r);
  r = await run(4, [0, 0, 0, 40000]); check('4 fixed timeouts: no leader, terms climb', r.leader === null && Math.min(...r.terms) >= 5, r);
  r = await run(5, [10000]); check('5 random timeouts: leader elected', r.leader !== null, r);
  const first = r.leader;
  r = await p.evaluate(() => { deck.next(); deck.next(); deck.next(); deck.sim.advance(12000); const l = deck.sim.leader(); return { leader: l && l.id + 1, term: l && l.term }; });
  check('5 crash leader: new leader in higher term', r.leader && r.leader !== first && r.term > 1, r);
  r = await run(6, [8000, 0, 0, 0]); check('6 fire-and-forget: logs/state diverge', !r.agree && new Set(r.logs).size > 1, r);
  r = await run(7, [14000, 0, 0, 0]); check('7 acks+retry: logs converge', r.agree && new Set(r.logs).size === 1, r);
  r = await run(8, [0, 3000, 7000, 3000, 6000]); check('8 apply early: acknowledged write lost', r.lost >= 1, r);
  r = await run(9, [0, 3000, 9000, 6000]); check('9 commit: no acknowledged write lost', r.lost === 0 && r.acked >= 1 && r.consistent, r);
  r = await run(10, [0, 0, 1000, 5000, 6000]); check('10 catch-up: S4 caught up via backoff', r.logs[3] === r.logs[0] && r.rejects >= 3 && r.agree, r);
  r = await run(11, [0, 3000, 0, 6000]); check('11 no restriction: committed entry overwritten', r.violations > 0 && r.lost > 0, r);
  r = await run(12, [0, 3000, 8000, 10000, 0]); check('12 restriction: no committed loss', r.violations === 0 && r.lost === 0 && r.leader && ![4,5].includes(r.leader) && r.consistent, r);
  r = await run(13, [500, 2000, 9000, 8000]); check('13 partition: old leader steps down, one leader, no loss', r.leaders.length === 1 && r.lost === 0 && new Set(r.logs).size === 1, r);
  r = await run(14, [0, 8000, 3000, 8000]); check('14 fig8 without rule: committed entry overwritten', r.violations > 0, r);
  r = await run(15, [0, 8000, 5000, 15000]); check('15 fig8 with rule: safe', r.violations === 0 && r.leader !== 5 && r.consistent, r);

  // determinism: same slide twice gives same logs
  const a = await run(13, [500, 2000, 9000, 8000]), c = await run(13, [500, 2000, 9000, 8000]);
  check('seeded replay is identical', JSON.stringify(a) === JSON.stringify(c), [a, c]);

  for (const x of results) console.log(x.join('  '));
  console.log('errors', errs);
  if (errs.length || results.some(x => x[0] === 'FAIL')) process.exitCode = 1;
  await b.close();
})();

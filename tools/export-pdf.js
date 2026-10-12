// Exports the presentation to export/slides.pdf (one 16:9 page per slide) for the
// Canvas upload. Each slide is shown fully revealed; demo slides are played
// forward to the state the audience sees at the end of the slide.
//
// Usage: node tools/export-pdf.js   (needs the playwright package; NODE_PATH=$(npm root -g) works for a global install)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'export');
const W = 1920, H = 1080;

// Simulated ms to run after revealing each fragment, per demo slide (by title).
// Mirrors tests/slides.test.js so the snapshot shows each demo's outcome.
const GAPS = {
  'A replicated, deterministic log': [0, 6000, 0, 0],
  'Everyone accepts writes': [5000, 0, 0, 0],
  'Electing a leader, naively': [0, 0, 0, 12000],
  'Randomized election timeouts': [9000, 0, 0, 12000],
  'Replicating the log, fire-and-forget': [7000, 0, 0, 0],
  'Say where it goes, acknowledge, retry': [12000, 0, 0, 0],
  'Applying too early': [0, 3000, 9000, 3500, 6000],
  'Commit before you apply': [0, 3000, 9000, 6000],
  'Catching up a returning server': [0, 0, 1000, 5000, 6000],
  'The wrong server wins': [0, 3000, 0, 6000],
  'Vote only for up-to-date logs': [0, 3000, 8000, 10000, 0],
  'Two leaders? Network partitions': [500, 2000, 9000, 8000],
  'The subtle one (Figure 8)': [0, 8000, 3000, 8000],
  'Only count replicas for the current term': [0, 8000, 5000, 15000],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto('file://' + path.join(ROOT, 'site/index.html'));
  const titles = await page.evaluate(() => TALK.SLIDES.map(s => s.title));

  const shots = [];
  for (let i = 0; i < titles.length; i++) {
    const gaps = GAPS[titles[i]] || [];
    await page.evaluate(([i, gaps]) => {
      deck.paused = true;
      deck.enter(i);
      const n = (TALK.SLIDES[i].frags || []).length;
      for (let k = 0; k < n; k++) { deck.next(); if (deck.sim) deck.sim.advance(gaps[k] || 0); }
      document.body.classList.add("export");
    }, [i, gaps]);
    // let bullet transitions and the panel refresh finish; the sandbox iframe needs longer
    await page.waitForTimeout(titles[i] === 'Sandbox' ? 1500 : 600);
    const file = path.join(OUT, `slide-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    console.log('slide', i, titles[i]);
  }

  const html = `<!doctype html><html><head><style>
    @page { size: ${W}px ${H}px; margin: 0; }
    body { margin: 0; } img { display: block; width: ${W}px; height: ${H}px; page-break-after: always; }
  </style></head><body>${shots.map(f => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('')}</body></html>`;
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(html, { waitUntil: 'load' });
  await pdfPage.pdf({ path: path.join(OUT, 'slides.pdf'), width: `${W}px`, height: `${H}px`, printBackground: true });
  for (const f of shots) fs.unlinkSync(f);
  await browser.close();
  console.log('wrote', path.join(OUT, 'slides.pdf'));
})();

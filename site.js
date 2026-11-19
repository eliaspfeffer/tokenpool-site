const $ = id => document.getElementById(id);
const local = document.documentElement.hasAttribute('data-local-book');
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const price = cents => `$${(cents / 100).toFixed(2)}`;
const command = $('command').textContent;
const defaultStatus = $('copy-status').textContent;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let resetCopy;
let loaded = false;

$('copy').disabled = false;
$('copy').addEventListener('click', async () => {
  clearTimeout(resetCopy);
  try {
    await navigator.clipboard.writeText(command);
    $('copy').setAttribute('data-copied', '');
    $('copy-label').textContent = 'Copied';
    $('copy-status').textContent = 'Copied. Paste into your terminal.';
  } catch {
    window.getSelection().selectAllChildren($('command'));
    $('copy-status').textContent = 'Command selected. Copy it with your keyboard.';
  }
  resetCopy = setTimeout(() => {
    $('copy').removeAttribute('data-copied');
    $('copy-label').textContent = 'Copy';
    $('copy-status').textContent = defaultStatus;
  }, 3500);
});

function duration(minutes) {
  if (minutes <= 0) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function drawRows(side, levels, asOf, max) {
  const body = $(side);
  if (!levels.length) {
    if (!body.querySelector('.empty') || !loaded) {
      const row = document.createElement('tr');
      const cell = row.insertCell();
      cell.colSpan = 3;
      cell.className = 'empty';
      cell.textContent = side === 'bids' ? 'No open buy orders' : 'No open sell orders';
      body.replaceChildren(row);
    }
    return;
  }

  const remaining = new Set();
  let cursor = body.firstElementChild;
  for (const level of levels) {
    let row = body.querySelector(`tr[data-level="${level.price}"]`);
    const fresh = !row;
    if (fresh) {
      row = document.createElement('tr');
      row.dataset.level = level.price;
      row.insertCell();
      const quantity = row.insertCell();
      quantity.className = 'depth';
      quantity.appendChild(document.createTextNode(''));
      const bar = quantity.appendChild(document.createElement('span'));
      bar.setAttribute('aria-hidden', 'true');
      row.insertCell();
    }
    const minutes = level.demoMinutes ?? Math.floor((level.expiresAt - asOf) / 60_000);
    row.cells[0].textContent = price(level.price);
    row.cells[1].firstChild.textContent = number.format(level.tokens);
    const quantity = level.tokens.toLocaleString('en');
    const changed = row.cells[1].title !== quantity;
    row.cells[1].title = quantity;
    row.cells[1].lastChild.style.setProperty('--depth-share', level.tokens / max);
    row.cells[2].textContent = duration(minutes);
    if (row !== cursor) body.insertBefore(row, cursor);
    if (loaded && changed && !reducedMotion.matches) {
      row.animate([{ backgroundColor: 'var(--depth)' }, { backgroundColor: 'transparent' }], 650);
    }
    cursor = row.nextElementSibling;
    remaining.add(row);
  }
  for (const row of [...body.rows]) if (!remaining.has(row)) row.remove();
}

const models = {
  openai: { codex: 'Codex default' },
  anthropic: { sonnet: 'Claude Sonnet', opus: 'Claude Opus' },
  xai: { grok: 'Grok 4.7' }
};
let samples;
let revision = 0;
let poll;
let sampleStep = 0;
let playing = !reducedMotion.matches;

// Replay one change at a time against the original sample quantities.
function sampleBook(book) {
  const frame = structuredClone(book);
  if (frame.asks.length && (sampleStep === 1 || sampleStep === 2)) frame.asks[0].tokens += 60000;
  if (frame.bids.length && sampleStep >= 2) frame.bids[0].tokens += 40000;
  return frame;
}

function scheduleSample() {
  if (playing) poll = setTimeout(() => {
    sampleStep = (sampleStep + 1) % 4;
    updateBook();
  }, 2400);
}

async function updateBook() {
  clearTimeout(poll);
  const current = ++revision;
  const model = $('model').value;
  const live = local && model === 'codex';
  $('sample-play').hidden = live;
  $('sample-play').textContent = playing ? 'Pause sample' : 'Play sample';
  $('books').setAttribute('aria-busy', 'true');
  try {
    let book;
    if (live || !samples) {
      const response = await fetch(live ? '/api/book' : './sample.json?v=0.2.1', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (current !== revision) return;
      if (live) book = data;
      else samples = data;
    }
    if (!live) book = sampleBook(samples[model]);
    const max = Math.max(1, ...[...book.bids, ...book.asks].map(level => level.tokens));
    drawRows('bids', book.bids, book.asOf, max);
    drawRows('asks', [...book.asks].reverse(), book.asOf, max);
    const ask = book.asks[0]?.price;
    const bid = book.bids[0]?.price;
    const quote = book.lastTrade?.price ?? ask ?? bid;
    $('quote').textContent = quote === undefined ? '—' : price(quote);
    $('quote-label').textContent = !live ? 'Last sample trade'
      : book.lastTrade ? 'Last simulated trade' : ask ? 'Best ask' : bid ? 'Best bid' : 'Waiting for orders';
    $('book-label').textContent = live ? 'Local simulated orders' : 'Illustrative orders';
    $('market').dataset.state = live ? 'live' : 'example';
    const status = live
      ? `Updated ${new Date(book.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : `${models[$('provider').value][model]} · Sample data`;
    if ($('market-status').textContent !== status) $('market-status').textContent = status;
    loaded = true;
  } catch {
    if (current !== revision) return;
    $('market').dataset.state = 'offline';
    const status = live ? 'Updates paused · Reconnecting' : 'Sample book unavailable';
    $('book-label').textContent = loaded ? 'Showing last known orders' : 'Order book unavailable';
    if (!loaded) {
      $('quote-label').textContent = 'Price unavailable';
      for (const side of ['bids', 'asks']) {
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'empty';
        cell.textContent = 'Waiting for market data';
        const row = document.createElement('tr');
        row.appendChild(cell);
        $(side).replaceChildren(row);
      }
    }
  } finally {
    if (current === revision) {
      $('books').setAttribute('aria-busy', 'false');
      if (live) poll = setTimeout(updateBook, 2500);
      else if ($('market').dataset.state === 'example') scheduleSample();
    }
  }
}
function setPlaying(value) {
  playing = value;
  if ($('sample-play').hidden) return;
  clearTimeout(poll);
  $('sample-play').textContent = playing ? 'Pause sample' : 'Play sample';
  if (loaded) scheduleSample();
}
$('sample-play').addEventListener('click', () => setPlaying(!playing));

function changeBook() {
  sampleStep = 0;
  loaded = false;
  $('quote').textContent = '—';
  $('quote-label').textContent = 'Loading price';
  $('book-label').textContent = 'Loading orders…';
  $('market-status').textContent = 'Loading orders…';
  for (const side of ['asks', 'bids']) $(side).replaceChildren();
  updateBook();
}

$('provider').addEventListener('change', () => {
  const choices = Object.entries(models[$('provider').value]);
  $('model').replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
  changeBook();
});
$('model').addEventListener('change', changeBook);
updateBook();

const videos = document.querySelectorAll('video');
for (const video of videos) {
  if (!reducedMotion.matches) video.play().catch(() => {});
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    setPlaying(false);
    for (const video of videos) video.pause();
  }
});

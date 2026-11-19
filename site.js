const $ = id => document.getElementById(id);
const local = document.documentElement.hasAttribute('data-local-book');
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const price = cents => `$${(cents / 100).toFixed(2)}`;
const command = $('command').textContent;
const defaultStatus = $('copy-status').textContent;
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
      if (loaded) row.dataset.new = '';
    }
    const minutes = level.demoMinutes ?? Math.floor((level.expiresAt - asOf) / 60_000);
    row.cells[0].textContent = price(level.price);
    row.cells[1].firstChild.textContent = number.format(level.tokens);
    row.cells[1].title = level.tokens.toLocaleString('en');
    row.cells[1].lastChild.style.setProperty('--depth-share', level.tokens / max);
    row.cells[2].textContent = duration(minutes);
    if (row !== cursor) body.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
    remaining.add(row);
  }
  for (const row of [...body.rows]) if (!remaining.has(row)) row.remove();
}

const models = {
  openai: { codex: 'Codex default' },
  anthropic: { sonnet: 'Claude Sonnet', opus: 'Claude Opus' }
};
let samples;
let revision = 0;
let poll;

async function updateBook() {
  clearTimeout(poll);
  const current = ++revision;
  const model = $('model').value;
  const live = local && model === 'codex';
  $('books').setAttribute('aria-busy', 'true');
  try {
    let book;
    if (live || !samples) {
      const response = await fetch(live ? '/api/book' : './sample.json', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (current !== revision) return;
      if (live) book = data;
      else samples = data;
    }
    if (!live) book = samples[model];
    const max = Math.max(1, ...[...book.bids, ...book.asks].map(level => level.tokens));
    drawRows('bids', book.bids, book.asOf, max);
    drawRows('asks', book.asks, book.asOf, max);
    const ask = book.asks[0]?.price;
    const bid = book.bids[0]?.price;
    const quote = book.lastTrade?.price ?? ask ?? bid;
    $('quote').textContent = quote === undefined ? '—' : price(quote);
    $('quote-label').textContent = !live ? 'Last sample trade'
      : book.lastTrade ? 'Last simulated trade' : ask ? 'Best ask' : bid ? 'Best bid' : 'Waiting for orders';
    $('book-label').textContent = live ? 'Local simulated orders' : 'Illustrative orders';
    $('market').dataset.state = live ? 'live' : 'example';
    $('market-status').textContent = live
      ? `Updated ${new Date(book.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : `${models[$('provider').value][model]} · Sample data`;
    loaded = true;
  } catch {
    if (current !== revision) return;
    $('market').dataset.state = 'offline';
    $('market-status').textContent = live ? 'Updates paused · Reconnecting' : 'Sample book unavailable';
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
    }
  }
}
function changeBook() {
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

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const videos = document.querySelectorAll('video');
for (const video of videos) {
  if (!reducedMotion.matches) video.play().catch(() => {});
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) for (const video of videos) video.pause();
});

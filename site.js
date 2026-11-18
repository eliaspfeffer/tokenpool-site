const $ = id => document.getElementById(id);
const local = location.protocol === 'http:' && location.hostname === '127.0.0.1';
const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const price = cents => `$${(cents / 100).toFixed(2)}`;
const command = $('command').textContent;
const defaultStatus = $('copy-status').textContent;
let resetCopy;
let loaded = false;

document.documentElement.dataset.market = local ? 'local' : 'example';
$('book-label').textContent = local ? 'Live Codex simulation' : 'Illustrative Codex market';
$('copy-status').textContent = defaultStatus;
$('command').textContent = command;
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

async function updateBook() {
  try {
    const response = await fetch(local ? '/api/book' : './sample.json', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error();
    const book = await response.json();
    const max = Math.max(1, ...[...book.bids, ...book.asks].map(level => level.tokens));
    drawRows('bids', book.bids, book.asOf, max);
    drawRows('asks', book.asks, book.asOf, max);
    const ask = book.asks[0]?.price;
    const bid = book.bids[0]?.price;
    const quote = book.lastTrade?.price ?? ask ?? bid;
    $('quote').textContent = quote === undefined ? '—' : price(quote);
    $('quote-label').textContent = !local ? 'Last sample trade'
      : book.lastTrade ? 'Last sandbox trade' : ask ? 'Best ask' : bid ? 'Best bid' : 'Waiting for orders';
    $('book-label').textContent = local ? 'Live Codex simulation' : 'Illustrative Codex market';
    $('market').dataset.state = local ? 'live' : 'example';
    $('market-status').textContent = local
      ? `Updated ${new Date(book.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'Sample market data';
    loaded = true;
  } catch {
    $('market').dataset.state = 'offline';
    $('market-status').textContent = local ? 'Updates paused · Reconnecting' : 'Sample book unavailable';
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
    $('books').setAttribute('aria-busy', 'false');
    if (local) setTimeout(updateBook, 2500);
  }
}
updateBook();

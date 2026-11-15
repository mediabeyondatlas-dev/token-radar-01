// Radar dashboard: reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a per-protocol detail view with the model's
// own arithmetic, and the comps the values are calibrated against.
// No network: every byte shown is in data.js. Deep links: ?slug=, ?cat=,
// ?chain=, ?q=, ?sort=.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    sort: params.get('sort') || 'implied',
    slug: params.get('slug') || null,
  };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageFmt(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function text(tag, cls, str) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (str !== undefined && str !== null) node.textContent = str;
    return node;
  }

  function chip(str) {
    return text('span', 'tag', str);
  }

  function syncUrl() {
    var next = new URLSearchParams();
    if (state.q) next.set('q', state.q);
    if (state.cat !== 'all') next.set('cat', state.cat);
    if (state.chain !== 'all') next.set('chain', state.chain);
    if (state.sort !== 'implied') next.set('sort', state.sort);
    if (state.slug) next.set('slug', state.slug);
    var qs = next.toString();
    window.history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl - a.tvl;
      if (key === 'growth') return (b.change7d === null ? -Infinity : b.change7d) - (a.change7d === null ? -Infinity : a.change7d);
      if (key === 'age') return (b.ageDays === null ? -1 : b.ageDays) - (a.ageDays === null ? -1 : a.ageDays);
      if (key === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  function renderStats() {
    var box = $('stats');
    box.textContent = '';
    var items = [
      [String(DATA.boardSize), 'protocols ranked'],
      [String(DATA.watchlistSize), 'on the watchlist'],
      [String(DATA.liveSize), 'live-token comps'],
      [(DATA.globalRatio).toFixed(2) + '×', 'global mcap / TVL median'],
    ];
    items.forEach(function (pair) {
      var card = text('div', 'stat');
      card.appendChild(text('b', null, pair[0]));
      card.appendChild(text('span', null, pair[1]));
      box.appendChild(card);
    });
    $('asof').textContent = DATA.asOf;
    $('asof2').textContent = DATA.asOf;
  }

  function fillSelects() {
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (cats.indexOf(c) === -1) cats.push(c);
      r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
    });
    cats.sort();
    chains.sort();
    var catSel = $('cat');
    catSel.appendChild(new Option('All categories', 'all'));
    cats.forEach(function (c) { catSel.appendChild(new Option(c, c)); });
    catSel.value = state.cat;
    var chainSel = $('chain');
    chainSel.appendChild(new Option('All chains', 'all'));
    chains.forEach(function (c) { chainSel.appendChild(new Option(c, c)); });
    chainSel.value = state.chain;
    $('q').value = state.q;
    $('sort').value = state.sort;
  }

  function renderTable() {
    var list = visibleRows();
    var body = $('rows');
    body.textContent = '';
    $('count').textContent = list.length + ' of ' + DATA.rows.length + ' ranked protocols shown';
    $('empty').hidden = list.length !== 0;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.slug === r.slug) tr.className = 'sel';
      tr.addEventListener('click', function () { openDetail(r.slug); });
      var rank = text('td', 'num', '#' + r.rank);
      var name = document.createElement('td');
      name.appendChild(text('strong', null, r.name));
      name.appendChild(document.createElement('br'));
      name.appendChild(text('span', 'slug', r.slug));
      var cat = text('td', null, r.category || '—');
      var ch = text('td', null, r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : ''));
      var tvl = text('td', 'num', money(r.tvl));
      var g = text('td', 'num ' + (r.change7d === null ? '' : r.change7d >= 0 ? 'up' : 'down'), pct(r.change7d));
      var age = text('td', 'num', ageFmt(r.ageDays));
      var imp = text('td', 'num');
      imp.appendChild(text('span', 'implied', money(r.implied)));
      tr.appendChild(rank);
      tr.appendChild(name);
      tr.appendChild(cat);
      tr.appendChild(ch);
      tr.appendChild(tvl);
      tr.appendChild(g);
      tr.appendChild(age);
      tr.appendChild(imp);
      body.appendChild(tr);
    });
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    var box = $('detail');
    if (!row) { box.hidden = true; state.slug = null; syncUrl(); renderTable(); return; }
    state.slug = slug;
    syncUrl();
    box.textContent = '';
    box.hidden = false;
    var head = text('div');
    head.appendChild(text('h2', null, row.name));
    var sub = row.category + ' · ' + row.chains.join(', ') + ' · listed ' + (row.listedAt || 'unknown') + ' · ' + ageFmt(row.ageDays) + ' old · rank #' + row.rank;
    head.appendChild(text('p', 'sub', sub));
    box.appendChild(head);
    box.appendChild(text('h3', null, 'How the value is computed'));
    var math = text('div', 'math');
    var cells = [
      [money(row.tvl), 'TVL'],
      [row.model.compRatio.toFixed(3) + '×', 'comp ratio · ' + row.category + ' (' + row.model.compN + ' comps)'],
      ['×' + row.model.growthMult.toFixed(2), 'growth · ' + pct(row.change7d) + ' in 7d'],
      ['×' + row.model.seasonMult.toFixed(2), 'seasoning · ' + ageFmt(row.ageDays)],
    ];
    cells.forEach(function (pair, idx) {
      var cell = text('div', idx === 3 ? 'eq' : null);
      cell.appendChild(text('b', null, pair[0]));
      cell.appendChild(text('span', null, pair[1]));
      math.appendChild(cell);
    });
    box.appendChild(math);
    var verdict = text('p', null, 'Implied value ' + money(row.implied) + ' = TVL × comp ratio × growth × seasoning. The comp ratio is the median mcap/TVL of tokens that already trade in this category, shrunk toward the global median.');
    box.appendChild(verdict);
    box.appendChild(text('h3', null, 'Farm plan — ' + row.farmSteps.length + ' steps'));
    var ol = text('ol', 'steps');
    row.farmSteps.forEach(function (s) {
      ol.appendChild(text('li', null, s));
    });
    box.appendChild(ol);
    var same = DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 3);
    if (same.length > 0) {
      box.appendChild(text('h3', null, 'Live comps in ' + row.category));
      var ul = text('ul', 'comps');
      same.forEach(function (l) {
        ul.appendChild(text('li', null, l.name + ' — mcap ' + money(l.mcap) + ' on TVL ' + money(l.tvl) + ', ' + l.ratio.toFixed(2) + '×'));
      });
      box.appendChild(ul);
    }
    renderTable();
    box.scrollIntoView({ block: 'nearest' });
  }

  function renderModel() {
    var box = $('model');
    box.textContent = '';
    box.appendChild(text('h2', null, 'How the value is computed'));
    box.appendChild(text('p', null, 'No protocol name is special-cased. The same arithmetic scores every row, from the snapshot’s own figures:'));
    var f = text('pre', 'formula', 'implied = TVL × compRatio × growth × seasoning\n' +
      'compRatio = category median mcap/TVL, shrunk toward the global median\n' +
      'growth    = 1 + clamp(7d change, -40%, +80%) × 0.6\n' +
      'seasoning = 0.7 + min(age, 1460 days) / 1460 × 0.5');
    box.appendChild(f);
    box.appendChild(text('p', null, 'Comps are the tokens that already trade: their market cap over their TVL, by category. Thin categories lean on the global median.'));
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Category', 'Comps', 'Median mcap/TVL', 'Ratio used'].forEach(function (h) {
      hr.appendChild(text('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = document.createElement('tbody');
    DATA.comps.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(text('td', null, c.category));
      tr.appendChild(text('td', 'num', String(c.n)));
      tr.appendChild(text('td', 'num', c.median.toFixed(3) + '×'));
      tr.appendChild(text('td', 'num', c.ratio.toFixed(3) + '×'));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
  }

  function renderLive() {
    var box = $('live');
    box.textContent = '';
    box.appendChild(text('h2', null, 'Tokens that already trade'));
    box.appendChild(text('p', null, 'The board never ranks these — a token that trades has a market price, not an implied value. They are the comps the model is calibrated against, top ' + DATA.live.length + ' by market cap.'));
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap', 'mcap / TVL'].forEach(function (h) {
      hr.appendChild(text('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = document.createElement('tbody');
    DATA.live.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.appendChild(text('td', null, l.name));
      tr.appendChild(text('td', null, l.category || '—'));
      tr.appendChild(text('td', 'num', money(l.tvl)));
      tr.appendChild(text('td', 'num', money(l.mcap)));
      tr.appendChild(text('td', 'num', l.ratio.toFixed(2) + '×'));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
  }

  function bind() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value; state.slug = null; syncUrl(); renderTable(); });
    $('cat').addEventListener('change', function (e) { state.cat = e.target.value; state.slug = null; syncUrl(); renderTable(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; state.slug = null; syncUrl(); renderTable(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; syncUrl(); renderTable(); });
    $('clear').addEventListener('click', function () {
      state.q = ''; state.cat = 'all'; state.chain = 'all'; state.sort = 'implied'; state.slug = null;
      $('q').value = ''; $('cat').value = 'all'; $('chain').value = 'all'; $('sort').value = 'implied';
      syncUrl(); renderTable(); $('detail').hidden = true;
    });
    var heads = document.querySelectorAll('th[data-k]');
    heads.forEach(function (th) {
      th.addEventListener('click', function () {
        state.sort = th.getAttribute('data-k');
        $('sort').value = state.sort;
        syncUrl(); renderTable();
      });
    });
  }

  renderStats();
  fillSelects();
  renderTable();
  renderModel();
  renderLive();
  bind();
  if (state.slug) openDetail(state.slug);
})();

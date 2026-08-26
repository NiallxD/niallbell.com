/* eBird checklist viewer — reads the CSV export shipped at DATA_URL and renders it
   entirely client-side. Rows are grouped into checklists by Submission ID, then
   bucketed by week, most recent week first.

   To update the data, replace static/data/ebird.csv with a fresh eBird export
   (eBird > Download My Data). Nothing else needs to change.

   The file picker is a fallback: it renders someone else's export in their own
   browser, and covers the case where the bundled file fails to load. */
(function () {
  'use strict';

  var DATA_URL = '/static/data/ebird.csv';
  var PAGE_SIZE = 12; // weeks rendered per "show more" step

  /* ── CSV parsing (quote-aware, handles embedded newlines) ── */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].length === 1 && rows[r][0] === '') continue;
      var o = {};
      for (var c = 0; c < head.length; c++) o[head[c]] = (rows[r][c] || '').trim();
      out.push(o);
    }
    return out;
  }

  /* ── Helpers ── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* eBird writes the Date column either ISO ("2025-10-07") or slash-separated in the
     account's locale ("07/10/2025" or "10/07/2025"). Opening the file in Excel can rewrite
     it too. Slash order is ambiguous per row, so it is decided once for the whole file:
     a component above 12 anywhere settles it, and day-first is the fallback. */
  var SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  function detectDayFirst(rows) {
    for (var i = 0; i < rows.length; i++) {
      var m = SLASH.exec((rows[i]['Date'] || '').trim());
      if (!m) continue;
      if (+m[1] > 12) return true;   // first component can only be a day
      if (+m[2] > 12) return false;  // second component can only be a day
    }
    return true;
  }

  // -> Date at local midnight (avoids UTC shifting the day)
  function parseDate(s, dayFirst) {
    s = (s || '').trim();
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    var m = SLASH.exec(s);
    if (!m) return null;
    var day = dayFirst ? +m[1] : +m[2];
    var mon = dayFirst ? +m[2] : +m[1];
    var d = new Date(+m[3], mon - 1, day);
    return d.getMonth() === mon - 1 && d.getDate() === day ? d : null;
  }

  /* Times arrive as "09:54 AM" or "7:00 am". Minutes-since-midnight orders same-day
     checklists correctly — a string sort puts "7:00 am" after "10:04 am". */
  function parseTime(s) {
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?/.exec((s || '').trim());
    if (!m) return -1;
    var h = +m[1] % 12, mins = +m[2];
    if (m[3]) { if (m[3].toLowerCase() === 'p') h += 12; } else { h = +m[1]; }
    return h * 60 + mins;
  }

  function fmtTime(mins) {
    if (mins < 0) return '';
    var h = Math.floor(mins / 60), m = mins % 60;
    var ap = h < 12 ? 'am' : 'pm';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }

  function weekStart(d) {
    var w = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); // back to Monday
    return w;
  }

  // "1st August 2026" — the ordinal has to be built by hand, Intl has no format for it.
  function ordinal(n) {
    if (n > 3 && n < 21) return 'th';
    return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  }
  function fmtDate(d) {
    return d.getDate() + ordinal(d.getDate()) + ' ' +
      d.toLocaleDateString(undefined, { month: 'long' }) + ' ' + d.getFullYear();
  }
  function fmtShort(d) { return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // "X" means "present, not counted" in eBird exports.
  function countNum(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  function duration(min) {
    var n = parseFloat(min);
    if (!n) return null;
    var h = Math.floor(n / 60), m = Math.round(n % 60);
    return h ? h + 'h ' + (m ? m + 'm' : '') : m + 'm';
  }

  var EXTERNAL_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  function protocolLabel(p) { return (p || '').replace(/^eBird\s*-\s*/, ''); }

  /* ── Build checklists from rows ── */
  function buildChecklists(rows) {
    var map = Object.create(null), order = [], dayFirst = detectDayFirst(rows);
    rows.forEach(function (r) {
      var id = r['Submission ID'];
      if (!id) return;
      var cl = map[id];
      if (!cl) {
        var d = parseDate(r['Date'], dayFirst);
        if (!d) return;
        var mins = parseTime(r['Time']);
        cl = map[id] = {
          id: id,
          date: d,
          dateStr: ymd(d), // normalised to ISO so the date-range inputs can compare strings
          minutes: mins,
          time: fmtTime(mins),
          location: r['Location'] || 'Unknown location',
          locationId: r['Location ID'] || '',
          county: r['County'] || '',
          region: r['State/Province'] || '',
          lat: r['Latitude'], lon: r['Longitude'],
          protocol: protocolLabel(r['Protocol']),
          durationMin: r['Duration (Min)'],
          distance: r['Distance Traveled (km)'],
          area: r['Area Covered (ha)'],
          observers: r['Number of Observers'],
          complete: r['All Obs Reported'] === '1',
          comments: [],
          species: []
        };
        order.push(cl);
      }
      // eBird repeats the checklist comment on every row; a few exports vary, so collect uniques.
      var cm = r['Checklist Comments'];
      if (cm && cl.comments.indexOf(cm) === -1) cl.comments.push(cm);

      cl.species.push({
        name: r['Common Name'] || '',
        sci: r['Scientific Name'] || '',
        order: parseFloat(r['Taxonomic Order']) || 0,
        count: r['Count'] || '',
        breeding: r['Breeding Code'] || '',
        details: r['Observation Details'] || '',
        media: r['ML Catalog Numbers'] || ''
      });
    });

    order.forEach(function (cl) {
      cl.species.sort(function (a, b) { return a.order - b.order; });
      cl.total = cl.species.reduce(function (s, sp) { return s + countNum(sp.count); }, 0);
      cl.searchText = (cl.location + ' ' + cl.county + ' ' + cl.region + ' ' + cl.comments.join(' ') + ' ' +
        cl.species.map(function (s) { return s.name + ' ' + s.sci + ' ' + s.details; }).join(' ')).toLowerCase();
    });

    order.sort(function (a, b) {
      if (b.date - a.date) return b.date - a.date;
      return b.minutes - a.minutes;
    });
    return order;
  }

  /* ── State ── */
  /* The list renders a moving window of `weeks`: `startWeek` is the first week in the DOM,
     `weeksShown` how many follow it. Scrolling extends the window at either end; a jump from
     the scrubber re-seats it. Rendering all of a decade at once is what this avoids. */
  var all = [], filtered = [], weeks = [], startWeek = 0, weeksShown = PAGE_SIZE;

  var el = {
    loading: document.getElementById('eb-loading'),
    loader: document.getElementById('eb-loader'),
    app: document.getElementById('eb-app'),
    drop: document.getElementById('eb-drop'),
    file: document.getElementById('eb-file'),
    error: document.getElementById('eb-error'),
    spark: document.getElementById('eb-spark'),
    bars: document.getElementById('eb-bars'),
    barToggle: document.getElementById('eb-bar-toggle'),
    sparkTitle: document.getElementById('eb-spark-title'),
    barAxis: document.getElementById('eb-bar-axis'),
    sparkReadout: document.getElementById('eb-spark-readout'),
    sparkRange: document.getElementById('eb-spark-range'),
    list: document.getElementById('eb-list'),
    sentinelUp: document.getElementById('eb-sentinel-up'),
    sentinelDown: document.getElementById('eb-sentinel-down'),
    end: document.getElementById('eb-end'),
    rail: document.getElementById('eb-rail'),
    bubble: document.getElementById('eb-bubble'),
    search: document.getElementById('eb-search'),
    year: document.getElementById('eb-year'),
    region: document.getElementById('eb-region'),
    from: document.getElementById('eb-from'),
    to: document.getElementById('eb-to'),
    reset: document.getElementById('eb-reset'),
    pick: document.getElementById('eb-pick')
  };

  function showError(msg) {
    el.loading.hidden = true;
    el.loader.hidden = false;
    el.error.textContent = msg;
    el.error.hidden = false;
  }

  function load(text) {
    var rows;
    try {
      rows = toObjects(parseCSV(text));
    } catch (e) {
      showError('That file could not be parsed as CSV.');
      return;
    }
    if (!rows.length || !('Submission ID' in rows[0])) {
      showError('That does not look like an eBird export — no "Submission ID" column found.');
      return;
    }
    all = buildChecklists(rows);
    if (!all.length) {
      showError('No checklists could be read from that file — the Date column was not in a recognised format.');
      return;
    }

    el.error.hidden = true;
    el.loading.hidden = true;
    el.loader.hidden = true;
    el.app.hidden = false;
    populateFilters();
    apply();
    initScroller();
  }

  function populateFilters() {
    var years = {}, regions = {};
    all.forEach(function (c) {
      years[c.date.getFullYear()] = true;
      if (c.region) regions[c.region] = (regions[c.region] || 0) + 1;
    });
    el.year.innerHTML = '<option value="">All years</option>' +
      Object.keys(years).sort(function (a, b) { return b - a; })
        .map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
    el.region.innerHTML = '<option value="">All regions</option>' +
      Object.keys(regions).sort().map(function (r) {
        return '<option value="' + esc(r) + '">' + esc(r) + ' (' + regions[r] + ')</option>';
      }).join('');
  }

  function apply() {
    var q = el.search.value.trim().toLowerCase();
    var year = el.year.value, region = el.region.value;
    var from = el.from.value, to = el.to.value;

    filtered = all.filter(function (c) {
      if (year && String(c.date.getFullYear()) !== year) return false;
      if (region && c.region !== region) return false;
      if (from && c.dateStr < from) return false;
      if (to && c.dateStr > to) return false;
      if (q && c.searchText.indexOf(q) === -1) return false;
      return true;
    });

    weeks = bucketWeeks(filtered);
    startWeek = 0;
    weeksShown = PAGE_SIZE;
    renderBars();
    renderList();
    renderRail();
  }

  // Bucket into weeks, preserving the newest-first order of `filtered`.
  function bucketWeeks(list) {
    var out = [], index = Object.create(null);
    list.forEach(function (c) {
      var key = ymd(weekStart(c.date));
      if (!index[key]) { index[key] = { key: key, start: weekStart(c.date), items: [] }; out.push(index[key]); }
      index[key].items.push(c);
    });
    return out;
  }

  function weeksHtml(from, to) {
    var out = '';
    for (var i = from; i < to; i++) out += renderWeek(weeks[i], i);
    return out;
  }

  function renderList() {
    if (!filtered.length) {
      el.list.innerHTML = '<p class="eb-empty">No checklists match those filters.</p>';
      updateEnd();
      return;
    }
    weeksShown = Math.min(weeksShown, weeks.length - startWeek);
    el.list.innerHTML = weeksHtml(startWeek, startWeek + weeksShown);
    updateEnd();
  }

  // Extend downwards. Appending beats re-rendering: open checklists stay open, and the
  // browser keeps its scroll position without any correction.
  function appendNext() {
    var from = startWeek + weeksShown;
    if (from >= weeks.length) return false;
    var to = Math.min(from + PAGE_SIZE, weeks.length);
    el.list.insertAdjacentHTML('beforeend', weeksHtml(from, to));
    weeksShown += to - from;
    updateEnd();
    return true;
  }

  // Extend upwards, after a scrubber jump has left earlier weeks unrendered. Inserting
  // above the viewport shifts everything down, so the scroll position is corrected by the
  // height that was just added — otherwise the page jumps under the reader.
  function prependPrev() {
    if (startWeek === 0) return false;
    var from = Math.max(0, startWeek - PAGE_SIZE);
    var before = el.list.scrollHeight;
    el.list.insertAdjacentHTML('afterbegin', weeksHtml(from, startWeek));
    window.scrollBy(0, el.list.scrollHeight - before);
    weeksShown += startWeek - from;
    startWeek = from;
    return true;
  }

  function updateEnd() {
    var done = !filtered.length || startWeek + weeksShown >= weeks.length;
    el.end.hidden = !done;
    if (done && filtered.length) {
      el.end.textContent = filtered.length.toLocaleString() + ' checklist' +
        (filtered.length === 1 ? '' : 's') + ' · that\u2019s everything';
    }
  }

  /* Infinite scroll. The sentinels sit outside the list and trigger a page ahead of time,
     so the next weeks are in the DOM before the reader reaches the bottom. */
  function initScroller() {
    if (!('IntersectionObserver' in window) || initScroller.done) return;
    initScroller.done = true;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || !filtered.length) return;
        if (entry.target === el.sentinelDown) { if (appendNext()) markActive(); }
        else if (entry.target === el.sentinelUp) { if (prependPrev()) markActive(); }
      });
    }, { rootMargin: '900px 0px' });
    io.observe(el.sentinelDown);
    io.observe(el.sentinelUp);
  }

  function renderWeek(w, i) {
    var end = new Date(w.start); end.setDate(end.getDate() + 6);
    var species = Object.create(null);
    w.items.forEach(function (c) { c.species.forEach(function (s) { if (s.name) species[s.name] = true; }); });
    var n = Object.keys(species).length;

    return '<section class="eb-week" data-week="' + i + '">' +
      '<div class="eb-week-head">' +
        '<h2 class="eb-week-title">Week of ' + esc(fmtShort(w.start)) + ' – ' + esc(fmtShort(end)) + ' ' + end.getFullYear() + '</h2>' +
        '<span class="eb-week-meta">' + w.items.length + ' checklist' + (w.items.length === 1 ? '' : 's') +
          ' · ' + n + ' species</span>' +
      '</div>' +
      w.items.map(renderCard).join('') +
    '</section>';
  }

  function renderCard(c) {
    var sub = [c.location, c.time, c.county || c.region].filter(Boolean).join(' · ');
    return '<details class="eb-card" data-id="' + esc(c.id) + '">' +
      '<summary>' +
        '<span class="eb-owl" aria-hidden="true">' +
          '<i class="eb-owl-face eb-owl-forward"></i>' +
          '<i class="eb-owl-face eb-owl-down"></i>' +
        '</span>' +
        '<div>' +
          '<div class="eb-card-date">' + esc(fmtDate(c.date)) + '</div>' +
          '<div class="eb-card-sub">' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="eb-card-actions">' +
          '<div class="eb-card-right">' +
            '<span class="eb-card-count">' + c.species.length + '</span> species' +
          '</div>' +
          '<a class="eb-open" href="https://ebird.org/checklist/' + encodeURIComponent(c.id) + '"' +
            ' target="_blank" rel="noopener noreferrer" title="Open this checklist on eBird"' +
            ' aria-label="Open this checklist on eBird">' + EXTERNAL_ICON + '</a>' +
        '</div>' +
      '</summary>' +
      '<div class="eb-detail">' + renderDetail(c) + '</div>' +
    '</details>';
  }

  function renderDetail(c) {
    var chips = [];
    chips.push(c.protocol);
    var d = duration(c.durationMin); if (d) chips.push(d);
    if (parseFloat(c.distance)) chips.push(parseFloat(c.distance).toFixed(2) + ' km');
    if (parseFloat(c.area)) chips.push(parseFloat(c.area) + ' ha');
    if (c.observers) chips.push(c.observers + ' observer' + (c.observers === '1' ? '' : 's'));
    chips.push(c.complete ? 'Complete checklist' : 'Incomplete');
    if (c.total) chips.push(c.total.toLocaleString() + ' birds counted');

    // The notes are the reason to open a checklist, so they lead.
    var html = '';
    if (c.comments.length) {
      html += '<div class="eb-notes">' +
        '<span class="eb-notes-label">Field notes</span>' +
        c.comments.map(function (cm) { return '<p class="eb-notes-body">' + esc(cm) + '</p>'; }).join('') +
      '</div>';
    }

    html += '<div class="eb-meta">' + chips.filter(Boolean).map(function (t) {
      return '<span class="eb-chip">' + esc(t) + '</span>';
    }).join('') + '</div>';

    var noted = c.species.filter(function (s) { return s.details || s.breeding || s.media; }).length;
    html += '<details class="eb-species-toggle">' +
      '<summary>' +
        '<span class="eb-species-chevron" aria-hidden="true">&#9656;</span>' +
        '<span>' + c.species.length + ' species' +
          (noted ? ' <span class="eb-species-noted">&middot; ' + noted + ' with notes</span>' : '') +
        '</span>' +
      '</summary>' +
      '<table class="eb-species"><thead><tr><th>Species</th><th class="eb-num">Count</th></tr></thead><tbody>' +
      c.species.map(function (s) {
        var notes = [];
        if (s.breeding) notes.push('Breeding code: ' + s.breeding);
        if (s.details) notes.push(s.details);
        if (s.media) notes.push('Media: ' + s.media);
        return '<tr><td>' + esc(s.name) +
            '<span class="eb-sci">' + esc(s.sci) + '</span>' +
            (notes.length ? '<div class="eb-obs-note">' + esc(notes.join(' \u2014 ')) + '</div>' : '') +
          '</td><td class="eb-num">' + esc(s.count === 'X' ? 'present' : s.count) + '</td></tr>';
      }).join('') + '</tbody></table>' +
    '</details>';

    return html;
  }

  /* ── Activity bars: checklists per week, last 12 months ─────────────────────
     One bar per calendar week, height = how many checklists that week. Counts, not a
     derived rate: an earlier version plotted a rolling per-day average, which was
     unreadable — the honest unit here is the same one the list below is grouped by.
     Plain HTML bars rather than SVG, so the rounded ends and hit targets stay exact at
     any width. Clicking a bar travels to that week. */

  var BAR_WEEKS = 52;
  var barWeeks = [];
  var barMetric = 'checklists'; // or 'species'

  function renderBars() {
    barWeeks = [];
    if (!filtered.length) { el.spark.hidden = true; return; }

    var newest = weekStart(filtered[0].date);
    var byWeek = Object.create(null);
    filtered.forEach(function (c) {
      var k = ymd(weekStart(c.date));
      var w = byWeek[k] || (byWeek[k] = { checklists: 0, species: Object.create(null) });
      w.checklists++;
      c.species.forEach(function (sp) { if (sp.name) w.species[sp.name] = true; });
    });

    for (var i = BAR_WEEKS - 1; i >= 0; i--) {
      var start = new Date(newest.getFullYear(), newest.getMonth(), newest.getDate() - i * 7);
      var key = ymd(start), w = byWeek[key];
      barWeeks.push({
        start: start, key: key,
        checklists: w ? w.checklists : 0,
        species: w ? Object.keys(w.species).length : 0
      });
    }
    paintBars();
  }

  function barValue(b) { return barMetric === 'species' ? b.species : b.checklists; }
  function barNoun(n) {
    if (barMetric === 'species') return n + ' species';
    return n + ' checklist' + (n === 1 ? '' : 's');
  }

  // Repainting is separate from bucketing: flipping the toggle must not re-walk the data.
  function paintBars() {
    var peak = barWeeks.reduce(function (m, b) { return Math.max(m, barValue(b)); }, 0);
    if (!peak) { el.spark.hidden = true; return; }
    el.spark.hidden = false;

    el.bars.innerHTML = barWeeks.map(function (b, i) {
      var v = barValue(b);
      var pct = v ? Math.max(6, Math.round((v / peak) * 100)) : 0;
      var label = 'Week of ' + fmtDate(b.start) + ': ' + barNoun(v);
      return '<button type="button" class="eb-bar" data-bar="' + i + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<span class="eb-bar-track"><span class="eb-bar-fill" style="height:' + pct + '%"></span></span>' +
      '</button>';
    }).join('');

    // Month boundaries under the bars — a year of weeks needs some orientation.
    el.barAxis.innerHTML = barWeeks.map(function (b, i) {
      var prev = barWeeks[i - 1];
      var newMonth = !prev || b.start.getMonth() !== prev.start.getMonth();
      var first = newMonth && b.start.getDate() <= 7;
      return '<span class="eb-bar-axis-cell">' + (first ?
        b.start.toLocaleDateString(undefined, { month: 'short' }) : '') + '</span>';
    }).join('');

    el.sparkTitle.textContent = barMetric === 'species' ? 'Species per week' : 'Checklists per week';
    el.sparkRange.textContent = fmtShort(barWeeks[0].start) + ' – ' +
      fmtShort(barWeeks[barWeeks.length - 1].start) + ' ' + barWeeks[barWeeks.length - 1].start.getFullYear();
    barsDefaultReadout = 'Best week: ' + barNoun(peak);
    el.sparkReadout.textContent = barsDefaultReadout;
  }

  var barsDefaultReadout = '';

  function barFromEvent(e) {
    var btn = e.target.closest ? e.target.closest('.eb-bar') : null;
    return btn ? barWeeks[+btn.dataset.bar] : null;
  }

  el.bars.addEventListener('pointermove', function (e) {
    var b = barFromEvent(e);
    if (!b) return;
    var v = barValue(b);
    el.sparkReadout.textContent = 'Week of ' + fmtDate(b.start) + ' · ' +
      (v ? barNoun(v) : (barMetric === 'species' ? 'no species' : 'no checklists'));
  });

  el.bars.addEventListener('pointerleave', function () { el.sparkReadout.textContent = barsDefaultReadout; });

  el.barToggle.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-metric]') : null;
    if (!btn || btn.dataset.metric === barMetric) return;
    barMetric = btn.dataset.metric;
    var opts = el.barToggle.querySelectorAll('[data-metric]');
    for (var i = 0; i < opts.length; i++) {
      var on = opts[i].dataset.metric === barMetric;
      opts[i].classList.toggle('is-on', on);
      opts[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    paintBars();
  });

  // A bar is a shortcut to that week in the list below.
  el.bars.addEventListener('click', function (e) {
    var b = barFromEvent(e);
    if (!b || !b.count) return;
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i].key === b.key) { goToWeek(i, true); return; }
    }
  });

  /* ── Date scrubber ──────────────────────────────────────────────────────────
     A sticky rail of ticks, one per week (per month once there are enough weeks
     that per-week ticks would be a pixel high). Click or drag to travel; the tick
     for whatever is at the top of the viewport stays lit. */

  var railTicks = [];        // { index, label, month } — index into `weeks`
  var scrubbing = false;

  function monthKey(d) { return d.getFullYear() + '-' + d.getMonth(); }

  function buildTicks() {
    // Per-week ticks stop being legible (or clickable) past ~50 of them.
    if (weeks.length <= 50) {
      return weeks.map(function (w, i) {
        return { index: i, label: fmtShort(w.start), month: monthKey(w.start) };
      });
    }
    var out = [], seen = Object.create(null);
    weeks.forEach(function (w, i) {
      var k = monthKey(w.start);
      if (seen[k]) return;
      seen[k] = true;
      out.push({
        index: i,
        label: w.start.toLocaleDateString(undefined, { month: 'short' }) + " '" + String(w.start.getFullYear()).slice(2),
        month: k
      });
    });
    return out;
  }

  function renderRail() {
    railTicks = filtered.length ? buildTicks() : [];
    if (railTicks.length < 2) { el.rail.innerHTML = ''; el.rail.hidden = true; return; }

    el.rail.hidden = false;
    el.rail.innerHTML = railTicks.map(function (t, i) {
      // Year headings only where the year actually turns over.
      var prev = railTicks[i - 1];
      var year = t.label.slice(-4);
      var newYear = !prev || weeks[t.index].start.getFullYear() !== weeks[prev.index].start.getFullYear();
      return '<button type="button" class="eb-tick' + (newYear ? ' is-year' : '') + '" data-tick="' + i +
        '" data-index="' + t.index + '" title="' + esc(t.label) + '">' +
        '<span class="eb-tick-line"></span>' +
        '<span class="eb-tick-label">' + esc(newYear ? weeks[t.index].start.getFullYear() : t.label) + '</span>' +
      '</button>';
    }).join('');
    markActive();
  }

  /* A jump to a week outside the rendered window re-seats the window on it rather than
     rendering everything in between — the point of the scrubber is reaching 2016 without
     building the intervening ten years of DOM. Nearby targets just extend the window, which
     keeps short scrubs continuous. */
  function ensureRendered(weekIndex) {
    if (weekIndex >= startWeek && weekIndex < startWeek + weeksShown) return;
    if (weekIndex >= startWeek + weeksShown && weekIndex < startWeek + weeksShown + PAGE_SIZE) {
      appendNext();
      return;
    }
    startWeek = Math.max(0, weekIndex - 1); // a week of lead-in, so the target isn't flush to the top
    weeksShown = PAGE_SIZE;
    renderList();
  }

  function headerOffset() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--nav-height');
    return (parseInt(v, 10) || 76) + 12;
  }

  function goToWeek(weekIndex, smooth) {
    ensureRendered(weekIndex);
    var section = el.list.querySelector('[data-week="' + weekIndex + '"]');
    if (!section) return;
    var y = section.getBoundingClientRect().top + window.pageYOffset - headerOffset();
    window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
  }

  /* Which tick covers the week being read?

     A fixed reading line near the top of the viewport lags badly at the end of the list: the
     final weeks never reach it, so the rail still pointed at 2018 while the oldest checklist
     of 2016 sat on screen. The line therefore travels — level with the header at the top of
     the document, level with the bottom of the viewport at the end of it — so the last week
     is "being read" once it is on screen rather than once it is at the top. Reaching the
     genuine end of a fully rendered list pins the rail to its last tick outright, so the fill
     completes with the last checklist rather than somewhere inside the footer. */
  function activeTickIndex() {
    var vh = window.innerHeight || 800;
    var top = headerOffset();

    if (startWeek + weeksShown >= weeks.length) {
      var listBottom = el.list.getBoundingClientRect().bottom;
      if (listBottom <= vh + 4) return railTicks.length - 1;
    }

    var docMax = Math.max(1, document.documentElement.scrollHeight - vh);
    var progress = Math.min(1, Math.max(0, (window.pageYOffset || 0) / docMax));
    var line = top + 8 + progress * (vh - top - 8);

    var best = startWeek; // the window may not start at week 0 after a scrubber jump
    var sections = el.list.querySelectorAll('[data-week]');
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= line) best = +sections[i].dataset.week;
    }
    for (var t = railTicks.length - 1; t >= 0; t--) {
      if (railTicks[t].index <= best) return t;
    }
    return 0;
  }

  function markActive() {
    if (!railTicks.length || scrubbing) return;
    var active = activeTickIndex();
    var ticks = el.rail.children;
    for (var i = 0; i < ticks.length; i++) ticks[i].classList.toggle('is-active', i === active);
  }

  // Map a pointer y within the rail onto a tick.
  function tickAt(clientY) {
    var box = el.rail.getBoundingClientRect();
    var ratio = (clientY - box.top) / Math.max(box.height, 1);
    var i = Math.round(ratio * (railTicks.length - 1));
    return Math.max(0, Math.min(railTicks.length - 1, i));
  }

  function showBubble(tickIndex, clientY) {
    var w = weeks[railTicks[tickIndex].index];
    var end = new Date(w.start); end.setDate(end.getDate() + 6);
    el.bubble.textContent = fmtShort(w.start) + ' – ' + fmtShort(end) + ' ' + end.getFullYear();
    el.bubble.hidden = false;
    var box = el.rail.getBoundingClientRect();
    var y = Math.max(box.top, Math.min(clientY, box.top + box.height));
    el.bubble.style.top = y + 'px';
    // The rail is against the right edge, so the bubble hangs off its left.
    el.bubble.style.right = (window.innerWidth - box.left + 8) + 'px';
  }

  /* Dragging across a decade fires pointermove far faster than the list can re-seat itself,
     so the bubble and the lit tick follow the pointer immediately while the travel itself is
     throttled to one per frame. */
  var pendingTick = -1, scrubFrame = 0;

  function scrubTo(clientY) {
    var t = tickAt(clientY);
    showBubble(t, clientY);
    var ticks = el.rail.children;
    for (var i = 0; i < ticks.length; i++) ticks[i].classList.toggle('is-active', i === t);

    pendingTick = t;
    if (scrubFrame) return;
    scrubFrame = requestAnimationFrame(function () {
      scrubFrame = 0;
      if (pendingTick >= 0) goToWeek(railTicks[pendingTick].index, false);
    });
  }

  el.rail.addEventListener('pointerdown', function (e) {
    if (!railTicks.length) return;
    scrubbing = true;
    el.rail.setPointerCapture(e.pointerId);
    el.rail.classList.add('is-scrubbing');
    scrubTo(e.clientY);
    e.preventDefault();
  });

  el.rail.addEventListener('pointermove', function (e) {
    if (scrubbing) { scrubTo(e.clientY); return; }
    if (railTicks.length) showBubble(tickAt(e.clientY), e.clientY);
  });

  el.rail.addEventListener('pointerleave', function () { if (!scrubbing) el.bubble.hidden = true; });

  function endScrub(e) {
    if (!scrubbing) return;
    scrubbing = false;
    if (pendingTick >= 0) goToWeek(railTicks[pendingTick].index, false); // land on the last position
    pendingTick = -1;
    el.rail.classList.remove('is-scrubbing');
    el.bubble.hidden = true;
    if (e && e.pointerId != null && el.rail.hasPointerCapture(e.pointerId)) el.rail.releasePointerCapture(e.pointerId);
    markActive();
  }
  el.rail.addEventListener('pointerup', endScrub);
  el.rail.addEventListener('pointercancel', endScrub);

  // Keyboard: the ticks are real buttons, so Enter/Space already work.
  el.rail.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.eb-tick') : null;
    if (btn) goToWeek(+btn.dataset.index, true);
  });



  /* <details> snaps open with no in-between state, which reads as a jump on a card this
     tall. Drive the open/close ourselves and animate the panel's height. Works for the
     checklist card and the species list inside it alike: in both cases the panel is the
     element right after the <summary>. */
  var REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function slideDetails(details, panel) {
    if (details.dataset.animating) return;
    var opening = !details.open;

    if (REDUCED_MOTION) { details.open = opening; return; }
    if (opening) details.open = true; // content has to be in flow before it can be measured

    var full = panel.scrollHeight;
    details.dataset.animating = '1';
    panel.style.overflow = 'hidden';

    /* box-sizing is border-box site-wide, so a 0px height still paints the panel's
       padding — animate it alongside, or the slide starts with a visible step. */
    var style = getComputedStyle(panel);
    var padTop = style.paddingTop, padBottom = style.paddingBottom;
    var closed = { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' };
    var openState = { height: full + 'px', opacity: 1, paddingTop: padTop, paddingBottom: padBottom };

    var anim = panel.animate(
      opening ? [closed, openState] : [openState, closed],
      { duration: opening ? 260 : 200, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' }
    );

    anim.onfinish = anim.oncancel = function () {
      panel.style.overflow = '';
      panel.style.height = '';
      panel.style.paddingTop = '';
      panel.style.paddingBottom = '';
      delete details.dataset.animating;
      if (!opening) details.open = false;
    };
  }

  el.list.addEventListener('click', function (e) {
    /* A link inside <summary> is a genuine conflict: the browser follows it AND toggles the
       row, and neither stopPropagation (same-element listeners still run) nor preventDefault
       (cancels the navigation too) settles it alone. Cancel the click and open the tab
       ourselves — a direct user gesture, so no popup blocker. */
    var link = e.target.closest ? e.target.closest('a[href]') : null;
    if (link) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }

    var summary = e.target.closest ? e.target.closest('summary') : null;
    if (!summary) return;
    var details = summary.parentElement;
    var panel = summary.nextElementSibling;
    if (!details || details.tagName !== 'DETAILS' || !panel) return;
    e.preventDefault(); // we own the toggle now
    slideDetails(details, panel);
  });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; markActive(); });
  }, { passive: true });

  /* ── ZIP support ─────────────────────────────────────────────────────────────
     eBird's "Download My Data" arrives as a .zip, so the picker accepts one and reads
     the CSV out of it. The container is parsed here and the DEFLATE stream is handed to
     the browser's own DecompressionStream — no library, nothing added to the CSP. */

  function findEOCD(view) {
    // The end-of-central-directory record is last, after a comment of unknown length.
    var max = Math.min(view.byteLength, 66000);
    for (var i = view.byteLength - 22; i >= view.byteLength - max; i--) {
      if (i >= 0 && view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  function zipEntries(buffer) {
    var view = new DataView(buffer);
    var eocd = findEOCD(view);
    if (eocd < 0) throw new Error('not a zip');

    var count = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var decoder = new TextDecoder();
    var out = [];

    for (var i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      var flags = view.getUint16(offset + 8, true);
      var method = view.getUint16(offset + 10, true);
      var compSize = view.getUint32(offset + 20, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localAt = view.getUint32(offset + 42, true);
      var name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLen));

      out.push({ name: name, method: method, compSize: compSize, localAt: localAt, encrypted: !!(flags & 1) });
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return { buffer: buffer, view: view, entries: out };
  }

  function readEntry(zip, entry) {
    var view = zip.view;
    if (view.getUint32(entry.localAt, true) !== 0x04034b50) throw new Error('bad zip entry');
    // The local header repeats the name and extra fields, at its own lengths.
    var nameLen = view.getUint16(entry.localAt + 26, true);
    var extraLen = view.getUint16(entry.localAt + 28, true);
    var start = entry.localAt + 30 + nameLen + extraLen;
    var bytes = new Uint8Array(zip.buffer, start, entry.compSize);

    if (entry.method === 0) return Promise.resolve(new TextDecoder().decode(bytes));
    if (entry.method !== 8) return Promise.reject(new Error('unsupported compression'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'));

    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new TextDecoder().decode(new Uint8Array(buf));
    });
  }

  function csvFromZip(buffer) {
    var zip = zipEntries(buffer);
    var candidates = zip.entries.filter(function (e) {
      // Skip directories and the resource forks a macOS-made zip carries around.
      return /\.csv$/i.test(e.name) && e.name.indexOf('__MACOSX') === -1 &&
        e.name.charAt(e.name.length - 1) !== '/' && !/(^|\/)\._/.test(e.name);
    });
    if (!candidates.length) return Promise.reject(new Error('no csv in zip'));
    if (candidates.some(function (e) { return e.encrypted; })) return Promise.reject(new Error('encrypted'));

    // eBird names it MyEBirdData.csv; fall back to the first CSV in the archive.
    var pick = candidates.filter(function (e) { return /MyEBirdData\.csv$/i.test(e.name); })[0] || candidates[0];
    return readEntry(zip, pick);
  }

  /* ── Wiring ── */
  /* Read as bytes and sniff the header rather than trusting the name or the MIME type:
     "PK\x03\x04" is a zip whatever it is called, and everything else is treated as text. */
  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showError('Could not read that file.'); };

    reader.onload = function () {
      var buffer = reader.result;
      var head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
      var isZip = head[0] === 0x50 && head[1] === 0x4b &&
        (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);

      if (!isZip) { load(new TextDecoder().decode(new Uint8Array(buffer))); return; }

      csvFromZip(buffer).then(load).catch(function (err) {
        var msg = String(err && err.message);
        if (msg === 'no csv in zip') showError('That zip contains no CSV file.');
        else if (msg === 'encrypted') showError('That zip is password-protected — unzip it first.');
        else if (msg === 'no DecompressionStream') showError('This browser cannot open zips — unzip the file and pick the CSV.');
        else showError('That zip could not be opened — unzip it and pick the CSV instead.');
      });
    };

    reader.readAsArrayBuffer(file);
  }

  el.file.addEventListener('change', function () { readFile(el.file.files[0]); });

  ['dragenter', 'dragover'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.drop.addEventListener(ev, function (e) { e.preventDefault(); el.drop.classList.remove('is-over'); });
  });
  el.drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });

  var debounce;
  el.search.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(apply, 150);
  });
  [el.year, el.region, el.from, el.to].forEach(function (n) { n.addEventListener('change', apply); });

  function markEmptyDates() {
    [el.from, el.to].forEach(function (n) { n.classList.toggle('is-empty', !n.value); });
  }
  [el.from, el.to].forEach(function (n) { n.addEventListener('change', markEmptyDates); });
  markEmptyDates();

  el.reset.addEventListener('click', function () {
    el.search.value = ''; el.year.value = ''; el.region.value = ''; el.from.value = ''; el.to.value = '';
    markEmptyDates();
    apply();
  });

  // Toggles, so the drop zone can be dismissed again without reloading the page.
  el.pick.addEventListener('click', function () {
    var showing = !el.loader.hidden;
    el.loader.hidden = showing;
    el.pick.textContent = showing ? 'Use your own CSV' : 'Cancel';
    if (!showing) el.loader.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // Bootstrap: load the export shipped with the site.
  fetch(DATA_URL, { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    })
    .then(function (text) { load(text); })
    .catch(function () {
      showError('Could not load the bundled export — choose a CSV file instead.');
    });
})();

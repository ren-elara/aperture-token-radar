/* Offline interaction layer. It intentionally has no fetch, imports or remote assets. */
(() => {
  'use strict';

  const E = globalThis.RadarEngine;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = value => '$' + (value >= 1e9 ? (value / 1e9).toFixed(2) + 'B' : value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' : value >= 1000 ? (value / 1000).toFixed(0) + 'K' : Math.round(value || 0).toLocaleString('en-US'));
  const percent = value => value === null ? 'Unreported' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  const labels = { momentum: 'TVL momentum', scale: 'TVL scale', maturity: 'Tracked maturity', evidence: 'Evidence coverage', actionability: 'Route actionability' };
  const state = { view: 'board', early: false, watch: false, query: '', category: '', chain: '', sort: 'implied_value_usd', direction: -1, page: 0, size: 8, scenario: 1 };
  let saved;
  try { saved = new Set(JSON.parse(localStorage.getItem('aperture-shortlist') || '[]')); } catch { saved = new Set(); }
  let radar = E.buildRadar(SNAPSHOT);

  const avatar = protocol => `<span class="avatar" aria-hidden="true">${esc(protocol.name.charAt(0))}</span>`;
  const bars = value => `<span class="micro-bars" aria-label="seven-day change magnitude"><i style="height:5px"></i><i style="height:${value >= 0 ? 8 : 16}px"></i><i style="height:10px"></i><i style="height:${value >= 0 ? 13 : 9}px"></i><i style="height:${value >= 0 ? 17 : 5}px"></i></span>`;
  const decision = protocol => protocol.plan?.restricted ? '<span class="decision research">RESEARCH ONLY</span>' : '<span class="decision verify">VERIFY ROUTE</span>';

  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), 2200);
  }

  function save(slug) {
    if (saved.has(slug)) saved.delete(slug); else saved.add(slug);
    try { localStorage.setItem('aperture-shortlist', JSON.stringify([...saved])); } catch { toast('Shortlist saved for this visit'); }
    $('saved-count').textContent = saved.size;
    render();
  }

  function populateFilters() {
    const options = (values, first) => `<option value="">${first}</option>` + [...new Set(values)].sort().map(value => `<option>${esc(value)}</option>`).join('');
    $('category').innerHTML = options(SNAPSHOT.protocols.map(protocol => protocol.category || 'Other'), 'All categories');
    $('chain').innerHTML = options(SNAPSHOT.protocols.flatMap(protocol => protocol.chains), 'All chains');
  }

  function matches(protocol) {
    return (!state.early || protocol.early) && (!state.watch || protocol.watchlist) &&
      (!state.category || (protocol.category || 'Other') === state.category) &&
      (!state.chain || protocol.chains.includes(state.chain)) &&
      (!state.query || `${protocol.name} ${protocol.slug} ${protocol.chains.join(' ')}`.toLowerCase().includes(state.query.toLowerCase())) &&
      (state.view !== 'saved' || saved.has(protocol.slug));
  }

  function filtered() {
    const source = state.view === 'recorded' ? radar.recorded.map(protocol => ({ ...protocol, implied_value_usd: protocol.mcap_usd || 0, alpha_score: 0, plan: { restricted: true }, recorded: true })) : radar.rows;
    return source.filter(matches).sort((a, b) => {
      const first = a[state.sort] ?? -Infinity, second = b[state.sort] ?? -Infinity;
      return (typeof first === 'string' ? first.localeCompare(second, 'en') : first - second) * state.direction || a.slug.localeCompare(b.slug, 'en');
    });
  }

  function renderMetrics() {
    const head = radar.rows[0];
    const validation = radar.validation;
    const metrics = [
      ['RANKED OPPORTUNITIES', `${radar.rows.length}<small> / ${radar.universe_size} scanned</small>`, `${radar.recorded.length} token records separated`, true],
      ['WATCHLIST COVERAGE', `${radar.watchlist_size}<small> / ${radar.watchlist_size}</small>`, 'Every required protocol included'],
      ['MODEL CHECK', `${validation.within_two_pct}%<small> within 2×</small>`, `${validation.held_out} held-out peers · ${validation.median_error_factor}× median error`],
      ['TOP IMPLIED VALUE', money(head.implied_value_usd), `${head.name} · base-equivalent`]
    ];
    $('metrics').innerHTML = metrics.map(([label, value, note, feature]) => `<div class="metric ${feature ? 'feature' : ''}"><div class="metric-label">${label}</div><span class="metric-corner">↗</span><div class="metric-value">${value}</div><div class="metric-note">${esc(note)}</div></div>`).join('');
  }

  function render() {
    $('saved-count').textContent = saved.size;
    $('nav-count').textContent = radar.rows.length;
    const rows = filtered();
    const recorded = state.view === 'recorded';
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / state.size) - 1));
    $('count').textContent = rows.length;
    $('board-title').firstChild.textContent = recorded ? 'Token records ' : state.view === 'saved' ? 'My research shortlist ' : 'The opportunity board ';
    $('board-caption').textContent = recorded ? 'Token identifiers already recorded. Positive market cap is observed; missing market cap is unreported.' : 'No token recorded ≠ a confirmed airdrop. Values estimate a protocol token, not your allocation.';
    renderMetrics();
    const fast = radar.rows.filter(row => row.early && row.change_7d > 10).sort((a, b) => b.change_7d - a.change_7d)[0];
    $('brief').innerHTML = fast ? `<strong>${esc(fast.name)}</strong> is below the watchlist floor with <strong>${percent(fast.change_7d)}</strong> 7d TVL growth. Inspect access and route evidence before allocating.` : 'The early view finds protocols below the watchlist floor. TVL, growth and tracked age drive the thesis; route access remains a check.';
    $('active-filters').textContent = [state.early && 'Early · TVL below $50M', state.watch && 'Required watchlist', state.category, state.chain, state.query && `Search: ${state.query}`].filter(Boolean).join('  / ');
    $('early').setAttribute('aria-pressed', state.early); $('watch').setAttribute('aria-pressed', state.watch);
    $('rows').innerHTML = rows.slice(state.page * state.size, (state.page + 1) * state.size).map(protocol => {
      const value = recorded && !protocol.mcap_usd ? 'Unreported' : money(protocol.implied_value_usd);
      const range = recorded ? 'Observed market cap' : `${money(protocol.value_low_usd)} – ${money(protocol.value_high_usd)}`;
      const action = recorded ? '—' : decision(protocol);
      const budget = recorded ? '—' : `$${protocol.plan.capital_usd} <span class="subvalue">~$${protocol.plan.estimated_total_cost_usd} cost · ${protocol.plan.days}d</span>`;
      return `<tr><td>${protocol.rank || '—'}</td><td><div class="protocol-cell">${avatar(protocol)}<div><button class="protocol-name" data-open="${esc(protocol.slug)}">${esc(protocol.name)}</button><div class="protocol-meta">${esc(protocol.category || 'Other')} · ${esc(protocol.chains[0] || 'Unknown')}${protocol.early ? '<span class="badge">EARLY</span>' : protocol.watchlist ? '<span class="badge">WATCH</span>' : ''}</div></div></div></td><td><span class="value">${value}</span><span class="subvalue">${range}</span></td><td>${money(protocol.tvl_usd)}</td><td><span class="flow ${protocol.change_7d < 0 ? 'negative' : 'positive'}">${percent(protocol.change_7d)}${protocol.change_7d === null ? '' : bars(protocol.change_7d)}</span></td><td>${recorded ? '—' : `<div class="alpha">${protocol.alpha_score}<span class="alpha-track"><i style="width:${protocol.alpha_score}%"></i></span></div>`}</td><td>${budget}</td><td><div class="open-row">${action}<button class="star ${saved.has(protocol.slug) ? 'on' : ''}" data-save="${esc(protocol.slug)}" aria-label="${saved.has(protocol.slug) ? 'Remove' : 'Save'} ${esc(protocol.name)}">${saved.has(protocol.slug) ? '★' : '☆'}</button><button data-open="${esc(protocol.slug)}" aria-label="View ${esc(protocol.name)}">↗</button></div></td></tr>`;
    }).join('');
    $('empty').hidden = rows.length > 0;
    $('page-info').textContent = rows.length ? `Showing ${state.page * state.size + 1}–${Math.min((state.page + 1) * state.size, rows.length)} of ${rows.length} protocols · sorted by ${state.sort.replaceAll('_', ' ')}` : '0 protocols';
    $('prev').disabled = state.page === 0; $('next').disabled = (state.page + 1) * state.size >= rows.length;
    $('coverage').textContent = `${radar.watchlist_size}/${radar.watchlist_size}`;
    $('as-of').textContent = radar.as_of;
  }

  function peerEvidence(model) {
    if (!model.peer_evidence.length) return '<p class="note">No category peers; the global prior is used.</p>';
    return model.peer_evidence.map(row => `<div><strong>${esc(row.name)}</strong><span>${money(row.mcap_usd)} cap / ${money(row.tvl_usd)} TVL</span><b>${row.clipped_ratio.toFixed(3)}×${row.ratio !== row.clipped_ratio ? ' clipped' : ''}</b></div>`).join('');
  }

  function planMarkup(plan) {
    const steps = plan.steps.map(step => `<div class="plan-step"><b>${esc(step.title)}</b><p>${esc(step.text)}</p><span>${esc(step.cost)} · ${esc(step.time)}</span></div>`).join('');
    return `<div class="panel plan-panel"><div class="panel-label">YOUR FARM PLAN <span style="float:right">${esc(plan.route_label)}</span></div><div class="plan-callout"><strong>${esc(plan.chain)} · ${plan.days} days</strong><span>${esc(plan.risk)}</span></div>${steps}<div class="plan-total"><span>FUNDING TARGET</span><span>ESTIMATED COST</span><strong>$${plan.funding_budget_usd}</strong><strong>~$${plan.estimated_total_cost_usd}</strong><small>${esc(plan.stop_rule)} Reward status: ${esc(plan.reward)}.</small></div></div>`;
  }

  function openDetail(slug) {
    const protocol = radar.rows.find(row => row.slug === slug);
    if (!protocol) {
      const recorded = radar.recorded.find(row => row.slug === slug);
      if (!recorded) return;
      $('detail-view').innerHTML = `<button class="back" data-back>← Back to board</button><h1>${esc(recorded.name)}</h1><div class="panel"><h2>Token already recorded</h2><p>${esc(recorded.symbol || recorded.gecko_id || 'Market cap record')} · TVL ${money(recorded.tvl_usd)} · ${recorded.mcap_usd ? money(recorded.mcap_usd) + ' market cap' : 'Market cap unreported'}</p><p class="note">Excluded from the pre-token valuation board. A token record does not establish a new farming campaign.</p></div>`;
    } else {
      const model = protocol.model, plan = protocol.plan, validation = radar.validation;
      const signalRows = Object.entries(model.signals).map(([key, number]) => `<div class="signal"><span>${esc(labels[key] || key)}</span><span class="alpha-track"><i style="width:${number}%"></i></span><b>${number}</b></div>`).join('');
      $('detail-view').innerHTML = `<button class="back" data-back>← Back to launch radar</button><div class="detail-heading"><div class="detail-identity">${avatar(protocol)}<div><div class="eyebrow">PROTOCOL DOSSIER / RANK ${String(protocol.rank).padStart(2, '0')}</div><h1>${esc(protocol.name)}</h1><p>${esc(protocol.category || 'Other')} <span class="separator">/</span> ${esc(plan.chain)} <span class="separator">/</span> ${model.age === null ? `Listing age unknown · model uses ${model.model_age_days}d prior` : `${model.age} days tracked`}</p></div></div><button data-save="${esc(protocol.slug)}">${saved.has(protocol.slug) ? '★ Shortlisted' : '☆ Add to shortlist'}</button></div><div class="detail-grid"><div><div class="panel valuation"><div class="panel-label">IMPLIED TOKEN VALUE · ${state.scenario === 1 ? 'BASE' : state.scenario < 1 ? 'BEAR' : 'BULL'} CASE</div><div class="detail-value">${money(protocol.implied_value_usd)}</div><div class="range"><span>${money(protocol.value_low_usd)}</span><div class="range-track"></div><span>${money(protocol.value_high_usd)}</span></div><div class="formula">${money(protocol.tvl_usd)} TVL × ${model.multiple}× peer × ${model.growth} growth × ${model.maturity} maturity</div><p class="note">Circulating-equivalent estimate, not FDV or personal rewards. The planning band uses pooled held-out peer error, not a protocol-specific prediction interval.</p></div><div class="panel"><div class="detail-stats"><div><small>TVL</small><strong>${money(protocol.tvl_usd)}</strong></div><div><small>7D TVL CHANGE</small><strong class="${protocol.change_7d < 0 ? 'negative' : 'positive'}">${percent(protocol.change_7d)}</strong></div><div><small>MODEL CONFIDENCE</small><strong>${model.confidence}<small> / 100</small></strong></div></div></div><div class="panel"><div class="panel-label">WHY THIS PROTOCOL TRIGGERED <span style="float:right">${model.alpha}/100 PRIORITY</span></div>${signalRows}</div><div class="panel"><div class="panel-label">TRACE THE VALUATION</div><p class="note">${model.peer_count ? `${model.peer_count} ${esc(protocol.category || 'Other')} peers inform this multiple at ${model.peer_weight}× category weight.` : 'No same-category peer was available; the global prior carries the estimate.'} The category median is ${model.category_median === null ? 'unavailable' : `${model.category_median}×`} versus a ${model.global_median}× global median.</p><div class="peer-evidence">${peerEvidence(model)}</div></div></div><div>${planMarkup(plan)}<div class="panel"><div class="panel-label">PLAN ECONOMICS</div><div class="detail-stats"><div><small>TEST CAPITAL</small><strong>$${plan.test_capital_usd}</strong></div><div><small>NETWORK FEES</small><strong>~$${plan.fee_budget_usd}</strong></div><div><small>OPPORTUNITY COST</small><strong>~$${plan.opportunity_cost_usd}</strong></div></div><p class="note">Fees are estimates, not quotes. No campaign, allocation or reward is present in the sealed snapshot.</p></div><div class="panel"><div class="panel-label">MODEL CHECK</div><p class="note">${validation.within_two_pct}% of ${validation.held_out} held-out recorded peers are within 2× on raw market-cap / TVL. Median error is ${validation.median_error_factor}×. The model is a prioritization aid, not a token or safety claim.</p></div></div></div>`;
    }
    $('board-view').hidden = true; $('method-view').hidden = true; $('detail-view').hidden = false;
    $('breadcrumb').textContent = protocol?.name || slug;
    window.scrollTo(0, 0);
  }

  function method() {
    const validation = radar.validation;
    $('method-view').innerHTML = `<div class="eyebrow">A MODEL YOU CAN INSPECT</div><h1 class="method-title">Evidence before conviction.</h1><p class="method-lede">A deterministic reconstruction of circulating-equivalent token value from the sealed snapshot. It ranks a research queue; it does not predict issuance or a personal airdrop.</p><div class="method-grid"><div class="panel"><h3>Value from the same universe</h3><p>${radar.peer_count} protocols have positive token market cap and TVL. Each ratio is clipped to 0.03–3× for the model. Category medians shrink toward the global ${radar.peer_multiple}× prior; shrinkage is selected by leave-one-out peer error.</p><code>multiple = shrink(category median, global median)<br>value = TVL × multiple × growth × maturity</code></div><div class="panel"><h3>Held-out model check</h3><div class="method-stat"><strong>${validation.within_two_pct}%</strong><span>within 2× of raw held-out market-cap / TVL</span></div><div class="method-stat"><strong>${validation.median_error_factor}×</strong><span>median absolute error factor across ${validation.held_out} peers</span></div><p class="note">The planning band uses the capped 75th-percentile held-out error factor (${validation.p75_error_factor}×). This pooled reconstruction diagnostic is not a protocol-specific prediction interval.</p></div></div><div class="panel"><div class="panel-label">INPUT BOUNDARIES</div><div class="method-list"><p><b>Known:</b> TVL, 7-day TVL change, tracked date, category, chains and token-record fields from the sealed snapshot.</p><p><b>Unknown:</b> token issuance, supply, FDV, campaign, allocation, eligibility, audits, authorities and holder concentration.</p><p><b>Interpretation:</b> a high rank means “research this first.” It never means a confirmed launch, reward or safe contract.</p></div></div><div class="panel"><div class="panel-label">ROUTE DESIGN</div><p>Every row has a five-step plan: locate the official route, verify access, run only a small test when a public route exists, prove the exit, and reassess. Gated categories begin as research-only. Transaction fees, time and opportunity cost are shown separately from test capital.</p></div>`;
    $('board-view').hidden = true; $('detail-view').hidden = true; $('method-view').hidden = false; $('breadcrumb').textContent = 'Value model';
  }

  function navigate(view) {
    state.view = view; state.page = 0;
    document.querySelectorAll('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === view));
    if (view === 'method') return method();
    $('board-view').hidden = false; $('detail-view').hidden = true; $('method-view').hidden = true;
    $('breadcrumb').textContent = view === 'saved' ? 'My shortlist' : view === 'recorded' ? 'Token recorded' : 'Launch radar';
    render();
  }

  function reset() {
    Object.assign(state, { early: false, watch: false, query: '', category: '', chain: '', page: 0 });
    $('search').value = ''; $('category').value = ''; $('chain').value = ''; render();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.open) { location.hash = 'protocol/' + encodeURIComponent(button.dataset.open); return; }
    if (button.dataset.save) { save(button.dataset.save); if (!$('detail-view').hidden) openDetail(button.dataset.save); return; }
    if (button.hasAttribute('data-back')) { location.hash = 'board'; navigate('board'); return; }
    if (button.dataset.view) { location.hash = button.dataset.view; navigate(button.dataset.view); return; }
    if (button.dataset.sort) { state.direction = state.sort === button.dataset.sort ? -state.direction : button.dataset.sort === 'name' ? 1 : -1; state.sort = button.dataset.sort; state.page = 0; render(); }
  });
  $('search').addEventListener('input', event => { state.query = event.target.value; state.page = 0; render(); });
  for (const id of ['category', 'chain']) $(id).addEventListener('change', event => { state[id] = event.target.value; state.page = 0; render(); });
  for (const id of ['early', 'watch']) $(id).onclick = () => { state[id] = !state[id]; state.page = 0; render(); };
  $('early-shortcut').onclick = () => { state.early = true; state.page = 0; render(); };
  $('clear').onclick = reset;
  $('prev').onclick = () => { state.page--; render(); };
  $('next').onclick = () => { state.page++; render(); };
  $('scenario').onchange = event => { state.scenario = Number(event.target.value); radar = E.buildRadar(SNAPSHOT, state.scenario); render(); };
  $('export').onclick = () => { const data = JSON.stringify({ as_of: radar.as_of, scenario: state.scenario, validation: radar.validation, rows: filtered() }, null, 2); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); link.download = 'aperture-board.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast('Exported board, evidence and farm plans'); };
  function route() {
    let hash;
    try { hash = decodeURIComponent(location.hash.slice(1)); } catch { hash = 'board'; }
    if (hash.startsWith('protocol/')) { if (!radar.rows.some(row => row.slug === hash.slice(9)) && !radar.recorded.some(row => row.slug === hash.slice(9))) return navigate('board'); openDetail(hash.slice(9)); }
    else navigate(['saved', 'recorded', 'method'].includes(hash) ? hash : 'board');
  }
  window.addEventListener('hashchange', route);
  populateFilters(); render(); route();
  globalThis.Aperture = { state, get radar() { return radar; }, filtered, openDetail, reset };
})();

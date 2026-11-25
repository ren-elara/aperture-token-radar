/* Offline research terminal. All text from the snapshot is escaped before rendering. */
(() => {
  'use strict';
  const E = globalThis.RadarEngine, snapshot = globalThis.SNAPSHOT;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = value => Number.isFinite(value) ? '$' + (Math.abs(value) >= 1e9 ? (value / 1e9).toFixed(2) + 'B' : Math.abs(value) >= 1e6 ? (value / 1e6).toFixed(2) + 'M' : Math.abs(value) >= 1e3 ? (value / 1e3).toFixed(1) + 'K' : value.toFixed(2)) : '—';
  const number = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
  const flow = value => value === null ? 'Not recorded' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  let saved;
  try { saved = new Set(JSON.parse(localStorage.getItem('aperture-shortlist') || '[]').filter(s => snapshot.protocols.some(p => p.slug === s))); } catch { saved = new Set(); }
  const state = { view:'board', query:'', category:'', chain:'', early:false, watch:false, sort:'implied_value_usd', direction:-1, page:0, scenario:1 };
  let radar = E.buildRadar(snapshot), activeSlug = null;
  const budgets = new Map(), pageSize = 8;
  const names = { board:'Launch radar', saved:'My shortlist', recorded:'Token recorded', excluded:'Other products', method:'Value model' };
  function filtered() {
    const source = state.view === 'recorded' ? radar.recorded : state.view === 'excluded' ? radar.excluded : radar.rows;
    return source.filter(p => (state.view !== 'saved' || saved.has(p.slug)) && (!state.query || `${p.name} ${p.slug} ${p.symbol || ''} ${p.category || ''} ${p.chains.join(' ')}`.toLowerCase().includes(state.query.toLowerCase())) &&
      (!state.category || p.category === state.category) && (!state.chain || p.chains.includes(state.chain)) && (!state.early || p.early) && (!state.watch || p.watchlist))
      .sort((a, b) => {
        const key = state.sort === 'implied_value_usd' && !a.model ? 'mcap_usd' : state.sort;
        const x = a[key], y = b[key];
        return (typeof x === 'string' && typeof y === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : (x ?? -1e20) - (y ?? -1e20)) * state.direction || a.slug.localeCompare(b.slug, 'en');
      });
  }
  function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 2500); }
  function save(slug) {
    saved.has(slug) ? saved.delete(slug) : saved.add(slug);
    try { localStorage.setItem('aperture-shortlist', JSON.stringify([...saved])); } catch { toast('Shortlist kept for this session. Storage is unavailable.'); }
    render(); if (activeSlug) detail(activeSlug);
  }
  function cohortSummary() {
    const c = radar.cohorts;
    return `<strong>${radar.universe_size} source records</strong> = ${radar.rows.length} candidates + ${c.recorded} token records + ${c.excluded} other products. Candidates = ${c.watchlist} required watchlist + ${c.below_floor} other below-floor + ${c.other_above_floor} other above-floor protocols.`;
  }
  function comparison() {
    const rows = radar.rows.filter(p => saved.has(p.slug)).slice(0, 2);
    if (state.view !== 'saved' || rows.length < 2) return '';
    return `<div class="comparison"><div><div class="eyebrow">SIDE BY SIDE · FIRST TWO BY VALUE</div><h3>Compare the thesis, then the cost.</h3><p>All figures share the same snapshot and scenario. Capital is recoverable only if the exit works.</p></div>${rows.map(p => `<button data-open="${esc(p.slug)}"><strong>${esc(p.name)}</strong><span>${money(p.implied_value_usd)} <small>implied value</small></span><span>${money(p.value_low_usd)} – ${money(p.value_high_usd)} <small>error scale</small></span><span>${money(p.plan.break_even_reward_usd)} <small>cost incl. time / ${p.plan.days}d</small></span></button>`).join('')}</div>`;
  }
  function render() {
    const inspection = ['recorded', 'excluded'].includes(state.view), rows = filtered();
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    $('#board-view').hidden = state.view === 'method' || !!activeSlug;
    $('#method-view').hidden = state.view !== 'method' || !!activeSlug;
    $('#detail-view').hidden = !activeSlug;
    $('#breadcrumb').textContent = names[state.view];
    document.querySelectorAll('.nav').forEach(b => { b.classList.toggle('active', b.dataset.view === state.view); b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'); });
    $('#nav-count').textContent = radar.rows.length; $('#saved-count').textContent = saved.size;
    $('#recorded-count').textContent = radar.recorded.length; $('#excluded-count').textContent = radar.excluded.length;
    $('#as-of').textContent = `${radar.as_of} · ${radar.universe_size} RECORDS`;
    $('#coverage').textContent = `${radar.watchlist_size}/${snapshot.watchlist.length}`;
    $('#metrics').innerHTML = [[radar.rows.length,'CANDIDATES','No token recorded in snapshot'],[`${radar.watchlist_size}/${snapshot.watchlist.length}`,'REQUIRED COVERAGE','Input watchlist, never a fixed list'],[radar.peer_count,'TRADED PEERS',`${radar.validation.held_out} held-out predictions`],[`${radar.validation.median_error_factor.toFixed(2)}×`,'MEDIAN MODEL ERROR','Empirical error; not a promise']].map(([n,label,note]) => `<div><small>${label}</small><strong>${n}</strong><span>${note}</span></div>`).join('');
    $('#brief').innerHTML = cohortSummary();
    $('#count').textContent = `${rows.length} / ${inspection ? (state.view === 'recorded' ? radar.recorded.length : radar.excluded.length) : radar.rows.length}`;
    $('#board-title-text').textContent = state.view === 'saved' ? 'Your research shortlist' : state.view === 'recorded' ? 'Observed token records' : state.view === 'excluded' ? 'Products set aside' : 'The opportunity board';
    $('#board-caption').textContent = inspection ? 'Inspect every source record. These rows are outside the candidate board; observed market cap is never a token-launch estimate.' : 'Conditional token market cap, not FDV or personal reward. Open a row to inspect the evidence and exit plan.';
    $('#value-sort').textContent = `${inspection ? 'OBSERVED MCAP' : 'IMPLIED VALUE'} ${state.sort === 'implied_value_usd' ? state.direction < 0 ? '↓' : '↑' : '↕'}`;
    $('#scenario').disabled = inspection;
    for (const id of ['early','watch']) { $('#' + id).disabled = inspection; $('#' + id).setAttribute('aria-pressed', String(state[id])); }
    $('#active-filters').textContent = [state.query && `Search: ${state.query}`,state.category,state.chain,state.early && `Below ${money(radar.floor_usd)} TVL`,state.watch && 'Required watchlist'].filter(Boolean).join(' · ');
    $('#comparison').innerHTML = comparison();
    $('#rows').innerHTML = rows.slice(state.page * pageSize, (state.page + 1) * pageSize).map((p, i) => `<tr><td class="rank">${p.rank || state.page * pageSize + i + 1}</td><td><button class="protocol" data-open="${esc(p.slug)}"><span class="avatar">${esc(p.name.slice(0,2).toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.category || 'Other')} · ${esc(p.chains.slice(0,2).join(', ') || 'Chain unknown')}</small></span></button></td><td class="value">${money(p.model ? p.implied_value_usd : p.mcap_usd)}<small>${p.model ? `${money(p.value_low_usd)} – ${money(p.value_high_usd)}` : esc(p.symbol || 'No symbol recorded')}</small></td><td>${money(p.tvl_usd)}${p.early ? '<small class="accent">BELOW FLOOR</small>' : ''}</td><td class="${p.change_7d !== null && p.change_7d < 0 ? 'negative' : 'positive'}">${flow(p.change_7d)}</td><td>${p.model ? `<b>${p.alpha_score}</b><small>screen score /100</small>` : '—'}</td><td>${p.plan ? `${money(p.plan.funding_budget_usd)}<small>${p.plan.route_label} · ${p.plan.days}d</small>` : 'Outside board'}</td><td class="actions">${p.model ? `<button data-save="${esc(p.slug)}" aria-label="${saved.has(p.slug) ? 'Remove' : 'Save'} ${esc(p.name)}" aria-pressed="${saved.has(p.slug)}">${saved.has(p.slug) ? '★' : '☆'}</button>` : ''}<button data-open="${esc(p.slug)}" aria-label="Inspect ${esc(p.name)}">↗</button></td></tr>`).join('');
    $('#empty').hidden = rows.length > 0;
    $('#page-info').textContent = rows.length ? `${state.page * pageSize + 1}–${Math.min(rows.length,(state.page + 1) * pageSize)} of ${rows.length} · sorted ${state.sort.replaceAll('_',' ')} ${state.direction < 0 ? 'descending' : 'ascending'}` : '0 results';
    $('#prev').disabled = state.page === 0; $('#next').disabled = (state.page + 1) * pageSize >= rows.length;
    if (state.view === 'method') method();
  }
  function peerEvidence(p) {
    const peers = p.model.peer_evidence;
    return `<div class="peer-evidence">${peers.length ? peers.map(r => `<div><span><strong>${esc(r.name)}</strong><small>${esc(r.slug)}</small></span><span>${money(r.mcap_usd)}<small>observed cap</small></span><span>${money(r.tvl_usd)}<small>TVL</small></span><span>${r.ratio.toFixed(3)}×<small>raw cap / TVL</small></span></div>`).join('') : '<p>No same-category traded peers. The global size model supplies the estimate.</p>'}</div>`;
  }
  function detail(slug) {
    const p = radar.rows.find(p => p.slug === slug) || snapshot.protocols.find(p => p.slug === slug);
    if (!p) { activeSlug = null; render(); return; }
    activeSlug = slug; render();
    const v = p.model, plan = v ? E.farmPlan(p, v.age, budgets.get(slug)) : null;
    $('#detail-view').innerHTML = `<div class="detail-top"><button data-back>← Back to ${names[state.view]}</button>${v ? `<button data-save="${esc(slug)}">${saved.has(slug) ? '★ Saved to shortlist' : '☆ Save to shortlist'}</button>` : ''}</div><div class="detail-heading"><div><div class="eyebrow">${v ? `CANDIDATE ${p.rank} / ${radar.rows.length}` : 'SOURCE RECORD · OUTSIDE CANDIDATE BOARD'} · ${esc(radar.as_of)}</div><h1>${esc(p.name)}</h1><p>${esc(p.category || 'Other')} <span class="separator">/</span> ${esc(p.chains.join(' · ') || 'Chain not recorded')} <span class="separator">/</span> ${esc(p.slug)}</p></div><div class="detail-value"><small>${v ? 'CONDITIONAL TOKEN MARKET CAP' : 'OBSERVED TOKEN MARKET CAP'}</small><strong>${money(v ? p.implied_value_usd : p.mcap_usd)}</strong><span>${v ? `${money(p.value_low_usd)} – ${money(p.value_high_usd)} empirical error scale` : esc(p.symbol || 'No symbol recorded')}</span></div></div>
    ${!v ? `<article class="panel"><h2>Why this record is set aside</h2><p>${E.tokenStatus(p) === 'recorded' ? 'A symbol, CoinGecko ID or positive market cap is recorded. It is not treated as a tokenless candidate.' : 'Category or name identifies a wrapper, bridge, exchange or versioned product. It is separated by a transparent heuristic; parent-token relationships are unavailable.'}</p><p>TVL ${money(p.tvl_usd)} · 7-day change ${flow(p.change_7d)} · CoinGecko ID ${esc(p.gecko_id)}</p></article>` : `
    <div class="notice">No campaign, points, token supply or personal allocation is recorded. This estimates a hypothetical protocol token’s market cap conditional on launch. ${p.watchlist ? 'Included in the input’s required watchlist.' : ''}</div>
    <div class="detail-grid"><article class="panel"><div class="eyebrow">TRACE THE VALUATION</div><h2>A model you can take apart.</h2><div class="formula"><span>${money(p.tvl_usd)}<small>snapshot TVL</small></span><i>×</i><span>${v.multiple.toFixed(4)}×<small>size + category multiple</small></span><i>×</i><span>${v.growth.toFixed(4)}<small>7d growth factor</small></span><i>×</i><span>${v.maturity.toFixed(4)}<small>listing-age factor</small></span><i>×</i><span>${state.scenario}×<small>scenario</small></span></div><p>log(cap / TVL) = intercept + size coefficient × log(TVL / $100M) + growth coefficient × clipped 7d change / 100 + age coefficient × log(1 + days / 365) + shrunk category residual.</p><dl><div><dt>Same-category peers</dt><dd>${v.peer_count} / ${radar.peer_count} total; ${Math.round(v.peer_weight * 100)}% category weight</dd></div><div><dt>Size adjustment</dt><dd>${v.size_factor.toFixed(3)}× at this TVL</dd></div><div><dt>Listing age</dt><dd>${v.age === null ? `Missing → ${v.model_age_days}d training median` : `${v.age} days since listing, not launch`}</dd></div><div><dt>Seven-day TVL change</dt><dd>${p.change_7d === null ? 'Missing → training median' : `${flow(p.change_7d)}; clipped to −60% / +150%`}</dd></div><div><dt>Uncertainty scale</dt><dd>÷ / × ${v.validation_band} · held-out p75 error</dd></div></dl><p class="muted">Error scale is cross-sectional peer error, not a probability interval or a tokenless-protocol backtest. Bear and bull are explicit stress assumptions of 0.5× and 1.8×.</p><button data-method>Inspect validation and coefficients ↗</button><h3>Nearest same-category evidence</h3><p class="muted">Nearest by TVL; raw observed ratios, without clipping. The fit uses all eligible peers.</p>${peerEvidence(p)}</article>
    <article class="panel"><div class="eyebrow">YOUR FARM PLAN</div><h2>${plan.route_label}.</h2><p>${esc(plan.risk)}</p><div class="plan-controls"><label>Target capital ($)<input data-budget="capital" type="number" min="20" max="10000" value="${plan.restricted ? 100 : plan.capital_usd}" ${plan.restricted ? 'disabled' : ''}></label><label>Review window (days)<input data-budget="days" type="number" min="7" max="90" value="${plan.days}"></label><label>Your time ($/hour)<input data-budget="hourly" type="number" min="0" max="500" value="${plan.hourly_rate_usd}"></label></div><div class="economics"><div class="eyebrow">PLAN ECONOMICS · EDITABLE ASSUMPTIONS</div><div class="cost-grid"><span>Cash to fund<strong>${money(plan.funding_budget_usd)}</strong><small>Capital + network + fee reserve</small></span><span>Cost incl. time<strong>${money(plan.break_even_reward_usd)}</strong><small>Break-even reward at this budget</small></span></div><dl><div><dt>Capital at risk / test included</dt><dd>${money(plan.capital_usd)} / ${money(plan.test_capital_usd)}</dd></div><div><dt>Network allowance</dt><dd>${plan.fee_transactions} actions × ${money(plan.network_fee_per_action_usd)} = ${money(plan.fee_budget_usd)}</dd></div><div><dt>Product-fee reserve</dt><dd>${money(plan.product_fee_reserve_usd)} · assumed 0.5% of capital</dd></div><div><dt>Opportunity cost</dt><dd>${money(plan.opportunity_cost_usd)} · assumed 5% annual × ${plan.days}d</dd></div><div><dt>Time allowance</dt><dd>${plan.time_minutes} min × ${money(plan.hourly_rate_usd)}/h = ${money(plan.labor_cost_usd)}</dd></div></dl><p>Fee rates and route are planning assumptions, not observed quotes. ${plan.weekly_reviews} off-chain reviews require no transactions. Product fees, slippage, bridge costs, losses and exit queues can exceed the reserve. No reward or eligibility is assumed.</p></div><ol class="steps">${plan.steps.map(s => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><small>${esc(s.cost)} <b>·</b> ${esc(s.time)}</small></li>`).join('')}</ol></article></div>`}`;
  }
  function method() {
    const v = radar.validation, c = v.coefficients;
    const modelRows = [['Full model',v],['Global median cap / TVL',v.baseline],...Object.entries(v.ablations).map(([key, value]) => [`Without ${key} · fixed inner choice`, value])];
    $('#method-view').innerHTML = `<div class="page-heading"><div class="eyebrow">METHODOLOGY / AUDIT THE EDGE</div><h1>Evidence before conviction.</h1></div><div class="method-grid"><article class="panel"><h2>Reconcile the input.</h2><p>${cohortSummary()}</p><p>${esc(snapshot.source)} · ${esc(snapshot.as_of)} · floor ${money(snapshot.floor_usd)}. All ${snapshot.watchlist.length} input watchlist slugs are covered.</p><p>Symbol, CoinGecko ID or positive cap means token recorded. Category/name heuristics separate wrappers, bridges, exchanges and versions. Required watchlist entries override exclusion; conflicts remain explicit.</p><p>Missing cap (including −1) stays unknown; missing growth/age use training medians. Listing date is a proxy. Parent relationships, fees, usage, funding, FDV, supply and campaigns are absent.</p><p>Values are conditional token market caps if launch prices resemble traded survivors. TVL may be double counted. This is not FDV, reward value or a forecast of token issuance.</p></article><article class="panel"><h2>Validate the whole formula.</h2><p>${v.held_out} positive-cap/TVL peers, excluding CEX. Deterministic nested five-fold validation holds each peer out of fitting and tuning. Four inner folds select ridge and category shrinkage by mean absolute log error; final coefficients refit all peers.</p><p>Six Huber reweighting passes fit raw log(cap / TVL), with regularized size, growth and age. Category median residual weight = n / (n + ${v.selected_shrinkage}); ridge = ${v.selected_ridge}. No ratio clipping.</p><div class="validation-metrics"><span><strong>${v.median_error_factor.toFixed(2)}×</strong>median error</span><span><strong>${v.p75_error_factor.toFixed(2)}×</strong>p75 error</span><span><strong>${v.within_two_pct}%</strong>within 2×</span></div><p>Error factor = exp(|log predicted cap − log observed cap|). Ranges divide/multiply by p75 error; they have no calibrated coverage claim or demonstrated future-launch accuracy.</p></article></div><article class="panel validation-table"><h2>Which terms help?</h2><p>Same outer folds. Ablations keep the full model’s inner-selected configuration; they are diagnostics, not separately tuned models. Size helps most; other terms show small or mixed gains.</p><table><thead><tr><th>MODEL</th><th>MEDIAN FACTOR</th><th>P75 FACTOR</th><th>MEAN ABS LOG ERROR</th><th>WITHIN 2×</th></tr></thead><tbody>${modelRows.map(([label,m]) => `<tr><td>${label}</td><td>${m.median_error_factor.toFixed(3)}×</td><td>${m.p75_error_factor.toFixed(3)}×</td><td>${m.mean_abs_log_error.toFixed(3)}</td><td>${m.within_two_pct}%</td></tr>`).join('')}</tbody></table><div class="coefficients">${Object.entries(c).map(([k,n]) => `<span>${k}<b>${n.toFixed(6)}</b></span>`).join('')}</div><p>log(cap / TVL) = intercept + size × log(TVL / 100M) + growth × clip(7d%, −60, 150) / 100 + age × log(1 + days / 365) + category residual. Scenarios: 0.5× / 1× / 1.8× after fitting.</p></article><article class="panel"><h2>Screen, then budget.</h2><p>Alpha /100 = 35% momentum + 30% log TVL scale + 15% listing maturity + 10% evidence + 10% category actionability: declared heuristics, not win probabilities. Early means below-floor TVL.</p><p>Default plan: $100 including a $20 test; 28 days, or 42 below 180-day listing age; 0.5% product-fee reserve, 5% annual opportunity cost and $15/hour. Network allowance: 4 actions on Solana/Sui, 6 elsewhere; $18 each on Ethereum, $10 Bitcoin, $3 elsewhere. These are assumptions. Restricted categories remain research-only. No reward probability is available.</p></article>`;
  }
  function navigate(view) {
    activeSlug = null; state.view = names[view] ? view : 'board'; state.page = 0;
    if (['recorded','excluded'].includes(state.view)) { state.early = false; state.watch = false; }
    history.replaceState(null, '', `#${state.view}`); render(); window.scrollTo(0,0);
  }
  function route() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch { hash = ''; }
    if (hash.startsWith('protocol/')) detail(hash.slice(9)); else navigate(hash || 'board');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button,a.brand'); if (!button) return;
    if (button.dataset.open) { location.hash = `protocol/${encodeURIComponent(button.dataset.open)}`; window.scrollTo(0,0); }
    else if (button.dataset.save) save(button.dataset.save);
    else if (button.hasAttribute('data-back')) navigate(state.view);
    else if (button.hasAttribute('data-method')) navigate('method');
    else if (button.dataset.view || button.matches('a.brand')) navigate(button.dataset.view || 'board');
    else if (button.dataset.sort) { state.direction = state.sort === button.dataset.sort ? -state.direction : button.dataset.sort === 'name' ? 1 : -1; state.sort = button.dataset.sort; render(); }
  });
  $('#search').addEventListener('input', e => { state.query = e.target.value; state.page = 0; render(); });
  for (const key of ['category','chain']) {
    const values = [...new Set(snapshot.protocols.flatMap(p => key === 'chain' ? p.chains : [p.category]).filter(Boolean))].sort();
    $('#' + key).innerHTML += values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('#' + key).addEventListener('change', e => { state[key] = e.target.value; state.page = 0; render(); });
  }
  for (const key of ['early','watch']) $('#' + key).addEventListener('click', () => { state[key] = !state[key]; state.page = 0; render(); });
  $('#early-shortcut').addEventListener('click', () => { navigate('board'); state.early = true; render(); });
  $('#clear').addEventListener('click', () => { for (const k of ['query','category','chain']) state[k] = ''; state.early = state.watch = false; state.page = 0; $('#search').value = $('#category').value = $('#chain').value = ''; render(); });
  for (const [key,direction] of [['prev',-1],['next',1]]) $('#' + key).addEventListener('click', () => { state.page += direction; render(); });
  $('#scenario').addEventListener('change', e => { state.scenario = +e.target.value; radar = E.buildRadar(snapshot,state.scenario); render(); });
  $('#detail-view').addEventListener('change', e => { if (!e.target.dataset.budget || !activeSlug) return; const p = radar.rows.find(p => p.slug === activeSlug), plan = E.farmPlan(p,p.model.age,budgets.get(activeSlug)); budgets.set(activeSlug,{capital:plan.capital_usd || 100,days:plan.days,hourly:plan.hourly_rate_usd,...budgets.get(activeSlug),[e.target.dataset.budget]:+e.target.value}); detail(activeSlug); });
  $('#export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ ...radar, shortlist:[...saved], scenario:state.scenario, personal_plan_assumptions:Object.fromEntries(budgets) },null,2)],{type:'application/json'})), link = document.createElement('a'); link.href = url; link.download = `aperture-${radar.as_of}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Research board exported.'); });
  globalThis.Aperture = { get radar() { return radar; }, state, filtered };
  window.addEventListener('hashchange',route); route();
})();

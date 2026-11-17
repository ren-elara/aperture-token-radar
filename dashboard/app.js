(() => {
  'use strict';
  const E = globalThis.RadarEngine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'K' : Math.round(n).toLocaleString('en-US'));
  const percent = n => n === null ? 'Unreported' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const state = { view: 'board', early: false, watch: false, query: '', category: '', chain: '', sort: 'implied_value_usd', direction: -1, page: 0, size: 8, scenario: 1 };
  let saved;
  try { saved = new Set(JSON.parse(localStorage.getItem('aperture-shortlist') || '[]')); } catch { saved = new Set(); }
  let radar = E.buildRadar(SNAPSHOT);
  const avatar = p => `<span class="avatar" aria-hidden="true">${esc(p.name.charAt(0))}</span>`;
  const bars = n => `<span class="micro-bars" aria-label="seven-day change magnitude"><i style="height:5px"></i><i style="height:${n >= 0 ? 8 : 16}px"></i><i style="height:10px"></i><i style="height:${n >= 0 ? 13 : 9}px"></i><i style="height:${n >= 0 ? 17 : 5}px"></i></span>`;
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 2000); }
  function save(slug) {
    if (saved.has(slug)) saved.delete(slug); else saved.add(slug);
    try { localStorage.setItem('aperture-shortlist', JSON.stringify([...saved])); } catch { toast('Shortlist saved for this visit'); }
    $('saved-count').textContent = saved.size;
    render();
  }
  function populateFilters() {
    const options = (values, first) => `<option value="">${first}</option>` + [...new Set(values)].sort().map(x => `<option>${esc(x)}</option>`).join('');
    $('category').innerHTML = options(SNAPSHOT.protocols.map(p => p.category || 'Other'), 'All categories');
    $('chain').innerHTML = options(SNAPSHOT.protocols.flatMap(p => p.chains), 'All chains');
  }
  function matches(r) {
    return (!state.early || r.early) && (!state.watch || r.watchlist) && (!state.category || (r.category || 'Other') === state.category) && (!state.chain || r.chains.includes(state.chain)) && (!state.query || `${r.name} ${r.slug} ${r.chains.join(' ')}`.toLowerCase().includes(state.query.toLowerCase())) && (state.view !== 'saved' || saved.has(r.slug));
  }
  function filtered() {
    const source = state.view === 'recorded' ? radar.recorded.map(p => ({...p, implied_value_usd:p.mcap_usd || 0, alpha_score:0, model:{}, plan:{ capital_usd:0 }, recorded:true})) : radar.rows;
    return source.filter(matches).sort((a, b) => {
      const x = a[state.sort] ?? -Infinity, y = b[state.sort] ?? -Infinity;
      return (typeof x === 'string' ? x.localeCompare(y, 'en') : x - y) * state.direction || a.slug.localeCompare(b.slug, 'en');
    });
  }
  function render() {
    $('saved-count').textContent = saved.size;
    $('nav-count').textContent = radar.rows.length;
    const rows = filtered(), recorded = state.view === 'recorded';
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / state.size) - 1));
    $('count').textContent = rows.length;
    $('board-title').firstChild.textContent = recorded ? 'Token records ' : state.view === 'saved' ? 'My research shortlist ' : 'The opportunity board ';
    $('board-caption').textContent = recorded ? 'Token identifiers already recorded. Positive market cap is observed; missing market cap is unreported.' : 'No token recorded ≠ a confirmed airdrop. Values estimate a protocol token, not your allocation.';
    const head = radar.rows[0], early = radar.rows.filter(r => r.early).length;
    $('metrics').innerHTML = [
      ['PROTOCOLS RANKED', `${radar.rows.length}<small> / ${radar.universe_size} scanned</small>`, `${radar.recorded.length} token records separated`, true],
      ['WATCHLIST COVERAGE', `${radar.watchlist_size}<small> / ${radar.watchlist_size}</small>`, 'Every required protocol included'],
      ['EARLY SIGNALS', `${early}<small> below $50M TVL</small>`, 'Beyond the required watchlist'],
      ['TOP IMPLIED VALUE', money(head.implied_value_usd), head.name + ' · base-equivalent', false]
    ].map(([label,value,note,feature]) => `<div class="metric ${feature?'feature':''}"><div class="metric-label">${label}</div><span class="metric-corner">↗</span><div class="metric-value">${value}</div><div class="metric-note">${esc(note)}</div></div>`).join('');
    const fast = radar.rows.filter(r => r.early && r.change_7d > 10).sort((a,b) => b.change_7d-a.change_7d)[0];
    $('brief').innerHTML = fast ? `<strong>${esc(fast.name)}</strong> is below the watchlist floor with <strong>${percent(fast.change_7d)}</strong> 7d TVL growth. Inspect the thesis before allocating.` : 'The early view finds protocols below the watchlist floor. Listing age and TVL growth drive the thesis.';
    $('active-filters').textContent = [state.early && 'Early · TVL below $50M', state.watch && 'Required watchlist', state.category, state.chain, state.query && `Search: ${state.query}`].filter(Boolean).join('  /  ');
    $('early').setAttribute('aria-pressed', state.early); $('watch').setAttribute('aria-pressed', state.watch);
    $('rows').innerHTML = rows.slice(state.page * state.size, (state.page + 1) * state.size).map(p => `<tr><td>${p.rank || '—'}</td><td><div class="protocol-cell">${avatar(p)}<div><button class="protocol-name" data-open="${esc(p.slug)}">${esc(p.name)}</button><div class="protocol-meta">${esc(p.category || 'Other')} · ${esc(p.chains[0] || 'Unknown')}${p.early ? '<span class="badge">EARLY</span>' : p.watchlist ? '<span class="badge">WATCH</span>' : ''}</div></div></div></td><td><span class="value">${recorded && !p.mcap_usd ? 'Unreported' : money(p.implied_value_usd)}</span><span class="subvalue">${recorded ? 'Observed market cap' : `${money(p.value_low_usd)} – ${money(p.value_high_usd)}`}</span></td><td>${money(p.tvl_usd)}</td><td><span class="flow ${p.change_7d < 0?'negative':'positive'}">${percent(p.change_7d)}${p.change_7d === null?'':bars(p.change_7d)}</span></td><td>${recorded?'—':`<div class="alpha">${p.alpha_score}<span class="alpha-track"><i style="width:${p.alpha_score}%"></i></span></div>`}</td><td>${recorded?'—':p.plan.restricted?'<span class="subvalue">Access check first</span>':`$${p.plan.capital_usd} <span class="subvalue">~$${p.plan.fee_budget_usd} fees · ${p.plan.days}d</span>`}</td><td><div class="open-row"><button class="star ${saved.has(p.slug)?'on':''}" data-save="${esc(p.slug)}" aria-label="${saved.has(p.slug)?'Remove':'Save'} ${esc(p.name)}">${saved.has(p.slug)?'★':'☆'}</button><button data-open="${esc(p.slug)}" aria-label="View ${esc(p.name)}">↗</button></div></td></tr>`).join('');
    $('empty').hidden = rows.length > 0;
    $('page-info').textContent = rows.length ? `Showing ${state.page*state.size+1}–${Math.min((state.page+1)*state.size,rows.length)} of ${rows.length} protocols · sorted by ${state.sort.replaceAll('_',' ')}` : '0 protocols';
    $('prev').disabled = state.page === 0; $('next').disabled = (state.page+1)*state.size >= rows.length;
    $('coverage').textContent = `${radar.watchlist_size}/${radar.watchlist_size}`;
    $('as-of').textContent = radar.as_of;
  }
  function openDetail(slug) {
    const p = radar.rows.find(r => r.slug === slug);
    if (!p) {
      const live = radar.recorded.find(r => r.slug === slug);
      if (!live) return;
      $('detail-view').innerHTML = `<button class="back" data-back>← Back to board</button><h1>${esc(live.name)}</h1><div class="panel"><h2>Token already recorded</h2><p>${esc(live.symbol || live.gecko_id || 'Market cap record')} · TVL ${money(live.tvl_usd)} · ${live.mcap_usd?money(live.mcap_usd)+' market cap':'Market cap unreported'}</p><p class="note">Excluded from the pre-token valuation board. A token record does not establish a new farming campaign.</p></div>`;
    } else {
      const v = p.model, plan = p.plan;
      $('detail-view').innerHTML = `<button class="back" data-back>← Back to launch radar</button><div class="detail-heading"><div class="detail-identity">${avatar(p)}<div><div class="eyebrow">PROTOCOL DOSSIER / RANK ${p.rank.toString().padStart(2,'0')}</div><h1>${esc(p.name)}</h1><p>${esc(p.category || 'Other')} <span class="separator">/</span> ${esc(plan.chain)} <span class="separator">/</span> ${v.age === null?'Listing age unknown':v.age+' days tracked'}</p></div></div><button data-save="${esc(p.slug)}">${saved.has(p.slug)?'★ Shortlisted':'☆ Add to shortlist'}</button></div><div class="detail-grid"><div><div class="panel valuation"><div class="panel-label">IMPLIED TOKEN VALUE · ${state.scenario === 1?'BASE':state.scenario < 1?'BEAR':'BULL'} CASE</div><div class="detail-value">${money(p.implied_value_usd)}</div><div class="range"><span>${money(p.value_low_usd)}</span><div class="range-track"></div><span>${money(p.value_high_usd)}</span></div><div class="formula">${money(p.tvl_usd)} TVL × ${v.multiple}× peer × ${v.growth} growth × ${v.maturity} maturity${state.scenario !== 1 ? ' × '+state.scenario+' scenario' : ''}</div><p class="note">Circulating-equivalent estimate, not FDV or personal rewards. Scenario range is 0.5×–1.8×, not a confidence interval.</p></div><div class="panel"><div class="detail-stats"><div><small>LOCKED VALUE</small><strong>${money(p.tvl_usd)}</strong></div><div><small>7D TVL CHANGE</small><strong class="${p.change_7d<0?'negative':'positive'}">${percent(p.change_7d)}</strong></div><div><small>DATA CONFIDENCE</small><strong>${p.confidence_score}<small> / 100</small></strong></div></div></div><div class="panel"><div class="panel-label">WHY THIS PROTOCOL TRIGGERED <span style="float:right">${p.alpha_score}/100 ALPHA</span></div>${Object.entries(v.signals).map(([k,n])=>`<div class="signal"><span>${esc({momentum:'TVL momentum · 40%',scale:'Economic scale · 30%',maturity:'Listing maturity · 20%',evidence:'Evidence · 10%'}[k])}</span><span class="alpha-track"><i style="width:${n}%"></i></span><strong>${n}</strong></div>`).join('')}<div class="reason">${p.watchlist?'Required watchlist protocol':'Additional candidate beyond the watchlist'} · ${v.peer_count} category peers · ${v.age === null?'age defaulted to 180 days':v.age+' days since listing'}. Growth ${p.change_7d === null?'unreported; neutral multiplier':percent(p.change_7d)}.</div></div><div class="panel"><div class="panel-label">EVIDENCE BOUNDARY</div><div class="checklist"><span>No token recorded</span><span>Mint / freeze: unknown</span><span>Holders: unknown</span><span>Campaign: unannounced</span></div><p class="note">Listing age is tracking history, not time spent tokenless. ${p.watchlist?'The sealed watchlist supplies parent screening.':'Parent relationships are absent for added candidates; verify independence.'} Source date: ${radar.as_of}.</p></div></div><div><div class="panel"><div class="panel-label">YOUR FARM PLAN <span style="float:right">${plan.steps.length} STEPS</span></div><h2>${plan.restricted?'Verify access before capital.':'Start small. Keep the evidence.'}</h2><div class="plan-summary"><span>${plan.restricted?'Research only':'$'+plan.capital_usd+' test capital'}</span><span>~$${plan.fee_budget_usd} estimated fees</span><span>${plan.days}-day review</span></div>${plan.steps.map((s,i)=>`<div class="step"><span class="step-number">${i+1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><small>${esc(s.cost)} <span class="separator">/</span> ${esc(s.time)}</small></div></div>`).join('')}<div class="risk-note">${esc(plan.risk)} ${esc(plan.reward)}. Capital is exposure, not a fee; fee estimates exclude market moves and product charges.</div></div></div></div>`;
    }
    $('board-view').hidden = true; $('method-view').hidden = true; $('detail-view').hidden = false;
    $('breadcrumb').textContent = p?.name || slug;
    window.scrollTo(0,0);
  }
  function method() {
    $('method-view').innerHTML = `<div class="eyebrow">A MODEL YOU CAN INSPECT</div><h1 class="method-title">Show the assumptions.</h1><div class="method-grid"><div class="panel"><h3>Value from the same sealed universe</h3><p>${radar.peer_count} protocols have positive token market cap and TVL. Clip each market-cap / TVL ratio to 0.03–3×, take category medians, then shrink small groups to the global ${radar.peer_multiple}× median.</p><code>w = category peer count / (count + 5)\nmultiple = w × category median + (1−w) × global median\nvalue = TVL × multiple × growth × maturity</code><p>Circulating market cap is not FDV. No allocation or launch probability is supplied. Every protocol uses the same function; names never set its valuation.</p></div><div class="panel"><h3>Growth, history and scenarios</h3><code>g = clamp(7d growth, −60%, 150%)\ngrowth = clamp(1 + g/200, .55, 1.65)\nmaturity = .65 + .5 × min(age,1095)/1095\nunknown age = 180 days\nbear / base / bull = .5× / 1× / 1.8×</code><p>Age means days since DefiLlama began tracking. Missing growth uses zero. Scenario ranges are assumptions, not statistical forecasts. Change the scenario above the board to recompute every value.</p></div><div class="panel"><h3>Alpha and evidence are different</h3><p>Alpha combines 40% momentum, 30% log-scaled TVL, 20% listing maturity and 10% evidence. Confidence reflects peer count and reported fields; neither is a contract audit or probability of reward.</p><p>Safety data such as token authority, holder concentration and slippage does not exist in the snapshot. These remain unknown. Optional live launch scoring lives in the CLI, with separate observed evidence.</p></div><div class="panel"><h3>Coverage and a practical plan</h3><p>Every ${radar.watchlist_size} required watchlist entry is covered. Additional candidates have no token record and pass name/category derivative screening. Parent relationships are absent outside the supplied watchlist.</p><p>Plans derive actions from category and chain, include capital, estimated fees, review duration and an exit. Access-restricted categories start with research, not an invented deposit. No points campaign, reward or eligibility is assumed.</p></div></div>`;
    $('board-view').hidden = true; $('detail-view').hidden = true; $('method-view').hidden = false; $('breadcrumb').textContent = 'Value model';
  }
  function navigate(view) {
    state.view = view; state.page = 0;
    document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active',n.dataset.view===view));
    if (view === 'method') return method();
    $('board-view').hidden = false; $('detail-view').hidden = true; $('method-view').hidden = true;
    $('breadcrumb').textContent = view==='saved'?'My shortlist':view==='recorded'?'Token recorded':'Launch radar'; render();
  }
  function reset() { Object.assign(state,{early:false,watch:false,query:'',category:'',chain:'',page:0}); $('search').value='';$('category').value='';$('chain').value='';render(); }
  document.addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button) return;
    if (button.dataset.open) { location.hash = 'protocol/'+encodeURIComponent(button.dataset.open); return; }
    if (button.dataset.save) { save(button.dataset.save); if (!$('detail-view').hidden) openDetail(button.dataset.save); return; }
    if (button.hasAttribute('data-back')) { location.hash = 'board'; navigate('board'); return; }
    if (button.dataset.view) { location.hash = button.dataset.view; navigate(button.dataset.view); return; }
    if (button.dataset.sort) { state.direction=state.sort===button.dataset.sort?-state.direction:button.dataset.sort==='name'?1:-1;state.sort=button.dataset.sort;state.page=0;render(); }
  });
  $('search').addEventListener('input',e=>{state.query=e.target.value;state.page=0;render();});
  for (const id of ['category','chain']) $(id).addEventListener('change',e=>{state[id]=e.target.value;state.page=0;render();});
  for (const id of ['early','watch']) $(id).onclick=()=>{state[id]=!state[id];state.page=0;render();};
  $('early-shortcut').onclick=()=>{state.early=true;state.page=0;render();};
  $('clear').onclick=reset;
  $('prev').onclick=()=>{state.page--;render();};$('next').onclick=()=>{state.page++;render();};
  $('scenario').onchange=e=>{state.scenario=Number(e.target.value);radar=E.buildRadar(SNAPSHOT,state.scenario);render();};
  $('export').onclick=()=>{const data=JSON.stringify({as_of:radar.as_of,scenario:state.scenario,rows:filtered()},null,2),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='aperture-board.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Exported current board and farm plans');};
  function route(){const hash=decodeURIComponent(location.hash.slice(1));if(hash.startsWith('protocol/'))openDetail(hash.slice(9));else navigate(['saved','recorded','method'].includes(hash)?hash:'board');}
  window.addEventListener('hashchange',route);
  populateFilters(); render(); route();
  globalThis.Aperture = {state,get radar(){return radar;},filtered,openDetail,reset};
})();

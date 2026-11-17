/* Aperture's shared valuation engine. Used unchanged by main.ts and the offline page. */
(() => {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const median = a => { const s = [...a].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : 0.35; };
  const codeOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  function parseSnapshot(text) {
    let s;
    try { s = JSON.parse(text); } catch { throw Error('Snapshot is not valid JSON'); }
    if (!s || !validDate(s.as_of) || typeof s.source !== 'string' || !Number.isSafeInteger(s.floor_usd) || s.floor_usd <= 0 || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw Error('Snapshot header or arrays are malformed');
    const seen = new Set();
    s.protocols = s.protocols.map((p, i) => {
      if (!p || typeof p.slug !== 'string' || !/^[^\s]{1,128}$/.test(p.slug) || typeof p.name !== 'string' || !p.name.trim() || !Number.isSafeInteger(p.tvl_usd) || p.tvl_usd < 0 || seen.has(p.slug)) throw Error(`Invalid or duplicate protocol at row ${i}`);
      seen.add(p.slug);
      for (const k of ['change_7d', 'mcap_usd']) if (p[k] !== null && (typeof p[k] !== 'number' || !Number.isFinite(p[k]))) throw Error(`Invalid ${k} for ${p.slug}`);
      for (const k of ['symbol', 'gecko_id', 'category']) if (p[k] !== null && typeof p[k] !== 'string') throw Error(`Invalid ${k} for ${p.slug}`);
      if (!Array.isArray(p.chains) || p.chains.some(c => typeof c !== 'string') || (p.listed_at !== null && !validDate(p.listed_at))) throw Error(`Invalid chains or date for ${p.slug}`);
      // The sealed dataset contains a -1 market-cap sentinel: unavailable, never a negative valuation.
      return { ...p, mcap_usd: p.mcap_usd < 0 ? null : p.mcap_usd, chains: [...new Set(p.chains)].sort(codeOrder) };
    });
    if (new Set(s.watchlist).size !== s.watchlist.length || s.watchlist.some(x => !seen.has(x))) throw Error('Watchlist has duplicate or unknown slugs');
    return s;
  }
  function tokenStatus(p) {
    if (p.gecko_id || p.symbol || p.mcap_usd > 0) return 'recorded';
    if (/^(Bridge|Canonical Bridge|Cross Chain Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX|Stablecoin Wrapper)$/i.test(p.category || '') || /\b(wrapped|staked|staking)\b/i.test(p.name) || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name) || /\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name)) return 'derivative';
    return 'unrecorded';
  }
  function ageDays(asOf, listed) { return listed === null ? null : Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(listed)) / 86400000)); }
  function peers(protocols) {
    const all = [], categories = {};
    for (const p of protocols) if (tokenStatus(p) === 'recorded' && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX') {
      const v = clamp(p.mcap_usd / p.tvl_usd, 0.03, 3);
      all.push(v); (categories[p.category || 'Other'] ||= []).push(v);
    }
    const broad = median(all);
    return { broad, count: all.length, categories };
  }
  const cheap = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Sui', 'Polygon', 'Monad', 'Starknet'];
  function farmPlan(p, age) {
    const chain = cheap.find(c => p.chains.includes(c)) || p.chains[0] || 'the supported network';
    const gas = chain === 'Ethereum' ? 18 : /Bitcoin/.test(chain) ? 10 : 3;
    const capital = 100, days = age !== null && age < 180 ? 42 : 28;
    const category = p.category || 'Other';
    const restricted = /RWA|CeDeFi|Uncollateralized|OTC|Card|Payments|Chain|Privacy|Governance/.test(category);
    let action, exit, risk;
    if (/Lending|CDP|Collateral/.test(category)) {
      action = `Supply a supported asset worth $${capital} to ${p.name} on ${chain}; confirm its asset list first. Use supply-only exposure and check the withdrawal queue.`;
      exit = 'Redeem a small portion, confirm it reaches your wallet, then withdraw the remainder and revoke the allowance.';
      risk = 'Contract and withdrawal risk; borrowing introduces liquidation risk.';
    } else if (/Dex|Liquidity/.test(category)) {
      action = `Use one genuine $20 swap on ${p.name} on ${chain}, capped at 0.5% slippage. If a suitable stable pair exists, optionally supply $${capital} of balanced liquidity.`;
      exit = 'Remove liquidity to its underlying assets, review price impact, and revoke token approvals after the final transaction.';
      risk = 'Pool depth, impermanent loss and MEV; skip pools with unknown assets.';
    } else if (/Restak|Staking|BTC/.test(category)) {
      action = `Inspect ${p.name}'s supported collateral on ${chain}; simulate a $${capital} delegation or restake only after confirming slashing exposure and the unlock period.`;
      exit = 'Start the unstake queue before the end of the plan; check the actual unlock date and redeem the receipt when available.';
      risk = 'Slashing, receipt depeg, validator and unbonding risk.';
    } else if (/Deriv|Perpetual|Prediction|Basis|Options/.test(category)) {
      action = `Inspect ${p.name}'s ${chain} market and fees. If eligible, fund at most $${capital} and use a small unleveraged position for an actual strategy; skip if this is unavailable.`;
      exit = 'Close the position, settle fees and withdraw margin; include realized trading losses in the farm log.';
      risk = 'Trading losses and funding costs; activity itself can lose principal.';
    } else if (/Risk Curator|Allocator|Yield|Farm|Manager|Indexes/.test(category)) {
      action = `Find a ${p.name}-managed vault on ${chain} through the protocol directory. Verify curator, underlying assets and fees, then test a supported $${capital} deposit.`;
      exit = 'Check vault redemption windows, redeem a small test amount, then unwind the remaining shares and allowances.';
      risk = 'Underlying lending risk, curator concentration and redemption delays.';
    } else {
      action = `Read ${p.name}'s ${category} documentation on ${chain}. Confirm public access, region and minimum deposit; if gated, record eligibility and keep this as research-only.`;
      exit = 'Follow the documented redemption or account-closure process only if access and an exit were confirmed in advance.';
      risk = 'Access restrictions, counterparty exposure and an unverified farming route.';
    }
    const steps = [
      { title: 'Verify the route', text: `Locate ${p.name} through its DefiLlama directory slug ${p.slug}; verify the official application and current token/points status. The snapshot supplies no campaign or asset eligibility.`, cost: '$0', time: '8 min' },
      { title: restricted ? 'Check eligibility first' : 'Open a test position', text: action, cost: restricted ? '$0 until eligible' : `$${capital} capital + ~$${gas} fees`, time: '12–20 min' },
      { title: 'Keep useful activity', text: `Review the position once a week for ${days} days. Use ${p.name} only when the action has an economic purpose; retain dated transaction hashes and any points balance actually displayed.`, cost: `~$${gas} per active week`, time: `${days} days; 5 min/week` },
      { title: 'Test an exit', text: exit, cost: `~$${gas} network fees + product fees`, time: '10 min + any queue' },
      { title: 'Reassess the thesis', text: `Recheck ${p.name}'s official token announcement before the next deposit. Record fees, capital-days and withdrawal results; stop if access, redemption or the tokenless thesis changes.`, cost: '$0 research; no reward assumed', time: '5 min/week' }
    ];
    return { chain, capital_usd: restricted ? 0 : capital, fee_budget_usd: restricted ? 0 : gas * 6, days, restricted, risk, steps, reward: 'Unannounced; eligibility and allocation unknown' };
  }
  function valueProtocol(p, asOf, peer, scenario = 1) {
    const group = peer.categories[p.category || 'Other'] || [];
    const weight = group.length / (group.length + 5);
    const multiple = weight * median(group) + (1 - weight) * peer.broad;
    const growth = clamp(p.change_7d ?? 0, -60, 150);
    const growthMult = clamp(1 + growth / 200, 0.55, 1.65);
    const age = ageDays(asOf, p.listed_at);
    const maturity = 0.65 + 0.5 * Math.min(age ?? 180, 1095) / 1095;
    const implied = clamp(Math.round(p.tvl_usd * multiple * growthMult * maturity * scenario), 1, 100000000000000);
    const confidence = Math.round(clamp(40 + Math.min(group.length, 10) * 3 + (age !== null ? 10 : 0) + (p.change_7d !== null ? 10 : 0), 0, 90));
    const momentum = clamp(50 + growth / 2, 0, 100);
    const scale = clamp((Math.log10(Math.max(1, p.tvl_usd)) - 6) * 25, 0, 100);
    const maturityScore = clamp((age ?? 180) / 1095 * 100, 0, 100);
    const alpha = Math.round(momentum * 0.4 + scale * 0.3 + maturityScore * 0.2 + confidence * 0.1);
    return { implied, low: Math.max(1, Math.round(implied * 0.5)), high: Math.min(100000000000000, Math.round(implied * 1.8)), multiple: round(multiple, 4), growth: round(growthMult, 4), maturity: round(maturity, 4), age, confidence, alpha, peer_count: group.length, signals: { momentum: Math.round(momentum), scale: Math.round(scale), maturity: Math.round(maturityScore), evidence: confidence } };
  }
  function buildRadar(snapshot, scenario = 1) {
    const peer = peers(snapshot.protocols), watch = new Set(snapshot.watchlist);
    const rows = [], recorded = [], excluded = [];
    for (const p of snapshot.protocols) {
      const status = tokenStatus(p);
      if (status === 'recorded' && !watch.has(p.slug)) { recorded.push(p); continue; }
      if (status === 'derivative' && !watch.has(p.slug)) { excluded.push(p); continue; }
      const v = valueProtocol(p, snapshot.as_of, peer, scenario), plan = farmPlan(p, v.age);
      rows.push({ ...p, rank: 0, implied_value_usd: v.implied, value_low_usd: v.low, value_high_usd: v.high, token_status: status === 'recorded' ? 'watchlist-conflict' : 'no token recorded', watchlist: watch.has(p.slug), early: p.tvl_usd < snapshot.floor_usd, model: v, alpha_score: v.alpha, confidence_score: v.confidence, plan, farm_steps: plan.steps.map(s => `${s.text} Budget: ${s.cost}. Time: ${s.time}.`) });
    }
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || codeOrder(a.slug, b.slug)).forEach((p, i) => p.rank = i + 1);
    return { schema: 'aperture/radar-v1', as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, watchlist_size: watch.size, universe_size: snapshot.protocols.length, peer_multiple: round(peer.broad, 4), peer_count: peer.count, rows, recorded, excluded };
  }
  function boardIssue(radar, snapshot) {
    const rows = radar.rows, universe = new Set(snapshot.protocols.map(p => p.slug)), seen = new Set();
    if (rows.length < 100 || rows.length > 4000) return 'Board must contain 100–4000 rows';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!universe.has(r.slug) || seen.has(r.slug)) return 'Unknown or duplicate slug';
      seen.add(r.slug);
      if (r.rank !== i + 1 || !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14 || (i && r.implied_value_usd > rows[i - 1].implied_value_usd)) return 'Ranks or implied values invalid';
      if (r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some(s => s.trim().length < 20 || s.trim().length > 600)) return 'Farm steps invalid';
    }
    if (snapshot.watchlist.some(x => !seen.has(x))) return 'Missing watchlist protocol';
    if (new Set(rows.map(r => r.implied_value_usd)).size < 2) return 'All values equal';
    return null;
  }
  globalThis.RadarEngine = { parseSnapshot, tokenStatus, ageDays, peers, valueProtocol, farmPlan, buildRadar, boardIssue, clamp, median };
})();

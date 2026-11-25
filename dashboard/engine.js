/* Shared deterministic radar engine.  main.ts and the offline page call the same code. */
(() => {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
  const codeOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function parseSnapshot(text) {
    let snapshot;
    try { snapshot = JSON.parse(text); } catch { throw Error('Snapshot is not valid JSON'); }
    if (!snapshot || !validDate(snapshot.as_of) || typeof snapshot.source !== 'string' ||
      !Number.isSafeInteger(snapshot.floor_usd) || snapshot.floor_usd <= 0 ||
      !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
      throw Error('Snapshot header or arrays are malformed');
    }
    const seen = new Set();
    snapshot.protocols = snapshot.protocols.map((protocol, index) => {
      if (!protocol || typeof protocol.slug !== 'string' || !/^[^\s]{1,128}$/.test(protocol.slug) ||
        typeof protocol.name !== 'string' || !protocol.name.trim() ||
        !Number.isSafeInteger(protocol.tvl_usd) || protocol.tvl_usd < 0 || seen.has(protocol.slug)) {
        throw Error(`Invalid or duplicate protocol at row ${index}`);
      }
      seen.add(protocol.slug);
      for (const key of ['change_7d', 'mcap_usd']) {
        if (protocol[key] !== null && (typeof protocol[key] !== 'number' || !Number.isFinite(protocol[key]))) {
          throw Error(`Invalid ${key} for ${protocol.slug}`);
        }
      }
      for (const key of ['symbol', 'gecko_id', 'category']) {
        if (protocol[key] !== null && typeof protocol[key] !== 'string') throw Error(`Invalid ${key} for ${protocol.slug}`);
      }
      if (!Array.isArray(protocol.chains) || protocol.chains.some(chain => typeof chain !== 'string') ||
        (protocol.listed_at !== null && !validDate(protocol.listed_at))) throw Error(`Invalid chains or date for ${protocol.slug}`);
      // The sealed snapshot uses -1 for an unavailable market cap, never a negative value.
      return { ...protocol, mcap_usd: protocol.mcap_usd < 0 ? null : protocol.mcap_usd, chains: [...new Set(protocol.chains)].sort(codeOrder) };
    });
    if (new Set(snapshot.watchlist).size !== snapshot.watchlist.length || snapshot.watchlist.some(slug => !seen.has(slug))) {
      throw Error('Watchlist has duplicate or unknown slugs');
    }
    return snapshot;
  }

  function tokenStatus(protocol) {
    if (protocol.gecko_id || protocol.symbol || protocol.mcap_usd > 0) return 'recorded';
    if (/^(Bridge|Canonical Bridge|Cross Chain Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX|Stablecoin Wrapper)$/i.test(protocol.category || '') ||
      /\b(wrapped|staked|staking)\b/i.test(protocol.name) ||
      /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(protocol.name) ||
      /\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(protocol.name)) return 'derivative';
    return 'unrecorded';
  }

  function ageDays(asOf, listedAt) {
    return listedAt === null ? null : Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(listedAt)) / 86400000));
  }

  function peerRows(protocols, omitSlug = null) {
    return protocols.filter(protocol => protocol.slug !== omitSlug && tokenStatus(protocol) === 'recorded' &&
      protocol.mcap_usd > 0 && protocol.tvl_usd > 0 && protocol.category !== 'CEX').map(protocol => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category || 'Other',
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd,
      ratio: protocol.mcap_usd / protocol.tvl_usd,
      listed_at: protocol.listed_at,
      change_7d: protocol.change_7d
    }));
  }

  function peers(protocols, asOf = '2026-11-14') {
    const evidence = peerRows(protocols);
    const { fit, report: validation } = globalThis.RadarCalibration.calibrate(evidence, asOf);
    return {
      broad: median(evidence.map(row => row.ratio)) || 0.25,
      count: evidence.length,
      evidence,
      fit,
      selected_shrinkage: validation.selected_shrinkage,
      validation,
      median_age_days: validation.median_age_days
    };
  }

  const lowFeeChains = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Sui', 'Polygon', 'Monad', 'Starknet'];

  function farmPlan(protocol, age, assumptions = {}) {
    const chain = lowFeeChains.find(candidate => protocol.chains.includes(candidate)) || protocol.chains[0] || 'the supported network';
    const networkFee = chain === 'Ethereum' ? 18 : /Bitcoin/i.test(chain) ? 10 : 3;
    const capital = clamp(Number(assumptions.capital) || 100, 20, 10000);
    const days = Math.round(clamp(Number(assumptions.days) || (age !== null && age < 180 ? 42 : 28), 7, 90));
    const category = protocol.category || 'Other';
    const restricted = /RWA|CeDeFi|Uncollateralized|OTC|Card|Payments|Privacy|Governance|^Chain$/i.test(category);
    const weeklyReviews = Math.ceil(days / 7);
    const feeTransactions = restricted ? 0 : /Solana|Sui/i.test(chain) ? 4 : 6;
    const feeBudget = restricted ? 0 : networkFee * feeTransactions;
    const opportunityCost = restricted ? 0 : round(capital * 0.05 * days / 365);
    const productFeeReserve = restricted ? 0 : round(capital * .005);
    const timeMinutes = 39 + weeklyReviews * 5;
    const hourlyRate = clamp(Number(assumptions.hourly) >= 0 ? Number(assumptions.hourly) : 15, 0, 500);
    const laborCost = round(timeMinutes / 60 * hourlyRate);
    const route = restricted ? 'research-only' : 'verify-before-fund';
    let openAction, exitAction, risk;
    if (/Lending|CDP|Collateral/i.test(category)) {
      openAction = `Verify ${protocol.name}'s supply market, collateral and exit queue on ${chain}. Test $20 before a $${capital} target; do not borrow.`;
      exitAction = 'Redeem the test, withdraw the remainder through the queue, then revoke allowances.';
      risk = 'Contract, oracle and withdrawal risk; never borrow against the test position.';
    } else if (/Dex|Liquidity/i.test(category)) {
      openAction = `Check pair depth on ${chain}. Make one genuine $20 swap with a 0.5% slippage cap; add liquidity only after verifying the pool.`;
      exitAction = 'Remove liquidity, check exit price impact and revoke approvals after the final swap.';
      risk = 'Pool depth, impermanent loss, MEV and unverified token risk.';
    } else if (/Restak|Staking|BTC/i.test(category)) {
      openAction = `Check ${protocol.name}'s collateral, validators, slashing and unlock terms on ${chain}; simulate a $20 delegation before funding.`;
      exitAction = 'Start unstaking before the review ends; record unlock date and redeem the receipt.';
      risk = 'Slashing, receipt depeg, validator and unbonding risk.';
    } else if (/Deriv|Perpetual|Prediction|Basis|Options/i.test(category)) {
      openAction = `Check ${protocol.name} eligibility and fees on ${chain}. Use a $20 unleveraged test only through a verified public route.`;
      exitAction = 'Close positions, settle funding, withdraw margin and record realized PnL.';
      risk = 'Trading loss, funding and liquidation risk; activity can lose principal.';
    } else if (/Risk Curator|Allocator|Yield|Farm|Manager|Indexes/i.test(category)) {
      openAction = `Verify ${protocol.name}'s vault address, curator, assets, fees and redemption on ${chain}. Test $20 before a $${capital} target.`;
      exitAction = 'Redeem test shares, verify the returned asset, then unwind remaining shares and approvals.';
      risk = 'Underlying protocol, curator concentration and redemption-delay risk.';
    } else {
      openAction = `Read ${protocol.name}'s ${category} documentation on ${chain}. Verify eligibility, minimum size and documented exit before funding.`;
      exitAction = 'Verify access and exit independently, then use the documented redemption route.';
      risk = 'Access restrictions, counterparty exposure and an unverified route.';
    }
    if (restricted) {
      openAction = `Check ${protocol.name}'s ${category} region, approval, assets and minimum size on ${chain}. Stay research-only until access and exit are verified.`;
      exitAction = 'Commit no funds until eligibility, custody and documented redemption are confirmed.';
    }
    const steps = [
      { title: '01 · Confirm the source', text: `Use DefiLlama slug ${protocol.slug} to locate ${protocol.name}'s official route. Campaigns, points and allocations are unrecorded; verify current claims.`, cost: '$0', time: '8 min' },
      { title: restricted ? '02 · Check eligibility' : '02 · Run a small test', text: openAction, cost: restricted ? '$0 until eligible' : `$20 test included in $${capital} target, not added to it; ~$${networkFee} per network action`, time: '16 min' },
      { title: '03 · Keep useful activity', text: restricted ? `Record ${protocol.name}'s access decision, assets and exit evidence; stop if the route is unverified.` : `Review weekly for ${days} days. Keep dated transaction hashes and any displayed points; do not manufacture volume.`, cost: '$0 off-chain reviews; no weekly transactions required', time: `${days} days · ${weeklyReviews} reviews of 5 min` },
      { title: '04 · Prove the exit', text: exitAction, cost: restricted ? '$0 research' : `~$${networkFee} network fees plus unknown product fees`, time: restricted ? '10 min research' : '10 min plus any queue' },
      { title: '05 · Stop or reassess', text: `Recheck ${protocol.name}'s token record, fees and redemption. Stop when access, the route or the tokenless thesis changes.`, cost: '$0 research; no reward assumed', time: '5 min at end of review window' }
    ];
    return {
      route,
      route_label: restricted ? 'Research only' : 'Verify before funding',
      chain,
      capital_usd: restricted ? 0 : capital,
      test_capital_usd: restricted ? 0 : 20,
      fee_budget_usd: feeBudget,
      network_fee_per_action_usd: networkFee,
      fee_transactions: feeTransactions,
      weekly_reviews: weeklyReviews,
      days,
      time_minutes: timeMinutes,
      hourly_rate_usd: hourlyRate,
      labor_cost_usd: laborCost,
      product_fee_reserve_usd: productFeeReserve,
      opportunity_cost_usd: opportunityCost,
      estimated_total_cost_usd: round(feeBudget + productFeeReserve + opportunityCost + laborCost),
      break_even_reward_usd: round(feeBudget + productFeeReserve + opportunityCost + laborCost),
      funding_budget_usd: restricted ? 0 : capital + feeBudget + productFeeReserve,
      restricted,
      risk,
      stop_rule: 'No confirmed allocation; stop when access, redemption, fees or the tokenless thesis is unverified.',
      steps,
      reward: 'Unannounced; eligibility and allocation unknown'
    };
  }

  function valueProtocol(protocol, asOf, peer, scenario = 1) {
    const category = protocol.category || 'Other';
    const evidence = Array.isArray(peer.evidence) ? peer.evidence : [];
    const fitted = globalThis.RadarCalibration.predict(protocol, peer.fit, asOf);
    const categoryFit = peer.fit.categories[category];
    const growth = clamp(protocol.change_7d ?? 0, -60, 150);
    const growthMultiplier = fitted.growth;
    const age = ageDays(asOf, protocol.listed_at);
    const ageForModel = age === null ? (peer.median_age_days ?? 180) : age;
    const maturityMultiplier = fitted.maturity;
    const multiple = fitted.multiple;
    const implied = clamp(Math.round(protocol.tvl_usd * multiple * growthMultiplier * maturityMultiplier * scenario), 1, 100000000000000);
    const peerCoverage = Math.min(1, fitted.category_count / 12);
    const fieldCoverage = (protocol.change_7d !== null ? 0.25 : 0) + (protocol.listed_at !== null ? 0.25 : 0) + (fitted.category_count ? 0.5 : 0);
    const confidence = Math.round(clamp(35 + peerCoverage * 35 + fieldCoverage * 30, 0, 95));
    const momentum = clamp(50 + growth / 2, 0, 100);
    const scale = clamp((Math.log10(Math.max(1, protocol.tvl_usd)) - 6) * 25, 0, 100);
    const maturityScore = clamp(ageForModel / 1095 * 100, 0, 100);
    const actionability = /RWA|CeDeFi|Uncollateralized|OTC|Card|Payments|Privacy|Governance|^Chain$/i.test(category) ? 40 : 72;
    const alpha = Math.round(momentum * 0.35 + scale * 0.3 + maturityScore * 0.15 + confidence * 0.1 + actionability * 0.1);
    const band = Math.max(1.35, peer.validation?.p75_error_factor ?? 2);
    return {
      implied,
      low: Math.max(1, Math.round(implied / band)),
      high: Math.min(100000000000000, Math.round(implied * band)),
      multiple: round(multiple, 6),
      growth: round(growthMultiplier, 6),
      maturity: round(maturityMultiplier, 6),
      size_factor: round(fitted.size_factor, 4),
      age,
      model_age_days: ageForModel,
      confidence,
      alpha,
      peer_count: fitted.category_count,
      peer_weight: round(fitted.category_count / (fitted.category_count + peer.fit.shrinkage), 4),
      category_log_offset: categoryFit?.offset ?? 0,
      validation_band: round(band, 2),
      peer_evidence: [...evidence].filter(row => row.category === category).sort((a, b) => Math.abs(Math.log(a.tvl_usd / protocol.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / protocol.tvl_usd)) || codeOrder(a.slug, b.slug)).slice(0, 5),
      signals: { momentum: Math.round(momentum), scale: Math.round(scale), maturity: Math.round(maturityScore), evidence: confidence, actionability }
    };
  }

  function buildRadar(snapshot, scenario = 1) {
    const peer = peers(snapshot.protocols, snapshot.as_of);
    const watchlist = new Set(snapshot.watchlist);
    const rows = [], recorded = [], excluded = [];
    for (const protocol of snapshot.protocols) {
      const status = tokenStatus(protocol);
      if (status === 'recorded' && !watchlist.has(protocol.slug)) { recorded.push(protocol); continue; }
      if (status === 'derivative' && !watchlist.has(protocol.slug)) { excluded.push(protocol); continue; }
      const model = valueProtocol(protocol, snapshot.as_of, peer, scenario);
      const plan = farmPlan(protocol, model.age);
      rows.push({ ...protocol, rank: 0, implied_value_usd: model.implied, value_low_usd: model.low, value_high_usd: model.high,
        token_status: status === 'recorded' ? 'watchlist-conflict' : 'no token recorded', watchlist: watchlist.has(protocol.slug),
        early: protocol.tvl_usd < snapshot.floor_usd, model, alpha_score: model.alpha, confidence_score: model.confidence,
        actionability: plan.route_label, plan, farm_steps: plan.steps.map(step => `${step.text} Budget: ${step.cost}. Time: ${step.time}.`) });
    }
    rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.alpha_score - a.alpha_score || codeOrder(a.slug, b.slug)).forEach((protocol, index) => protocol.rank = index + 1);
    const cohorts = { watchlist: rows.filter(p => p.watchlist).length, below_floor: rows.filter(p => !p.watchlist && p.early).length,
      other_above_floor: rows.filter(p => !p.watchlist && !p.early).length, recorded: recorded.length, excluded: excluded.length };
    return { schema: 'aperture/radar-v3', as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, cohorts,
      watchlist_size: watchlist.size, universe_size: snapshot.protocols.length, peer_multiple: round(peer.broad, 4), peer_count: peer.count,
      validation: peer.validation, rows, recorded, excluded };
  }

  function boardIssue(radar, snapshot) {
    const universe = new Set(snapshot.protocols.map(protocol => protocol.slug));
    const seen = new Set();
    if (radar.rows.length < 100 || radar.rows.length > 4000) return 'Board must contain 100–4000 rows';
    for (let index = 0; index < radar.rows.length; index++) {
      const row = radar.rows[index];
      if (!universe.has(row.slug) || seen.has(row.slug)) return 'Unknown or duplicate slug';
      seen.add(row.slug);
      if (row.rank !== index + 1 || !Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 ||
        row.implied_value_usd > 1e14 || (index && row.implied_value_usd > radar.rows[index - 1].implied_value_usd)) return 'Ranks or implied values invalid';
      if (row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some(step => step.trim().length < 20 || step.trim().length > 600)) return 'Farm steps invalid';
    }
    if (snapshot.watchlist.some(slug => !seen.has(slug))) return 'Missing watchlist protocol';
    if (new Set(radar.rows.map(row => row.implied_value_usd)).size < 2) return 'All values equal';
    return null;
  }

  globalThis.RadarEngine = { parseSnapshot, tokenStatus, ageDays, peers, valueProtocol, farmPlan, buildRadar, boardIssue, clamp, median };
})();

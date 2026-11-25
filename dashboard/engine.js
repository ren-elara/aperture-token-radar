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
  const quantile = (values, probability) => {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability)))];
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
      clipped_ratio: clamp(protocol.mcap_usd / protocol.tvl_usd, 0.03, 3),
      age: protocol.listed_at
    }));
  }

  function estimateMultiple(category, observations = [], shrinkage = 8) {
    const all = observations.map(row => row.clipped_ratio);
    const categoryRows = observations.filter(row => row.category === (category || 'Other'));
    const globalMedian = median(all) || 0.25;
    const categoryMedian = categoryRows.length ? median(categoryRows.map(row => row.clipped_ratio)) : globalMedian;
    const weight = categoryRows.length ? categoryRows.length / (categoryRows.length + Math.max(0, shrinkage)) : 0;
    return { multiple: weight * categoryMedian + (1 - weight) * globalMedian, weight, categoryMedian, globalMedian, categoryCount: categoryRows.length };
  }

  function validationReport(protocols, observations, asOf = '2026-11-14') {
    // Leave-one-out validation prevents one large peer from validating itself.  The selected
    // shrinkage is chosen from a small, transparent family, not from protocol names.
    const tested = [0, 2, 5, 8, 12].map(shrinkage => {
      const errors = [];
      let withinTwo = 0;
      for (const observed of observations) {
        const remaining = observations.filter(row => row.slug !== observed.slug);
        const estimate = estimateMultiple(observed.category, remaining, shrinkage).multiple;
        const actual = Math.max(0.0001, observed.ratio);
        const error = Math.abs(Math.log(Math.max(0.0001, estimate) / actual));
        errors.push(error);
        if (error <= Math.log(2)) withinTwo++;
      }
      const sorted = [...errors].sort((a, b) => a - b);
      return {
        shrinkage,
        held_out: errors.length,
        median_error_factor: round(Math.exp(median(sorted)), 2),
        p75_error_factor: round(Math.exp(quantile(sorted, 0.75)), 2),
        within_two_pct: Math.round(withinTwo / Math.max(1, errors.length) * 100),
        median_abs_log_error: median(sorted)
      };
    });
    tested.sort((a, b) => a.median_abs_log_error - b.median_abs_log_error || b.within_two_pct - a.within_two_pct || a.shrinkage - b.shrinkage);
    const selected = tested[0] || { shrinkage: 8, held_out: 0, median_error_factor: 2, p75_error_factor: 2, within_two_pct: 0, median_abs_log_error: 0 };
    const ages = protocols.map(protocol => ageDays(asOf, protocol.listed_at)).filter(age => age !== null);
    return {
      method: 'leave-one-out market-cap / TVL peer reconstruction',
      selected_shrinkage: selected.shrinkage,
      held_out: selected.held_out,
      median_error_factor: selected.median_error_factor,
      p75_error_factor: selected.p75_error_factor,
      within_two_pct: selected.within_two_pct,
      median_age_days: Math.round(median(ages) || 180),
      candidates: tested.map(row => ({ shrinkage: row.shrinkage, median_error_factor: row.median_error_factor, p75_error_factor: row.p75_error_factor, within_two_pct: row.within_two_pct }))
    };
  }

  function peers(protocols, asOf = '2026-11-14') {
    const evidence = peerRows(protocols);
    const categories = {};
    for (const row of evidence) (categories[row.category] ||= []).push(row.clipped_ratio);
    const validation = validationReport(protocols, evidence, asOf);
    return {
      broad: median(evidence.map(row => row.clipped_ratio)) || 0.25,
      count: evidence.length,
      categories,
      evidence,
      selected_shrinkage: validation.selected_shrinkage,
      validation,
      median_age_days: validation.median_age_days
    };
  }

  const lowFeeChains = ['Base', 'Arbitrum', 'Optimism', 'Solana', 'Sui', 'Polygon', 'Monad', 'Starknet'];

  function farmPlan(protocol, age) {
    const chain = lowFeeChains.find(candidate => protocol.chains.includes(candidate)) || protocol.chains[0] || 'the supported network';
    const networkFee = chain === 'Ethereum' ? 18 : /Bitcoin/i.test(chain) ? 10 : 3;
    const capital = 100;
    const days = age !== null && age < 180 ? 42 : 28;
    const category = protocol.category || 'Other';
    const restricted = /RWA|CeDeFi|Uncollateralized|OTC|Card|Payments|Chain|Privacy|Governance/i.test(category);
    const weeklyReviews = Math.ceil(days / 7);
    const feeTransactions = restricted ? 0 : weeklyReviews + 2;
    const feeBudget = restricted ? 0 : networkFee * feeTransactions;
    const opportunityCost = restricted ? 0 : round(capital * 0.05 * days / 365);
    const route = restricted ? 'research-only' : 'verify-before-fund';
    let openAction, exitAction, risk;
    if (/Lending|CDP|Collateral/i.test(category)) {
      openAction = `Confirm ${protocol.name}'s public supply market, supported collateral and withdrawal queue on ${chain}; then test a $20 supply before sizing up to $${capital}.`;
      exitAction = `Redeem the $20 test first, then withdraw the remainder, review the queue, and revoke the allowance after the final transaction.`;
      risk = 'Contract, oracle and withdrawal risk; never borrow against the test position.';
    } else if (/Dex|Liquidity/i.test(category)) {
      openAction = `Confirm a liquid, supported pair on ${chain}; execute one genuine $20 swap with a 0.5% slippage cap, and add liquidity only after pool depth is checked.`;
      exitAction = 'Remove liquidity into the underlying assets, review price impact, and revoke token approvals after the last swap.';
      risk = 'Pool depth, impermanent loss, MEV and unverified token risk.';
    } else if (/Restak|Staking|BTC/i.test(category)) {
      openAction = `Inspect ${protocol.name}'s accepted collateral and validator terms on ${chain}; simulate a $20 delegation and fund only after slashing and unlock terms are clear.`;
      exitAction = 'Start the unstake queue before the review window ends, record the unlock date, and redeem the receipt when available.';
      risk = 'Slashing, receipt depeg, validator and unbonding risk.';
    } else if (/Deriv|Perpetual|Prediction|Basis|Options/i.test(category)) {
      openAction = `Inspect the ${protocol.name} market, eligibility and fee schedule on ${chain}; use a small unleveraged $20 test only if the route is public.`;
      exitAction = 'Close the position, settle funding and withdraw margin; record realized PnL rather than treating activity as a reward.';
      risk = 'Trading loss, funding and liquidation risk; activity can lose principal.';
    } else if (/Risk Curator|Allocator|Yield|Farm|Manager|Indexes/i.test(category)) {
      openAction = `Verify the ${protocol.name} vault address, curator, underlying assets, fees and redemption window on ${chain}; make a $20 test deposit before a $${capital} target.`;
      exitAction = 'Redeem the test share, confirm the returned asset, then unwind the remaining shares and allowances before the deadline.';
      risk = 'Underlying protocol, curator concentration and redemption-delay risk.';
    } else {
      openAction = `Read ${protocol.name}'s official ${category} access and product documentation on ${chain}; confirm public eligibility, minimum size and a documented exit before funding anything.`;
      exitAction = 'Use the documented redemption or account-closure route only after access and exit have been verified independently.';
      risk = 'Access restrictions, counterparty exposure and an unverified route.';
    }
    if (restricted) {
      openAction = `Check ${protocol.name}'s official ${category} access requirements on ${chain}, including region, approval, supported assets and minimum size. Keep it research-only until a public route and exit are verified.`;
      exitAction = `Do not commit funds to ${protocol.name} until eligibility, custody and the documented redemption path are independently confirmed.`;
    }
    const steps = [
      { title: '01 · Confirm the source', text: `Start with the DefiLlama slug ${protocol.slug} and locate the official ${protocol.name} route. The snapshot records no campaign, points balance or allocation, so verify any current claim separately.`, cost: '$0', time: '8 min' },
      { title: restricted ? '02 · Check eligibility' : '02 · Run a small test', text: openAction, cost: restricted ? '$0 until eligible' : `$20 test; target capital $${capital}; network fees are estimated separately`, time: '12–20 min' },
      { title: '03 · Keep useful activity', text: restricted ? `Record the access decision, supported assets and exit evidence for ${protocol.name}; stop if the public route cannot be verified.` : `Review the position once per week for ${days} days. Keep dated transaction hashes and any points balance actually displayed; do not manufacture volume.`, cost: restricted ? '$0 research' : `~$${networkFee} per network action; ${weeklyReviews} reviews budgeted`, time: `${days} days · 5 min/week` },
      { title: '04 · Prove the exit', text: exitAction, cost: restricted ? '$0 research' : `~$${networkFee} network fees plus unknown product fees`, time: restricted ? '10 min research' : '10 min plus any queue' },
      { title: '05 · Stop or reassess', text: `Recheck ${protocol.name}'s token announcement, fees, access and redemption before adding capital. Stop when the tokenless thesis, route or risk evidence changes.`, cost: '$0 research; no reward assumed', time: '5 min/week' }
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
      time_minutes: restricted ? 38 : 68 + weeklyReviews * 5,
      opportunity_cost_usd: opportunityCost,
      estimated_total_cost_usd: round(feeBudget + opportunityCost),
      break_even_reward_usd: round(feeBudget + opportunityCost),
      funding_budget_usd: restricted ? 0 : capital + feeBudget,
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
    const estimate = estimateMultiple(category, evidence, peer.selected_shrinkage ?? 8);
    const growth = clamp(protocol.change_7d ?? 0, -60, 150);
    const growthMultiplier = clamp(1 + growth / 240, 0.75, 1.4);
    const age = ageDays(asOf, protocol.listed_at);
    const ageForModel = age === null ? (peer.median_age_days ?? 180) : age;
    const maturityMultiplier = 0.75 + 0.35 * Math.min(ageForModel, 1095) / 1095;
    const implied = clamp(Math.round(protocol.tvl_usd * estimate.multiple * growthMultiplier * maturityMultiplier * scenario), 1, 100000000000000);
    const peerCoverage = Math.min(1, estimate.categoryCount / 12);
    const fieldCoverage = (protocol.change_7d !== null ? 0.25 : 0) + (protocol.listed_at !== null ? 0.25 : 0) + (estimate.categoryCount ? 0.5 : 0);
    const confidence = Math.round(clamp(35 + peerCoverage * 35 + fieldCoverage * 30, 0, 95));
    const momentum = clamp(50 + growth / 2, 0, 100);
    const scale = clamp((Math.log10(Math.max(1, protocol.tvl_usd)) - 6) * 25, 0, 100);
    const maturityScore = clamp(ageForModel / 1095 * 100, 0, 100);
    const actionability = /RWA|CeDeFi|Uncollateralized|OTC|Card|Payments|Chain|Privacy|Governance/i.test(category) ? 40 : 72;
    const alpha = Math.round(momentum * 0.35 + scale * 0.3 + maturityScore * 0.15 + confidence * 0.1 + actionability * 0.1);
    const band = clamp(peer.validation?.p75_error_factor ?? 2, 1.35, 10);
    return {
      implied,
      low: Math.max(1, Math.round(implied / band)),
      high: Math.min(100000000000000, Math.round(implied * band)),
      multiple: round(estimate.multiple, 4),
      growth: round(growthMultiplier, 4),
      maturity: round(maturityMultiplier, 4),
      age,
      model_age_days: ageForModel,
      confidence,
      alpha,
      peer_count: estimate.categoryCount,
      peer_weight: round(estimate.weight, 4),
      category_median: estimate.categoryCount ? round(estimate.categoryMedian, 4) : null,
      global_median: round(estimate.globalMedian, 4),
      validation_band: round(band, 2),
      peer_evidence: [...evidence].filter(row => row.category === category).sort((a, b) => Math.abs(a.clipped_ratio - estimate.categoryMedian) - Math.abs(b.clipped_ratio - estimate.categoryMedian) || codeOrder(a.slug, b.slug)).slice(0, 5),
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
    return { schema: 'aperture/radar-v2', as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
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

  globalThis.RadarEngine = { parseSnapshot, tokenStatus, ageDays, peers, valueProtocol, farmPlan, buildRadar, boardIssue, clamp, median, quantile };
})();

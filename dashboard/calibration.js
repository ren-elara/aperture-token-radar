/* Robust log-value fit; every validation prediction is made without its outer fold. */
(() => {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 : 0; };
  const configs = [1, 8, 32].flatMap(ridge => [4, 12].map(shrinkage => ({ ridge, shrinkage })));
  const hash = s => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const age = (p, date) => p.listed_at ? Math.max(0, (Date.parse(date) - Date.parse(p.listed_at)) / 86400000) : null;
  function solve(matrix, target) {
    const a = matrix.map((row, i) => [...row, target[i]]);
    for (let i = 0; i < target.length; i++) {
      let pivot = i;
      for (let j = i + 1; j < a.length; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
      [a[i], a[pivot]] = [a[pivot], a[i]];
      const d = a[i][i] || 1e-9;
      for (let k = i; k <= target.length; k++) a[i][k] /= d;
      for (let j = 0; j < a.length; j++) if (j !== i) {
        const f = a[j][i];
        for (let k = i; k <= target.length; k++) a[j][k] -= f * a[i][k];
      }
    }
    return a.map(row => row[target.length]);
  }
  function features(p, fit, date) {
    return [1, Math.log(Math.max(1, p.tvl_usd) / 1e8), clamp(p.change_7d ?? fit.growth_prior, -60, 150) / 100,
      Math.log1p((age(p, date) ?? fit.age_prior) / 365)];
  }
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  function train(rows, date, config, omit = '') {
    const fit = { ...config, omit, age_prior: median(rows.map(p => age(p, date)).filter(v => v !== null)) || 180,
      growth_prior: median(rows.map(p => p.change_7d).filter(v => v !== null)), categories: {}, count: rows.length };
    if (!rows.length) return { ...fit, beta: [Math.log(.25), 0, 0, 0] };
    const x = rows.map(p => features(p, fit, date).map((v, i) => ['intercept', 'size', 'growth', 'age'][i] === omit ? 0 : v));
    const y = rows.map(p => Math.log(p.mcap_usd / p.tvl_usd));
    let beta = [median(y) || Math.log(.25), 0, 0, 0];
    for (let iteration = 0; iteration < 6; iteration++) {
      const matrix = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i === j ? i ? config.ridge : 1e-8 : 0));
      const target = [0, 0, 0, 0];
      for (let r = 0; r < rows.length; r++) {
        const residual = Math.abs(y[r] - dot(x[r], beta));
        const weight = Math.min(1, 1.5 / Math.max(1e-9, residual));
        for (let i = 0; i < 4; i++) {
          target[i] += weight * x[r][i] * y[r];
          for (let j = 0; j < 4; j++) matrix[i][j] += weight * x[r][i] * x[r][j];
        }
      }
      beta = solve(matrix, target).map((v, i) => i ? clamp(v, -1.5, 1.5) : v);
    }
    fit.beta = beta;
    const residuals = {};
    rows.forEach((p, i) => (residuals[p.category || 'Other'] ||= []).push(y[i] - dot(x[i], beta)));
    for (const [category, values] of Object.entries(residuals)) fit.categories[category] = {
      count: values.length, residual: median(values), offset: omit === 'category' ? 0 : median(values) * values.length / (values.length + config.shrinkage)
    };
    return fit;
  }
  function predict(p, fit, date) {
    const x = features(p, fit, date), category = fit.categories[p.category || 'Other'];
    const terms = x.map((v, i) => fit.beta[i] * v);
    return { multiple: Math.exp(terms[0] + terms[1] + (category?.offset || 0)), growth: Math.exp(terms[2]),
      maturity: Math.exp(terms[3]), log_ratio: terms.reduce((a, b) => a + b, 0) + (category?.offset || 0),
      category_count: category?.count || 0, size_factor: Math.exp(terms[1]) };
  }
  function folds(rows, n) {
    // Round-robin allocation keeps tiny folds populated.
    const sorted = [...rows].sort((a, b) => hash(a.slug) - hash(b.slug) || (a.slug < b.slug ? -1 : 1));
    return Array.from({ length: Math.min(n, rows.length) }, (_, i) => sorted.filter((_, k) => k % Math.min(n, rows.length) === i));
  }
  function choose(rows, date) {
    const parts = folds(rows, 4);
    return configs.map(config => {
      const errors = [];
      parts.forEach((test, i) => {
        const fit = train(parts.filter((_, j) => j !== i).flat(), date, config);
        test.forEach(p => errors.push(Math.abs(predict(p, fit, date).log_ratio - Math.log(p.mcap_usd / p.tvl_usd))));
      });
      return { ...config, loss: errors.reduce((s, e) => s + e, 0) / Math.max(1, errors.length) };
    }).sort((a, b) => a.loss - b.loss || b.ridge - a.ridge || b.shrinkage - a.shrinkage)[0];
  }
  function metrics(predictions, key = 'log_prediction') {
    const errors = predictions.map(p => Math.abs(p[key] - p.log_actual)).sort((a, b) => a - b);
    return { held_out: errors.length, median_error_factor: Math.exp(median(errors)),
      p75_error_factor: Math.exp(errors[Math.floor((errors.length - 1) * .75)] || 0),
      mean_abs_log_error: errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length),
      within_two_pct: Math.round(errors.filter(e => e <= Math.log(2)).length / Math.max(1, errors.length) * 100) };
  }
  function calibrate(rows, date) {
    const predictions = [], ablations = Object.fromEntries(['size', 'growth', 'age', 'category'].map(key => [key, []]));
    folds(rows, 5).forEach((test, i, parts) => {
      const training = parts.filter((_, j) => j !== i).flat(), config = choose(training, date), fit = train(training, date, config);
      const prior = median(training.map(p => Math.log(p.mcap_usd / p.tvl_usd)));
      test.forEach(p => predictions.push({ slug: p.slug, fold: i, log_actual: Math.log(p.mcap_usd),
        log_prediction: Math.log(p.tvl_usd) + predict(p, fit, date).log_ratio,
        log_baseline: Math.log(p.tvl_usd) + prior, training_count: training.length, config: { ridge: config.ridge, shrinkage: config.shrinkage } }));
      for (const key of Object.keys(ablations)) {
        const without = train(training, date, config, key);
        test.forEach(p => ablations[key].push({ log_actual: Math.log(p.mcap_usd), log_prediction: Math.log(p.tvl_usd) + predict(p, without, date).log_ratio }));
      }
    });
    const config = choose(rows, date), fit = train(rows, date, config);
    return { fit, report: { method: 'nested 5-fold full-value validation; 4 inner folds select ridge and category shrinkage',
      ...metrics(predictions), baseline: metrics(predictions, 'log_baseline'),
      selected_shrinkage: config.shrinkage, selected_ridge: config.ridge, median_age_days: Math.round(fit.age_prior),
      coefficients: { intercept: fit.beta[0], size: fit.beta[1], growth: fit.beta[2], age: fit.beta[3] },
      ablations: Object.fromEntries(Object.entries(ablations).map(([k, p]) => [k, metrics(p)])), predictions } };
  }
  globalThis.RadarCalibration = { train, predict, calibrate, metrics, configs };
})();

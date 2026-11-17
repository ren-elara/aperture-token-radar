import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import './dashboard/engine.js';
import { scoreLaunch, observation, normalizeDex, normalizeGecko, mergeObservations, AlertCache } from './lib/launch.mjs';
import { requestJson, discover, solanaSafety } from './lib/feeds.mjs';
import { runLive } from './live.mjs';

const E=globalThis.RadarEngine, results=[];
mkdirSync('.verify',{recursive:true});mkdirSync('artifacts',{recursive:true});
async function test(name,fn){const start=performance.now();try{await fn();results.push({name,status:'pass',ms:+(performance.now()-start).toFixed(2)});console.log('PASS',name);}catch(e){results.push({name,status:'fail',error:e.message});console.error('FAIL',name,e.stack);}}
const raw=readFileSync('token-radar-01-kit/input/snapshot.json','utf8'),snapshot=E.parseSnapshot(raw),radar=E.buildRadar(snapshot);
const fixtures=JSON.parse(readFileSync('fixtures/launches.json','utf8')).rows;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const runMain=(out,extra=[])=>{
  const args=[...(!process.features.typescript?['--import','tsx']:[]),'main.ts','--input','token-radar-01-kit/input/snapshot.json','--output',out,...extra];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return r.stdout;
};
function files(dir,base=''){return readdirSync(dir).sort().flatMap(n=>statSync(join(dir,n)).isDirectory()?files(join(dir,n),join(base,n)):[join(base,n)]);}
function manifest(dir){return Object.fromEntries(files(dir).map(f=>[f,createHash('sha256').update(readFileSync(join(dir,f))).digest('hex')]));}
await test('sealed schema, full watchlist and sorted unique ranks',()=>{
  assert.equal(snapshot.protocols.length,758);assert.equal(snapshot.watchlist.length,40);assert.equal(E.boardIssue(radar,snapshot),null);
  assert.equal(new Set(radar.rows.map(r=>r.slug)).size,radar.rows.length);
  assert(radar.rows.every(r=>!r.gecko_id&&!r.symbol));
  assert.equal(radar.rows.length+radar.recorded.length+radar.excluded.length,758);
  assert(radar.rows.some(r=>r.early));assert(!radar.rows.some(r=>r.slug==='wbtc'));
});
await test('strict malformed, duplicate, missing-watchlist and date refusal',()=>{
  assert.throws(()=>E.parseSnapshot('{oops'));
  for(const modify of [s=>s.protocols.push(s.protocols[0]),s=>s.watchlist.push('invented-slug'),s=>s.watchlist.push(s.watchlist[0]),s=>s.as_of='2026-02-31',s=>s.protocols[0].change_7d='bad',s=>s.protocols[0].chains=null,s=>s.protocols[0].tvl_usd=-3]){const s=JSON.parse(raw);modify(s);assert.throws(()=>E.parseSnapshot(JSON.stringify(s)));}
  const sentinel=E.parseSnapshot(raw).protocols.find(p=>p.slug==='autofinance');assert.equal(sentinel.mcap_usd,null);assert.equal(E.tokenStatus(sentinel),'recorded');
});
await test('value formula, growth/age monotonicity, sparse peer shrinkage',()=>{
  const p={...snapshot.protocols.find(p=>p.slug==='curvance')},peer=E.peers(snapshot.protocols),base=E.valueProtocol(p,snapshot.as_of,peer);
  assert(Math.abs(base.implied-Math.round(p.tvl_usd*base.multiple*base.growth*base.maturity))/base.implied<.001, 'displayed factors should reproduce value within 0.1% rounding');
  assert(E.valueProtocol({...p,change_7d:100},snapshot.as_of,peer).implied>E.valueProtocol({...p,change_7d:-50},snapshot.as_of,peer).implied);
  assert(E.valueProtocol({...p,listed_at:'2023-01-01'},snapshot.as_of,peer).implied>E.valueProtocol({...p,listed_at:'2026-11-01'},snapshot.as_of,peer).implied);
  const sparse={broad:0.3,categories:{Lending:[3]}};assert(E.valueProtocol(p,snapshot.as_of,sparse).multiple<1);
  assert(E.valueProtocol({...p,tvl_usd:p.tvl_usd*2},snapshot.as_of,peer).implied>=base.implied*2-1);
  assert.equal(E.ageDays(snapshot.as_of,null),null);
});
await test('farm plans have concrete costs, duration, access gates and exits',()=>{
  for(const r of radar.rows){assert.equal(r.farm_steps.length,5);for(const s of r.farm_steps){assert(s.length>=20&&s.length<=600);assert.match(s,/Budget:/);assert.match(s,/Time:/);}assert(r.plan.steps.some(s=>/exit/i.test(s.title)));}
  assert(radar.rows.filter(p=>p.category==='RWA').every(p=>p.plan.restricted));
});
await test('traceable peer observations and consistent 28/42-day farm economics',()=>{
  for(const p of radar.rows){
    const v=p.model,plan=p.plan;
    for(const r of v.peer_evidence){const source=snapshot.protocols.find(x=>x.slug===r.slug);assert(source&&E.tokenStatus(source)==='recorded');assert.equal(r.ratio,source.mcap_usd/source.tvl_usd);assert.equal(r.clipped_ratio,E.clamp(r.ratio,.03,3));}
    assert.equal(plan.weekly_reviews,Math.ceil(plan.days/7));
    assert.equal(plan.fee_budget_usd,plan.fee_transactions*plan.network_fee_per_action_usd);
    assert.equal(plan.funding_budget_usd,plan.capital_usd+plan.fee_budget_usd);
    if(plan.restricted){assert.equal(plan.capital_usd,0);assert(plan.steps.every(s=>!/^~\$/.test(s.cost)));assert.match(plan.steps[1].text,/commit no funds/);}
    else{assert.equal(plan.fee_transactions,plan.weekly_reviews+2);assert(plan.opportunity_cost_usd>0);}
  }
  const fresh=E.farmPlan({...snapshot.protocols[0],category:'Lending'},30);assert.equal(fresh.fee_transactions,8);
});
await test('runner/rug ordering, unknown safety caps and authority veto',()=>{
  const [runner,rug,unknown,quiet]=fixtures.map(scoreLaunch);
  assert(runner.composite>quiet.composite);assert(quiet.composite>rug.composite);assert(runner.alert);assert(!rug.alert);assert(rug.veto.length>=4);
  assert.equal(unknown.safety,45);assert(!unknown.alert);assert(unknown.unknown.includes('unique wallet buyers'));
  assert(!scoreLaunch({...fixtures[0],mintAuthority:true}).alert);
  assert.throws(()=>observation({chain:'solana',mint:'bad'}));
  assert.equal(scoreLaunch({...fixtures[0],volume5m:Infinity}).volume5m,null);
});
await test('vendor payload validation, numeric Gecko fields, liquidity dedup',()=>{
  assert.throws(()=>normalizeDex({pairs:[]}));assert.deepEqual(normalizeDex([null,{}, {baseToken:{}}]),[]);
  assert.throws(()=>normalizeGecko({}));
  const gecko=normalizeGecko({data:[{attributes:{name:'Example',reserve_in_usd:'10000',volume_usd:{m5:'200'},fdv_usd:'100000'},relationships:{base_token:{data:{id:'solana_'+fixtures[0].mint}}}}]});
  assert.equal(gecko[0].liquidity,10000);assert.equal(gecko[0].uniqueBuyers5m,null);
  assert.equal(mergeObservations([{...fixtures[0],liquidity:1},fixtures[0]]).length,1);
  assert.equal(mergeObservations([{...fixtures[0],liquidity:1},fixtures[0]])[0].liquidity,180000);
});
await test('bounded retries, Retry-After, nonretryable status and body cap',async()=>{
  let calls=0;const delays=[];
  const r=await requestJson('https://fixture.invalid',{fetchImpl:async()=>++calls<3?new Response('',{status:429,headers:{'retry-after':'0'}}):Response.json({ok:true}),sleep:async n=>delays.push(n),random:()=>.5});
  assert(r.ok);assert.equal(calls,3);assert.deepEqual(delays,[150,300]);
  calls=0;await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>{calls++;return new Response('',{status:404});},sleep:async()=>{}}));assert.equal(calls,1);
  await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>new Response('x'.repeat(100)),maxBytes:20}));
  await assert.rejects(requestJson('https://fixture.invalid',{fetchImpl:async()=>new Response('not json'),attempts:1}));
});
await test('multi-vendor fallback and all-offline deterministic replay',async()=>{
  const gecko={data:[{attributes:{name:'Fallback',reserve_in_usd:'50000'},relationships:{base_token:{data:{id:'solana_'+fixtures[0].mint}}}}]};
  const discovery=await discover({request:async url=>{if(url.includes('geckoterminal'))return gecko;throw Error('Vendor down');}});
  assert.equal(discovery.rows.length,1);assert(discovery.health.filter(x=>x.status==='failed').length===2);
  const a=await runLive({offline:true}),b=await runLive({offline:true});assert.deepEqual(a,b);
  const fallback=await runLive({request:async()=>{throw Error('offline');}});assert.equal(fallback.mode,'fallback-fixture');assert.equal(fallback.rows.length,4);
});
await test('Solana authorities, exact supply arithmetic and unsupported mint owner',async()=>{
  const request=async(_,o)=>o.body.method==='getAccountInfo'?{result:{value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{type:'mint',info:{supply:'10000000000000000000',mintAuthority:null,freezeAuthority:'active'}}}}}}:{result:{value:[{amount:'2000000000000000000'}]}};
  const s=await solanaSafety('So11111111111111111111111111111111111111112',{request});assert.equal(s.top10AccountsPct,20);assert.equal(s.freezeAuthority,true);assert.equal(s.mintAuthority,false);
  await assert.rejects(solanaSafety('So11111111111111111111111111111111111111112',{request:async()=>({result:{value:{owner:'Token2022'}}})}));
});
await test('dedup TTL, score transitions, risk escalation and bounded cache',()=>{
  let now=0;const cache=new AlertCache({ttl:100,max:2,now:()=>now}),s=scoreLaunch(fixtures[0]);
  assert(cache.accept(s));assert(!cache.accept(s));assert(cache.accept({...s,veto:['Active freeze authority'],alert:false}));
  now=101;assert(cache.accept(s));cache.accept(scoreLaunch(fixtures[1]));cache.accept(scoreLaunch(fixtures[2]));assert.equal(cache.map.size,2);
});
await test('replay scoring and full board latency benchmarks',()=>{
  const scoring=[],board=[];
  for(let i=0;i<2000;i++){const start=performance.now();scoreLaunch(fixtures[i%4]);scoring.push(performance.now()-start);}
  for(let i=0;i<25;i++){const start=performance.now();E.buildRadar(snapshot);board.push(performance.now()-start);}
  const summarize=a=>({p50_ms:+percentile(a,.5).toFixed(4),p95_ms:+percentile(a,.95).toFixed(4),p99_ms:+percentile(a,.99).toFixed(4)});
  const output={runtime:process.version,arch:process.arch,protocols:snapshot.protocols.length,ranked:radar.rows.length,scoring_samples:scoring.length,launch_scoring:summarize(scoring),board_samples:board.length,board_build:summarize(board)};
  writeFileSync('artifacts/benchmarks.json',JSON.stringify(output,null,2)+'\n');assert(output.launch_scoring.p99_ms<20);assert(output.board_build.p95_ms<1500);
});
await test('two full builds produce identical directory bytes and valid dossier',async()=>{
  runMain('.verify/run-a');runMain('.verify/run-b');assert.deepEqual(manifest('.verify/run-a'),manifest('.verify/run-b'));
  if(!process.features.typescript){const {register}=await import('tsx/esm/api');register();}
  const {buildDossier}=await import('./vendor/makefun-board.ts');
  const dossier=readFileSync('.verify/run-a/dossier.json');assert(dossier.length<=1572864);assert.deepEqual(dossier,Buffer.from(buildDossier('.verify/run-a',{text_max_bytes:65536})));
  const doc=JSON.parse(dossier);assert.equal(doc.images.length,4);assert(!doc.text.includes('[Cut at'));
  assert.deepEqual(readFileSync('vendor/makefun-board.ts'),readFileSync('token-radar-01-kit/starter/vendor/makefun-board.ts'));
  for(const shot of files('screenshots'))assert(statSync(join('screenshots',shot)).size<=524288);
});
await test('offline browser: rows, details, filters, sort, scenarios, export, mobile',async()=>{
  const {browser}=await import('./scripts/browser.mjs'),b=await browser();
  try{
    const context=await b.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],remote=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>{remote.push(r.request().url());return r.abort();});
    await page.goto(pathToFileURL(resolve('.verify/run-a/dashboard/index.html')).href);await page.waitForSelector('#rows tr');
    assert.equal(await page.evaluate(()=>Aperture.radar.rows.length),radar.rows.length);
    const dims=await page.evaluate(async()=>{const a=[];for(const src of ['1-board.jpg','2-detail.jpg','3-filtered.jpg']){const img=new Image();img.src='../../..'+'/screenshots/'+src;await img.decode();a.push([img.naturalWidth,img.naturalHeight]);}return a;});
    for(const [w,h]of dims){assert(Math.min(w,h)>=800);assert(Math.max(w,h)<=1440);}
    await page.fill('#search','curvance');assert.equal(await page.locator('#rows tr').count(),1);await page.locator('[data-open="curvance"]').first().click();await page.waitForSelector('#detail-view:not([hidden])');assert.match(await page.locator('#detail-view').innerText(),/YOUR FARM PLAN/);
    assert.match(await page.locator('#detail-view').innerText(),/TRACE THE VALUATION/);assert.match(await page.locator('#detail-view').innerText(),/PLAN ECONOMICS/);assert(await page.locator('.peer-evidence > div').count()>0);
    await page.locator('[data-back]').click();await page.click('#clear');await page.click('#early');await page.selectOption('#category','Lending');await page.selectOption('#chain','Base');
    assert(await page.evaluate(()=>Aperture.filtered().every(r=>r.early&&r.category==='Lending'&&r.chains.includes('Base'))));
    await page.click('#clear');await page.click('[data-sort="name"]');assert.equal(await page.evaluate(()=>Aperture.state.sort),'name');
    const before=await page.evaluate(()=>Aperture.radar.rows[0].implied_value_usd);await page.selectOption('#scenario','0.5');const after=await page.evaluate(()=>Aperture.radar.rows[0].implied_value_usd);assert(Math.abs(after-before*.5)<=1);
    const download=page.waitForEvent('download');await page.click('#export');const d=await download;await d.saveAs(resolve('.verify/export.json'));assert(JSON.parse(readFileSync('.verify/export.json')).rows.length>100);
    await page.locator('[data-save]').first().click();await page.locator('[data-view="saved"]').click();assert.equal(await page.evaluate(()=>Aperture.filtered().length),1);
    await page.locator('[data-view="method"]').click();assert.match(await page.locator('#method-view').innerText(),/category peer count/);
    await page.setViewportSize({width:390,height:844});await page.locator('[data-view="board"]').click();assert(await page.locator('#rows').isVisible());
    await page.evaluate(()=>{location.hash='protocol/missing-slug';});await page.waitForFunction(()=>!document.getElementById('board-view').hidden);
    await page.evaluate(()=>{location.hash='%E0%A4%A';});await page.waitForFunction(()=>!document.getElementById('board-view').hidden);
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  }finally{await b.close();}
});
if(process.argv.includes('--live'))await test('bounded real public feed probe (outages explicitly reported)',async()=>{
  const result=await runLive({limit:3});writeFileSync('artifacts/verification-live.json',JSON.stringify({mode:result.mode,elapsed_ms:result.elapsed_ms,count:result.rows.length,health:result.health},null,2)+'\n');
  assert(result.rows.length>0);if(result.mode!=='live')console.log('DEGRADED: live providers unavailable; replay verified, live not claimed');
});
writeFileSync('artifacts/verification.json',JSON.stringify({passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,results},null,2)+'\n');
console.log(`\n${results.filter(r=>r.status==='pass').length}/${results.length} checks passed`);
if(results.some(r=>r.status==='fail'))process.exitCode=1;

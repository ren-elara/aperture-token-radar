import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { discover, solanaSafety } from './lib/feeds.mjs';
import { scoreLaunch, AlertCache, mergeObservations } from './lib/launch.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/launches.json',import.meta.url),'utf8'));
export async function runLive({offline=false,replay=null,withRpc=false,limit=8,request}={}) {
  let result={rows:[],health:[],elapsed_ms:0},mode='live';
  if(!offline&&!replay)result=await discover({limit,...(request?{request}:{})});
  if(offline||replay||!result.rows.length){const f=replay?JSON.parse(readFileSync(replay,'utf8')):fixture();result.rows=mergeObservations(f.rows);mode=replay?'replay':offline?'fixture':'fallback-fixture';}
  if(withRpc&&mode==='live'){
    for(const row of result.rows.slice(0,limit))if(row.chain==='solana')try{Object.assign(row,await solanaSafety(row.mint,request?{request}:{}));}catch(e){result.health.push({source:'solana-rpc',status:'failed',reason:e.message});}
  }
  return {mode,...result,rows:result.rows.map(scoreLaunch).sort((a,b)=>b.composite-a.composite||a.mint.localeCompare(b.mint)),notice:mode==='live'?'Observed market data; unknown fields reduce confidence.':'SYNTHETIC REPLAY: not live tokens or historical outcomes.'};
}
async function main(){
  const args=process.argv.slice(2),arg=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1];};
  if(args.includes('--help')){console.log('node live.mjs [--offline | --replay file.json] [--rpc] [--json] [--watch] [--interval 60] [--limit 8]\nDiscovery: DexScreener profiles/boosts + GeckoTerminal new pools. --rpc verifies SPL mint authorities and largest token accounts. All failures fall back to labeled synthetic fixtures.');return;}
  const limit=Number(arg('--limit',8)),interval=Number(arg('--interval',60));
  if(!Number.isInteger(limit)||limit<1||limit>30||!Number.isFinite(interval)||interval<30)throw Error('limit must be 1–30 and interval at least 30 seconds');
  const cache=new AlertCache();let running=true;process.on('SIGINT',()=>running=false);process.on('SIGTERM',()=>running=false);
  do{
    const result=await runLive({offline:args.includes('--offline'),replay:arg('--replay',null),withRpc:args.includes('--rpc'),limit});
    const changed=result.rows.filter(r=>cache.accept(r));
    if(args.includes('--json'))console.log(JSON.stringify({...result,changed:changed.map(r=>`${r.chain}:${r.mint}`)}));
    else{
      console.log(`\nAPERTURE / ${result.mode.toUpperCase()} / ${result.elapsed_ms}ms / ${result.rows.length} tokens\n${result.notice}`);
      console.table(result.rows.map(r=>({token:r.name,chain:r.chain,alpha:r.alpha,safety:r.safety,score:r.composite,signal:r.alert?'ALERT':r.veto.length?'VETO':'WATCH',unknown:r.unknown.length})));
      for(const r of changed)console.log(`${r.name}: ${r.reasons.join('; ')}${r.veto.length?' | VETO: '+r.veto.join('; '):''} | UNKNOWN: ${r.unknown.join(', ')||'none'}`);
      console.log(`Sources: ${result.health.map(h=>`${h.source}=${h.status}`).join(', ')||'fixture; no requests'}`);
    }
    if(!args.includes('--watch')||!running)break;
    // Short timers allow SIGINT to stop quickly even during a longer poll interval.
    for(let elapsed=0;elapsed<interval*1000&&running;elapsed+=250)await new Promise(r=>setTimeout(r,250));
  }while(running);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(`Aperture live: ${e.message}`);process.exitCode=1;});

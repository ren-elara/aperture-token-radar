// Public market observations are distinct from the sealed pre-token valuation universe.
export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const numeric = v => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : number(v);
const bool = v => typeof v === 'boolean' ? v : null;
export function observation(p) {
  if (!p || typeof p.chain !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.chain) || typeof p.mint !== 'string' || !/^[a-zA-Z0-9]{20,100}$/.test(p.mint)) throw Error('Invalid chain or token identity');
  const o = {chain:p.chain,mint:p.mint,name:typeof p.name==='string'?p.name.slice(0,80):p.mint,source:typeof p.source==='string'?p.source:'unknown'};
  for (const k of ['volume5m','volume1h','buys5m','sells5m','uniqueBuyers5m','liquidity','fdv','top10AccountsPct','slippagePct','observedAt','createdAt']) o[k]=number(p[k]);
  for (const k of ['mintAuthority','freezeAuthority']) o[k]=bool(p[k]);
  return o;
}
export function scoreLaunch(raw) {
  const o = observation(raw), reasons=[], unknown=[], veto=[];
  const components = {acceleration:0,pressure:0,buyerVelocity:0,liquidity:0};
  if (o.volume5m !== null && o.volume1h !== null && o.volume1h >= o.volume5m && o.volume1h > 0) {
    // Compare the last 5m with the preceding 55m; windows overlap, so subtract first.
    const baseline=(o.volume1h-o.volume5m)/11;
    const acceleration = o.volume5m / Math.max(1,baseline);
    components.acceleration = clamp((Math.log2(Math.max(0.125,acceleration))+1)*12,0,30);
    reasons.push(`Volume acceleration ${acceleration.toFixed(2)}× preceding 55m`);
  } else unknown.push('volume acceleration');
  if (o.buys5m !== null && o.sells5m !== null && o.buys5m+o.sells5m>0) {
    const fraction=o.buys5m/(o.buys5m+o.sells5m);
    components.pressure = fraction*25;
    reasons.push(`Buy pressure ${(fraction*100).toFixed(0)}% of transactions`);
  } else unknown.push('buy/sell pressure');
  if (o.uniqueBuyers5m !== null) {
    components.buyerVelocity = clamp(Math.log2(1+o.uniqueBuyers5m)*3,0,20);
    reasons.push(`${o.uniqueBuyers5m} observed unique buyers / 5m`);
  } else unknown.push('unique wallet buyers');
  if (o.liquidity !== null && o.fdv !== null && o.fdv>0) {
    const ratio=o.liquidity/o.fdv;
    components.liquidity=clamp(ratio/0.15*25,0,25);
    reasons.push(`Liquidity / FDV ${(ratio*100).toFixed(2)}%`);
  } else unknown.push('liquidity / FDV');
  let safety=100, safetyKnown=0;
  for (const [key,label,penalty] of [['mintAuthority','mint authority',35],['freezeAuthority','freeze authority',30]]) {
    if (o[key] === null) unknown.push(label); else { safetyKnown++; if(o[key]){safety-=penalty;veto.push(`Active ${label}`);} }
  }
  if(o.top10AccountsPct!==null){safetyKnown++;if(o.top10AccountsPct>35){safety-=clamp((o.top10AccountsPct-20)*.8,0,50);reasons.push(`Largest 10 token accounts ${o.top10AccountsPct.toFixed(1)}% (not unique holders)`);}if(o.top10AccountsPct>70)veto.push('Extreme token-account concentration');}else unknown.push('largest account concentration');
  if(o.slippagePct!==null){safetyKnown++;if(o.slippagePct>3)safety-=clamp(o.slippagePct*3,0,40);if(o.slippagePct>10)veto.push('Abnormal observed slippage');}else unknown.push('executable slippage');
  if(o.liquidity!==null&&o.liquidity<10000){safety-=25;veto.push('Liquidity below $10k');}
  const wash = o.volume5m !== null && o.liquidity !== null && o.liquidity>0 && o.volume5m/o.liquidity>10;
  const fewBuyers=o.uniqueBuyers5m!==null&&o.buys5m!==null&&o.buys5m>100&&o.uniqueBuyers5m/o.buys5m<.03;
  if(wash||fewBuyers){safety-=35;veto.push('Wash-like activity anomaly; requires review');}
  // Unknown authorities and ownership cannot receive a high safety score.
  if(o.mintAuthority===null||o.freezeAuthority===null||o.top10AccountsPct===null)safety=Math.min(safety,45);
  else if(o.slippagePct===null)safety=Math.min(safety,75);
  safety=Math.round(clamp(safety));
  const alpha=Math.round(Object.values(components).reduce((a,b)=>a+b,0));
  const composite=veto.length?Math.min(29,Math.round(alpha*safety/100)):Math.round(alpha*.65+safety*.35);
  return {...o,alpha,safety,composite,components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,Math.round(v*100)/100])),coverage:Math.round((8-unknown.length)/8*100),unknown,reasons,veto,alert:veto.length===0&&alpha>=55&&safety>=65};
}
export function normalizeDex(payload, source='dexscreener') {
  if(!Array.isArray(payload))throw Error('DexScreener pairs must be an array');
  return payload.flatMap(p=>{
    try {return [observation({chain:p.chainId,mint:p.baseToken?.address,name:p.baseToken?.name||p.baseToken?.symbol,source,volume5m:number(p.volume?.m5),volume1h:number(p.volume?.h1),buys5m:number(p.txns?.m5?.buys),sells5m:number(p.txns?.m5?.sells),liquidity:number(p.liquidity?.usd),fdv:number(p.fdv),createdAt:number(p.pairCreatedAt)})];} catch {return [];}
  });
}
export function normalizeGecko(payload) {
  if(!payload || !Array.isArray(payload.data))throw Error('GeckoTerminal data must be an array');
  return payload.data.flatMap(p=>{
    const a=p.attributes||{}, id=p.relationships?.base_token?.data?.id||'', at=id.indexOf('_');
    if(at<0)return [];
    try{return [observation({chain:id.slice(0,at)==='eth'?'ethereum':id.slice(0,at),mint:id.slice(at+1),name:a.name,source:'geckoterminal',volume5m:numeric(a.volume_usd?.m5),volume1h:numeric(a.volume_usd?.h1),buys5m:number(a.transactions?.m5?.buys),sells5m:number(a.transactions?.m5?.sells),liquidity:numeric(a.reserve_in_usd),fdv:numeric(a.fdv_usd),createdAt:Number.isFinite(Date.parse(a.pool_created_at))?Date.parse(a.pool_created_at):null})];}catch{return [];}
  });
}
export function mergeObservations(rows) {
  const result=new Map();
  for(const raw of rows){const row=observation(raw), key=`${row.chain}:${row.mint}`;const old=result.get(key);if(!old || (row.liquidity??-1)>(old.liquidity??-1))result.set(key,row);}
  return [...result.values()];
}
export class AlertCache {
  constructor({ttl=300000,max=5000,now=()=>Date.now()}={}) {this.ttl=ttl;this.max=max;this.now=now;this.map=new Map();}
  accept(score){
    const t=this.now(),key=`${score.chain}:${score.mint}`,signature=`${score.alert}:${score.veto.join('|')}:${Math.floor(score.composite/10)}`;
    for(const [k,v]of this.map)if(t-v.time>=this.ttl)this.map.delete(k);
    const prior=this.map.get(key);
    if(prior&&prior.signature===signature)return false;
    this.map.delete(key);this.map.set(key,{signature,time:t});
    while(this.map.size>this.max)this.map.delete(this.map.keys().next().value);
    return true;
  }
}

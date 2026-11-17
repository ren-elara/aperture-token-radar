import { normalizeDex, normalizeGecko, mergeObservations } from './launch.mjs';
export async function requestJson(url,{fetchImpl=fetch,attempts=3,timeout=3500,baseDelay=150,sleep=ms=>new Promise(r=>setTimeout(r,ms)),random=Math.random,body,maxBytes=2000000}={}) {
  let error;
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    let retryAfter=0;
    try{
      const response=await fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
      if(!response.ok){
        const retryable=response.status===429||response.status>=500;
        const header=response.headers.get('retry-after');
        retryAfter=header?Math.max(0,Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-Date.now()):0;
        const e=Error(`HTTP ${response.status}`);e.terminal=!retryable;throw e;
      }
      if(Number(response.headers.get('content-length'))>maxBytes)throw Object.assign(Error('Response too large'),{terminal:true});
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw Object.assign(Error('Response too large'),{terminal:true});}chunks.push(value);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(e){error=e;if(e.terminal||attempt===attempts-1)break;}
    finally{clearTimeout(timer);}
    if(retryAfter>10000)throw Error(`Rate limited; Retry-After ${retryAfter}ms exceeds request budget`);
    await sleep(Math.max(retryAfter,baseDelay*2**attempt*(.75+random()*.5)));
  }
  throw error||Error('No attempts configured');
}
export async function discover({request=requestJson,limit=12,now=()=>Date.now(),deadline=15000}={}) {
  const start=now(),health=[],observations=[];
  const sources=[
    {name:'dexscreener-profiles',url:'https://api.dexscreener.com/token-profiles/latest/v1'},
    {name:'dexscreener-boosts',url:'https://api.dexscreener.com/token-boosts/latest/v1'},
    {name:'geckoterminal-new-pools',url:'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',gecko:true}
  ];
  const candidates=new Map();
  await Promise.all(sources.map(async source=>{
    try{
      const payload=await request(source.url,{attempts:2,timeout:2500});
      if(source.gecko){const rows=normalizeGecko(payload);observations.push(...rows);health.push({source:source.name,status:rows.length?'ok':'empty',count:rows.length});}
      else{
        if(!Array.isArray(payload))throw Error('Discovery payload must be an array');
        let count=0;
        for(const p of payload){if(typeof p.chainId==='string'&&/^[a-z0-9-]{1,40}$/.test(p.chainId)&&typeof p.tokenAddress==='string'&&/^[a-zA-Z0-9]{20,100}$/.test(p.tokenAddress)){candidates.set(`${p.chainId}:${p.tokenAddress}`,p);count++;}}
        health.push({source:source.name,status:count?'ok':'empty',count});
      }
    }catch(e){health.push({source:source.name,status:'failed',reason:e.message});}
  }));
  const list=[...candidates.values()].slice(0,limit);
  // Two workers bound concurrency and preserve the total discovery budget.
  let cursor=0;
  await Promise.all([0,1].map(async()=>{
    while(cursor<list.length&&now()-start<deadline){const p=list[cursor++];
      try{const data=await request(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(p.chainId)}/${encodeURIComponent(p.tokenAddress)}`,{attempts:1,timeout:2000});observations.push(...normalizeDex(data));}
      catch(e){health.push({source:`pairs:${p.chainId}:${p.tokenAddress}`,status:'failed',reason:e.message});}
    }
  }));
  return {rows:mergeObservations(observations).map(o=>({...o,observedAt:now()})),health:health.sort((a,b)=>a.source<b.source?-1:1),elapsed_ms:now()-start};
}
export async function solanaSafety(mint,{request=requestJson,rpc='https://api.mainnet-beta.solana.com'}={}) {
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))throw Error('Invalid Solana mint');
  const call=(method,params)=>request(rpc,{attempts:1,timeout:2500,body:{jsonrpc:'2.0',id:1,method,params}}).then(x=>{if(x.error)throw Error(`RPC ${x.error.code}`);return x.result;});
  const account=await call('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]);
  const v=account?.value;
  if(v?.owner!=='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')throw Error('Unsupported mint owner or Token-2022 extensions; safety unknown');
  const info=v?.data?.parsed?.info;
  if(v.data.parsed.type!=='mint'||!info||!('mintAuthority'in info)||!('freezeAuthority'in info))throw Error('Missing parsed SPL mint authority evidence');
  const result={mintAuthority:info.mintAuthority!==null,freezeAuthority:info.freezeAuthority!==null,top10AccountsPct:null};
  try{
    const largest=await call('getTokenLargestAccounts',[mint,{commitment:'confirmed'}]);
    const supply=BigInt(info.supply),accounts=largest?.value;
    if(supply>0n&&Array.isArray(accounts)){const top=accounts.slice(0,10).reduce((n,a)=>n+BigInt(a.amount),0n);result.top10AccountsPct=Math.min(100,Number(top*10000n/supply)/100);}
  }catch{/* Authority evidence remains useful even if largest accounts is rate limited. */}
  return result;
}

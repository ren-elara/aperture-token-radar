import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { browser } from './scripts/browser.mjs';
const b=await browser();
try {
  const context=await b.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,route=>{remote.push(route.request().url());return route.abort();});
  await page.goto(pathToFileURL(resolve('out/dashboard/index.html')).href);
  await page.waitForSelector('#rows tr');
  await page.evaluate(()=>document.fonts.ready);
  mkdirSync('screenshots',{recursive:true});
  const shots=[];
  async function shot(name){await page.screenshot({path:`screenshots/${name}`,type:'jpeg',quality:85,fullPage:false});shots.push(name);}
  await shot('1-board.jpg');
  await page.locator('button[data-open="curvance"]').count().then(async n=>{
    if(n)await page.locator('button[data-open="curvance"]').first().click();
    else await page.evaluate(()=>{location.hash='protocol/curvance';});
  });
  await page.waitForSelector('#detail-view:not([hidden])');
   await shot('2-detail.jpg');
   await page.locator('.peer-evidence').scrollIntoViewIfNeeded();
   await shot('4-evidence.jpg');
   await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('[data-back]').click();
  await page.locator('#early').click();
  await page.selectOption('#category','Lending');
  await page.selectOption('#chain','Base');
  await page.waitForFunction(()=>Aperture.state.category==='Lending'&&Aperture.state.chain==='Base');
  await shot('3-filtered.jpg');
  if(errors.length||remote.length)throw Error(JSON.stringify({errors,remote}));
  writeFileSync('artifacts/capture.json',JSON.stringify({viewport:{width:1440,height:1000},shots,errors,remote},null,2)+'\n');
   console.log('Captured genuine offline board, Curvance dossier, peer evidence, and Base lending filter screenshots');
}finally{await b.close();}

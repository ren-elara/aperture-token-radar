import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export async function browser() {
  mkdirSync('.verify/browser-tmp',{recursive:true});
  process.env.TMPDIR=resolve('.verify/browser-tmp');
  const explicit=process.env.APERTURE_BROWSER;
  const local=resolve('.browser-root/usr/lib/chromium/chrome');
  const path=explicit || (existsSync(local)?resolve('scripts/chromium-local.sh'):undefined);
  if(!path)throw Error('Set APERTURE_BROWSER to an installed Chromium executable');
  return chromium.launch({executablePath:path,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--disable-background-networking','--disable-component-update','--disable-crash-reporter','--disable-breakpad','--no-first-run','--no-default-browser-check'],env:{...process.env,TMPDIR:resolve('.verify/browser-tmp'),XDG_CONFIG_HOME:resolve('.verify/config'),XDG_CACHE_HOME:resolve('.verify/cache'),...(!explicit?{FONTCONFIG_FILE:resolve('scripts/fonts.conf')}:{})},timeout:30000});
}

import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,[...(!process.features.typescript?['--import','tsx']:[]),'main.ts','--input','token-radar-01-kit/input/snapshot.json','--output','out',...process.argv.slice(2)],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;

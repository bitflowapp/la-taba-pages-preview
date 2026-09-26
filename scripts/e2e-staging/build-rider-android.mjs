// Build configuration only: loads the public Staging key; never passes administrative keys to Gradle.
import {spawnSync} from 'node:child_process';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
import path from 'node:path';
const key=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
if(key?.usuario!=='ucbtjcurawxjwjdvvcvj'||!key.secreto.startsWith('sb_publishable_'))throw Error('STAGING_PUBLIC_KEY_UNAVAILABLE');
const tasks=process.argv.slice(2);
if(tasks.some(t=>!/^[:\w-]+$/.test(t)))throw Error('INVALID_TASK');
const result=spawnSync('cmd.exe',['/d','/c','.\\gradlew.bat',...(tasks.length?tasks:[':app:testDebugUnitTest',':app:assembleDebug',':app:assembleDebugAndroidTest']),'--console=plain'],{
 cwd:path.resolve('apps/rider-android'),stdio:'inherit',windowsHide:true,
 env:{...process.env,ANDROID_HOME:path.join(process.env.LOCALAPPDATA,'Android/Sdk'),RIDER_STAGING_PUBLIC_KEY:key.secreto},
});
process.exit(result.status??1);

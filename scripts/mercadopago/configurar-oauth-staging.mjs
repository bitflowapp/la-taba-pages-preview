import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { conToken } from '../lib/supabase-cli-token.mjs';

// MCP callers pipe JSON directly through stdin; the secure PowerShell prompt uses env.
// Never put credential values in command arguments, logs, or repository files.
const ref='ukxqbgswjlibmnjemrzd';
let input={};
const stdinMode=process.argv.includes('--stdin');
if(stdinMode) {
  try { input=JSON.parse(readFileSync(0,'utf8')); }
  catch { throw Error('Entrada de configuración inválida. No se modificó staging.'); }
}
const clientId=stdinMode ? input?.clientId : process.env.TABA_SETUP_CLIENT_ID;
const clientSecret=stdinMode ? input?.clientSecret : process.env.TABA_SETUP_CLIENT_SECRET;
const webhookSecret=stdinMode ? input?.webhookSecret : process.env.TABA_SETUP_WEBHOOK_SECRET;
const completeSecret=value=>typeof value==='string' && /^[A-Za-z0-9_+/=-]{16,}$/.test(value) && !/^(?:undefined|null|not_available)/i.test(value);
if(typeof clientId!=='string' || !/^\d+$/.test(clientId) || !completeSecret(clientSecret) || !completeSecret(webhookSecret)) {
  throw Error('Faltan credenciales completas de la aplicación. No se modificó staging.');
}
await conToken(async token=>{
  const headers={Authorization:`Bearer ${token}`,'content-type':'application/json'};
  const endpoint=`https://api.supabase.com/v1/projects/${ref}/secrets`;
  const existingResponse=await fetch(endpoint,{headers});
  if(!existingResponse.ok) throw Error('No pudimos verificar staging.');
  const existing=await existingResponse.json();
  const values={
    MERCADOPAGO_CLIENT_ID:clientId,MERCADOPAGO_CLIENT_SECRET:clientSecret,
    MERCADOPAGO_OAUTH_WEBHOOK_SECRET:webhookSecret,MERCADOPAGO_CREDENTIAL_MODE:'oauth',
    MERCADOPAGO_ENVIRONMENT:'test',TABA_DEPLOYMENT_ENV:'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF:ref,MERCADOPAGO_OAUTH_PANEL_URL:'https://taba2-staging.pages.dev/',
    TABA_CHECKOUT_BASE_URL:'https://taba2-staging.pages.dev',TABA_ALLOWED_ORIGINS:'https://taba2-staging.pages.dev',
  };
  if(!existing.some(entry=>entry.name==='MERCADOPAGO_TOKEN_ENCRYPTION_KEY')) values.MERCADOPAGO_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64url');
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(Object.entries(values).map(([name,value])=>({name,value})))});
  if(!response.ok) throw Error(`La configuración de staging falló (HTTP ${response.status}).`);
  console.log('Configuración OAuth guardada únicamente en staging. Falta verificar el inicio de autorización en TABA.');
});

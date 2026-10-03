import fs from 'node:fs';
export async function call(name, args={}) {
  const token=JSON.parse(fs.readFileSync('C:/Users/marco/.mcp-auth/mcp-remote-v1/4ac597162bbcd60c127d66a895f6d39f_tokens.json','utf8'));
  const response=await fetch('https://mcp.mercadopago.com/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',Authorization:'Bearer '+token.access_token,'X-Plugin-Version':'4.3.2','X-Invocation-Context':'router'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});
  const raw=await response.text();
  const parsed=raw.startsWith('event:')?JSON.parse(raw.split('\n').find(l=>l.startsWith('data:')).slice(5)):JSON.parse(raw);
  if(!response.ok || parsed.error) throw Error('MCP request failed: '+response.status+' '+JSON.stringify(parsed.error || {code:parsed.code,message:parsed.message}));
  return parsed.result;
}
export function decode(result) {
  return result.content?.filter(c=>c.type==='text').map(c=>{try{return JSON.parse(c.text);}catch{return c.text;}}) || result;
}

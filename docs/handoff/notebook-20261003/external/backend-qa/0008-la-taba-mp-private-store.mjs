import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='C:/Users/marco/.mcp-auth/mcp-remote-v1/';
function transform(value,read=false) {
 const command=read
 ? "Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $taskPlain=[System.Security.Cryptography.ProtectedData]::Unprotect($taskBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($taskPlain));"
 : "Add-Type -AssemblyName System.Security; $taskBytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $taskSealed=[System.Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskSealed));";
 return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:value,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true}).trim();
}
export const exists=name=>fs.existsSync(root+name+'.dpapi');
export const save=(name,value)=>fs.writeFileSync(root+name+'.dpapi',transform(JSON.stringify(value)));
export const read=name=>JSON.parse(transform(fs.readFileSync(root+name+'.dpapi','utf8'),true));

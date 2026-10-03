import os, json, subprocess, pathlib, re, concurrent.futures
OUT=pathlib.Path(r'C:\Users\marco\Documents\New project\outputs\taba-handoff-20261003')
OUT.mkdir(parents=True,exist_ok=True)
SKIP={'.git','node_modules','windows','windows.old','program files','program files (x86)','programdata','$recycle.bin','$recycle.bin'.lower(),'system volume information','recovery','appdata','pub-cache','pubcache','pubcache_ok','.pub-cache','.pubcache','.gradle','.cargo','.rustup','.venv','venvs','flutter','flutter_sdk','scoop','hf_cache','.ollama','android','sdk','.android','fvm','gradle-cache','gradle-home','python313','ue_5.8','riot games','nvidia corporation','sessions','archived_sessions'}
SKIP.update({'target','build','.dart_tool','.next','.cache','hosted','caches','cache','registry','toolchains','platforms','system-images','emulator','ndk','devtools','devcache','site-packages'})
SKIP.update({'$getcurrent','$windows.~ws','$windows.~bt','$winreagent','archivos de programa','documents and settings','msocache','wuDownloadCache'.lower(),'winsxs','internet explorer','microsoft visual studio','vs','wpSystem'.lower(),'windowsapps','nueva carpeta (2)'})
SKIP.update({'taba-cert-tauri-target','taba-tauri-target','taba-rc1-cargo-home','taba-rc1-cargo-target','taba-cargo-cache-from-c-20260802','taba-rider-gradle-home','taba-rider-pub-cache'})
SKIP.update({'intermediates','.transforms','bitflow-build','bitflowbuild','generated','incremental','__pycache__','.npm'})
def git(p,*args):
 r=subprocess.run(['git','-C',str(p),*args],capture_output=True,text=True,encoding='utf-8',errors='replace')
 return r.stdout.strip() if r.returncode==0 else 'ERROR: '+r.stderr.strip()
def scan(root):
 repos=[]; files=[]; errors=[]
 for base,ds,fs in os.walk(root,followlinks=False,onerror=lambda e:errors.append(str(e))):
  if '.git' in ds or '.git' in fs:
   repos.append(base)
   with (OUT/'repos-discovered.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps(base)+'\n')
  def allowed(d):
   if d.lower() in SKIP or re.search(r'(cargo-(cache|home|target)|gradle-home|pub-cache|node-compile-cache|playwright-transform-cache)',d,re.I):return False
   try:return not (os.stat(os.path.join(base,d),follow_symlinks=False).st_file_attributes & 1024)
   except OSError:return False
  ds[:]=[d for d in ds if allowed(d)]
  for f in fs:
   if 'taba' in (base+'\\'+f).lower() and '.git' not in base.lower().split('\\'):
    try: files.append({'path':os.path.join(base,f),'size':os.stat(os.path.join(base,f)).st_size})
    except OSError:pass
 (OUT/('scan-'+root[0]+'.json')).write_text(json.dumps({'repos':repos,'files':files,'errors':errors}),encoding='utf-8')
 print('Scanned '+root+' repos='+str(len(repos))+' artifacts='+str(len(files)),flush=True)
 return repos,files,errors
def inspect(p):
 remote=git(p,'remote','-v')
 branches=git(p,'branch','-vv')
 related='taba' in (p+remote+branches).lower()
 return {'path':p,'remote':remote,'branches':branches,'related':related}
if __name__=='__main__':
 scans=[]
 for root in ['C:\\','D:\\','E:\\']:
  saved=OUT/('scan-'+root[0]+'.json')
  if saved.exists():
   s=json.loads(saved.read_text());scans.append((s['repos'],s['files'],s['errors']))
  else:scans.append(scan(root))
 repos=sorted(set(p for s in scans for p in s[0])); files=[p for s in scans for p in s[1]]
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex: inspected=list(ex.map(inspect,repos))
 data={'repos':inspected,'files':files,'scan_errors':[e for s in scans for e in s[2]],'excluded_directories':sorted(SKIP)}
 (OUT/'discovery.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
 print(json.dumps({'repos_found':len(repos),'related':[r for r in inspected if r['related']],'artifacts_found':len(files),'scan_errors':len(data['scan_errors'])},indent=2))

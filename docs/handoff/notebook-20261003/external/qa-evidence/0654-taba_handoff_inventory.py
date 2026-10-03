import json,pathlib,concurrent.futures,subprocess
from taba_handoff_audit import OUT,git
PRIMARY=r'C:\Users\marco\dev\la-taba-pages-preview'
def inventory(p):
 row={k:git(p,*a) for k,a in {'path':['rev-parse','--show-toplevel'],'common':['rev-parse','--path-format=absolute','--git-common-dir'],'branch':['branch','--show-current'],'head':['rev-parse','HEAD'],'status':['status','--porcelain=v1','-uall'],'ignored':['ls-files','--others','--ignored','--exclude-standard','--directory','--no-empty-directory'],'remote':['remote','-v'],'branches':['for-each-ref','--format=%(refname:short)|%(objectname)|%(upstream:short)|%(upstream:track)','refs/heads'],'unpushed':['log','--oneline','--branches','--not','--remotes=origin'],'stash':['stash','list','--format=%gd|%H|%gs'],'worktrees':['worktree','list','--porcelain'],'remote_contains':['branch','-r','--contains','HEAD'],'main_relation':['rev-list','--left-right','--count','HEAD...origin/main']}.items()}
 with (OUT/'inventory-progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps(row)+'\n')
 return row
if __name__=='__main__':
 paths=[line[9:] for line in git(PRIMARY,'worktree','list','--porcelain').splitlines() if line.startswith('worktree ')]
 if (OUT/'discovery.json').exists():
  paths+= [r['path'] for r in json.loads((OUT/'discovery.json').read_text())['repos'] if r['related']]
 paths=sorted(set(str(pathlib.Path(p)) for p in paths if pathlib.Path(p).exists()))
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex: rows=list(ex.map(inventory,paths))
 (OUT/'inventory-initial.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
 print(json.dumps({'count':len(rows),'dirty':[{'path':r['path'],'branch':r['branch'],'head':r['head'],'status':r['status']} for r in rows if r['status']],'commons':sorted(set(r['common'] for r in rows)),'hardening':[{'path':r['path'],'branch':r['branch'],'head':r['head']} for r in rows if r['branch'].startswith('hardening/')]},indent=2))

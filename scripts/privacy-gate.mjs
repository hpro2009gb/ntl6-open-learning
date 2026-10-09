import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const paths=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const allowed=p=>/^(core|contracts|application|persistence|ui|tools|skills|scripts)\//.test(p)||/^data\/fixtures\/0[1-6]-[a-z0-9-]+\.json$/.test(p)||/^examples\/manual-pack\/(manifest\.json|evidence\.jsonl|raw-chat\.md|summary\.md)$/.test(p)||/^(README\.md|LICENSE|SECURITY\.md|PRIVACY\.md|\.gitignore|package\.json)$/.test(p);
const forbidden=/(^|\/)(runtime-data|learner-data|student-data|school-data|private-data|\.aki|\.ai-memory|docs|content|uploads|backups|exports|AGENTS\.md)(\/|$)/i;
const patterns=[
 /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /(?:ghp_|github_pat_|xoxb-)[A-Za-z0-9_-]{16,}/,
 /AKIA[A-Z0-9]{16}/,
 /(?:sk-)[A-Za-z0-9_-]{25,}/,
 /[A-Z]:\\Users\\[^ \r\n]+/i,
 /[A-Z]:\\OneDrive/i,
 /\b5A6\b/i,
 /Nam[\s_-]?T(?:u|ừ|ù)[\s_-]?Li(?:e|ê)m/i,
 /\b(?:zjn|bell|zin)\b/i
];
const publicDocs=new Set(['README.vi.md','docs/FEATURES.md','docs/USER_GUIDE.md','docs/HUONG_DAN_SU_DUNG.vi.md']);
const issues=[];
let scanned=0;
for(const p of paths){
 if((!allowed(p)&&!publicDocs.has(p))||(forbidden.test('/'+p)&&!publicDocs.has(p))){issues.push('not-public-allowlisted:'+p);continue;}
 if(p==='scripts/privacy-gate.mjs')continue;
 const content=fs.readFileSync(path.join(root,p),'utf8');
 scanned++;
 for(let i=0;i<patterns.length;i++)if(patterns[i].test(content)){issues.push('sensitive-pattern:'+p+':pattern-'+i);break;}
}
console.log(JSON.stringify({status:issues.length?'FAIL':'PASS',tracked_count:paths.length,scanned,issues}));
if(issues.length)process.exitCode=1;

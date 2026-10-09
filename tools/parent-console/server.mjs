import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createParentConsoleFacade } from '../../application/parent-console/facade.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');
const HOST='127.0.0.1';
const MAX_BODY=256*1024;

function json(res,status,value) {
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}
function errorPayload(error) {
  const message=String(error?.message??error);
  const code=message.split(':')[0];
  const map={
    ASSESSMENT_NOT_FOUND:'Không tìm thấy bài kiểm tra.',
    QUESTION_CANDIDATE_NOT_FOUND:'Không tìm thấy câu hỏi trong kho chờ duyệt.',
    RESULTS_REQUIRED:'Chưa có kết quả để ghi nhận.',
    LEARNER_ID_MISMATCH:'Mã học sinh không khớp với hồ sơ đang mở.',
    BODY_TOO_LARGE:'Dữ liệu gửi lên quá lớn.',
    INVALID_JSON:'Dữ liệu gửi lên không phải JSON hợp lệ.'
  };
  return {error_code:code,message_vi:map[code]??`Không thể thực hiện: ${message}`};
}
function rejectUnknown(body,allowed) {
  const unknown=Object.keys(body??{}).filter((key)=>!allowed.includes(key));
  if (unknown.length) throw new Error(`UNKNOWN_FIELDS:${unknown.join(',')}`);
  return body;
}
async function readBody(req) {
  let size=0; const chunks=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>MAX_BODY) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}
function staticFile(root,urlPath) {
  const names={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/labels.vi.js':'labels.vi.js'};
  const name=names[urlPath];
  if (!name) return null;
  const file=path.join(root,'ui','parent-console',name);
  return fs.existsSync(file)?file:null;
}
function serveStatic(res,file) {
  const ext=path.extname(file);
  const type=ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
  const body=fs.readFileSync(file);
  res.writeHead(200,{'content-type':type,'content-length':body.length,'cache-control':'no-store'});
  res.end(body);
}
function materialResolutionStatus(kind) {
  if (kind==='EXACT') return 200;
  if (kind==='AMBIGUOUS'||kind==='BLOCKED') return 409;
  if (kind==='NOT_FOUND'||kind==='MATERIAL_MISSING') return 404;
  return 500;
}
function materialQuery(url) {
  return {
    date:url.searchParams.get('date')||null,
    date_from:url.searchParams.get('date_from')||null,
    date_to:url.searchParams.get('date_to')||null,
    subject:url.searchParams.get('subject')||null,
    kind:url.searchParams.get('kind')||null,
    workflow_status:url.searchParams.get('workflow_status')||null,
    audience:url.searchParams.get('audience')||null,
    purpose:url.searchParams.get('purpose')||null,
    q:url.searchParams.get('q')||null,
    concept_id:url.searchParams.get('concept_id')||null,
    provenance_category:url.searchParams.get('provenance')||url.searchParams.get('provenance_category')||null,
    assessment_id:url.searchParams.get('assessment_id')||null,
    status:url.searchParams.get('status')||null
  };
}
function serveResolvedArtifact(res,root,resolution,{download=false}={}) {
  if (resolution?.kind!=='EXACT'||!resolution?.artifact) {
    return json(res,materialResolutionStatus(resolution?.kind),resolution??{kind:'NOT_FOUND',reason:'ARTIFACT_NOT_RESOLVED'});
  }
  const id=String(resolution.material?.assessment_id??'');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('INVALID_ASSESSMENT_ID');
  const artifact=resolution.artifact;
  const expectedRoot=path.resolve(root,'runtime-data','parent-console','assessments',id,'artifacts');
  const file=path.resolve(root,...String(artifact.ref??'').split('/'));
  const relative=path.relative(expectedRoot,file);
  if (!relative||relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('ARTIFACT_PATH_OUTSIDE_CANONICAL_ROOT');
  if (!artifact.exists||!fs.existsSync(file)) return json(res,404,{kind:'MATERIAL_MISSING',assessment_id:id,expected_ref:artifact.ref});
  const body=fs.readFileSync(file);
  const ext=path.extname(file).toLowerCase();
  const type=ext==='.pdf'?'application/pdf':ext==='.json'?'application/json; charset=utf-8':'application/octet-stream';
  const disposition=`${download?'attachment':'inline'}; filename="${path.basename(file).replaceAll('"','')}"`;
  res.writeHead(200,{
    'content-type':type,
    'content-length':body.length,
    'content-disposition':disposition,
    'cache-control':'no-store'
  });
  res.end(body);
}

export function createParentConsoleHttpServer(options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const facade=options.facade??createParentConsoleFacade({root,learnerId:options.learnerId??'default-learner'});
  return http.createServer(async (req,res)=>{
    try {
      const url=new URL(req.url,`http://${HOST}`);
      if (req.method==='GET' && !url.pathname.startsWith('/api/')) {
        const file=staticFile(root,url.pathname);
        if (file) return serveStatic(res,file);
        if (url.pathname==='/') return json(res,200,{status:'UI_PENDING',message_vi:'Giao diện Parent Console sẽ được cài ở bước tiếp theo.'});
      }
      if (req.method==='GET'&&url.pathname==='/api/dashboard') return json(res,200,facade.getDashboard());
      if (req.method==='GET'&&url.pathname==='/api/planning-context') return json(res,200,facade.getPlanningContext({asOf:url.searchParams.get('as_of')||new Date().toISOString()}));
      if (req.method==='GET'&&url.pathname==='/api/learning-context') return json(res,200,facade.getCurrentLearningContext({asOf:url.searchParams.get('as_of')||new Date().toISOString()}));
      if (req.method==='POST'&&url.pathname==='/api/source-fusion') return json(res,200,facade.getSourceFusion(rejectUnknown(await readBody(req),['as_of','subject','concept_id','purpose','strategy_ref','source_refs','learner_evidence_refs','item_family_refs','generation_constraints','lane_applicability','current_learning_context'])));
      if (req.method==='GET'&&url.pathname==='/api/progress') return json(res,200,facade.getProgress({subject:url.searchParams.get('subject')||null}));
      if (req.method==='GET'&&url.pathname==='/api/question-bank') return json(res,200,facade.getQuestionBank());
      if (req.method==='GET'&&url.pathname==='/api/baseline') return json(res,200,facade.getBaseline()??{status:'NOT_ACCEPTED'});
      if (req.method==='GET'&&url.pathname==='/api/materials') return json(res,200,facade.getMaterials(materialQuery(url)));
      if (req.method==='GET'&&url.pathname==='/api/materials/current') {
        const resolution=facade.getCurrentMaterial({subject:url.searchParams.get('subject')||null,as_of:url.searchParams.get('as_of')||null});
        return json(res,materialResolutionStatus(resolution.kind),resolution);
      }
      const materialFile=url.pathname.match(/^\/api\/materials\/([A-Za-z0-9._-]+)\/file$/);
      if (req.method==='GET'&&materialFile) {
        const resolution=facade.getMaterialResolution(materialFile[1],{artifact_ref:url.searchParams.get('artifact_ref')||null});
        return serveResolvedArtifact(res,root,resolution,{download:url.searchParams.get('download')==='1'});
      }
      const materialDetail=url.pathname.match(/^\/api\/materials\/([A-Za-z0-9._-]+)$/);
      if (req.method==='GET'&&materialDetail) {
        const resolution=facade.getMaterialResolution(materialDetail[1],{artifact_ref:url.searchParams.get('artifact_ref')||null});
        return json(res,materialResolutionStatus(resolution.kind),resolution);
      }
      if (req.method==='GET'&&url.pathname==='/api/assessment-history') return json(res,200,facade.getAssessmentHistory({
        date:url.searchParams.get('date')||null,
        subject:url.searchParams.get('subject')||null,
        kind:url.searchParams.get('kind')||null,
        audience:url.searchParams.get('audience')||null,
        purpose:url.searchParams.get('purpose')||url.searchParams.get('type')||null,
        session_mode:url.searchParams.get('session_mode')||null,
        feedback_policy:url.searchParams.get('feedback_policy')||null,
        q:url.searchParams.get('q')||url.searchParams.get('content')||null,
        status:url.searchParams.get('status')||null,
        assessment_id:url.searchParams.get('assessment_id')||null
      }));
      const historyDetail=url.pathname.match(/^\/api\/assessment-history\/([A-Za-z0-9._-]+)$/);
      if (req.method==='GET'&&historyDetail) return json(res,200,facade.getAssessmentHistoryDetail(historyDetail[1]));
      if (req.method==='GET'&&url.pathname==='/api/lessons/current-approved') {
        const resolution=facade.getApprovedLesson({
          assessment_id:url.searchParams.get('assessment_id')||null,
          artifact_ref:url.searchParams.get('artifact_ref')||null,
          subject:url.searchParams.get('subject')||null,
          concept_id:url.searchParams.get('concept_id')||null,
          as_of:url.searchParams.get('as_of')||new Date().toISOString()
        });
        return json(res,materialResolutionStatus(resolution.kind),resolution);
      }
      const lessonApprove=url.pathname.match(/^\/api\/lessons\/([A-Za-z0-9._-]+)\/approve$/);
      if (req.method==='POST'&&lessonApprove) return json(res,200,facade.approveLesson(lessonApprove[1],rejectUnknown(await readBody(req),['approved_at','artifact_ref','source_ref'])));
      const lessonComplete=url.pathname.match(/^\/api\/lessons\/([A-Za-z0-9._-]+)\/complete$/);
      if (req.method==='POST'&&lessonComplete) return json(res,200,facade.completeLesson(lessonComplete[1],rejectUnknown(await readBody(req),['session_id','started_at','completed_at','completion_checks','end_reason','understanding_checks','scaffolding_help','unresolved_confusion','suggested_next_action','source_provenance','continuation_of_session_id'])));

      const baselineCreate=url.pathname.match(/^\/api\/baseline\/(MATH|VIETNAMESE|ENGLISH)$/);
      if (req.method==='POST'&&baselineCreate) return json(res,201,facade.createBaseline(baselineCreate[1],rejectUnknown(await readBody(req),['requested_at'])));
      const baselineAccept=url.pathname.match(/^\/api\/baseline\/([A-Za-z0-9._-]+)\/accept$/);
      if (req.method==='POST'&&baselineAccept) return json(res,200,facade.acceptBaseline(baselineAccept[1],rejectUnknown(await readBody(req),['accepted_at'])));

      const assessmentMatch=url.pathname.match(/^\/api\/assessments\/([A-Za-z0-9._-]+)$/);
      if (req.method==='GET'&&assessmentMatch) return json(res,200,facade.getAssessment(assessmentMatch[1]));
      if (req.method==='POST'&&url.pathname==='/api/assessments') {
        const body=rejectUnknown(await readBody(req),['contract_version','request_id','learner_id','subject','target_concepts','purpose','max_items','time_budget_minutes','difficulty_band','requested_at','parent_constraints','session_mode','feedback_policy','expected_evidence_ceiling']);
        return json(res,201,facade.createAssessment(body));
      }
      const readyMatch=url.pathname.match(/^\/api\/assessments\/([A-Za-z0-9._-]+)\/ready$/);
      if (req.method==='POST'&&readyMatch) return json(res,200,facade.markAssessmentReady(readyMatch[1],rejectUnknown(await readBody(req),['occurred_at'])));
      const answersMatch=url.pathname.match(/^\/api\/assessments\/([A-Za-z0-9._-]+)\/answers$/);
      if (req.method==='POST'&&answersMatch) return json(res,200,facade.submitAssessmentAnswers(answersMatch[1],rejectUnknown(await readBody(req),['answers','submitted_at'])));
      const resultsMatch=url.pathname.match(/^\/api\/assessments\/([A-Za-z0-9._-]+)\/results$/);
      if (req.method==='POST'&&resultsMatch) return json(res,200,facade.recordAssessmentResults(resultsMatch[1],rejectUnknown(await readBody(req),['results','imported_at','observed_at','policy_version','source_kind'])));
      if (req.method==='POST'&&url.pathname==='/api/corrections') return json(res,200,facade.recordCorrection(rejectUnknown(await readBody(req),['action','correctionId','targetRecordId','reason','createdAt','replacementRecordId','affectedSnapshotIds','affectedDecisionIds','rebuildRequired'])));

      const promote=url.pathname.match(/^\/api\/questions\/([A-Za-z0-9._-]+)\/promote$/);
      if (req.method==='POST'&&promote) return json(res,200,facade.promoteQuestion(promote[1],rejectUnknown(await readBody(req),['occurred_at','reason','validation_refs'])));
      const retire=url.pathname.match(/^\/api\/questions\/([A-Za-z0-9._-]+)\/retire$/);
      if (req.method==='POST'&&retire) return json(res,200,facade.retireQuestion(retire[1],rejectUnknown(await readBody(req),['occurred_at','reason','validation_refs'])));
      if (req.method==='POST'&&url.pathname==='/api/target/revalidate') return json(res,200,facade.revalidateTarget(rejectUnknown(await readBody(req),['as_of','version'])));

      return json(res,404,{error_code:'NOT_FOUND',message_vi:'Không tìm thấy chức năng yêu cầu.'});
    } catch (error) {
      const payload=errorPayload(error);
      const status=payload.error_code==='BODY_TOO_LARGE'?413:400;
      return json(res,status,payload);
    }
  });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid)||pid<=0) return false;
  try { process.kill(pid,0); return true; }
  catch (error) { return error?.code==='EPERM'; }
}
function acquireServerLock(lockPath) {
  for (let attempt=0; attempt<2; attempt+=1) {
    try {
      const fd=fs.openSync(lockPath,'wx');
      fs.writeFileSync(fd,String(process.pid));
      return fd;
    } catch (error) {
      if (error?.code!=='EEXIST') throw error;
      let existingPid=null;
      try { existingPid=Number(fs.readFileSync(lockPath,'utf8').trim()); } catch {}
      if (processIsAlive(existingPid)) throw new Error('PARENT_CONSOLE_ALREADY_RUNNING');
      try { fs.unlinkSync(lockPath); }
      catch (unlinkError) { if (unlinkError?.code!=='ENOENT') throw unlinkError; }
    }
  }
  throw new Error('PARENT_CONSOLE_ALREADY_RUNNING');
}

export async function startParentConsoleServer(options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const port=Number(options.port??17661);
  if (!Number.isInteger(port)||port<0||port>65535) throw new Error('INVALID_PORT');
  const runtime=path.join(root,'runtime-data','parent-console');
  fs.mkdirSync(runtime,{recursive:true});
  const lockPath=path.join(runtime,'server.lock');
  const fd=acquireServerLock(lockPath);
  const server=createParentConsoleHttpServer(options);
  let released=false;
  const release=()=>{ if (released) return; released=true; try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(lockPath); } catch {} };
  server.on('close',release);
  process.once('exit',release);
  try {
    await new Promise((resolve,reject)=>{
      const onError=(error)=>{server.off('listening',onListen); reject(error);};
      const onListen=()=>{server.off('error',onError); resolve();};
      server.once('error',onError); server.once('listening',onListen); server.listen(port,HOST);
    });
  } catch (error) { release(); throw error; }
  return {server,host:HOST,port:server.address().port,close:()=>new Promise((resolve)=>server.close(resolve))};
}

function cliPort(argv) {
  const i=argv.indexOf('--port');
  return i>=0?Number(argv[i+1]):17661;
}
function openBrowser(url) {
  const child=spawn('cmd.exe',['/d','/c','start','',url],{detached:true,stdio:'ignore',windowsHide:true});
  child.unref();
}
async function main() {
  const args=process.argv.slice(2);
  const port=cliPort(args);
  const url=`http://${HOST}:${port}/`;
  try {
    const started=await startParentConsoleServer({port});
    const startedUrl=`http://${started.host}:${started.port}/`;
    console.log(`NTL6 Parent Console đang chạy tại ${startedUrl}`);
    if(args.includes('--open')) openBrowser(startedUrl);
    console.log('Nhấn Ctrl+C để dừng.');
  } catch (error) {
    const code=String(error?.code??'');
    const message=String(error?.message??'');
    if (message==='PARENT_CONSOLE_ALREADY_RUNNING'&&args.includes('--open')) {
      console.log(`NTL6 Parent Console đã chạy tại ${url}. Đang mở lại trình duyệt.`);
      openBrowser(url);
      return;
    }
    if (code==='EADDRINUSE') {
      console.error(`Không thể khởi động: cổng ${port} đang được chương trình khác sử dụng.`);
    } else if (message==='PARENT_CONSOLE_ALREADY_RUNNING') {
      console.error('NTL6 Parent Console đã chạy. Hãy dùng cửa sổ trình duyệt hiện có.');
    } else console.error(`Không thể khởi động Parent Console: ${error?.message??error}`);
    process.exitCode=1;
  }
}
if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
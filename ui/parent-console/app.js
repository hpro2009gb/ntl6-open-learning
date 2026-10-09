import {
  SUBJECT_LABELS,
  HELP_OPTIONS,
  RESULT_OPTIONS,
  DEMONSTRATION_LABELS,
  CONCERN_LABELS,
  ACTION_LABELS,
  LIFECYCLE_LABELS,
  CONCEPT_LABELS
} from './labels.vi.js';

const state={dashboard:null,currentAssessment:null,currentAssessmentId:null};

const MATERIAL_KIND_LABELS=Object.freeze({
  LESSON:'Bài giảng',
  PRACTICE:'Bài luyện',
  TEST:'Bài kiểm tra',
  SUBMISSION:'Bài đã làm',
  GRADING:'Kết quả chấm',
  SYSTEM:'Tệp hệ thống'
});
const WORKFLOW_LABELS=Object.freeze({
  NEEDS_TEACHING:'Cần dạy',
  READY_FOR_LEARNER:'Con cần làm',
  WAITING_FOR_GRADING:'Chờ chấm',
  COMPLETED:'Đã hoàn thành',
  BLOCKED_OR_WAITING:'Đang chờ',
  MATERIAL_MISSING:'Thiếu file',
  AMBIGUOUS:'Cần xác minh',
  UNKNOWN:'Chưa rõ'
});
const SOURCE_CLASS_LABELS=Object.freeze({
  CTGDPT:'CTGDPT',
  SGK:'SGK / học liệu nhà trường',
  OFFICIAL_SCHOOL:'Nguồn trường chính thức',
  HISTORICAL_REPORTED:'Đề lịch sử / báo cáo',
  HISTORICAL_RECONSTRUCTED:'Đề lịch sử phục dựng',
  PRACTICE_MOCK:'Đề tham khảo / mô phỏng',
  SUPPLEMENTARY_REFERENCE:'Nguồn tham khảo',
  COMMERCIAL_UNVERIFIED:'Nguồn thương mại chưa xác minh',
  ORIGINAL_GENERATED:'Bài mới do NTL6 sinh',
  AI_GENERATED:'Bài do AI sinh',
  LEARNER_ORIGIN:'Bài của con',
  IMPORTED:'Tệp nhập vào',
  UNKNOWN:'Chưa rõ'
});
const AUDIENCE_LABELS=Object.freeze({
  LEARNER:'Con / học sinh',
  AI_TEACHER:'AI dạy',
  PARENT_GRADER:'Phụ huynh / người chấm',
  SYSTEM:'Hệ thống'
});
const BASELINE_CONCEPT_LABELS=Object.freeze({
  'MATH4.NUMBER.PLACE_VALUE':'Giá trị chữ số trong số tự nhiên',
  'MATH4.NUMBER.COMPARE':'So sánh số tự nhiên',
  'MATH4.NUMBER.ROUND':'Làm tròn số',
  'MATH4.ARITH.ADD':'Phép cộng',
  'MATH4.ARITH.SUBTRACT':'Phép trừ',
  'MATH4.ARITH.MULTIPLY':'Phép nhân',
  'MATH4.ARITH.DIVIDE':'Phép chia',
  'MATH4.EXPRESSION.ORDER':'Thứ tự thực hiện phép tính',
  'MATH4.WORD.SUM_DIFFERENCE':'Bài toán tổng – hiệu',
  'MATH4.MEASURE.MASS':'Đổi đơn vị khối lượng',
  'MATH4.GEOMETRY.QUADRILATERAL':'Nhận biết hình tứ giác',
  'MATH4.DATA.FREQUENCY':'Đọc và đếm số liệu',
  'MATH4.FRACTION.EQUIVALENT':'Phân số bằng nhau',
  'MATH4.FRACTION.COMPARE':'So sánh phân số',
  'MATH4.FRACTION.ADD':'Cộng phân số',
  'MATH4.FRACTION.OF_NUMBER':'Tìm phân số của một số',
  'VI4.READING.EXPLICIT':'Đọc hiểu thông tin trực tiếp',
  'VI4.READING.INFERENCE':'Đọc hiểu suy luận',
  'VI4.READING.EVIDENCE':'Tìm bằng chứng trong bài đọc',
  'VI4.VOCAB.CONTEXT':'Hiểu từ trong ngữ cảnh',
  'VI4.LANGUAGE.WORD_CLASS':'Danh từ - động từ - tính từ',
  'VI4.SENTENCE.SUBJECT_PREDICATE':'Chủ ngữ và vị ngữ',
  'VI4.LANGUAGE.PROPER_NOUN':'Danh từ riêng',
  'VI4.WRITING.OPINION_PARAGRAPH':'Viết đoạn văn nêu ý kiến',
  'EN4.VOCAB.COUNTRY_NATIONALITY':'Quốc gia và quốc tịch',
  'EN4.GRAMMAR.TIME_PREPOSITION':'Giới từ chỉ thời gian',
  'EN4.GRAMMAR.DAY_PREPOSITION':'Giới từ với ngày',
  'EN4.GRAMMAR.MONTH_PREPOSITION':'Giới từ với tháng',
  'EN4.GRAMMAR.CAN_CANT':"Can / can't",
  'EN4.GRAMMAR.PRESENT_SIMPLE_3SG':'Hiện tại đơn ngôi thứ ba',
  'EN4.VOCAB.SCHOOL_SUBJECT':'Từ vựng môn học',
  'EN4.VOCAB.JOBS':'Từ vựng nghề nghiệp',
  'EN4.VOCAB.APPEARANCE':'Miêu tả ngoại hình',
  'EN4.VOCAB.WEATHER':'Từ vựng thời tiết',
  'EN4.READING.EXPLICIT':'Đọc hiểu thông tin trực tiếp',
  'EN4.READING.INFERENCE':'Đọc hiểu suy luận',
  'EN4.WRITING.ROUTINE_PARAGRAPH':'Viết đoạn văn về sinh hoạt hằng ngày'
});

export function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function conceptLabel(id){return CONCEPT_LABELS[id]??BASELINE_CONCEPT_LABELS[id]??'Kiến thức đang theo dõi';}
function subjectLabel(subject){return subject==='MULTI'?'Nhiều môn':SUBJECT_LABELS[subject]??subject??'Chưa rõ môn';}
function conceptPrefix(subject){return subject==='MATH'?'MATH.':subject==='VIETNAMESE'?'VI.':subject==='ENGLISH'?'EN.':'';}
function populateConceptSelect(subject,select){
  if(!select)return;
  const prefix=conceptPrefix(subject);
  const entries=Object.entries(CONCEPT_LABELS).filter(function(entry){return entry[0].startsWith(prefix);});
  select.innerHTML=entries.map(function(entry){return '<option value="'+escapeHtml(entry[0])+'">'+escapeHtml(entry[1])+'</option>';}).join('');
}
function listText(values,empty){return Array.isArray(values)&&values.length?values.map(escapeHtml).join(', '):(empty??'Chưa có');}
function formatPrompt(prompt){
  if(typeof prompt==='string')return escapeHtml(prompt);
  if(!prompt||typeof prompt!=='object')return 'Nội dung câu hỏi chưa sẵn sàng.';
  const parts=[];
  if(prompt.passage)parts.push('<p>'+escapeHtml(prompt.passage)+'</p>');
  if(prompt.question)parts.push('<p><b>'+escapeHtml(prompt.question)+'</b></p>');
  if(prompt.task)parts.push('<p><b>'+escapeHtml(prompt.task)+'</b></p>');
  if(prompt.draft)parts.push('<p>'+escapeHtml(prompt.draft)+'</p>');
  if(prompt.learner_task)parts.push('<p><b>'+escapeHtml(prompt.learner_task)+'</b></p>');
  return parts.join('')||escapeHtml(JSON.stringify(prompt));
}
function renderAutoEvaluationHtml(evaluation){
  if(!evaluation)return '';
  const steps=evaluation.next_steps??[];
  return '<div class="panel"><h3>Hệ thống đã chấm và đánh giá</h3>'
    +'<div class="metrics">'
    +'<div class="metric"><b>Tự chấm</b><span>'+escapeHtml(evaluation.auto_graded_count??0)+'/'+escapeHtml(evaluation.total_items??0)+'</span></div>'
    +'<div class="metric"><b>Đúng</b><span>'+escapeHtml(evaluation.correct_count??0)+'</span></div>'
    +'<div class="metric"><b>Sai</b><span>'+escapeHtml(evaluation.incorrect_count??0)+'</span></div>'
    +'<div class="metric"><b>Chưa chắc</b><span>'+escapeHtml(evaluation.unresolved_count??0)+'</span></div>'
    +'</div>'
    +(steps.length?'<h4>Cần làm tiếp</h4><ul>'+steps.map(function(x){return '<li><b>'+escapeHtml(conceptLabel(x.concept_id))+'</b>: '+escapeHtml(ACTION_LABELS[x.scheduled_action??x.action]??'Kiểm tra thêm')+'</li>';}).join('')+'</ul>':'<p>Không có mục nào cần kiểm tra thêm ngay.</p>')
    +'<p class="muted">'+escapeHtml(evaluation.note??'')+'</p></div>';
}
export function renderAssessmentPreviewHtml(stored){
  const student=stored.preview?.student_items??[];
  const key=stored.preview?.parent_key??[];
  const isBaseline=stored.baseline_candidate===true;
  const submitted=['SUBMITTED','RESULT_CAPTURED'].includes(stored.status);
  const submittedById=new Map((stored.learner_submission?.answers??[]).map(function(x){return [x.item_id,x.answer];}));
  function answerBox(item){
    if(!isBaseline)return '';
    const saved=submittedById.get(item.item_id)??'';
    return '<label class="learner-answer"><b>Câu trả lời của con</b><textarea rows="3" data-answer-item="'+escapeHtml(item.item_id)+'"'+(submitted?' disabled':'')+'>'+escapeHtml(saved)+'</textarea></label>';
  }
  return '<div class="panel student-sheet">'
    +'<h3>'+(isBaseline?'Bài kiểm tra đầu vào':'Bài cho con')+'</h3>'
    +'<p class="muted">'+student.length+' câu · khoảng '+escapeHtml(stored.candidate?.estimated_minutes??'?')+' phút</p>'
    +(stored.candidate?.shortage?.length?'<div class="notice">Chưa đủ đúng số câu yêu cầu: '+stored.candidate.shortage.map(escapeHtml).join(' · ')+'</div>':'')
    +student.map(function(item,i){return '<div class="item"><div class="item-number">Câu '+(i+1)+'</div><div>'+formatPrompt(item.prompt_or_artifact_ref)+'</div>'+answerBox(item)+'</div>';}).join('')
    +'<div class="action-row">'
    +(isBaseline?'<button id="submitAnswersButton" class="primary"'+(submitted?' disabled':'')+'>'+(submitted?'Đã nộp & chấm':'Nộp bài')+'</button>':'<button id="markReadyButton" class="primary">Đánh dấu sẵn sàng cho con làm</button>')
    +'<button id="printStudentButton">In bài cho con</button>'
    +(isBaseline?'':'<button id="toggleKeyButton">Hiện đáp án phụ huynh</button>')
    +'</div></div>'
    +(isBaseline?renderAutoEvaluationHtml(stored.auto_evaluation):'')
    +(isBaseline?'':'<div id="parentKeyPanel" class="panel parent-key hidden"><h3>Đáp án / tiêu chí dành cho phụ huynh</h3><p class="muted">Phần này không hiện trong bản in cho con.</p>'
      +key.map(function(item,i){return '<div class="item"><b>Câu '+(i+1)+'</b><pre>'+escapeHtml(JSON.stringify(item.answer_or_scoring_ref,null,2))+'</pre></div>';}).join('')
      +'</div>');
}
function toast(message){
  const el=document.getElementById('toast');if(!el)return;
  el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);
  toast.timer=setTimeout(function(){el.classList.remove('show');},2600);
}
async function api(url,options){
  options=options??{};
  const headers={...(options.headers??{})};
  if(options.body!==undefined&&!headers['content-type'])headers['content-type']='application/json';
  const res=await fetch(url,{...options,headers:headers});
  const data=await res.json().catch(function(){return {message_vi:'Không đọc được phản hồi từ hệ thống.'};});
  if(!res.ok)throw new Error(data.message_vi??data.reason??data.error_code??'Có lỗi xảy ra.');
  return data;
}
async function apiResolution(url){
  const res=await fetch(url,{headers:{accept:'application/json'}});
  const data=await res.json().catch(function(){return {kind:'NOT_FOUND',reason:'INVALID_RESPONSE'};});
  return {ok:res.ok,status:res.status,data:data};
}
function showView(id){
  document.querySelectorAll('.view').forEach(function(x){x.classList.toggle('active-view',x.id===id);});
  document.querySelectorAll('.nav button').forEach(function(x){x.classList.toggle('active',x.dataset.view===id);});
  if(id==='todo')loadTodo().catch(renderTodoError);
  if(id==='materials')loadMaterials().catch(renderMaterialError);
  if(id==='progress')loadProgress().catch(renderProgressError);
  if(id==='bank')loadBank().catch(function(e){toast(e.message);});
  if(id==='target')loadTarget().catch(function(e){toast(e.message);});
  if(typeof window!=='undefined')window.scrollTo({top:0,behavior:'smooth'});
}
async function loadDashboard(){
  const data=await api('/api/dashboard');state.dashboard=data;
  const badge=document.getElementById('targetBadge');
  if(badge)badge.textContent=data.target_model?.status==='PROVISIONAL'?'NTL6 2027 · mục tiêu tạm thời':'NTL6 2027 · đã có bằng chứng';
  return data;
}
function currentStateLabel(material){return WORKFLOW_LABELS[material?.derived_workflow_state]??material?.derived_workflow_state??'Cần xem';}
function materialPrimaryArtifact(material){
  const visible=(material?.artifacts??[]).filter(function(x){return x.exists&&x.kind!=='SYSTEM'&&x.audience!=='SYSTEM';});
  return visible.length===1?visible[0]:null;
}
function artifactHref(material,artifact,download){
  if(!material?.assessment_id||!artifact?.ref)return null;
  const q=new URLSearchParams({artifact_ref:artifact.ref});if(download)q.set('download','1');
  return '/api/materials/'+encodeURIComponent(material.assessment_id)+'/file?'+q.toString();
}
function taskActionsHtml(material,artifact){
  if(!artifact)return '<button type="button" data-material-open="'+escapeHtml(material.assessment_id)+'">Xem chi tiết</button>';
  return '<a class="primary-link" href="'+escapeHtml(artifactHref(material,artifact,false))+'" target="_blank" rel="noopener">Mở bài</a>'
    +'<a href="'+escapeHtml(artifactHref(material,artifact,true))+'">Lấy file</a>'
    +'<button type="button" data-material-open="'+escapeHtml(material.assessment_id)+'">Nguồn & chi tiết</button>';
}
async function relatedMaterial(id){const rows=await api('/api/materials?assessment_id='+encodeURIComponent(id));return rows?.[0]??null;}
function todoStateHtml(kind,data){
  if(kind==='BLOCKED')return '<div class="state-panel"><h2>Chưa đến lúc giao bài tiếp</h2><p>'+(data.reason==='STRATEGY_SCHEDULED_PAUSE'?'Chiến lược hiện tại đang tạm dừng giao thêm bài để tránh quá tải.':'Bài tiếp theo đang chờ điều kiện trước đó hoàn thành.')+'</p><button type="button" data-jump="progress">Xem tiến độ</button></div>';
  if(kind==='AMBIGUOUS')return '<div class="state-panel"><h2>Cần xác minh học liệu</h2><p>Có nhiều học liệu cùng phù hợp với trạng thái hiện tại. Hệ thống không tự đoán thay anh.</p><button type="button" data-jump="materials">Xem các học liệu phù hợp</button></div>';
  if(kind==='MATERIAL_MISSING')return '<div class="state-panel"><h2>Đã xác định việc cần làm nhưng thiếu file</h2><p>Chiến lược đã xác định nội dung phù hợp, nhưng file canonical chưa sẵn sàng. Hệ thống không thay bằng một file “mới nhất” khác.</p><button type="button" data-jump="materials">Kiểm tra học liệu</button></div>';
  return '<div class="state-panel"><h2>Chưa có việc cần làm ngay</h2><p>Hiện chưa có học liệu nào được resolver xác nhận là bước học hiện tại. Có thể xem tiến độ hoặc tìm lại học liệu cũ.</p><div class="task-actions"><button type="button" data-jump="progress">Xem tiến độ</button><button type="button" data-jump="materials">Mở học liệu</button></div></div>';
}
async function loadTodo(){
  const target=document.getElementById('todoContent');if(!target)return;
  target.className='loading-state';target.textContent='Đang xác định bước học phù hợp…';
  const response=await apiResolution('/api/materials/current');const data=response.data;
  if(data.kind!=='EXACT'){target.className='';target.innerHTML=todoStateHtml(data.kind,data);return;}
  const material=data.material;const artifact=data.artifact??materialPrimaryArtifact(material);
  let next=null;const nextId=material?.relationships?.next_supported?.[0];
  if(nextId){try{next=await relatedMaterial(nextId);}catch{}}
  const conceptText=(material.concept_ids??[]).slice(0,3).map(conceptLabel).join(' · ')||material.content_summary||'Nội dung học';
  target.className='';
  target.innerHTML='<div class="current-shell"><article class="focus-task subject-'+escapeHtml(material.subject)+'">'
    +'<div class="task-kicker"><span class="task-status">'+escapeHtml(currentStateLabel(material))+'</span><span>'+escapeHtml(subjectLabel(material.subject))+'</span>'+(material.date?'<span>· '+escapeHtml(formatDate(material.date))+'</span>':'')+'</div>'
    +'<h2>'+escapeHtml(material.display_title??MATERIAL_KIND_LABELS[material.activity_kind]??'Học liệu')+'</h2>'
    +'<p class="task-topic">'+escapeHtml(conceptText)+'</p>'
    +'<div class="task-meta"><span class="meta-pill">'+escapeHtml(MATERIAL_KIND_LABELS[material.activity_kind]??material.activity_kind)+'</span>'+(material.audiences?.[0]?'<span class="meta-pill">'+escapeHtml(AUDIENCE_LABELS[material.audiences[0]]??material.audiences[0])+'</span>':'')+'</div>'
    +'<div class="task-actions">'+taskActionsHtml(material,artifact)+'</div></article>'
    +'<aside class="path-panel" aria-label="Đường học tiếp theo"><h3>Đường học</h3><div class="path-step current"><b>'+escapeHtml(currentStateLabel(material))+'</b>'+escapeHtml(material.display_title??'Việc hiện tại')+'</div>'
    +(next?'<div class="path-step"><b>Sau đó</b>'+escapeHtml(next.display_title??'Bước tiếp theo')+'</div>':'<div class="path-step"><b>Sau đó</b>NTL6 sẽ xác định sau khi có bằng chứng mới.</div>')
    +'<div class="path-note">Thứ tự này dựa trên trạng thái chiến lược, không dựa vào file mới nhất.</div></aside></div>';
  wireMaterialButtons(target);
}
function renderTodoError(error){const target=document.getElementById('todoContent');if(target){target.className='error-state';target.textContent='Không tải được việc cần làm: '+error.message;}}
function isoLocalDate(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
function materialParams(){
  const params=new URLSearchParams();
  const values={
    subject:document.getElementById('materialSubject')?.value,
    kind:document.getElementById('materialKind')?.value,
    workflow_status:document.getElementById('materialStatus')?.value,
    audience:document.getElementById('materialAudience')?.value,
    provenance:document.getElementById('materialProvenance')?.value,
    q:document.getElementById('materialQuery')?.value?.trim()
  };
  const preset=document.getElementById('materialDatePreset')?.value;
  if(preset==='today')values.date=isoLocalDate(new Date());
  else if(preset==='7'||preset==='30'){
    const end=new Date();const start=new Date();start.setDate(end.getDate()-(Number(preset)-1));
    values.date_from=isoLocalDate(start);values.date_to=isoLocalDate(end);
  }else if(preset==='custom'){values.date_from=document.getElementById('materialDateFrom')?.value;values.date_to=document.getElementById('materialDateTo')?.value;}
  Object.entries(values).forEach(function(entry){if(entry[1])params.set(entry[0],entry[1]);});return params;
}
function formatDate(value){
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?match[3]+'/'+match[2]+'/'+match[1]:(value??'Chưa rõ ngày');
}
function provenanceSummary(provenance){
  const curriculum=(provenance?.curriculum_grounding??[]).map(function(x){return SOURCE_CLASS_LABELS[x.source_class]??x.title;}).filter(Boolean);
  const exam=(provenance?.exam_pattern_evidence??[]).map(function(x){return SOURCE_CLASS_LABELS[x.source_class]??x.title;}).filter(Boolean);
  const origin=SOURCE_CLASS_LABELS[provenance?.generation_origin]??provenance?.generation_origin;
  const parts=[];if(curriculum.length)parts.push(curriculum[0]);if(exam.length)parts.push(exam[0]);if(origin&&origin!=='Chưa rõ')parts.push(origin);
  return parts.length?parts.join(' · '):'Chưa đủ thông tin nguồn';
}
function materialRowHtml(row){
  const artifact=materialPrimaryArtifact(row);
  return '<article class="material-row subject-'+escapeHtml(row.subject)+'"><div><div class="material-subject">'+escapeHtml(subjectLabel(row.subject))+'</div><div class="material-kind">'+escapeHtml(MATERIAL_KIND_LABELS[row.activity_kind]??row.activity_kind)+'</div></div>'
    +'<div class="material-main"><h3>'+escapeHtml(row.display_title??row.content_summary)+'</h3><p>'+escapeHtml((row.concept_ids??[]).slice(0,3).map(conceptLabel).join(' · ')||row.content_summary||'Chưa có mô tả')+'</p>'
    +'<div class="material-secondary"><span class="state-tag '+escapeHtml(row.derived_workflow_state)+'">'+escapeHtml(currentStateLabel(row))+'</span><span class="source-tag">'+escapeHtml(provenanceSummary(row.provenance))+'</span></div></div>'
    +'<div class="material-actions">'+(artifact?'<a class="primary-link" href="'+escapeHtml(artifactHref(row,artifact,false))+'" target="_blank" rel="noopener">Mở</a><a href="'+escapeHtml(artifactHref(row,artifact,true))+'">Lấy file</a>':'')+'<button type="button" data-material-open="'+escapeHtml(row.assessment_id)+'">Chi tiết</button></div></article>';
}
function groupByDate(rows){const map=new Map();for(const row of rows){const date=row.date??'UNKNOWN';if(!map.has(date))map.set(date,[]);map.get(date).push(row);}return [...map.entries()];}
async function loadMaterials(){
  const target=document.getElementById('materialContent');const detail=document.getElementById('materialDetail');if(!target)return;
  target.className='loading-state';target.textContent='Đang tải học liệu…';if(detail)detail.innerHTML='';
  const params=materialParams();const rows=await api('/api/materials'+(params.size?'?'+params.toString():''));
  const summary=document.getElementById('materialSummary');if(summary)summary.textContent=rows.length+' học liệu phù hợp';
  if(!rows.length){target.className='empty-state';target.textContent='Không tìm thấy học liệu phù hợp với bộ lọc.';return;}
  target.className='material-list';
  target.innerHTML=groupByDate(rows).map(function(group){
    return '<section class="material-date-group"><div class="material-date-heading">'+escapeHtml(group[0]==='UNKNOWN'?'Chưa rõ ngày':formatDate(group[0]))+'</div>'+group[1].map(materialRowHtml).join('')+'</section>';
  }).join('');
  wireMaterialButtons(target);
}
function wireMaterialButtons(scope){
  scope.querySelectorAll('[data-material-open]').forEach(function(button){button.onclick=function(){loadMaterialDetail(button.dataset.materialOpen).catch(function(error){toast(error.message);});};});
}
function renderMaterialError(error){const target=document.getElementById('materialContent');if(target){target.className='error-state';target.textContent='Không tải được học liệu: '+error.message;}}
function sourceRefsHtml(title,refs,empty){
  return '<div class="provenance-cell"><b>'+escapeHtml(title)+'</b>'+(refs?.length?refs.map(function(x){return '<span>'+escapeHtml(x.title??x.source_id)+' · '+escapeHtml(SOURCE_CLASS_LABELS[x.source_class]??x.source_class)+'</span>';}).join('<br>'):'<span>'+escapeHtml(empty)+'</span>')+'</div>';
}
async function loadMaterialDetail(id){
  const response=await apiResolution('/api/materials/'+encodeURIComponent(id));const data=response.data;const material=data.material??data;const target=document.getElementById('materialDetail');
  if(!target||!material?.assessment_id){toast(data.reason??'Không mở được chi tiết học liệu.');return;}
  const provenance=material.provenance??{};const artifacts=(material.artifacts??[]).filter(function(x){return x.kind!=='SYSTEM'&&x.audience!=='SYSTEM';});
  target.innerHTML='<article class="material-detail"><div class="page-head"><div><div class="material-subject">'+escapeHtml(subjectLabel(material.subject))+' · '+escapeHtml(formatDate(material.date))+'</div><h2>'+escapeHtml(material.display_title??material.content_summary)+'</h2><p>'+escapeHtml((material.concept_ids??[]).slice(0,4).map(conceptLabel).join(' · ')||material.content_summary||'')+'</p></div><button type="button" data-material-close>Đóng</button></div>'
    +(artifacts.length?'<div class="artifact-actions">'+artifacts.map(function(artifact){if(!artifact.exists)return '<span class="state-tag MATERIAL_MISSING">'+escapeHtml(artifact.label??artifact.name)+' · thiếu file</span>';return '<a class="primary-link" href="'+escapeHtml(artifactHref(material,artifact,false))+'" target="_blank" rel="noopener">'+escapeHtml(artifact.label??'Mở file')+'</a><a href="'+escapeHtml(artifactHref(material,artifact,true))+'">Lấy '+escapeHtml(artifact.original_name??artifact.name)+'</a>';}).join('')+'</div>':'')
    +'<h3 style="margin-top:20px">Nguồn & truy xuất</h3><div class="provenance-grid">'
    +sourceRefsHtml('Chương trình / SGK',provenance.curriculum_grounding,'Chưa đủ thông tin nguồn chương trình')
    +sourceRefsHtml('Đề trường / tham khảo',provenance.exam_pattern_evidence,'Chưa có nguồn mẫu đề được liên kết')
    +'<div class="provenance-cell"><b>Nguồn tạo bài</b><span>'+escapeHtml(SOURCE_CLASS_LABELS[provenance.generation_origin]??provenance.generation_origin??'Chưa rõ')+'</span></div></div>'
    +(provenance.gaps?.length?'<p class="muted">Khoảng trống nguồn: '+escapeHtml(provenance.gaps.join(' · '))+'</p>':'')
    +'<details class="technical-details"><summary>Chi tiết kỹ thuật</summary><p><b>Mã hồ sơ:</b> <code>'+escapeHtml(material.assessment_id)+'</code></p><p><b>Trạng thái canonical:</b> '+escapeHtml(material.canonical_status??material.status)+'</p><p><b>Mục đích:</b> '+escapeHtml(material.purpose)+'</p></details></article>';
  target.querySelector('[data-material-close]').onclick=function(){target.innerHTML='';};
  target.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadProgress(){
  const data=await api('/api/progress');const concepts=data.concepts??[];const target=document.getElementById('progressContent');if(!target)return;
  if(!concepts.length){target.className='empty-state';target.textContent='Chưa có đủ dữ liệu học để hiển thị tiến độ. Hãy làm bài đầu vào hoặc bài chẩn đoán trước.';return;}
  const grouped=new Map();
  for(const item of concepts){const subject=item?.concept?.subject??String(item?.concept?.concept_id??'').split('.')[0]??'UNKNOWN';if(!grouped.has(subject))grouped.set(subject,[]);grouped.get(subject).push(item);}
  const order=['MATH','VIETNAMESE','ENGLISH'];target.className='progress-list';
  target.innerHTML=order.filter(function(subject){return grouped.has(subject);}).map(function(subject){
    const items=grouped.get(subject).sort(function(a,b){return (a?.priority?.rank??999)-(b?.priority?.rank??999);});const focus=items[0];
    const demo=DEMONSTRATION_LABELS[focus?.state?.demonstration?.status]??focus?.state?.demonstration?.status??'Chưa đủ dữ liệu';
    const concern=CONCERN_LABELS[focus?.state?.concern?.status]??focus?.state?.concern?.status??'Chưa rõ';
    const action=ACTION_LABELS[focus?.decision?.scheduled_action??focus?.decision?.need_action]??focus?.decision?.scheduled_action??focus?.decision?.need_action??'Chưa xác định';
    return '<article class="progress-subject"><div class="progress-subject-name">'+escapeHtml(subjectLabel(subject))+'</div><div class="progress-focus"><h3>'+escapeHtml(conceptLabel(focus?.concept?.concept_id))+'</h3><p>Bằng chứng hiện tại: '+escapeHtml(demo)+' · Cần lưu ý: '+escapeHtml(concern)+'</p></div><div class="progress-action"><b>Việc tiếp theo</b>'+escapeHtml(action)+'<br><button type="button" data-material-subject="'+escapeHtml(subject)+'">Xem học liệu</button></div></article>';
  }).join('');
  target.querySelectorAll('[data-material-subject]').forEach(function(button){button.onclick=function(){const select=document.getElementById('materialSubject');if(select)select.value=button.dataset.materialSubject;showView('materials');};});
}
function renderProgressError(error){const target=document.getElementById('progressContent');if(target){target.className='error-state';target.textContent='Không tải được tiến độ: '+error.message;}}
function requestId(prefix){return (prefix??'pc')+'-'+Date.now().toString(36);}
async function createBaseline(subject){
  const stored=await api('/api/baseline/'+subject,{method:'POST',body:JSON.stringify({requested_at:new Date().toISOString()})});state.currentAssessment=stored;state.currentAssessmentId=stored.candidate.assessment_id;
  const gradeId=document.getElementById('gradeAssessmentId');if(gradeId)gradeId.value=state.currentAssessmentId;showView('advanced');
  const target=document.getElementById('baselinePreview');target.innerHTML=renderAssessmentPreviewHtml(stored);wirePreviewActions(target);toast('Đã tạo bài kiểm tra đầu vào '+subjectLabel(subject)+'.');
}
async function createAssessmentFromForm(args){
  const body={contract_version:'ASSESSMENT_REQUEST/1.0',request_id:requestId(args.purpose.toLowerCase()),learner_id:state.dashboard?.learner_id??'default-learner',subject:args.subject,target_concepts:args.concepts,purpose:args.purpose,max_items:Number(args.count),time_budget_minutes:Number(args.time),difficulty_band:'GRADE5_CORE',requested_at:new Date().toISOString(),parent_constraints:{}};
  const stored=await api('/api/assessments',{method:'POST',body:JSON.stringify(body)});state.currentAssessment=stored;state.currentAssessmentId=stored.candidate.assessment_id;
  const gradeId=document.getElementById('gradeAssessmentId');if(gradeId)gradeId.value=state.currentAssessmentId;
  const target=document.getElementById(args.targetId);target.innerHTML=renderAssessmentPreviewHtml(stored);wirePreviewActions(target);toast('Đã tạo bản xem trước.');
}
async function submitBaselineAnswers(container){
  const controls=[...container.querySelectorAll('[data-answer-item]')];const answers=controls.map(function(el){return {item_id:el.dataset.answerItem,answer:el.value.trim()};});
  if(!answers.length||answers.some(function(x){return !x.answer;})){toast('Con hãy trả lời đủ các câu trước khi nộp bài.');return;}
  const result=await api('/api/assessments/'+encodeURIComponent(state.currentAssessmentId)+'/answers',{method:'POST',body:JSON.stringify({submitted_at:new Date().toISOString(),answers:answers})});
  const fresh=await api('/api/assessments/'+encodeURIComponent(state.currentAssessmentId));state.currentAssessment=fresh;state.dashboard=result.dashboard??state.dashboard;
  container.innerHTML=renderAssessmentPreviewHtml(fresh);wirePreviewActions(container);const evaluation=result.auto_evaluation??fresh.auto_evaluation;
  toast('Đã tự chấm '+(evaluation?.auto_graded_count??0)+'/'+(evaluation?.total_items??0)+' câu; '+(evaluation?.unresolved_count??0)+' câu cần kiểm tra thêm.');
  await loadDashboard();await loadTodo();
}
function wirePreviewActions(container){
  const ready=container.querySelector('#markReadyButton');const submit=container.querySelector('#submitAnswersButton');const print=container.querySelector('#printStudentButton');const toggle=container.querySelector('#toggleKeyButton');
  if(ready)ready.onclick=async function(){await api('/api/assessments/'+encodeURIComponent(state.currentAssessmentId)+'/ready',{method:'POST',body:'{}'});toast('Đã đánh dấu bài sẵn sàng.');await loadTodo().catch(function(){});};
  if(submit)submit.onclick=function(){submitBaselineAnswers(container).catch(function(err){toast(err.message);});};
  if(print)print.onclick=function(){window.print();};if(toggle)toggle.onclick=function(){container.querySelector('#parentKeyPanel')?.classList.toggle('hidden');};
}
async function loadGrade(id){
  const stored=await api('/api/assessments/'+encodeURIComponent(id));state.currentAssessment=stored;state.currentAssessmentId=id;const allItems=stored.preview?.student_items??[];
  const unresolvedIds=new Set((stored.auto_evaluation?.unresolved_items??[]).map(function(x){return x.item_id;}));const items=stored.baseline_candidate&&stored.auto_evaluation?allItems.filter(function(x){return unresolvedIds.has(x.item_id);}):allItems;
  const answerById=new Map((stored.learner_submission?.answers??[]).map(function(x){return [x.item_id,x.answer];}));const keyById=new Map((stored.preview?.parent_key??[]).map(function(x){return [x.item_id,x.answer_or_scoring_ref];}));
  document.getElementById('gradeContent').innerHTML='<div class="panel"><h3>'+escapeHtml(id)+'</h3>'
    +items.map(function(item,i){return '<div class="item grade-item" data-item-id="'+escapeHtml(item.item_id)+'"><div class="item-number">Câu '+(i+1)+'</div><div>'+formatPrompt(item.prompt_or_artifact_ref)+'</div>'
      +(stored.baseline_candidate?'<p><b>Câu trả lời của con:</b> '+escapeHtml(answerById.get(item.item_id)??'Chưa có câu trả lời')+'</p><details><summary>Đáp án / tiêu chí cho phụ huynh</summary><pre>'+escapeHtml(JSON.stringify(keyById.get(item.item_id)??null,null,2))+'</pre></details>':'')
      +'<div class="grade-row"><label>Kết quả<select class="criterion">'+RESULT_OPTIONS.map(function(pair){return '<option value="'+pair[0]+'">'+pair[1]+'</option>';}).join('')+'</select></label><label>Trợ giúp<select class="help">'+HELP_OPTIONS.map(function(pair){return '<option value="'+pair[0]+'">'+pair[1]+'</option>';}).join('')+'</select></label><label>Lỗi quan sát được<input class="errorHypothesis" placeholder="Để trống nếu chưa rõ"></label></div></div>';}).join('')
    +(items.length?'<button id="saveResults" class="primary">Lưu kết quả & cập nhật tiến độ</button>':'<p><b>Không còn câu nào cần chấm tay.</b></p>')+'</div>';
  const save=document.getElementById('saveResults');if(save)save.onclick=saveResults;
}
async function saveResults(){
  const rows=[...document.querySelectorAll('.grade-item')].map(function(el){const criterion=el.querySelector('.criterion').value;const help=el.querySelector('.help').value;const hypothesis=el.querySelector('.errorHypothesis').value.trim();return {item_id:el.dataset.itemId,result:{criterionResult:criterion,grader:'PARENT',gradingVerified:true,helpLevel:help,helpSource:'PARENT_REPORTED',helpTiming:'AFTER_ATTEMPT',helpObservationBasis:'PARENT_REPORTED',firstAttempt:'YES',retryRelation:'FRESH',answerExposure:help==='WORKED_STEP_OR_ANSWER'?'WORKED_ANSWER':'NONE_OBSERVED',timeLimit:'KNOWN',interruption:'NONE_OBSERVED',fatigue:'UNKNOWN',responseModality:'WRITTEN',errorHypothesis:hypothesis||'UNKNOWN',interpretationStatus:hypothesis?'VERIFIED':'UNRESOLVED',interpretationOrigin:'HUMAN'}};});
  await api('/api/assessments/'+encodeURIComponent(state.currentAssessmentId)+'/results',{method:'POST',body:JSON.stringify({imported_at:new Date().toISOString(),observed_at:new Date().toISOString(),policy_version:'PARENT_CONSOLE_R1',results:rows})});
  if(state.currentAssessment?.baseline_candidate&&!state.currentAssessment?.auto_evaluation)await api('/api/baseline/'+encodeURIComponent(state.currentAssessmentId)+'/accept',{method:'POST',body:JSON.stringify({accepted_at:new Date().toISOString()})});
  toast('Đã lưu kết quả và cập nhật tiến độ.');await loadDashboard();showView('todo');
}
async function loadBank(){
  const data=await api('/api/question-bank');const lifecycle=new Map();(data.lifecycle??[]).forEach(function(e){lifecycle.set(e.item_id,e.new_state);});const target=document.getElementById('bankContent');target.className='';
  target.innerHTML='<div class="panel">'+((data.candidates??[]).length?(data.candidates??[]).map(function(q){return '<div class="bank-row"><div><b>'+escapeHtml(conceptLabel(q.concept_id))+'</b><br><span class="muted">Trạng thái: '+escapeHtml(LIFECYCLE_LABELS[lifecycle.get(q.item_id)]??'Câu mới')+'</span></div><div class="action-row"><button data-promote="'+escapeHtml(q.item_id)+'">Duyệt sử dụng</button><button data-retire="'+escapeHtml(q.item_id)+'">Ngừng sử dụng</button></div></div>';}).join(''):'Chưa có câu mới nào trong kho chờ duyệt.')+'</div>';
  target.querySelectorAll('[data-promote]').forEach(function(button){button.onclick=async function(){await api('/api/questions/'+button.dataset.promote+'/promote',{method:'POST',body:JSON.stringify({reason:'Phụ huynh duyệt sử dụng'})});toast('Đã duyệt câu hỏi.');loadBank();};});
  target.querySelectorAll('[data-retire]').forEach(function(button){button.onclick=async function(){await api('/api/questions/'+button.dataset.retire+'/retire',{method:'POST',body:JSON.stringify({reason:'Phụ huynh ngừng sử dụng'})});toast('Đã ngừng sử dụng câu hỏi.');loadBank();};});
}
async function loadTarget(){
  const data=state.dashboard??await api('/api/dashboard');const target=document.getElementById('targetContent');target.className='';
  target.innerHTML='<div class="panel"><h3>Trạng thái mục tiêu: '+escapeHtml(data.target_model.status==='PROVISIONAL'?'Tạm thời — đang chờ thông tin 2027 đáng tin cậy':'Đã có bằng chứng năm mục tiêu')+'</h3><p>Phiên bản: '+escapeHtml(data.target_model.version)+'</p>'+((data.warnings??[]).length?'<div class="notice">'+data.warnings.map(function(x){return '<div>'+escapeHtml(x)+'</div>';}).join('')+'</div>':'')+'</div>';
}
async function refreshTarget(){
  const data=await api('/api/target/revalidate',{method:'POST',body:JSON.stringify({as_of:new Date().toISOString(),version:'PARENT-'+new Date().toISOString().slice(0,10)})});
  document.getElementById('targetContent').innerHTML='<div class="panel"><h3>'+(data.model.status==='PROVISIONAL'?'Vẫn là mục tiêu tạm thời':'Đã có bằng chứng năm mục tiêu')+'</h3><p>Nguồn chính thức đã biết: '+data.model.official_facts.length+' · Nguồn lịch sử/tham khảo: '+data.model.historical_pattern_evidence.length+'</p><p><b>Điểm chưa biết:</b> '+listText(data.model.unknowns,'Không có')+'</p></div>';toast('Đã làm mới mô hình mục tiêu từ kho nguồn hiện có.');
}
function resetMaterialFilters(){
  ['materialQuery','materialSubject','materialDatePreset','materialKind','materialStatus','materialAudience','materialProvenance','materialDateFrom','materialDateTo'].forEach(function(id){const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('customDateRange')?.classList.add('hidden');loadMaterials().catch(renderMaterialError);
}
async function init(){
  populateConceptSelect(document.getElementById('subjectInput')?.value,document.getElementById('conceptInput'));populateConceptSelect(document.getElementById('checkSubjectInput')?.value,document.getElementById('checkConceptInput'));populateConceptSelect(document.getElementById('recheckSubject')?.value,document.getElementById('recheckConcept'));
  document.getElementById('subjectInput').onchange=function(e){populateConceptSelect(e.target.value,document.getElementById('conceptInput'));};document.getElementById('checkSubjectInput').onchange=function(e){populateConceptSelect(e.target.value,document.getElementById('checkConceptInput'));};document.getElementById('recheckSubject').onchange=function(e){populateConceptSelect(e.target.value,document.getElementById('recheckConcept'));};
  document.querySelectorAll('[data-baseline]').forEach(function(button){button.onclick=function(){createBaseline(button.dataset.baseline).catch(function(err){toast(err.message);});};});document.querySelectorAll('.nav button').forEach(function(button){button.onclick=function(){showView(button.dataset.view);};});
  document.addEventListener('click',function(event){const button=event.target.closest('[data-jump]');if(button)showView(button.dataset.jump);});
  document.getElementById('assessmentForm').onsubmit=async function(event){event.preventDefault();try{await createAssessmentFromForm({subject:document.getElementById('subjectInput').value,purpose:document.getElementById('purposeInput').value,concepts:[document.getElementById('conceptInput').value],count:document.getElementById('itemCountInput').value,time:document.getElementById('timeInput').value,targetId:'assessmentPreview'});}catch(error){toast(error.message);}};
  document.getElementById('checkAssessmentForm').onsubmit=async function(event){event.preventDefault();try{await createAssessmentFromForm({subject:document.getElementById('checkSubjectInput').value,purpose:document.getElementById('checkPurposeInput').value,concepts:[document.getElementById('checkConceptInput').value],count:document.getElementById('checkItemCountInput').value,time:document.getElementById('checkTimeInput').value,targetId:'checkAssessmentPreview'});}catch(error){toast(error.message);}};
  document.getElementById('recheckForm').onsubmit=async function(event){event.preventDefault();try{await createAssessmentFromForm({subject:document.getElementById('recheckSubject').value,purpose:'FRESH_RECHECK',concepts:[document.getElementById('recheckConcept').value],count:document.getElementById('recheckCount').value,time:document.getElementById('recheckTime').value,targetId:'recheckPreview'});}catch(error){toast(error.message);}};
  document.getElementById('loadGradeAssessment').onclick=async function(){try{await loadGrade(document.getElementById('gradeAssessmentId').value.trim());}catch(error){toast(error.message);}};
  document.getElementById('materialSearchForm').onsubmit=function(event){event.preventDefault();loadMaterials().catch(renderMaterialError);};document.getElementById('materialDatePreset').onchange=function(event){document.getElementById('customDateRange').classList.toggle('hidden',event.target.value!=='custom');};document.getElementById('materialReset').onclick=resetMaterialFilters;document.getElementById('refreshTodo').onclick=function(){loadTodo().catch(renderTodoError);};document.getElementById('refreshTarget').onclick=function(){refreshTarget().catch(function(err){toast(err.message);});};
  await loadDashboard();await loadTodo();
}
if(typeof document!=='undefined')init().catch(function(error){console.error(error);renderTodoError(error);});

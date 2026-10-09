const SUBJECT_LABELS=Object.freeze({MATH:'Toán',VIETNAMESE:'Tiếng Việt',ENGLISH:'Tiếng Anh'});
const STRATEGY_LABELS=Object.freeze({
  GIU_NHIP:'Giữ nhịp',
  TANG_TOC:'Tăng tốc',
  CUNG_CO:'Củng cố',
  GIAM_TAI:'Giảm tải',
  DOI_CHIEN_THUAT:'Đổi chiến thuật'
});
const ACTION_LABELS=Object.freeze({
  DIAGNOSE:'Chẩn đoán thêm',
  RETEACH:'Dạy lại phần chưa hiểu',
  REPAIR:'Sửa đúng chỗ sai',
  RECHECK:'Kiểm tra lại bằng bài mới',
  MAINTAIN:'Duy trì / ôn nhẹ',
  ADVANCE:'Nâng mức / học tiếp',
  PAUSE:'Tạm dừng / giảm tải'
});
const STATE_LABELS=Object.freeze({
  CHUA_DU_DU_LIEU:'Chưa đủ dữ liệu',
  DU_LIEU_MAU_THUAN:'Dữ liệu đang mâu thuẫn',
  DANG_CUNG_CO:'Đang củng cố',
  CO_BANG_CHUNG_DOC_LAP_ON_DINH_TRONG_PHAM_VI_DA_KIEM_TRA:'Đã tự làm ổn định trong phạm vi đã kiểm tra',
  DA_CO_BANG_CHUNG_TU_LAM:'Đã có bằng chứng tự làm',
  CHUA_DU_BANG_CHUNG_DOC_LAP:'Chưa đủ bằng chứng tự làm',
  CHUA_DU_DU_LIEU_BASELINE:'Chưa đủ dữ liệu khởi động'
});
const TREND_LABELS=Object.freeze({
  CHUA_DU_DU_LIEU_XU_HUONG:'Chưa đủ dữ liệu xu hướng',
  CAN_THEO_DOI:'Cần chú ý',
  DANG_TIEN_BO:'Đang tiến bộ',
  ON_DINH_HOAC_LAN_LON:'Ổn định / còn lẫn lộn'
});

function plainGap(gap) {
  if (!gap||!gap.concept_id) return gap?.reason==='CHUA_CO_KHOANG_TRONG_UU_TIEN'?'Chưa có khoảng trống ưu tiên rõ':'Chưa đủ dữ liệu';
  const reason={
    CONFLICT:'Dữ liệu mâu thuẫn',
    REPEATED_PATTERN:'Lỗi lặp lại',
    ASSISTED_ONLY:'Mới làm được khi có trợ giúp',
    INSUFFICIENT_EVIDENCE:'Chưa đủ bằng chứng',
    TRANSFER_NOT_CHECKED:'Chưa kiểm tra vận dụng'
  }[gap.reason]??gap.reason;
  return `${gap.display_name??gap.concept_id} — ${reason}`;
}

export function buildParentDashboard({learnerId,roadmap,targetModel,subjectFilter=null}) {
  const subjects=roadmap.subject_states
    .filter((s)=>!subjectFilter||s.subject===subjectFilter)
    .map((s)=>({
      subject:s.subject,
      start_state:STATE_LABELS[s.start_state]??s.start_state,
      current_state:STATE_LABELS[s.current_state]??s.current_state,
      achievements:s.achievements.map((x)=>x.display_name??x.concept_id),
      main_gap:plainGap(s.main_gap),
      trend:TREND_LABELS[s.trend]??s.trend,
      strategy:STRATEGY_LABELS[s.strategy]??s.strategy,
      next_action:ACTION_LABELS[s.next_action]??s.next_action,
      evidence_status:s.evidence_status
    }));

  const priority=subjects.find((s)=>s.evidence_status==='CONFLICT')??
    subjects.find((s)=>s.main_gap!=='Chưa có khoảng trống ưu tiên rõ')??
    subjects[0]??null;

  const warnings=[...(roadmap.unknowns??[])];
  if (targetModel.status==='PROVISIONAL') warnings.unshift('Mục tiêu NTL6 2027 hiện vẫn là mô hình tạm thời dựa trên bằng chứng hiện có.');

  return {
    contract_version:'PARENT_DASHBOARD/1.0',
    learner_id:learnerId,
    as_of:roadmap.as_of,
    goal:'Đỗ NTL6 2027',
    journey_stage:roadmap.journey_stage,
    target_model:{version:targetModel.version,status:targetModel.status},
    subjects,
    priority_action:priority?{
      subject:priority.subject,
      subject_label:SUBJECT_LABELS[priority.subject]??priority.subject,
      strategy:priority.strategy,
      next_action:priority.next_action,
      reason:priority.main_gap
    }:{},
    warnings
  };
}

export const SUBJECT_LABELS=Object.freeze({
  MATH:'Toán',
  VIETNAMESE:'Tiếng Việt',
  ENGLISH:'Tiếng Anh'
});

export const PURPOSE_LABELS=Object.freeze({
  DIAGNOSTIC:'Kiểm tra xem con đang biết đến đâu',
  PRACTICE:'Luyện tập',
  REPAIR:'Luyện đúng phần đang yếu',
  FRESH_RECHECK:'Kiểm tra lại bằng bài mới',
  WEEKLY_CHECK:'Bài kiểm tra tuần',
  MOCK:'Đề mô phỏng'
});

export const JOURNEY_LABELS=Object.freeze({
  KHOI_DONG:'Khởi động',
  XAY_NEN:'Xây nền',
  HOAN_THIEN_LOP_5:'Hoàn thiện lớp 5',
  VAN_DUNG:'Vận dụng',
  LUYEN_MUC_TIEU_NTL6:'Luyện mục tiêu NTL6',
  THI_THU_ON_DINH:'Thi thử / Ổn định'
});

export const EVIDENCE_LABELS=Object.freeze({
  SUFFICIENT:'Đã có bằng chứng',
  INSUFFICIENT:'Chưa đủ dữ liệu',
  CONFLICT:'Dữ liệu mâu thuẫn'
});

export const HELP_OPTIONS=Object.freeze([
  ['NONE_OBSERVED','Không trợ giúp'],
  ['GENERAL_PROMPT','Nhắc chung'],
  ['TARGET_HINT','Gợi ý đúng chỗ'],
  ['WORKED_STEP_OR_ANSWER','Đã hướng dẫn bước giải / đáp án'],
  ['UNKNOWN','Không rõ']
]);

export const DEMONSTRATION_LABELS=Object.freeze({
  UNKNOWN:'Chưa đủ dữ liệu',
  ASSISTED_ONLY:'Làm được khi có trợ giúp',
  INDEPENDENT_OBSERVED:'Đã tự làm được — cần kiểm tra thêm',
  INDEPENDENT_CONFIRMED:'Đã tự làm ổn định trong phạm vi đã kiểm tra'
});

export const CONCERN_LABELS=Object.freeze({
  NONE_OBSERVED:'Chưa thấy vấn đề nổi bật',
  SIGNAL:'Có dấu hiệu cần theo dõi',
  REPEATED_PATTERN:'Có lỗi lặp lại',
  CONFLICT:'Dữ liệu đang mâu thuẫn'
});

export const ACTION_LABELS=Object.freeze({
  DIAGNOSE:'Chẩn đoán thêm',
  RETEACH:'Dạy lại phần chưa hiểu',
  REPAIR:'Sửa đúng chỗ sai',
  RECHECK:'Kiểm tra lại bằng bài mới',
  MAINTAIN:'Duy trì / ôn nhẹ',
  ADVANCE:'Nâng mức / học tiếp',
  PAUSE:'Tạm dừng / giảm tải'
});

export const LIFECYCLE_LABELS=Object.freeze({
  GENERATED_CANDIDATE:'Câu mới sinh',
  VALIDATED:'Đã kiểm tra',
  PROMOTED:'Đã duyệt sử dụng',
  RETIRED:'Ngừng sử dụng'
});

export const CONCEPT_LABELS=Object.freeze({
  'MATH.DECIMAL.COMPARE':'So sánh số thập phân',
  'MATH.DECIMAL.ORDER':'Sắp xếp số thập phân',
  'VI.READING.EXPLICIT_INFORMATION':'Đọc hiểu thông tin trực tiếp',
  'VI.READING.INFER_WITH_EVIDENCE':'Đọc hiểu suy luận có bằng chứng',
  'VI.LANGUAGE.VOCAB_IN_CONTEXT':'Từ ngữ trong ngữ cảnh',
  'VI.LANGUAGE.SENTENCE_COHESION':'Liên kết câu',
  'VI.WRITING.PLAN_AND_DRAFT':'Lập ý và viết',
  'VI.WRITING.REVISE':'Chỉnh sửa bài viết',
  'EN.VOCABULARY.USE_IN_CONTEXT':'Từ vựng trong ngữ cảnh',
  'EN.LANGUAGE.FORM_MEANING':'Ngữ pháp và ý nghĩa',
  'EN.READING.COMPREHEND':'Đọc hiểu tiếng Anh',
  'EN.WRITING.PRODUCE':'Viết tiếng Anh',
  'EN.LISTENING.COMPREHEND':'Nghe hiểu tiếng Anh'
});

export const RESULT_OPTIONS=Object.freeze([
  ['CORRECT','Đúng'],
  ['PARTIAL','Đúng một phần'],
  ['INCORRECT','Sai'],
  ['UNRESOLVED','Chưa kết luận']
]);

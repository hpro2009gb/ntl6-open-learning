const UNKNOWN = 'UNKNOWN';

const ACTION_LABELS = Object.freeze({
  DIAGNOSE: 'Làm rõ',
  RETEACH: 'Học lại phần cốt lõi',
  REPAIR: 'Sửa kỹ năng cụ thể',
  RECHECK: 'Kiểm tra lại',
  MAINTAIN: 'Duy trì nhẹ',
  ADVANCE: 'Nâng mức',
  PAUSE: 'Tạm hoãn hôm nay'
});

const ACTION_BUCKETS = Object.freeze({
  DIAGNOSE: 'LAM_RO',
  RETEACH: 'HOC_LAI',
  REPAIR: 'SUA_KY_NANG',
  RECHECK: 'KIEM_TRA_LAI',
  MAINTAIN: 'DUY_TRI',
  ADVANCE: 'NANG_MUC'
});

const CAPACITY_LABELS = Object.freeze({
  REST: 'Nghỉ bổ trợ',
  MICRO: 'Rất nhẹ',
  NORMAL: 'Bình thường',
  DEEP: 'Có thể học sâu'
});

const DEMO_LABELS = Object.freeze({
  UNKNOWN: 'Chưa đủ dữ liệu',
  ASSISTED_ONLY: 'Làm được khi có hỗ trợ',
  INDEPENDENT_OBSERVED: 'Đã tự làm được — cần kiểm tra thêm',
  INDEPENDENT_CONFIRMED: 'Đã tự làm ổn định trong phạm vi đã kiểm tra'
});

const TRANSFER_LABELS = Object.freeze({
  NOT_CHECKED: 'Chưa kiểm tra vận dụng',
  OBSERVED: 'Đã thấy dấu hiệu vận dụng',
  CONFIRMED_IN_SCOPE: 'Vận dụng ổn trong phạm vi đã kiểm tra'
});

const RETENTION_LABELS = Object.freeze({
  NOT_CHECKED: 'Chưa kiểm tra nhớ lại sau khoảng cách',
  CHECK_PENDING: 'Đến lúc kiểm tra lại',
  OBSERVED_AT_DELAY: 'Đã quan sát được nhớ lại sau khoảng cách',
  CONCERN: 'Có dấu hiệu cần kiểm tra lại khả năng nhớ'
});

const CONCERN_LABELS = Object.freeze({
  NONE_OBSERVED: 'Chưa thấy vấn đề nổi bật',
  SIGNAL: 'Có một dấu hiệu cần theo dõi',
  REPEATED_PATTERN: 'Có lỗi lặp lại',
  CONFLICT: 'Dữ liệu đang mâu thuẫn'
});

const TREND_LABELS = Object.freeze({
  IMPROVING: 'Điểm đúng đang tăng',
  WORSENING: 'Điểm đúng đang giảm',
  STABLE: 'Điểm đúng ổn định',
  DECREASING_SUPPORT: 'Đang cần ít trợ giúp hơn',
  INCREASING_SUPPORT: 'Đang cần nhiều trợ giúp hơn',
  STABLE_SUPPORT: 'Mức trợ giúp ổn định',
  MORE_INDEPENDENT_EVIDENCE: 'Bằng chứng tự làm đang tăng',
  LESS_INDEPENDENT_EVIDENCE: 'Bằng chứng tự làm đang giảm',
  STABLE_INDEPENDENT_EVIDENCE: 'Mức tự làm đang ổn định',
  INSUFFICIENT_COMPARABLE_DATA: 'Chưa đủ dữ liệu so sánh công bằng',
  MIXED: 'Xu hướng còn lẫn lộn'
});

const OUTCOME_LABELS = Object.freeze({
  IMPROVED_ON_TARGET: 'Sau lần thực hiện gần nhất, có cải thiện quan sát được ở mục tiêu đã theo dõi.',
  NO_OBSERVED_CHANGE: 'Sau lần thực hiện gần nhất, chưa thấy thay đổi rõ ở mục tiêu đã theo dõi.',
  WORSE_ON_TARGET: 'Sau lần thực hiện gần nhất, quan sát thấy kết quả kém hơn; chưa kết luận nguyên nhân.',
  INCONCLUSIVE: 'Chưa đủ dữ liệu để đánh giá kết quả của lần thực hiện gần nhất.',
  NOT_DELIVERED: 'Kế hoạch chưa được thực hiện, nên không đánh giá hiệu quả.'
});

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`MISSING_REQUIRED:${name}`);
  return value;
}

function label(map, value, fallback = 'Chưa rõ') {
  return map[value] ?? (value === UNKNOWN ? 'Chưa rõ' : fallback);
}

function rankOf(entry) {
  return Number.isFinite(entry?.priority?.rank) ? entry.priority.rank : Number.MAX_SAFE_INTEGER;
}

function conceptName(entry) {
  return entry.display_name ?? entry.displayName ?? entry.state?.concept?.concept_id ?? entry.concept_id ?? 'Khái niệm chưa đặt tên';
}

function subjectName(entry) {
  const subject = entry.state?.concept?.subject ?? entry.subject ?? UNKNOWN;
  return ({ MATH: 'Toán', VIETNAMESE: 'Tiếng Việt', ENGLISH: 'Tiếng Anh' })[subject] ?? 'Chưa rõ môn';
}

function mechanismLabel(value) {
  const labels = {
    CONCEPT_GAP: 'thiếu hiểu biết cốt lõi',
    PREREQUISITE_GAP: 'thiếu kiến thức nền',
    PROCEDURE_ERROR: 'lỗi quy trình',
    STRATEGY: 'lỗi chọn chiến lược',
    MISREAD_QUESTION: 'lỗi đọc đề',
    CALCULATION_ERROR: 'lỗi tính toán',
    LANGUAGE_CONFUSION: 'nhầm ngôn ngữ/diễn đạt',
    CARELESS_ERROR: 'lỗi bất cẩn',
    TIME: 'vấn đề về thời gian'
  };
  return labels[value] ?? 'một kiểu lỗi chưa xác định rõ';
}

function parentWhy(entry) {
  const diagnosis = entry.diagnosis ?? {};
  const priority = entry.priority ?? {};
  const decision = entry.decision ?? {};

  if (diagnosis.status === 'CONFLICT') return 'Các nguồn dữ liệu đang mâu thuẫn; cần làm rõ trước khi kết luận.';
  if (diagnosis.status === 'QUALITY_DISPUTE') return 'Chất lượng câu hỏi hoặc chấm điểm chưa đủ chắc để kết luận về con.';
  if (diagnosis.status === 'AMBIGUOUS_MECHANISMS') return 'Có nhiều nguyên nhân hợp lý; cần một câu kiểm tra phân biệt trước khi can thiệp mạnh.';
  if (diagnosis.status === 'REPEATED_PATTERN') return `Đã lặp lại ${mechanismLabel(diagnosis.hypothesis)} ở nhiều buổi.`;
  if (diagnosis.status === 'SIGNAL') return 'Mới có một dấu hiệu; nên kiểm tra lại độc lập trước khi tăng can thiệp.';
  if (priority.flags?.prerequisite_blocker) return 'Đây là kiến thức nền đang chặn phần học tiếp theo.';
  if (priority.flags?.retention_due) return 'Đã đến lúc kiểm tra lại sau một khoảng cách.';
  if (priority.flags?.verification_due) return 'Cần thêm một lần kiểm tra độc lập để xác nhận trạng thái.';
  if (decision.need_action === 'ADVANCE') return 'Bằng chứng hiện tại đủ tốt trong phạm vi đã kiểm tra và phạm vi nâng mức đã được cho phép.';
  if (decision.need_action === 'MAINTAIN') return 'Trạng thái hiện tại tương đối ổn; chỉ cần duy trì nhẹ.';
  return 'Chưa có đủ bằng chứng để đưa ra kết luận mạnh hơn.';
}

function statusTone(state, diagnosis) {
  if (diagnosis?.status === 'CONFLICT' || state?.concern?.status === 'CONFLICT') return 'danger';
  if (diagnosis?.status === 'QUALITY_DISPUTE' || diagnosis?.status === 'AMBIGUOUS_MECHANISMS') return 'warning';
  if (state?.concern?.status === 'REPEATED_PATTERN') return 'danger';
  if (state?.concern?.status === 'SIGNAL') return 'warning';
  if (state?.demonstration?.status === 'INDEPENDENT_CONFIRMED') return 'good';
  if (state?.demonstration?.status === 'INDEPENDENT_OBSERVED') return 'info';
  return 'muted';
}

function primaryStatus(entry) {
  const concern = entry.state?.concern?.status;
  if (concern && concern !== 'NONE_OBSERVED') return label(CONCERN_LABELS, concern);
  return label(DEMO_LABELS, entry.state?.demonstration?.status ?? UNKNOWN);
}

function trendChips(trend) {
  if (!trend?.axes) return [];
  return ['correctness', 'support', 'independence']
    .map((axis) => trend.axes?.[axis]?.status)
    .filter(Boolean)
    .map((status) => label(TREND_LABELS, status));
}

function outcomeText(outcome) {
  if (!outcome) return null;
  return OUTCOME_LABELS[outcome.status] ?? 'Kết quả gần nhất chưa thể diễn giải chắc chắn.';
}

function todayItem(entry) {
  const decision = entry.decision;
  if (!decision) return null;
  const paused = decision.scheduled_action === 'PAUSE';
  return {
    concept: conceptName(entry),
    subject: subjectName(entry),
    rank: rankOf(entry),
    scheduled_action: decision.scheduled_action,
    scheduled_label: label(ACTION_LABELS, decision.scheduled_action),
    need_action: decision.need_action,
    need_label: label(ACTION_LABELS, decision.need_action),
    paused,
    dose_text: paused ? '0 phút hôm nay' : `${decision.dose?.minutes ?? '?'} phút · ${label(CAPACITY_LABELS, decision.dose?.class)}`,
    why: parentWhy(entry),
    note: paused && decision.need_action !== 'PAUSE'
      ? `Nhu cầu vẫn là “${label(ACTION_LABELS, decision.need_action)}”; chỉ tạm hoãn vì tải hôm nay.`
      : null
  };
}

function progressCard(entry) {
  const state = required(entry.state, 'concept.state');
  const diagnosis = entry.diagnosis ?? {};
  const evidenceCount = state.decision_basis?.evidence_ids?.length ?? 0;
  return {
    concept: conceptName(entry),
    subject: subjectName(entry),
    rank: rankOf(entry),
    tone: statusTone(state, diagnosis),
    headline: primaryStatus(entry),
    dimensions: {
      tu_lam: label(DEMO_LABELS, state.demonstration?.status ?? UNKNOWN),
      van_dung: label(TRANSFER_LABELS, state.transfer?.status ?? UNKNOWN),
      nho_lai: label(RETENTION_LABELS, state.retention?.status ?? UNKNOWN),
      can_luu_y: label(CONCERN_LABELS, state.concern?.status ?? UNKNOWN)
    },
    trends: trendChips(entry.trend),
    evidence_text: `${evidenceCount} bằng chứng đã được xét`,
    why: parentWhy(entry),
    uncertainty: diagnosis.status === 'CONFLICT'
      ? 'CONFLICT — dữ liệu mâu thuẫn, chưa chọn bên thắng.'
      : diagnosis.status === 'QUALITY_DISPUTE'
        ? 'UNKNOWN — chất lượng evidence chưa đủ chắc.'
        : diagnosis.status === 'AMBIGUOUS_MECHANISMS'
          ? 'UNKNOWN — còn nhiều nguyên nhân hợp lý.'
          : null
  };
}

function weeklyItem(entry) {
  const decision = entry.decision;
  if (!decision) return null;
  return {
    concept: conceptName(entry),
    subject: subjectName(entry),
    rank: rankOf(entry),
    need_action: decision.need_action,
    need_label: label(ACTION_LABELS, decision.need_action),
    scheduled_action: decision.scheduled_action,
    scheduled_label: label(ACTION_LABELS, decision.scheduled_action),
    why: parentWhy(entry),
    outcome: outcomeText(entry.outcome),
    paused_today: decision.scheduled_action === 'PAUSE' && decision.need_action !== 'PAUSE'
  };
}

export function buildParentViewModel(input) {
  const asOf = required(input.asOf, 'asOf');
  const workload = required(input.workload, 'workload');
  const concepts = [...(input.concepts ?? [])].sort((a, b) => rankOf(a) - rankOf(b) || conceptName(a).localeCompare(conceptName(b), 'vi'));

  const today = concepts.map(todayItem).filter(Boolean).slice(0, 3);
  const progress = concepts.map(progressCard);
  const weeklyItems = concepts.map(weeklyItem).filter(Boolean);
  const groups = Object.fromEntries(['LAM_RO','HOC_LAI','SUA_KY_NANG','KIEM_TRA_LAI','DUY_TRI','NANG_MUC','TAM_HOAN_HOM_NAY'].map((key) => [key, []]));

  for (const item of weeklyItems) {
    const bucket = ACTION_BUCKETS[item.need_action];
    if (bucket) groups[bucket].push(item);
    if (item.paused_today) groups.TAM_HOAN_HOM_NAY.push(item);
  }

  return {
    contract_version: 'PARENT_VIEW/1.0',
    as_of: asOf,
    surface_order: ['HOM_NAY', 'TIEN_DO', 'CHIEN_LUOC_TUAN'],
    surfaces: {
      HOM_NAY: {
        title: 'Hôm nay',
        capacity: {
          band: workload.capacity_band,
          label: label(CAPACITY_LABELS, workload.capacity_band),
          remaining_minutes: workload.remaining_minutes ?? 0,
          summary: `${label(CAPACITY_LABELS, workload.capacity_band)} · còn ${workload.remaining_minutes ?? 0} phút bổ trợ`,
          why: workload.why?.[0] ?? 'Chưa có ghi chú tải học.'
        },
        items: today,
        empty_text: today.length ? null : 'Hôm nay chưa có việc bổ trợ cần hiển thị.'
      },
      TIEN_DO: {
        title: 'Tiến độ',
        items: progress,
        note: 'Trạng thái được tách theo tự làm, vận dụng, nhớ lại và điều cần lưu ý — không dùng một điểm phần trăm năng lực tổng.'
      },
      CHIEN_LUOC_TUAN: {
        title: 'Chiến lược tuần',
        groups,
        note: 'Mọi thay đổi đều giữ WHY và phân biệt nhu cầu học tập với việc có thực hiện hôm nay hay không.'
      }
    }
  };
}

export const ParentViewLabels = Object.freeze({ ACTION_LABELS, CAPACITY_LABELS, DEMO_LABELS, TRANSFER_LABELS, RETENTION_LABELS, CONCERN_LABELS });

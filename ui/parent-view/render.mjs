const GROUP_LABELS = Object.freeze({
  LAM_RO: 'Làm rõ trước',
  HOC_LAI: 'Học lại cốt lõi',
  SUA_KY_NANG: 'Sửa kỹ năng',
  KIEM_TRA_LAI: 'Kiểm tra lại',
  DUY_TRI: 'Duy trì',
  NANG_MUC: 'Nâng mức',
  TAM_HOAN_HOM_NAY: 'Tạm hoãn hôm nay'
});

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function todayCards(surface) {
  if (!surface.items.length) return `<div class="empty">${esc(surface.empty_text)}</div>`;
  return surface.items.map((item) => `
    <article class="card action-card ${item.paused ? 'is-paused' : ''}">
      <div class="card-topline"><span class="subject">${esc(item.subject)}</span><span class="dose">${esc(item.dose_text)}</span></div>
      <h3>${esc(item.concept)}</h3>
      <div class="action-line">${esc(item.scheduled_label)}</div>
      ${item.paused ? `<div class="need-line">Nhu cầu thật: <strong>${esc(item.need_label)}</strong></div>` : ''}
      <p class="why">${esc(item.why)}</p>
      ${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}
    </article>`).join('');
}

function progressCards(surface) {
  return surface.items.map((item) => `
    <article class="card progress-card tone-${esc(item.tone)}">
      <div class="card-topline"><span class="subject">${esc(item.subject)}</span><span class="evidence">${esc(item.evidence_text)}</span></div>
      <h3>${esc(item.concept)}</h3>
      <div class="headline">${esc(item.headline)}</div>
      ${item.uncertainty ? `<div class="uncertainty">${esc(item.uncertainty)}</div>` : ''}
      <div class="dimension-grid">
        <div><span>Tự làm</span><strong>${esc(item.dimensions.tu_lam)}</strong></div>
        <div><span>Vận dụng</span><strong>${esc(item.dimensions.van_dung)}</strong></div>
        <div><span>Nhớ lại</span><strong>${esc(item.dimensions.nho_lai)}</strong></div>
        <div><span>Cần lưu ý</span><strong>${esc(item.dimensions.can_luu_y)}</strong></div>
      </div>
      ${item.trends.length ? `<div class="chips">${item.trends.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <p class="why">${esc(item.why)}</p>
    </article>`).join('');
}

function weeklyGroups(surface) {
  return Object.entries(surface.groups)
    .filter(([, items]) => items.length)
    .map(([key, items]) => `
      <section class="strategy-group">
        <h3>${esc(GROUP_LABELS[key] ?? key)}</h3>
        <div class="strategy-list">
          ${items.map((item) => `
            <article class="strategy-item">
              <div><span class="subject">${esc(item.subject)}</span><strong>${esc(item.concept)}</strong></div>
              <div class="strategy-action">${esc(item.need_label)}${item.paused_today ? ` <span class="pause-badge">· ${esc(item.scheduled_label)}</span>` : ''}</div>
              <p>${esc(item.why)}</p>
              ${item.outcome ? `<p class="outcome">${esc(item.outcome)}</p>` : ''}
            </article>`).join('')}
        </div>
      </section>`).join('') || '<div class="empty">Chưa có thay đổi chiến lược cần hiển thị.</div>';
}

export function renderParentViewHtml(model) {
  const today = model.surfaces.HOM_NAY;
  const progress = model.surfaces.TIEN_DO;
  const weekly = model.surfaces.CHIEN_LUOC_TUAN;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NTL6 · Theo dõi học tập</title>
<style>
:root{color-scheme:light;--bg:#f5f7fb;--panel:#fff;--ink:#172033;--muted:#667085;--line:#e6eaf2;--accent:#4b62d8;--good:#197a55;--warn:#a65f00;--danger:#b33b47;--soft:#eef2ff;--shadow:0 16px 44px rgba(35,50,90,.09)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#eef1ff 0,#f7f8fc 38%,var(--bg) 72%);color:var(--ink);font:18px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.shell{width:min(1100px,calc(100% - 28px));margin:0 auto;padding:28px 0 56px}.hero{padding:12px 2px 22px}.eyebrow{font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}h1{font-size:clamp(30px,5vw,48px);line-height:1.08;margin:8px 0 8px}h2{font-size:clamp(26px,4vw,36px);margin:0}h3{font-size:21px;line-height:1.25;margin:6px 0 10px}.subtle,.surface-note{color:var(--muted);margin:0}
.nav{position:sticky;top:10px;z-index:5;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 24px;padding:7px;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.nav button{appearance:none;border:0;border-radius:13px;padding:13px 10px;background:transparent;color:var(--muted);font:700 15px/1.2 inherit;cursor:pointer}.nav button.active{background:var(--ink);color:#fff}
.surface{display:none}.surface.active{display:block}.surface-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 2px 18px}.surface-head p{max-width:650px}.capacity{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;margin-bottom:16px;border-radius:22px;background:linear-gradient(135deg,#1c2642,#354999);color:#fff;box-shadow:var(--shadow)}.capacity strong{display:block;font-size:25px}.capacity p{margin:2px 0 0;color:#dce2ff}.minutes{font-size:34px;font-weight:800;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:22px;padding:20px;box-shadow:0 8px 28px rgba(35,50,90,.06)}.card-topline{display:flex;justify-content:space-between;gap:10px;align-items:center;color:var(--muted);font-size:14px}.subject{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--soft);color:#4052b8;font-size:13px;font-weight:800}.dose,.evidence{font-weight:700}.action-line,.headline{font-size:21px;font-weight:850;margin:6px 0}.need-line{padding:10px 12px;background:#fff4df;border-radius:12px;color:#744700}.why{margin:13px 0 0;color:#39445a}.note,.outcome{margin:11px 0 0;padding:10px 12px;border-left:3px solid #8b98e8;background:#f6f7ff;color:#4a5570}.is-paused{border-color:#ead5ad}.uncertainty{margin:10px 0;padding:10px 12px;border-radius:12px;background:#fff2f3;color:#8b2633;font-weight:750}
.dimension-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:16px}.dimension-grid div{padding:11px;border-radius:14px;background:#f7f8fb}.dimension-grid span{display:block;font-size:13px;color:var(--muted);margin-bottom:3px}.dimension-grid strong{font-size:15px}.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}.chips span{font-size:13px;padding:6px 9px;border-radius:999px;background:#edf7f2;color:#246448}.tone-danger{border-left:5px solid var(--danger)}.tone-warning{border-left:5px solid var(--warn)}.tone-good{border-left:5px solid var(--good)}.tone-info{border-left:5px solid var(--accent)}.tone-muted{border-left:5px solid #a7afbf}
.strategy-group{margin:0 0 18px}.strategy-group>h3{margin:0 0 9px;color:#3d4c6b}.strategy-list{display:grid;gap:10px}.strategy-item{background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px 18px}.strategy-item>div:first-child{display:flex;gap:10px;align-items:center}.strategy-action{font-weight:850;margin-top:9px}.strategy-item p{margin:8px 0 0;color:#465168}.pause-badge{color:var(--warn)}.empty{padding:34px;text-align:center;border:1px dashed #cbd2df;border-radius:20px;color:var(--muted);background:#fff}.surface-note{margin-top:14px;font-size:15px}
@media(max-width:760px){body{font-size:17px}.shell{width:min(100% - 18px,1100px);padding-top:18px}.grid{grid-template-columns:1fr}.dimension-grid{grid-template-columns:1fr}.surface-head{align-items:start;flex-direction:column}.capacity{align-items:flex-start;flex-direction:column}.nav button{font-size:13px;padding:11px 5px}.card{padding:17px}}
</style>
</head>
<body>
<main class="shell">
  <header class="hero"><div class="eyebrow">NTL6 · Learning Intelligence</div><h1>Theo dõi học tập</h1><p class="subtle">Xem nhanh điều cần làm, tiến độ thật và lý do chiến lược thay đổi.</p></header>
  <nav class="nav" aria-label="Ba màn hình phụ huynh">
    <button class="active" data-target="HOM_NAY">Hôm nay</button><button data-target="TIEN_DO">Tiến độ</button><button data-target="CHIEN_LUOC_TUAN">Chiến lược tuần</button>
  </nav>
  <section id="HOM_NAY" class="surface active"><div class="surface-head"><div><div class="eyebrow">01</div><h2>${esc(today.title)}</h2></div></div>
    <div class="capacity"><div><strong>${esc(today.capacity.label)}</strong><p>${esc(today.capacity.why)}</p></div><div class="minutes">${esc(today.capacity.remaining_minutes)} phút</div></div>
    <div class="grid">${todayCards(today)}</div>
  </section>
  <section id="TIEN_DO" class="surface"><div class="surface-head"><div><div class="eyebrow">02</div><h2>${esc(progress.title)}</h2></div><p>${esc(progress.note)}</p></div>
    <div class="grid">${progressCards(progress)}</div>
  </section>
  <section id="CHIEN_LUOC_TUAN" class="surface"><div class="surface-head"><div><div class="eyebrow">03</div><h2>${esc(weekly.title)}</h2></div><p>${esc(weekly.note)}</p></div>
    ${weeklyGroups(weekly)}
  </section>
</main>
<script>
const buttons=[...document.querySelectorAll('[data-target]')];const surfaces=[...document.querySelectorAll('.surface')];
for(const button of buttons){button.addEventListener('click',()=>{for(const b of buttons)b.classList.toggle('active',b===button);for(const s of surfaces)s.classList.toggle('active',s.id===button.dataset.target);});}
</script>
</body></html>`;
}

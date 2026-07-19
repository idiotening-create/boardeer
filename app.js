/* =========================================================
   자캐커플 갠홈 — app.js
   ========================================================= */

let widgets = [];          // Firestore에서 동기화된 위젯 목록
let editMode = sessionStorage.getItem('gh_edit') === '1';
let calendarMonthState = {}; // widgetId -> {y, m}

const dashboardEl = document.getElementById('dashboard');
const addBarEl = document.getElementById('addWidgetBar');
const lockBtn = document.getElementById('lockBtn');
const lockBadge = document.getElementById('lockBadge');
const siteNameEl = document.getElementById('siteName');
const modalRoot = document.getElementById('modalRoot');

/* ---------------- 설정 미완료 안내 ---------------- */

if (typeof FIREBASE_NOT_CONFIGURED !== 'undefined' && FIREBASE_NOT_CONFIGURED) {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#f4d9d9;color:#7a2b2b;padding:12px 20px;font-size:.85rem;text-align:center;position:sticky;top:0;z-index:999;';
  banner.innerHTML = '⚠️ 아직 firebase-config.js에 실제 Firebase 값을 넣지 않았어요. 설정가이드.md의 ①②단계를 먼저 완료해주세요. (지금은 저장이 되지 않아요)';
  document.body.prepend(banner);
}

/* ---------------- 공통 유틸 ---------------- */

function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 1800);
}

async function sha256(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function openModal(innerHtml, onMount){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeModal(); });
  modalRoot.innerHTML = '';
  modalRoot.appendChild(overlay);
  if(onMount) onMount(overlay.querySelector('.modal'));
}
function closeModal(){ modalRoot.innerHTML = ''; }

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function pressAnim(el){
  el.classList.add('pressed');
  setTimeout(()=> el.classList.remove('pressed'), 160);
}

/* ---------------- 잠금 / 편집모드 ---------------- */

function refreshLockUI(){
  document.body.classList.toggle('edit-mode', editMode);
  addBarEl.style.display = editMode ? 'flex' : 'none';
  siteNameEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  lockBadge.textContent = editMode ? '🔓 편집 가능' : '🔒 보기 전용';
  lockBadge.classList.toggle('unlocked', editMode);
  lockBtn.textContent = editMode ? '잠그기' : '잠금 해제';
}

lockBtn.addEventListener('click', async ()=>{
  if(editMode){
    editMode = false;
    sessionStorage.removeItem('gh_edit');
    refreshLockUI();
    renderAll();
    return;
  }
  let lockDoc;
  try{
    lockDoc = await db.collection('meta').doc('lock').get();
  }catch(err){
    console.error(err);
    toast('저장소 연결에 실패했어요. firebase-config.js 설정을 확인해주세요.');
    return;
  }
  if(!lockDoc.exists){
    openModal(`
      <h3>편집 비밀번호 설정</h3>
      <p style="font-size:.8rem;color:var(--ink-soft)">이 갠홈을 처음 여셨네요. 앞으로 사용할 편집 비밀번호를 정해주세요. 이 비밀번호를 아는 사람만 내용을 수정할 수 있어요.</p>
      <label>비밀번호</label>
      <input type="password" id="pwSet1">
      <label>비밀번호 확인</label>
      <input type="password" id="pwSet2">
      <div class="modal-actions">
        <button class="btn ghost" id="pwCancel">취소</button>
        <button class="btn primary" id="pwSave">설정하고 시작</button>
      </div>
    `, (m)=>{
      m.querySelector('#pwCancel').onclick = closeModal;
      m.querySelector('#pwSave').onclick = async ()=>{
        const p1 = m.querySelector('#pwSet1').value;
        const p2 = m.querySelector('#pwSet2').value;
        if(!p1 || p1.length < 4){ toast('4자 이상 입력해주세요'); return; }
        if(p1 !== p2){ toast('비밀번호가 서로 달라요'); return; }
        const hash = await sha256(p1);
        await db.collection('meta').doc('lock').set({ passwordHash: hash });
        editMode = true;
        sessionStorage.setItem('gh_edit','1');
        refreshLockUI(); renderAll(); closeModal();
        toast('편집 모드가 시작됐어요');
      };
    });
    return;
  }
  openModal(`
    <h3>편집 비밀번호 입력</h3>
    <input type="password" id="pwEnter" placeholder="비밀번호">
    <div class="modal-actions">
      <button class="btn ghost" id="pwCancel">취소</button>
      <button class="btn primary" id="pwOk">확인</button>
    </div>
  `, (m)=>{
    const input = m.querySelector('#pwEnter');
    input.focus();
    const submit = async ()=>{
      const hash = await sha256(input.value);
      if(hash === lockDoc.data().passwordHash){
        editMode = true;
        sessionStorage.setItem('gh_edit','1');
        refreshLockUI(); renderAll(); closeModal();
        toast('편집 모드로 전환됐어요');
      } else {
        toast('비밀번호가 일치하지 않아요');
      }
    };
    m.querySelector('#pwOk').onclick = submit;
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
    m.querySelector('#pwCancel').onclick = closeModal;
  });
});

siteNameEl.addEventListener('blur', ()=>{
  if(!editMode) return;
  db.collection('meta').doc('site').set({ name: siteNameEl.textContent.trim() }, {merge:true});
});

db.collection('meta').doc('site').onSnapshot(doc=>{
  if(doc.exists && doc.data().name){ siteNameEl.textContent = doc.data().name; }
});

/* ---------------- Firestore 동기화 ---------------- */

db.collection('widgets').orderBy('order').onSnapshot(snap=>{
  widgets = snap.docs.map(d=> ({ id: d.id, ...d.data() }));
  renderAll();
}, err=>{
  console.error(err);
  toast('데이터를 불러오지 못했어요. Firebase 설정/규칙을 확인해주세요.');
});

async function addWidget(type){
  const defaults = {
    banner:     { title:'배너', span:12, data:{ subtitle:'여기에 부제목을 적어주세요' } },
    dday:       { title:'디데이', span:4, data:{ items:[] } },
    calendar:   { title:'캘린더', span:8, data:{ events:{} } },
    gallery:    { title:'갤러리', span:6, data:{ images:[] } },
    embed:      { title:'외부 링크', span:6, data:{ url:'' } },
    backup:     { title:'외부자료 백업', span:6, data:{ cards:[] } },
    music:      { title:'음악 플레이어', span:4, data:{ tracks:[] } },
    story:      { title:'썰', span:6, data:{ entries:[] } },
    commission: { title:'커미션', span:6, data:{ items:[] } },
  };
  const base = defaults[type];
  if(!base) return;
  await db.collection('widgets').add({
    type, title: base.title, span: base.span,
    order: Date.now(),
    bg: { color:'', text:'', image:'' },
    data: base.data
  });
  toast('위젯을 추가했어요');
}

async function deleteWidget(id){
  if(!confirm('이 위젯을 삭제할까요? 되돌릴 수 없어요.')) return;
  await db.collection('widgets').doc(id).delete();
}

async function updateWidget(id, updates){
  await db.collection('widgets').doc(id).update(updates);
}

document.querySelectorAll('[data-add]').forEach(btn=>{
  btn.addEventListener('click', ()=> addWidget(btn.dataset.add));
});

/* ---------------- 위젯 설정 모달 (색/배경/크기/삭제) ---------------- */

function openSettingsModal(w){
  openModal(`
    <h3>위젯 설정</h3>
    <label>카드 배경색</label>
    <div class="color-row"><input type="color" id="setBg" value="${w.bg?.color || '#2a1417'}"><span>비워두면 기본값</span>
      <button class="btn small ghost" id="clearBg">초기화</button></div>
    <label>글자색</label>
    <div class="color-row"><input type="color" id="setText" value="${w.bg?.text || '#f3e6e2'}">
      <button class="btn small ghost" id="clearText">초기화</button></div>
    <label>배경 사진 URL (선택)</label>
    <input type="url" id="setImg" placeholder="https://..." value="${w.bg?.image || ''}">
    <label>가로 크기</label>
    <select id="setSpan">
      <option value="4" ${w.span===4?'selected':''}>좁게 (1칸)</option>
      <option value="6" ${w.span===6?'selected':''}>보통 (1.5칸)</option>
      <option value="8" ${w.span===8?'selected':''}>넓게 (2칸)</option>
      <option value="12" ${w.span===12?'selected':''}>전체 폭</option>
    </select>
    <div class="modal-actions">
      <button class="btn danger" id="delW">위젯 삭제</button>
      <button class="btn ghost" id="closeSet">취소</button>
      <button class="btn primary" id="saveSet">저장</button>
    </div>
  `, (m)=>{
    m.querySelector('#clearBg').onclick = ()=> m.querySelector('#setBg').value = '#2a1417';
    m.querySelector('#clearText').onclick = ()=> m.querySelector('#setText').value = '#f3e6e2';
    m.querySelector('#closeSet').onclick = closeModal;
    m.querySelector('#delW').onclick = ()=>{ closeModal(); deleteWidget(w.id); };
    m.querySelector('#saveSet').onclick = async ()=>{
      await updateWidget(w.id, {
        span: Number(m.querySelector('#setSpan').value),
        bg: {
          color: m.querySelector('#setBg').value,
          text: m.querySelector('#setText').value,
          image: m.querySelector('#setImg').value.trim()
        }
      });
      closeModal();
    };
  });
}

/* ---------------- 위젯 프레임 렌더 ---------------- */

function widgetFrame(w, bodyHtml){
  const hasBg = w.bg && w.bg.image;
  return `
    <div class="widget type-${w.type} ${hasBg?'has-bg':''}" data-id="${w.id}" data-span="${w.span||4}"
      style="${w.bg?.color ? `background:${w.bg.color};` : ''} ${w.bg?.text ? `color:${w.bg.text};` : ''}">
      ${hasBg ? `<div class="widget-bg" style="background-image:url('${escapeHtml(w.bg.image)}')"></div>` : ''}
      <div class="widget-header">
        <div class="widget-title" contenteditable="${editMode}" data-id="${w.id}">${escapeHtml(w.title)}</div>
        <div class="widget-tools">
          <div class="icon-btn" data-settings="${w.id}" title="설정">⚙️</div>
        </div>
      </div>
      <div class="widget-body" data-body="${w.id}">
        ${bodyHtml}
      </div>
    </div>
  `;
}

/* ---------------- 타입별 렌더러 ---------------- */

function render_banner(w){
  return `
    <div class="banner-sub" data-editfield="subtitle" data-id="${w.id}" contenteditable="${editMode}">${escapeHtml(w.data.subtitle||'')}</div>
  `;
}

function ddayDiffText(dateStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr+'T00:00:00');
  const diff = Math.round((target - today) / 86400000);
  if(diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function render_dday(w){
  const items = w.data.items || [];
  const rows = items.map((it,i)=> `
    <div class="dday-item">
      <span class="dday-label">${escapeHtml(it.label)} <small style="color:var(--ink-soft)">(${it.date})</small></span>
      <span style="display:flex;align-items:center;gap:8px;">
        <span class="dday-count">${ddayDiffText(it.date)}</span>
        ${editMode ? `<span class="icon-btn small" data-dday-del="${w.id}:${i}" style="width:20px;height:20px;font-size:.65rem;">✕</span>` : ''}
      </span>
    </div>`).join('') || `<div class="empty-hint">아직 등록된 디데이가 없어요</div>`;
  return `
    ${rows}
    ${editMode ? `<button class="btn small" data-dday-add="${w.id}" style="margin-top:8px;">+ 디데이 추가</button>` : ''}
  `;
}

function render_calendar(w){
  const st = calendarMonthState[w.id] || (calendarMonthState[w.id] = (()=>{ const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()}; })());
  const events = w.data.events || {};
  const first = new Date(st.y, st.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(st.y, st.m+1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);
  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div class="cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${st.y}-${String(st.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = events[dateStr] && events[dateStr].length;
    cells += `<div class="cal-day ${dateStr===todayStr?'today':''} ${has?'has-event':''}" data-cal-day="${w.id}:${dateStr}">${d}</div>`;
  }
  return `
    <div class="cal-head">
      <span class="icon-btn" data-cal-prev="${w.id}">‹</span>
      <strong>${st.y}. ${st.m+1}</strong>
      <span class="icon-btn" data-cal-next="${w.id}">›</span>
    </div>
    <div class="cal-grid">
      ${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
  `;
}

function render_gallery(w){
  const imgs = w.data.images || [];
  return `
    <div class="gallery-grid">
      ${imgs.map((url,i)=> `<img src="${escapeHtml(url)}" data-gal-view="${w.id}:${i}">`).join('')}
      ${editMode ? `<div class="gallery-add" data-gal-add="${w.id}">＋</div>` : ''}
    </div>
    ${imgs.length===0 && !editMode ? `<div class="empty-hint">아직 사진이 없어요</div>` : ''}
  `;
}

function render_embed(w){
  const url = w.data.url;
  return `
    ${editMode ? `<button class="btn small" data-embed-edit="${w.id}">🔗 링크 ${url?'변경':'추가'}</button>` : ''}
    ${url ? `
      <div class="embed-frame-wrap">
        <iframe src="${escapeHtml(url)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
      </div>
      <div class="embed-fallback">화면이 안 보이면 사이트에서 임베드를 막아둔 거예요 · <a href="${escapeHtml(url)}" target="_blank" rel="noopener">새 창에서 열기 ↗</a></div>
    ` : `<div class="empty-hint">등록된 링크가 없어요</div>`}
  `;
}

function render_backup(w){
  const cards = w.data.cards || [];
  return `
    <div class="backup-cards">
      ${cards.map((c,i)=> `
        <div class="backup-card">
          <div class="bc-icon">${escapeHtml(c.icon||'📎')}</div>
          <div class="bc-main">
            <div class="bc-title">${escapeHtml(c.title)}</div>
            <div class="bc-desc">${escapeHtml(c.desc||'')}</div>
          </div>
          ${c.link ? `<a class="bc-link" href="${escapeHtml(c.link)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}
          ${editMode ? `<span class="icon-btn" data-bu-del="${w.id}:${i}" style="width:22px;height:22px;">✕</span>` : ''}
        </div>
      `).join('') || `<div class="empty-hint">등록된 자료가 없어요</div>`}
    </div>
    ${editMode ? `<button class="btn small" data-bu-add="${w.id}" style="margin-top:4px;">+ 카드 추가</button>` : ''}
  `;
}

function render_music(w){
  const tracks = w.data.tracks || [];
  return `
    <div class="player-tracks">
      ${tracks.map((t,i)=> `
        <div class="player-track" data-track="${w.id}:${i}">
          ♪ <span style="flex:1;">${escapeHtml(t.title)}</span>
          ${editMode ? `<span class="icon-btn" data-mu-del="${w.id}:${i}" style="width:20px;height:20px;font-size:.65rem;">✕</span>` : ''}
        </div>
      `).join('') || `<div class="empty-hint">등록된 곡이 없어요</div>`}
    </div>
    <audio data-player="${w.id}" style="width:100%;margin-top:6px;" controls></audio>
    ${editMode ? `<button class="btn small" data-mu-add="${w.id}" style="margin-top:6px;">+ 곡 추가</button>` : ''}
  `;
}

function render_story(w){
  const entries = (w.data.entries || []).slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  return `
    ${editMode ? `<button class="btn small" data-story-add="${w.id}">+ 새 글</button>` : ''}
    ${entries.map((e)=> {
      const idx = w.data.entries.indexOf(e);
      return `
      <div class="story-entry">
        <h4>${escapeHtml(e.title)}</h4>
        <div class="meta">${escapeHtml(e.date||'')}</div>
        <div class="content">${escapeHtml(e.content)}</div>
        ${editMode ? `<div style="text-align:right;margin-top:6px;"><span class="icon-btn" data-story-del="${w.id}:${idx}" style="width:22px;height:22px;">✕</span></div>` : ''}
      </div>`;
    }).join('') || `<div class="empty-hint">아직 작성된 썰이 없어요</div>`}
  `;
}

function render_commission(w){
  const items = w.data.items || [];
  return `
    ${editMode ? `<button class="btn small" data-comm-add="${w.id}">+ 커미션 추가</button>` : ''}
    ${items.map((c,i)=> `
      <div class="commission-card">
        ${c.image ? `<img src="${escapeHtml(c.image)}">` : ''}
        <h4>${escapeHtml(c.artist)}</h4>
        <div class="meta">${escapeHtml(c.status||'')} ${c.price?(' · '+escapeHtml(c.price)):''}</div>
        ${c.link ? `<a class="bc-link" href="${escapeHtml(c.link)}" target="_blank" rel="noopener">링크 ↗</a>` : ''}
        ${editMode ? `<div style="text-align:right;"><span class="icon-btn" data-comm-del="${w.id}:${i}" style="width:22px;height:22px;">✕</span></div>` : ''}
      </div>
    `).join('') || `<div class="empty-hint">등록된 커미션이 없어요</div>`}
  `;
}

const renderers = {
  banner: render_banner, dday: render_dday, calendar: render_calendar,
  gallery: render_gallery, embed: render_embed, backup: render_backup,
  music: render_music, story: render_story, commission: render_commission
};

/* ---------------- 전체 렌더 + 이벤트 위임 ---------------- */

function renderAll(){
  refreshLockUI();
  dashboardEl.innerHTML = widgets.map(w=>{
    const r = renderers[w.type];
    return widgetFrame(w, r ? r(w) : '<div class="empty-hint">알 수 없는 위젯</div>');
  }).join('');
  bindEvents();
  document.querySelectorAll('.dashboard img').forEach(img=>{
    if(!img.complete) img.addEventListener('load', applyMasonry, {once:true});
  });
  requestAnimationFrame(applyMasonry);
  setTimeout(applyMasonry, 200); // 이미지 로딩 등으로 높이가 늦게 확정되는 경우 대비
}

const MASONRY_ROW = 8;   // CSS grid-auto-rows 값과 일치해야 함
const MASONRY_GAP = 20;  // CSS gap 값과 일치해야 함

function applyMasonry(){
  document.querySelectorAll('.widget').forEach(el=>{
    const h = el.offsetHeight;
    const span = Math.ceil((h + MASONRY_GAP) / (MASONRY_ROW + MASONRY_GAP));
    el.style.gridRowEnd = `span ${span}`;
  });
}
window.addEventListener('resize', ()=> applyMasonry());

function bindEvents(){
  // 클릭 애니메이션
  document.querySelectorAll('.widget').forEach(el=>{
    el.addEventListener('click', ()=> pressAnim(el));
  });

  // 제목 편집
  document.querySelectorAll('.widget-title[contenteditable="true"]').forEach(el=>{
    el.addEventListener('blur', ()=> updateWidget(el.dataset.id, { title: el.textContent.trim() || '제목 없음' }));
  });

  // 설정 버튼
  document.querySelectorAll('[data-settings]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.stopPropagation(); openSettingsModal(widgets.find(w=>w.id===el.dataset.settings)); });
  });

  // 배너 부제목 편집
  document.querySelectorAll('[data-editfield="subtitle"]').forEach(el=>{
    el.addEventListener('blur', ()=> updateWidget(el.dataset.id, { 'data.subtitle': el.textContent.trim() }));
  });

  bindDday(); bindCalendar(); bindGallery(); bindEmbed();
  bindBackup(); bindMusic(); bindStory(); bindCommission();
}

function widgetById(id){ return widgets.find(w=>w.id===id); }

/* ----- 디데이 ----- */
function bindDday(){
  document.querySelectorAll('[data-dday-add]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = el.dataset.ddayAdd;
      openModal(`
        <h3>디데이 추가</h3>
        <label>이름</label><input type="text" id="dLabel" placeholder="예: 처음 만난 날">
        <label>날짜</label><input type="date" id="dDate">
        <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
      `, m=>{
        m.querySelector('#c').onclick = closeModal;
        m.querySelector('#s').onclick = async ()=>{
          const label = m.querySelector('#dLabel').value.trim();
          const date = m.querySelector('#dDate').value;
          if(!label || !date){ toast('이름과 날짜를 입력해주세요'); return; }
          const w = widgetById(id);
          const items = [...(w.data.items||[]), {label, date}];
          await updateWidget(id, {'data.items': items});
          closeModal();
        };
      });
    });
  });
  document.querySelectorAll('[data-dday-del]').forEach(el=>{
    el.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const [id, idx] = el.dataset.ddayDel.split(':');
      const w = widgetById(id);
      const items = [...w.data.items]; items.splice(Number(idx),1);
      await updateWidget(id, {'data.items': items});
    });
  });
}

/* ----- 캘린더 ----- */
function bindCalendar(){
  document.querySelectorAll('[data-cal-prev]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.calPrev; const st = calendarMonthState[id];
    st.m--; if(st.m<0){st.m=11; st.y--;} renderAll();
  }));
  document.querySelectorAll('[data-cal-next]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.calNext; const st = calendarMonthState[id];
    st.m++; if(st.m>11){st.m=0; st.y++;} renderAll();
  }));
  document.querySelectorAll('[data-cal-day]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const [id, dateStr] = el.dataset.calDay.split(':');
    const w = widgetById(id);
    const events = w.data.events || {};
    const current = (events[dateStr]||[]).join('\n');
    if(!editMode){
      if(!current){ toast('이 날은 등록된 일정이 없어요'); return; }
      openModal(`<h3>${dateStr}</h3><div style="white-space:pre-wrap;font-size:.88rem;">${escapeHtml(current)}</div>
        <div class="modal-actions"><button class="btn ghost" id="c">닫기</button></div>`,
        m=> m.querySelector('#c').onclick = closeModal);
      return;
    }
    openModal(`
      <h3>${dateStr} 일정</h3>
      <label>내용 (줄바꿈으로 여러 개 가능)</label>
      <textarea id="evText">${escapeHtml(current)}</textarea>
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const text = m.querySelector('#evText').value.trim();
        const newEvents = {...events};
        if(text) newEvents[dateStr] = text.split('\n').filter(Boolean); else delete newEvents[dateStr];
        await updateWidget(id, {'data.events': newEvents});
        closeModal();
      };
    });
  }));
}

/* ----- 갤러리 ----- */
function bindGallery(){
  document.querySelectorAll('[data-gal-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.galAdd;
    openModal(`
      <h3>사진 추가</h3>
      <label>이미지 URL</label><input type="url" id="imgUrl" placeholder="https://...">
      <p style="font-size:.75rem;color:var(--ink-soft)">imgbb.com, imgur.com 등 무료 이미지 호스팅 사이트에 먼저 올린 뒤, 그 "직접 링크" 주소를 붙여넣어주세요.</p>
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const url = m.querySelector('#imgUrl').value.trim();
        if(!url){ toast('URL을 입력해주세요'); return; }
        const w = widgetById(id);
        await updateWidget(id, {'data.images': [...(w.data.images||[]), url]});
        closeModal();
      };
    });
  }));
  document.querySelectorAll('[data-gal-view]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.galView.split(':');
    const w = widgetById(id);
    const url = w.data.images[idx];
    openModal(`
      <img src="${escapeHtml(url)}" style="width:100%;border-radius:10px;">
      <div class="modal-actions">
        ${editMode ? `<button class="btn danger" id="del">삭제</button>` : ''}
        <button class="btn ghost" id="c">닫기</button>
      </div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      if(editMode) m.querySelector('#del').onclick = async ()=>{
        const imgs = [...w.data.images]; imgs.splice(Number(idx),1);
        await updateWidget(id, {'data.images': imgs});
        closeModal();
      };
    });
  }));
}

/* ----- 외부 링크 임베드 ----- */
function bindEmbed(){
  document.querySelectorAll('[data-embed-edit]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.embedEdit;
    const w = widgetById(id);
    openModal(`
      <h3>임베드 링크</h3>
      <input type="url" id="eUrl" placeholder="https://..." value="${w.data.url||''}">
      <p style="font-size:.75rem;color:var(--ink-soft)">일부 사이트는 보안 정책상 외부 화면 삽입을 막아둬서, 그런 경우엔 링크로 열기만 가능해요.</p>
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        await updateWidget(id, {'data.url': m.querySelector('#eUrl').value.trim()});
        closeModal();
      };
    });
  }));
}

/* ----- 백업 카드함 ----- */
function bindBackup(){
  document.querySelectorAll('[data-bu-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.buAdd;
    openModal(`
      <h3>백업 카드 추가</h3>
      <label>아이콘(이모지)</label><input type="text" id="bIcon" placeholder="📎" maxlength="2">
      <label>제목</label><input type="text" id="bTitle">
      <label>설명</label><input type="text" id="bDesc">
      <label>링크 (구글드라이브 등 자료 주소)</label><input type="url" id="bLink">
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const title = m.querySelector('#bTitle').value.trim();
        if(!title){ toast('제목을 입력해주세요'); return; }
        const w = widgetById(id);
        const cards = [...(w.data.cards||[]), {
          icon: m.querySelector('#bIcon').value.trim() || '📎',
          title, desc: m.querySelector('#bDesc').value.trim(),
          link: m.querySelector('#bLink').value.trim()
        }];
        await updateWidget(id, {'data.cards': cards});
        closeModal();
      };
    });
  }));
  document.querySelectorAll('[data-bu-del]').forEach(el=> el.addEventListener('click', async e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.buDel.split(':');
    const w = widgetById(id);
    const cards = [...w.data.cards]; cards.splice(Number(idx),1);
    await updateWidget(id, {'data.cards': cards});
  }));
}

/* ----- 음악 플레이어 ----- */
function bindMusic(){
  document.querySelectorAll('[data-mu-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.muAdd;
    openModal(`
      <h3>곡 추가</h3>
      <label>곡 제목</label><input type="text" id="mTitle">
      <label>오디오 파일 URL (mp3 등 직접재생 가능한 주소)</label><input type="url" id="mUrl">
      <p style="font-size:.75rem;color:var(--ink-soft)">구글 드라이브 공유링크(다운로드 직링크로 변환), Dropbox 등에 올린 뒤 주소를 붙여넣어주세요.</p>
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const title = m.querySelector('#mTitle').value.trim();
        const url = m.querySelector('#mUrl').value.trim();
        if(!title || !url){ toast('제목과 주소를 입력해주세요'); return; }
        const w = widgetById(id);
        await updateWidget(id, {'data.tracks': [...(w.data.tracks||[]), {title, url}]});
        closeModal();
      };
    });
  }));
  document.querySelectorAll('[data-mu-del]').forEach(el=> el.addEventListener('click', async e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.muDel.split(':');
    const w = widgetById(id);
    const tracks = [...w.data.tracks]; tracks.splice(Number(idx),1);
    await updateWidget(id, {'data.tracks': tracks});
  }));
  document.querySelectorAll('[data-track]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.track.split(':');
    const w = widgetById(id);
    const t = w.data.tracks[idx];
    const player = document.querySelector(`[data-player="${id}"]`);
    player.src = t.url;
    player.play().catch(()=>{});
    document.querySelectorAll(`[data-track^="${id}:"]`).forEach(x=> x.classList.remove('active'));
    el.classList.add('active');
  }));
}

/* ----- 썰 ----- */
function bindStory(){
  document.querySelectorAll('[data-story-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.storyAdd;
    openModal(`
      <h3>새 글 작성</h3>
      <label>제목</label><input type="text" id="sTitle">
      <label>날짜</label><input type="date" id="sDate">
      <label>내용</label><textarea id="sContent" style="min-height:140px;"></textarea>
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">등록</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const title = m.querySelector('#sTitle').value.trim();
        const content = m.querySelector('#sContent').value.trim();
        if(!title || !content){ toast('제목과 내용을 입력해주세요'); return; }
        const w = widgetById(id);
        const entries = [...(w.data.entries||[]), {title, date: m.querySelector('#sDate').value, content}];
        await updateWidget(id, {'data.entries': entries});
        closeModal();
      };
    });
  }));
  document.querySelectorAll('[data-story-del]').forEach(el=> el.addEventListener('click', async e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.storyDel.split(':');
    const w = widgetById(id);
    const entries = [...w.data.entries]; entries.splice(Number(idx),1);
    await updateWidget(id, {'data.entries': entries});
  }));
}

/* ----- 커미션 ----- */
function bindCommission(){
  document.querySelectorAll('[data-comm-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.commAdd;
    openModal(`
      <h3>커미션 추가</h3>
      <label>작가/작업자</label><input type="text" id="cArtist">
      <div class="row">
        <div><label>진행 상태</label>
          <select id="cStatus"><option>대기</option><option>진행중</option><option>완료</option></select>
        </div>
        <div><label>금액 (선택)</label><input type="text" id="cPrice"></div>
      </div>
      <label>이미지 URL (선택)</label><input type="url" id="cImage">
      <label>링크 (선택)</label><input type="url" id="cLink">
      <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
    `, m=>{
      m.querySelector('#c').onclick = closeModal;
      m.querySelector('#s').onclick = async ()=>{
        const artist = m.querySelector('#cArtist').value.trim();
        if(!artist){ toast('작가명을 입력해주세요'); return; }
        const w = widgetById(id);
        const items = [...(w.data.items||[]), {
          artist, status: m.querySelector('#cStatus').value,
          price: m.querySelector('#cPrice').value.trim(),
          image: m.querySelector('#cImage').value.trim(),
          link: m.querySelector('#cLink').value.trim()
        }];
        await updateWidget(id, {'data.items': items});
        closeModal();
      };
    });
  }));
  document.querySelectorAll('[data-comm-del]').forEach(el=> el.addEventListener('click', async e=>{
    e.stopPropagation();
    const [id, idx] = el.dataset.commDel.split(':');
    const w = widgetById(id);
    const items = [...w.data.items]; items.splice(Number(idx),1);
    await updateWidget(id, {'data.items': items});
  }));
}

refreshLockUI();

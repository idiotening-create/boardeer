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
const siteBannerEl = document.getElementById('siteBanner');
const bannerSubEl = document.getElementById('bannerSub');
const bannerEditBtn = document.getElementById('bannerEditBtn');
const globalStyleBtn = document.getElementById('globalStyleBtn');

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

function extractYouTubeId(url){
  if(!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* 사진을 화면에서 바로 올릴 수 있도록 브라우저에서 리사이즈+압축 후 base64로 변환.
   Firestore 문서 1건당 최대 1MB라서, 별도 유료 스토리지 없이 쓰려면 이렇게 줄여서 저장해야 함. */
function compressImageFile(file, maxDim=1600, maxBytes=700000){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let { width, height } = img;
        if(width > height && width > maxDim){ height = Math.round(height * (maxDim/width)); width = maxDim; }
        else if(height >= width && height > maxDim){ width = Math.round(width * (maxDim/height)); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while(dataUrl.length > maxBytes * 1.37 && quality > 0.25){
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = ()=> reject(new Error('이미지를 불러오지 못했어요'));
      img.src = reader.result;
    };
    reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(file);
  });
}

/* ---------------- 잠금 / 편집모드 ---------------- */

function refreshLockUI(){
  document.body.classList.toggle('edit-mode', editMode);
  addBarEl.style.display = editMode ? 'flex' : 'none';
  siteNameEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  bannerSubEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  bannerEditBtn.style.display = editMode ? 'inline-flex' : 'none';
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

/* ---------------- 배너 (항상 최상단 고정, 위젯 목록에는 없음) ---------------- */

bannerSubEl.addEventListener('blur', ()=>{
  if(!editMode) return;
  db.collection('meta').doc('banner').set({ subtitle: bannerSubEl.textContent.trim() }, {merge:true});
});

bannerEditBtn.addEventListener('click', async ()=>{
  const doc = await db.collection('meta').doc('banner').get();
  const cur = doc.exists ? doc.data() : {};
  const curIsUrl = cur.image && !cur.image.startsWith('data:');
  openModal(`
    <h3>배너 편집</h3>
    <label>배너 사진 올리기 (기기에서 바로 선택)</label>
    <input type="file" id="bImgFile" accept="image/*">
    <p class="hint">기기의 사진을 바로 선택하면 화면에 맞게 자동으로 압축해서 저장해요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="bImg" placeholder="https://..." value="${curIsUrl ? cur.image : ''}">
    <p class="hint">imgbb.com, postimages.org 등에 올린 "직접 링크" 주소를 붙여넣어도 돼요. 위에서 사진을 선택하면 이 URL 입력은 무시돼요.</p>
    <label>부제목</label>
    <input type="text" id="bSub" value="${escapeHtml(cur.subtitle||'')}">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">저장</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const file = m.querySelector('#bImgFile').files[0];
      let image = m.querySelector('#bImg').value.trim();
      if(file){
        saveBtn.disabled = true;
        saveBtn.textContent = '사진 처리 중…';
        try{
          image = await compressImageFile(file);
        }catch(err){
          toast(err.message || '이미지를 처리하지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      } else if(!image){
        image = cur.image || '';
      }
      await db.collection('meta').doc('banner').set({
        image,
        subtitle: m.querySelector('#bSub').value.trim()
      }, {merge:true});
      closeModal();
      toast('배너를 저장했어요');
    };
  });
});

db.collection('meta').doc('banner').onSnapshot(doc=>{
  if(!doc.exists) return;
  const d = doc.data();
  if(d.image) siteBannerEl.style.backgroundImage = `url('${d.image}')`;
  if(typeof d.subtitle === 'string' && document.activeElement !== bannerSubEl){
    bannerSubEl.textContent = d.subtitle;
  }
});

/* ---------------- 전체 스타일 (모든 위젯에 일괄 적용) ---------------- */

const THEME_VARS = ['--rose','--sage','--gold','--paper','--card-bg','--card-bg2','--ink'];
const FONT_DISPLAY_OPTIONS = ['ZEN SERIF','Song Myung','Noto Serif KR','Nanum Myeongjo','Gowun Batang'];
const FONT_BODY_OPTIONS = ['ZEN SERIF','Noto Sans KR','Gowun Dodum'];
const CUSTOM_FONT_MAX_BYTES = 500000; // 폰트 파일 업로드(base64 저장) 용량 제한. 넘으면 fonts 폴더+파일명 방식을 안내함

/* 업로드한 폰트 파일(base64) 또는 fonts 폴더의 파일명으로 @font-face를 동적으로 주입 */
function injectCustomFontFace(srcDecl){
  let styleTag = document.getElementById('customFontFace');
  if(!styleTag){
    styleTag = document.createElement('style');
    styleTag.id = 'customFontFace';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = srcDecl
    ? `@font-face{ font-family:'CustomUserFont'; src:${srcDecl}; font-weight:400; font-style:normal; font-display:swap; }`
    : '';
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(file);
  });
}

function applyTheme(theme){
  if(!theme) return;
  THEME_VARS.forEach(v=>{
    const key = v.replace('--','');
    if(theme[key]) document.documentElement.style.setProperty(v, theme[key]);
  });

  // 커스텀 폰트(업로드했거나 fonts 폴더에 직접 올린 파일)가 있으면 제목/본문 폰트를 모두 그걸로 통일
  if(theme.customFontData){
    injectCustomFontFace(`url(${theme.customFontData}) format('truetype')`);
    document.documentElement.style.setProperty('--font-display', `'CustomUserFont', 'ZEN SERIF', serif`);
    document.documentElement.style.setProperty('--font-body', `'CustomUserFont', 'ZEN SERIF', sans-serif`);
  } else if(theme.customFontFile){
    injectCustomFontFace(`url('./fonts/${theme.customFontFile}') format('truetype')`);
    document.documentElement.style.setProperty('--font-display', `'CustomUserFont', 'ZEN SERIF', serif`);
    document.documentElement.style.setProperty('--font-body', `'CustomUserFont', 'ZEN SERIF', sans-serif`);
  } else {
    injectCustomFontFace(null);
    if(theme.fontDisplay) document.documentElement.style.setProperty('--font-display', `'${theme.fontDisplay}', 'Noto Serif KR', serif`);
    if(theme.fontBody) document.documentElement.style.setProperty('--font-body', `'${theme.fontBody}', sans-serif`);
  }
}

db.collection('meta').doc('theme').onSnapshot(doc=>{
  if(doc.exists) applyTheme(doc.data());
});

globalStyleBtn.addEventListener('click', async ()=>{
  if(!editMode){ toast('잠금 해제 후 편집모드에서 변경할 수 있어요'); return; }
  const cs = getComputedStyle(document.documentElement);
  const cur = {};
  THEME_VARS.forEach(v=> cur[v.replace('--','')] = cs.getPropertyValue(v).trim());
  const themeDoc = await db.collection('meta').doc('theme').get();
  const saved = themeDoc.exists ? themeDoc.data() : {};
  openModal(`
    <h3>전체 스타일</h3>
    <p style="font-size:.78rem;color:var(--ink-soft)">여기서 바꾸면 모든 위젯에 한 번에 적용돼요. 위젯별로 따로 지정해둔 색은 아래에서 초기화할 수 있어요.</p>
    <label>메인 포인트 컬러</label>
    <div class="color-row"><input type="color" id="tRose" value="${cur.rose}"></div>
    <label>보조 포인트 컬러</label>
    <div class="color-row"><input type="color" id="tSage" value="${cur.sage}"></div>
    <label>라인/코너 컬러</label>
    <div class="color-row"><input type="color" id="tGold" value="${cur.gold}"></div>
    <label>배경색</label>
    <div class="color-row"><input type="color" id="tPaper" value="${cur.paper}"></div>
    <label>카드 배경색</label>
    <div class="color-row"><input type="color" id="tCardBg" value="${cur['card-bg']}"></div>
    <label>글자색</label>
    <div class="color-row"><input type="color" id="tInk" value="${cur.ink}"></div>
    <label>제목 폰트</label>
    <select id="tFontDisplay">${FONT_DISPLAY_OPTIONS.map(f=>`<option value="${f}" ${saved.fontDisplay===f?'selected':''}>${f}</option>`).join('')}</select>
    <label>본문 폰트</label>
    <select id="tFontBody">${FONT_BODY_OPTIONS.map(f=>`<option value="${f}" ${saved.fontBody===f?'selected':''}>${f}</option>`).join('')}</select>

    <label style="margin-top:16px;">커스텀 폰트 파일로 전체 글자체 통일 (선택)</label>
    <input type="file" id="tFontUpload" accept=".ttf,.otf,font/ttf,font/otf">
    <p class="hint">폰트 파일을 올리면 위에서 고른 제목/본문 폰트 대신, 사이트 전체 글자체가 이 폰트 하나로 통일돼요. 500KB 이하 파일만 여기서 바로 올릴 수 있어요.</p>
    <label>또는, GitHub의 fonts 폴더에 직접 올린 폰트 파일명</label>
    <input type="text" id="tFontFileName" placeholder="예: ZenSerif.ttf" value="${escapeHtml(saved.customFontFile||'')}">
    <p class="hint">500KB보다 큰 폰트는 저장소의 fonts 폴더에 파일을 올린 뒤, 정확한 파일 이름만 여기에 입력해주세요.</p>
    <div style="margin-top:6px;">
      <button class="btn small ghost" id="tFontClear" type="button">커스텀 폰트 해제 (기본 ZEN SERIF로)</button>
    </div>

    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
      <input type="checkbox" id="tReset" style="width:auto;"> 위젯별로 따로 지정한 색상 전부 초기화
    </label>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">전체 적용</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#tFontClear').onclick = async ()=>{
      await db.collection('meta').doc('theme').set({ customFontData:'', customFontFile:'' }, {merge:true});
      closeModal();
      toast('커스텀 폰트를 해제했어요');
    };
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const theme = {
        rose: m.querySelector('#tRose').value,
        sage: m.querySelector('#tSage').value,
        gold: m.querySelector('#tGold').value,
        paper: m.querySelector('#tPaper').value,
        'card-bg': m.querySelector('#tCardBg').value,
        ink: m.querySelector('#tInk').value,
        fontDisplay: m.querySelector('#tFontDisplay').value,
        fontBody: m.querySelector('#tFontBody').value
      };
      const fontFile = m.querySelector('#tFontUpload').files[0];
      const fontFileName = m.querySelector('#tFontFileName').value.trim();
      if(fontFile){
        if(fontFile.size > CUSTOM_FONT_MAX_BYTES){
          toast('폰트 파일이 너무 커요(500KB 이하 권장). 대신 fonts 폴더에 올리고 파일명을 입력해주세요.');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '폰트 처리 중…';
        try{
          theme.customFontData = await fileToBase64(fontFile);
          theme.customFontFile = '';
        }catch(err){
          toast('폰트 파일을 읽지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '전체 적용';
          return;
        }
      } else if(fontFileName){
        theme.customFontFile = fontFileName;
        theme.customFontData = '';
      }
      await db.collection('meta').doc('theme').set(theme, {merge:true});
      if(m.querySelector('#tReset').checked){
        const batch = db.batch();
        widgets.forEach(w=>{
          batch.update(db.collection('widgets').doc(w.id), { bg: { color:'', text:'', image: w.bg?.image || '' } });
        });
        await batch.commit();
      }
      closeModal();
      toast('전체 스타일을 적용했어요');
    };
  });
});

/* ---------------- Firestore 동기화 ---------------- */

db.collection('widgets').orderBy('order').onSnapshot(snap=>{
  widgets = snap.docs.map(d=> ({ id: d.id, ...d.data() })).filter(w=> w.type !== 'banner' && w.type !== 'commission' && w.type !== 'backup' && w.type !== 'story');
  renderAll();
}, err=>{
  console.error(err);
  toast('데이터를 불러오지 못했어요. Firebase 설정/규칙을 확인해주세요.');
});

async function addWidget(type){
  const defaults = {
    dday:       { title:'D-Day', span:4, data:{ items:[] } },
    calendar:   { title:'Calendar', span:8, data:{ events:{} } },
    gallery:    { title:'Gallery', span:6, data:{ images:[] } },
    embed:      { title:'Embed', span:6, data:{ url:'' } },
    music:      { title:'Music', span:4, data:{ tracks:[] } },
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
  const curIsUrl = w.bg?.image && !w.bg.image.startsWith('data:');
  openModal(`
    <h3>위젯 설정</h3>
    <label>카드 배경색</label>
    <div class="color-row"><input type="color" id="setBg" value="${w.bg?.color || '#1c0e12'}"><span>비워두면 기본값</span>
      <button class="btn small ghost" id="clearBg">초기화</button></div>
    <label>글자색</label>
    <div class="color-row"><input type="color" id="setText" value="${w.bg?.text || '#e2ddE3'}">
      <button class="btn small ghost" id="clearText">초기화</button></div>
    <label>배경 사진 올리기 (기기에서 바로 선택)</label>
    <input type="file" id="setImgFile" accept="image/*">
    <p class="hint">사진을 선택하면 화면에 맞게 자동으로 압축해서 저장돼요. 이 위젯 카드 배경으로 바로 꾸며져요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="setImg" placeholder="https://..." value="${curIsUrl ? w.bg.image : ''}">
    <p class="hint">위에서 사진을 선택하면 이 URL 입력은 무시돼요.</p>
    ${w.bg?.image ? `<button class="btn small ghost" id="clearImg">배경 사진 제거</button>` : ''}
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
    let clearedImg = false;
    m.querySelector('#clearBg').onclick = ()=> m.querySelector('#setBg').value = '#1c0e12';
    m.querySelector('#clearText').onclick = ()=> m.querySelector('#setText').value = '#e2ddE3';
    m.querySelector('#closeSet').onclick = closeModal;
    m.querySelector('#delW').onclick = ()=>{ closeModal(); deleteWidget(w.id); };
    const clearImgBtn = m.querySelector('#clearImg');
    if(clearImgBtn) clearImgBtn.onclick = ()=>{
      clearedImg = true;
      m.querySelector('#setImg').value = '';
      m.querySelector('#setImgFile').value = '';
      toast('저장을 누르면 배경 사진이 제거돼요');
    };
    m.querySelector('#saveSet').onclick = async ()=>{
      const saveBtn = m.querySelector('#saveSet');
      const file = m.querySelector('#setImgFile').files[0];
      let image = m.querySelector('#setImg').value.trim();
      if(file){
        saveBtn.disabled = true;
        saveBtn.textContent = '사진 처리 중…';
        try{
          image = await compressImageFile(file);
        }catch(err){
          toast(err.message || '이미지를 처리하지 못했어요');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      } else if(!image && !clearedImg){
        image = w.bg?.image || '';
      }
      await updateWidget(w.id, {
        span: Number(m.querySelector('#setSpan').value),
        bg: {
          color: m.querySelector('#setBg').value,
          text: m.querySelector('#setText').value,
          image
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
      ${imgs.map((url,i)=> `<div class="g-item" data-gal-view="${w.id}:${i}"><img src="${escapeHtml(url)}"></div>`).join('')}
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
    <audio data-player="${w.id}" style="display:none;"></audio>
    <div class="yt-frame" data-ytframe="${w.id}" style="display:none;margin-top:6px;"></div>
    <div class="player-panel" data-panel="${w.id}" style="display:none;">
      <div class="player-now" data-now="${w.id}">&nbsp;</div>
      <input type="range" class="player-seek" data-seek="${w.id}" min="0" max="100" value="0" step="0.1">
      <div class="player-controls">
        <button data-mu-playpause="${w.id}">▶</button>
      </div>
    </div>
    ${editMode ? `<button class="btn small" data-mu-add="${w.id}" style="margin-top:6px;">+ 곡 추가</button>` : ''}
  `;
}

const renderers = {
  dday: render_dday, calendar: render_calendar,
  gallery: render_gallery, embed: render_embed,
  music: render_music
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
    const h = el.scrollHeight;
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

  bindDday(); bindCalendar(); bindGallery(); bindEmbed();
  bindMusic();
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

/* ----- 갤러리 (벤토형) ----- */
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

/* ----- 음악 플레이어 (오디오 URL 또는 유튜브 링크) ----- */
function bindMusic(){
  document.querySelectorAll('[data-mu-add]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.muAdd;
    openModal(`
      <h3>곡 추가</h3>
      <label>곡 제목</label><input type="text" id="mTitle">
      <label>오디오 파일 URL 또는 유튜브 링크</label><input type="url" id="mUrl" placeholder="mp3 직링크 또는 https://youtu.be/...">
      <p style="font-size:.75rem;color:var(--ink-soft)">유튜브 영상 링크를 그대로 붙여넣으면 화면 안에서 바로 재생돼요. 직접 mp3 파일은 구글드라이브 등에 올린 뒤 다운로드 직링크를 붙여넣어주세요.</p>
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
    const audioEl = document.querySelector(`[data-player="${id}"]`);
    const ytEl = document.querySelector(`[data-ytframe="${id}"]`);
    const panelEl = document.querySelector(`[data-panel="${id}"]`);
    const nowEl = document.querySelector(`[data-now="${id}"]`);
    const seekEl = document.querySelector(`[data-seek="${id}"]`);
    const ytId = extractYouTubeId(t.url);
    if(ytId){
      audioEl.pause(); audioEl.removeAttribute('src');
      if(panelEl) panelEl.style.display = 'none';
      ytEl.style.display = 'block';
      ytEl.innerHTML = `<iframe height="190" src="https://www.youtube.com/embed/${ytId}?autoplay=1" title="${escapeHtml(t.title)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else {
      ytEl.style.display = 'none'; ytEl.innerHTML = '';
      audioEl.src = t.url; audioEl.play().catch(()=>{});
      if(panelEl) panelEl.style.display = 'flex';
      if(nowEl) nowEl.textContent = t.title;
      if(seekEl) seekEl.value = 0;
    }
    document.querySelectorAll(`[data-track^="${id}:"]`).forEach(x=> x.classList.remove('active'));
    el.classList.add('active');
  }));

  // 재생/일시정지 버튼 — 팔레트 컬러(Night Bordeaux) 원형 버튼으로 브라우저 기본 오디오 UI를 대체
  document.querySelectorAll('[data-mu-playpause]').forEach(el=> el.addEventListener('click', e=>{
    e.stopPropagation();
    const id = el.dataset.muPlaypause;
    const audioEl = document.querySelector(`[data-player="${id}"]`);
    if(!audioEl || !audioEl.src) return;
    if(audioEl.paused) audioEl.play().catch(()=>{}); else audioEl.pause();
  }));

  // 탐색바(seek) — 팔레트 컬러로 직접 그린 슬라이더
  document.querySelectorAll('[data-seek]').forEach(el=>{
    el.addEventListener('input', e=>{
      e.stopPropagation();
      const id = el.dataset.seek;
      const audioEl = document.querySelector(`[data-player="${id}"]`);
      if(!audioEl || !audioEl.duration) return;
      audioEl.currentTime = (el.value/100) * audioEl.duration;
    });
    el.addEventListener('click', e=> e.stopPropagation());
  });

  document.querySelectorAll('[data-player]').forEach(audioEl=>{
    const id = audioEl.dataset.player;
    const seekEl = document.querySelector(`[data-seek="${id}"]`);
    const playBtn = document.querySelector(`[data-mu-playpause="${id}"]`);
    audioEl.addEventListener('timeupdate', ()=>{
      if(seekEl && audioEl.duration) seekEl.value = (audioEl.currentTime/audioEl.duration)*100;
    });
    audioEl.addEventListener('play', ()=>{ if(playBtn) playBtn.textContent = '⏸'; });
    audioEl.addEventListener('pause', ()=>{ if(playBtn) playBtn.textContent = '▶'; });
    audioEl.addEventListener('ended', ()=>{ if(playBtn) playBtn.textContent = '▶'; if(seekEl) seekEl.value = 0; });
  });
}

refreshLockUI();

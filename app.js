/* =========================================================
   노은 — app.js (전면 재제작)
   위젯을 자유롭게 추가/삭제하던 방식은 없애고, 정해진 8개 영역
   (이미지 슬라이드 · 음악 · 디데이 · 방명록 · 캘린더 · 갤러리 · 세션카드 · 체크보드)
   이 항상 같은 구성으로 보이도록 각각 고정 렌더 함수로 관리함.
   ========================================================= */

let editMode = sessionStorage.getItem('gh_edit') === '1';

const lockBtn = document.getElementById('lockBtn');
const lockBadge = document.getElementById('lockBadge');
const siteNameEl = document.getElementById('siteName');
const modalRoot = document.getElementById('modalRoot');
const siteBannerEl = document.getElementById('siteBanner');
const bannerSubEl = document.getElementById('bannerSub');
const bannerEditBtn = document.getElementById('bannerEditBtn');
const globalStyleBtn = document.getElementById('globalStyleBtn');
const ddayTitleEl = document.getElementById('ddayTitle');
const guestbookTitleEl = document.getElementById('guestbookTitle');

/* ---------------- 설정 미완료 안내 ---------------- */

if (typeof FIREBASE_NOT_CONFIGURED !== 'undefined' && FIREBASE_NOT_CONFIGURED) {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#f4d9d9;color:#7a2b2b;padding:12px 20px;font-size:.85rem;text-align:center;position:sticky;top:0;z-index:999;';
  banner.innerHTML = '⚠️ 아직 firebase-config.js에 실제 Firebase 값을 넣지 않았어요. 설정가이드.md의 ①②단계를 먼저 완료해주세요. (지금은 저장이 되지 않아요)';
  document.body.prepend(banner);
}

/* ---------------- 공통 유틸 ---------------- */

function docRef(name){ return db.collection('content').doc(name); }

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

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

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

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = ()=> reject(new Error('파일을 읽지 못했어요'));
    reader.readAsDataURL(file);
  });
}

/* ---------------- 잠금 / 편집모드 ---------------- */

function refreshLockUI(){
  document.body.classList.toggle('edit-mode', editMode);
  siteNameEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  bannerSubEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  ddayTitleEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  guestbookTitleEl.setAttribute('contenteditable', editMode ? 'true' : 'false');
  bannerEditBtn.style.display = editMode ? 'inline-flex' : 'none';
  document.getElementById('checklistAddWrap').style.display = editMode ? 'flex' : 'none';
  lockBadge.textContent = editMode ? '🔓 편집 가능' : '🔒 보기 전용';
  lockBadge.classList.toggle('unlocked', editMode);
  lockBtn.textContent = editMode ? '잠그기' : '잠금 해제';
}

function renderAllModules(){
  renderImages(); renderMusic(); renderDday(); renderGuestbook();
  renderCalendar(); renderGallery(); renderSessions(); renderChecklist();
}

lockBtn.addEventListener('click', async ()=>{
  if(editMode){
    editMode = false;
    sessionStorage.removeItem('gh_edit');
    refreshLockUI();
    renderAllModules();
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
        refreshLockUI(); renderAllModules(); closeModal();
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
        refreshLockUI(); renderAllModules(); closeModal();
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
  db.collection('meta').doc('site').set({ name: siteNameEl.textContent.trim() || '노은' }, {merge:true});
});
db.collection('meta').doc('site').onSnapshot(doc=>{
  if(doc.exists && doc.data().name && document.activeElement !== siteNameEl){ siteNameEl.textContent = doc.data().name; }
});

ddayTitleEl.addEventListener('blur', ()=>{
  if(!editMode) return;
  db.collection('meta').doc('labels').set({ dday: ddayTitleEl.textContent.trim() || 'D-Day' }, {merge:true});
});
guestbookTitleEl.addEventListener('blur', ()=>{
  if(!editMode) return;
  db.collection('meta').doc('labels').set({ guestbook: guestbookTitleEl.textContent.trim() || '방명록' }, {merge:true});
});
db.collection('meta').doc('labels').onSnapshot(doc=>{
  if(!doc.exists) return;
  const d = doc.data();
  if(d.dday && document.activeElement !== ddayTitleEl) ddayTitleEl.textContent = d.dday;
  if(d.guestbook && document.activeElement !== guestbookTitleEl) guestbookTitleEl.textContent = d.guestbook;
});

/* ---------------- 배너 (항상 최상단 고정) ---------------- */

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

/* ---------------- 테마 편집 (전체 색/폰트 일괄 적용) ---------------- */

const THEME_VARS = ['--rose','--sage','--gold','--paper','--card-bg','--card-bg2','--ink'];
const FONT_DISPLAY_OPTIONS = ['ZEN SERIF','Song Myung','Noto Serif KR','Nanum Myeongjo','Gowun Batang'];
const FONT_BODY_OPTIONS = ['ZEN SERIF','Noto Sans KR','Gowun Dodum'];
const CUSTOM_FONT_MAX_BYTES = 500000;

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

function applyTheme(theme){
  if(!theme) return;
  THEME_VARS.forEach(v=>{
    const key = v.replace('--','');
    if(theme[key]) document.documentElement.style.setProperty(v, theme[key]);
  });
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
    <h3>테마 편집</h3>
    <p style="font-size:.78rem;color:var(--ink-soft)">여기서 바꾸면 사이트 전체에 한 번에 적용돼요.</p>
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
      closeModal();
      toast('테마를 적용했어요');
    };
  });
});

/* ================================================================
   콘텐츠 모듈 8종 — 각자 독립된 Firestore 문서(collection 'content')를
   구독하고, 자기 영역만 렌더링함
   ================================================================ */

/* ---------------- 1. 이미지 위젯 (가로형 슬라이드) ---------------- */

let imagesData = { items: [] };
let imgSlideIndex = 0;
let slidePaused = false;
let slideAutoTimer = null;

function renderImages(){
  const box = document.getElementById('cardImages');
  const items = imagesData.items || [];
  if(items.length === 0){
    box.innerHTML = `
      <div class="slide-empty">아직 사진이 없어요</div>
      ${editMode ? `<button class="btn small slide-add" id="imgAddBtn">+ 사진 추가</button>` : ''}
    `;
  } else {
    if(imgSlideIndex >= items.length) imgSlideIndex = 0;
    box.innerHTML = `
      <div class="slide-viewport" id="slideViewport">
        <img src="${items[imgSlideIndex]}">
        ${editMode ? `<button class="icon-btn slide-del" id="imgDelBtn" title="이 사진 삭제">✕</button>` : ''}
        ${items.length>1 ? `<button class="slide-nav prev" id="imgPrev">‹</button><button class="slide-nav next" id="imgNext">›</button>` : ''}
      </div>
      ${items.length>1 ? `<div class="slide-dots">${items.map((_,i)=>`<span class="dot ${i===imgSlideIndex?'active':''}" data-dot="${i}"></span>`).join('')}</div>` : ''}
      ${editMode ? `<button class="btn small slide-add" id="imgAddBtn">+ 사진 추가</button>` : ''}
    `;
  }
  bindImages();
}

function bindImages(){
  const box = document.getElementById('cardImages');
  const prev = box.querySelector('#imgPrev');
  const next = box.querySelector('#imgNext');
  if(prev) prev.onclick = ()=>{ imgSlideIndex = (imgSlideIndex - 1 + imagesData.items.length) % imagesData.items.length; renderImages(); };
  if(next) next.onclick = ()=>{ imgSlideIndex = (imgSlideIndex + 1) % imagesData.items.length; renderImages(); };
  box.querySelectorAll('[data-dot]').forEach(d=> d.onclick = ()=>{ imgSlideIndex = Number(d.dataset.dot); renderImages(); });
  const del = box.querySelector('#imgDelBtn');
  if(del) del.onclick = async ()=>{
    const items = [...imagesData.items]; items.splice(imgSlideIndex,1);
    await docRef('images').set({items}, {merge:true});
  };
  const addBtn = box.querySelector('#imgAddBtn');
  if(addBtn) addBtn.onclick = openImagesAddModal;
  box.onmouseenter = ()=> slidePaused = true;
  box.onmouseleave = ()=> slidePaused = false;
}

function openImagesAddModal(){
  openModal(`
    <h3>사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="imgFiles" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 슬라이드에 바로 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="imgUrl" placeholder="https://...">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#imgFiles').files || []);
      const url = m.querySelector('#imgUrl').value.trim();
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{ newItems.push(await compressImageFile(files[i], 1400, 230000)); }
          catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push(url);
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        await docRef('images').set({ items: [...(imagesData.items||[]), ...newItems] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('images').onSnapshot(doc=>{ imagesData = doc.exists ? doc.data() : {items:[]}; renderImages(); });

slideAutoTimer = setInterval(()=>{
  if(!slidePaused && imagesData.items && imagesData.items.length > 1){
    imgSlideIndex = (imgSlideIndex + 1) % imagesData.items.length;
    renderImages();
  }
}, 5000);

/* ---------------- 2. 음악 위젯 ---------------- */

let musicData = { tracks: [] };

function renderMusic(){
  const box = document.getElementById('cardMusic');
  const tracks = musicData.tracks || [];
  box.innerHTML = `
    <div class="player-tracks">
      ${tracks.map((t,i)=>`
        <div class="player-track" data-idx="${i}">
          ♪ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)}</span>
          ${editMode ? `<button class="icon-btn" data-del="${i}" style="width:18px;height:18px;font-size:.6rem;">✕</button>` : ''}
        </div>
      `).join('') || `<div class="w-empty">등록된 곡이 없어요</div>`}
    </div>
    <audio id="musicAudio" controls style="display:none;"></audio>
    <div class="yt-frame" id="musicYt" style="display:none;"></div>
    ${editMode ? `<button class="btn small music-add" id="musicAddBtn">+ 곡 추가</button>` : ''}
  `;
  bindMusic();
}

function bindMusic(){
  const box = document.getElementById('cardMusic');
  box.querySelectorAll('[data-idx]').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if(e.target.closest('[data-del]')) return;
      const idx = Number(row.dataset.idx);
      playTrack(idx);
      box.querySelectorAll('.player-track').forEach(x=>x.classList.remove('active'));
      row.classList.add('active');
    });
  });
  box.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async e=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const tracks = [...musicData.tracks]; tracks.splice(idx,1);
    await docRef('music').set({tracks}, {merge:true});
  }));
  const addBtn = box.querySelector('#musicAddBtn');
  if(addBtn) addBtn.onclick = openMusicAddModal;
}

function playTrack(idx){
  const t = musicData.tracks[idx]; if(!t) return;
  const audioEl = document.getElementById('musicAudio');
  const ytEl = document.getElementById('musicYt');
  const ytId = extractYouTubeId(t.url);
  if(ytId){
    audioEl.pause(); audioEl.removeAttribute('src'); audioEl.style.display = 'none';
    ytEl.style.display = 'block';
    ytEl.innerHTML = `<iframe height="150" src="https://www.youtube.com/embed/${ytId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen title="${escapeHtml(t.title)}"></iframe>`;
  } else {
    ytEl.style.display = 'none'; ytEl.innerHTML = '';
    audioEl.style.display = 'block'; audioEl.src = t.url; audioEl.play().catch(()=>{});
  }
}

function openMusicAddModal(){
  openModal(`
    <h3>곡 추가</h3>
    <label>곡 제목</label><input type="text" id="mTitle">
    <label>오디오 파일 URL 또는 유튜브 링크</label><input type="url" id="mUrl" placeholder="mp3 직링크 또는 https://youtu.be/...">
    <p class="hint">유튜브 링크는 그대로 붙여넣으면 화면 안에서 바로 재생돼요. mp3는 구글드라이브 등의 직링크를 붙여넣어주세요.</p>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const title = m.querySelector('#mTitle').value.trim();
      const url = m.querySelector('#mUrl').value.trim();
      if(!title || !url){ toast('제목과 주소를 입력해주세요'); return; }
      await docRef('music').set({ tracks: [...(musicData.tracks||[]), {title, url}] }, {merge:true});
      closeModal();
    };
  });
}

docRef('music').onSnapshot(doc=>{ musicData = doc.exists ? doc.data() : {tracks:[]}; renderMusic(); });

/* ---------------- 3. 디데이 ---------------- */

let ddayData = { items: [] };

function ddayDiffText(dateStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr+'T00:00:00');
  const diff = Math.round((target - today) / 86400000);
  if(diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function renderDday(){
  const items = (ddayData.items || []).map((it,i)=>({...it, _i:i})).sort((a,b)=> a.date.localeCompare(b.date));
  const body = document.getElementById('ddayBody');
  body.innerHTML = items.map(it=> `
    <div class="dday-item">
      <span class="dday-label">${escapeHtml(it.label)}</span>
      <span style="display:flex;align-items:center;gap:6px;">
        <span class="dday-count">${ddayDiffText(it.date)}</span>
        ${editMode ? `<button class="icon-btn" data-del="${it._i}" style="width:18px;height:18px;font-size:.6rem;">✕</button>` : ''}
      </span>
    </div>
  `).join('') || `<div class="w-empty">등록된 디데이가 없어요</div>`;
  body.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async ()=>{
    const idx = Number(btn.dataset.del);
    const arr = [...ddayData.items]; arr.splice(idx,1);
    await docRef('dday').set({items:arr}, {merge:true});
  }));

  const wrap = document.getElementById('ddayAddWrap');
  wrap.innerHTML = editMode ? `<button class="btn small" id="ddayAddBtn">+ 디데이 추가</button>` : '';
  const addBtn = document.getElementById('ddayAddBtn');
  if(addBtn) addBtn.onclick = openDdayAddModal;
}

function openDdayAddModal(){
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
      await docRef('dday').set({ items: [...(ddayData.items||[]), {label, date}] }, {merge:true});
      closeModal();
    };
  });
}

docRef('dday').onSnapshot(doc=>{ ddayData = doc.exists ? doc.data() : {items:[]}; renderDday(); });

/* ---------------- 4. 방명록 (누구나 남길 수 있음, 삭제만 편집모드 전용) ---------------- */

let guestbookData = { entries: [] };

function renderGuestbook(){
  const entries = (guestbookData.entries || []).slice().sort((a,b)=> (b.ts||0) - (a.ts||0));
  const body = document.getElementById('guestbookBody');
  body.innerHTML = entries.map(e=> `
    <div class="gb-entry" data-id="${e.id}">
      ${editMode ? `<button class="gb-del">✕</button>` : ''}
      <span class="gb-name">${escapeHtml(e.name||'익명')}</span>
      <span class="gb-time">${e.ts ? new Date(e.ts).toLocaleDateString('ko-KR') : ''}</span>
      <div class="gb-msg">${escapeHtml(e.message)}</div>
    </div>
  `).join('') || `<div class="w-empty">아직 남겨진 방명록이 없어요</div>`;
  body.querySelectorAll('.gb-del').forEach(btn=> btn.addEventListener('click', async ()=>{
    const id = btn.closest('.gb-entry').dataset.id;
    const arr = (guestbookData.entries||[]).filter(x=> x.id !== id);
    await docRef('guestbook').set({entries: arr}, {merge:true});
  }));
}

docRef('guestbook').onSnapshot(doc=>{ guestbookData = doc.exists ? doc.data() : {entries:[]}; renderGuestbook(); });

// 방명록은 잠금 상태와 관계없이 누구나 남길 수 있어요 (삭제만 편집모드 전용)
document.getElementById('gbSubmit').addEventListener('click', async ()=>{
  const nameInput = document.getElementById('gbName');
  const msgInput = document.getElementById('gbMsg');
  const name = nameInput.value.trim();
  const message = msgInput.value.trim();
  if(!message){ toast('메시지를 입력해주세요'); return; }
  try{
    await docRef('guestbook').set({
      entries: [...(guestbookData.entries||[]), { id: uid(), name: name || '익명', message, ts: Date.now() }]
    }, {merge:true});
    nameInput.value = ''; msgInput.value = '';
    toast('방명록을 남겼어요');
  }catch(err){
    console.error(err);
    toast('저장하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
});

/* ---------------- 5. 캘린더 (내용만, 제목 없음) ---------------- */

let calendarData = { events: {} };
let calState = (()=>{ const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

function renderCalendar(){
  const box = document.getElementById('cardCalendar');
  const events = calendarData.events || {};
  const first = new Date(calState.y, calState.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(calState.y, calState.m+1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);
  let cells = '';
  for(let i=0;i<startDow;i++) cells += `<div class="cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${calState.y}-${String(calState.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = events[dateStr] && events[dateStr].length;
    cells += `<div class="cal-day ${dateStr===todayStr?'today':''} ${has?'has-event':''}" data-day="${dateStr}">${d}</div>`;
  }
  box.innerHTML = `
    <div class="cal-head">
      <span class="icon-btn" id="calPrev">‹</span>
      <strong>${calState.y}. ${calState.m+1}</strong>
      <span class="icon-btn" id="calNext">›</span>
    </div>
    <div class="cal-grid">
      ${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
  `;
  box.querySelector('#calPrev').onclick = ()=>{ calState.m--; if(calState.m<0){calState.m=11; calState.y--;} renderCalendar(); };
  box.querySelector('#calNext').onclick = ()=>{ calState.m++; if(calState.m>11){calState.m=0; calState.y++;} renderCalendar(); };
  box.querySelectorAll('[data-day]').forEach(el=> el.addEventListener('click', ()=> openDayModal(el.dataset.day)));
}

function openDayModal(dateStr){
  const events = calendarData.events || {};
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
      await docRef('calendar').set({events:newEvents}, {merge:true});
      closeModal();
    };
  });
}

docRef('calendar').onSnapshot(doc=>{ calendarData = doc.exists ? doc.data() : {events:{}}; renderCalendar(); });

/* ---------------- 6. 갤러리 (핀터레스트형 매스너리) ---------------- */

let galleryData = { items: [] };

function renderGallery(){
  const box = document.getElementById('cardGallery');
  const items = galleryData.items || [];
  box.innerHTML = `
    <div class="pin-grid">
      ${items.map((url,i)=> `<div class="pin-item" data-idx="${i}"><img src="${escapeHtml(url)}"></div>`).join('')}
    </div>
    ${items.length===0 ? `<div class="w-empty">아직 사진이 없어요</div>` : ''}
    ${editMode ? `<button class="gallery-add-fab" id="galAddBtn" title="사진 추가">＋</button>` : ''}
  `;
  box.querySelectorAll('.pin-item').forEach(el=> el.addEventListener('click', ()=> openGalleryViewModal(Number(el.dataset.idx))));
  const addBtn = box.querySelector('#galAddBtn');
  if(addBtn) addBtn.onclick = openGalleryAddModal;
}

function openGalleryViewModal(idx){
  const url = galleryData.items[idx];
  openModal(`
    <img src="${escapeHtml(url)}" style="width:100%;border-radius:10px;">
    <div class="modal-actions">
      ${editMode ? `<button class="btn danger" id="del">삭제</button>` : ''}
      <button class="btn ghost" id="c">닫기</button>
    </div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    if(editMode) m.querySelector('#del').onclick = async ()=>{
      const arr = [...galleryData.items]; arr.splice(idx,1);
      await docRef('gallery').set({items:arr}, {merge:true});
      closeModal();
    };
  });
}

function openGalleryAddModal(){
  openModal(`
    <h3>사진 추가</h3>
    <label>사진 올리기 (기기에서 여러 장 선택 가능)</label>
    <input type="file" id="galFiles" accept="image/*" multiple>
    <p class="hint">화면에 맞게 자동으로 압축해서 갤러리에 바로 추가돼요. 별도 사이트에 올릴 필요 없어요.</p>
    <label>또는, 이미지 URL 직접 입력</label>
    <input type="url" id="galUrl" placeholder="https://...">
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const files = Array.from(m.querySelector('#galFiles').files || []);
      const url = m.querySelector('#galUrl').value.trim();
      const newItems = [];
      if(files.length){
        saveBtn.disabled = true;
        for(let i=0;i<files.length;i++){
          saveBtn.textContent = `처리 중… (${i+1}/${files.length})`;
          try{ newItems.push(await compressImageFile(files[i], 1200, 260000)); }
          catch(err){ toast(`"${files[i].name}" 처리 실패`); }
        }
      } else if(url){
        newItems.push(url);
      } else {
        toast('사진을 선택하거나 URL을 입력해주세요');
        return;
      }
      try{
        await docRef('gallery').set({ items: [...(galleryData.items||[]), ...newItems] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. 용량이 크면 URL 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('gallery').onSnapshot(doc=>{ galleryData = doc.exists ? doc.data() : {items:[]}; renderGallery(); });

/* ---------------- 7. TRPG 세션카드 (클릭하면 PDF로 연결) ---------------- */

let sessionsData = { cards: [] };
const SESSION_PDF_MAX_BYTES = 650000;

function renderSessions(){
  const grid = document.getElementById('sessionGrid');
  const cards = sessionsData.cards || [];
  grid.innerHTML = cards.map((c,i)=> `
    <div class="session-card" data-idx="${i}">
      ${editMode ? `<button class="del" data-del="${i}">✕</button>` : ''}
      <h4>${escapeHtml(c.title)}</h4>
      ${c.note ? `<div class="meta">${escapeHtml(c.note)}</div>` : ''}
      ${c.pdf ? `<span class="pdf-badge">📄 PDF 열기</span>` : `<span class="pdf-badge" style="color:var(--ink-soft)">연결된 PDF 없음</span>`}
    </div>
  `).join('') || `<div class="w-empty" style="grid-column:1/-1">등록된 세션이 없어요</div>`;

  grid.querySelectorAll('.session-card').forEach(el=> el.addEventListener('click', (e)=>{
    if(e.target.closest('[data-del]')) return;
    const idx = Number(el.dataset.idx);
    const card = sessionsData.cards[idx];
    if(card.pdf) window.open(card.pdf, '_blank');
    else toast('연결된 PDF가 없어요');
  }));
  grid.querySelectorAll('[data-del]').forEach(btn=> btn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const idx = Number(btn.dataset.del);
    const arr = [...sessionsData.cards]; arr.splice(idx,1);
    await docRef('sessions').set({cards:arr}, {merge:true});
  }));

  const wrap = document.getElementById('sessionAddWrap');
  wrap.innerHTML = editMode ? `<button class="btn small session-add" id="sessAddBtn">+ 세션 추가</button>` : '';
  const addBtn = document.getElementById('sessAddBtn');
  if(addBtn) addBtn.onclick = openSessionAddModal;
}

function openSessionAddModal(){
  openModal(`
    <h3>세션 카드 추가</h3>
    <label>세션 제목</label><input type="text" id="sTitle" placeholder="예: 1화 - 첫 만남">
    <label>날짜/한 줄 메모 (선택)</label><input type="text" id="sNote" placeholder="예: 2026.07.01">
    <div class="radio-row">
      <label><input type="radio" name="pdf-src" value="file" checked> PDF 파일 올리기</label>
      <label><input type="radio" name="pdf-src" value="link"> 링크로 연결</label>
    </div>
    <div id="pdfFileWrap">
      <label>PDF 파일</label><input type="file" id="sPdfFile" accept="application/pdf">
      <p class="hint">파일이 약 ${Math.round(SESSION_PDF_MAX_BYTES/1024)}KB보다 크면 여기서 바로 못 올려요. 그럴 땐 오른쪽 "링크로 연결"을 골라서 구글드라이브 공유 링크를 붙여넣어주세요.</p>
    </div>
    <div id="pdfLinkWrap" style="display:none">
      <label>PDF 링크 (구글드라이브 공유 링크 등)</label><input type="url" id="sPdfLink" placeholder="https://drive.google.com/...">
    </div>
    <div class="modal-actions"><button class="btn ghost" id="c">취소</button><button class="btn primary" id="s">추가</button></div>
  `, m=>{
    m.querySelectorAll('input[name="pdf-src"]').forEach(r=> r.addEventListener('change', ()=>{
      const isFile = m.querySelector('input[name="pdf-src"]:checked').value === 'file';
      m.querySelector('#pdfFileWrap').style.display = isFile ? '' : 'none';
      m.querySelector('#pdfLinkWrap').style.display = isFile ? 'none' : '';
    }));
    m.querySelector('#c').onclick = closeModal;
    m.querySelector('#s').onclick = async ()=>{
      const saveBtn = m.querySelector('#s');
      const title = m.querySelector('#sTitle').value.trim();
      const note = m.querySelector('#sNote').value.trim();
      if(!title){ toast('세션 제목을 입력해주세요'); return; }
      const isFile = m.querySelector('input[name="pdf-src"]:checked').value === 'file';
      let pdf = '';
      if(isFile){
        const file = m.querySelector('#sPdfFile').files[0];
        if(file){
          if(file.size > SESSION_PDF_MAX_BYTES){
            toast('PDF 용량이 너무 커요. "링크로 연결"을 이용해주세요.');
            return;
          }
          saveBtn.disabled = true; saveBtn.textContent = '처리 중…';
          try{ pdf = await fileToBase64(file); }
          catch(err){ toast('PDF를 읽지 못했어요'); saveBtn.disabled=false; saveBtn.textContent='추가'; return; }
        }
      } else {
        pdf = m.querySelector('#sPdfLink').value.trim();
      }
      try{
        await docRef('sessions').set({ cards: [...(sessionsData.cards||[]), {title, note, pdf}] }, {merge:true});
      }catch(err){
        toast('저장하지 못했어요. PDF 용량이 크면 링크 방식을 이용해주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '추가';
        return;
      }
      closeModal();
    };
  });
}

docRef('sessions').onSnapshot(doc=>{ sessionsData = doc.exists ? doc.data() : {cards:[]}; renderSessions(); });

/* ---------------- 8. 체크보드 (체크된 항목은 아래로) ---------------- */

let checklistData = { items: [] };

function renderChecklist(){
  const body = document.getElementById('checklistBody');
  const all = (checklistData.items || []).map((it,i)=>({...it, _i:i}));
  const unchecked = all.filter(it=> !it.checked);
  const checked = all.filter(it=> it.checked);

  function row(it){
    return `
      <div class="check-item ${it.checked?'checked':''}" data-idx="${it._i}">
        <input type="checkbox" ${it.checked?'checked':''} ${editMode?'':'disabled'}>
        <span>${escapeHtml(it.text)}</span>
        ${editMode ? `<button class="del">✕</button>` : ''}
      </div>
    `;
  }

  body.innerHTML =
    unchecked.map(row).join('') +
    (unchecked.length && checked.length ? `<div class="check-divider"></div>` : '') +
    checked.map(row).join('') ||
    `<div class="w-empty">등록된 항목이 없어요</div>`;

  body.querySelectorAll('.check-item').forEach(el=>{
    const idx = Number(el.dataset.idx);
    const cb = el.querySelector('input[type=checkbox]');
    cb.addEventListener('change', async ()=>{
      if(!editMode) return;
      const arr = [...checklistData.items];
      arr[idx] = { ...arr[idx], checked: cb.checked };
      await docRef('checklist').set({items:arr}, {merge:true});
    });
    const del = el.querySelector('.del');
    if(del) del.addEventListener('click', async ()=>{
      const arr = [...checklistData.items]; arr.splice(idx,1);
      await docRef('checklist').set({items:arr}, {merge:true});
    });
  });

  const wrap = document.getElementById('checklistAddWrap');
  wrap.innerHTML = `<input type="text" id="checkNewInput" placeholder="새 항목"><button class="btn small primary" id="checkAddBtn">추가</button>`;
  const addBtn = document.getElementById('checkAddBtn');
  const input = document.getElementById('checkNewInput');
  const submit = async ()=>{
    const text = input.value.trim();
    if(!text) return;
    await docRef('checklist').set({ items: [...(checklistData.items||[]), {text, checked:false}] }, {merge:true});
    input.value = '';
  };
  addBtn.onclick = submit;
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
}

docRef('checklist').onSnapshot(doc=>{ checklistData = doc.exists ? doc.data() : {items:[]}; renderChecklist(); });

/* ---------------- 초기화 ---------------- */

refreshLockUI();

// ═══════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════
const DEF_PHASES = ['Frontend','Backend','Testing','Bug Report','Design','DevOps'];
let S = { projects:[], activeProject:null, tasks:[] };

// save() is patched to push changes to Supabase (see supabase.js#queueSync).
// Called after every local mutation; debounced diff-based sync.
function save(){ if(typeof queueSync==='function') queueSync(); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
// UUID for DB rows (projects.id is uuid)
function uuid(){
  if(crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}

// ═══════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════
function getProject(id){ return S.projects.find(p=>p.id===(id||S.activeProject)); }
function getPhases(pid){ return getProject(pid)?.phases||DEF_PHASES; }
function getColTasks(pid,ph){ return S.tasks.filter(t=>t.projectId===pid&&t.phase===ph); }
function getAllTasks(pid){ return S.tasks.filter(t=>t.projectId===pid); }
function isOverdue(t){ return !!(t.due&&!t.done&&new Date(t.due)<new Date(new Date().toDateString())); }

// ═══════════════════════════════════════════════
// DURATION
// ═══════════════════════════════════════════════
function getActualMs(t){
  let ms=0;
  (t.history||[]).forEach(h=>{ if(h.type==='completed'&&h.elapsed) ms+=h.elapsed; });
  if(!t.done&&t.startedAt) ms+=Date.now()-t.startedAt;
  return ms;
}
function getDisplayMs(t){
  if(t.startDate){
    const start=parseStartDate(t.startDate);
    const end=t.done?(t.completedAt||Date.now()):Date.now();
    return Math.max(0,end-start);
  }
  return getActualMs(t);
}
function fmtMs(ms){
  if(!ms||ms<86400000) return null;
  return Math.floor(ms/86400000)+'d';
}
function fmtMsCard(ms){
  if(!ms||ms<86400000) return null;
  return Math.floor(ms/86400000)+'d';
}
function fmtMsSub(ms){
  if(!ms||ms<86400000) return null;
  return Math.floor(ms/86400000)+'d';
}
function getSubDisplayMs(s){
  if(s.startDate){
    const start=parseStartDate(s.startDate);
    const end=s.done?(s.completedAt||Date.now()):Date.now();
    return Math.max(0,end-start);
  }
  if(s.done) return s.elapsed||0;
  return (s.elapsed||0)+(s.startedAt?Date.now()-s.startedAt:0);
}
function fmtTs(ts){
  if(!ts) return '—';
  const d=new Date(ts);
  const mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${d.getDate()} ${mo}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
const _MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(s){
  if(!s) return '';
  const[,m,d]=s.slice(0,10).split('-');
  return `${parseInt(d)} ${_MONTHS[parseInt(m)-1]}`;
}
// Convert timestamp to "YYYY-MM-DD" in local time (for date inputs)
function tsToDateInput(ts){
  if(!ts) return '';
  const d=new Date(ts);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
// Parse startDate string to ms timestamp, handling both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM"
function parseStartDate(s){
  if(!s) return null;
  if(s.includes('T')) return new Date(s).getTime();
  const[y,m,d]=s.split('-').map(Number);
  return new Date(y,m-1,d).getTime();
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const COL_COLORS=['c0','c1','c2','c3','c4','c5','c6','c7','c8'];
function colColor(i){ return COL_COLORS[i%COL_COLORS.length]; }
function urgencyLabel(u){ return u==='high'?'URGENT':u.toUpperCase(); }

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
function render(){ renderProjectBar(); renderDashboard(); renderTimeline(); renderBoard(); }

function renderDashboard(){
  const el = document.getElementById('dashStats');
  if(!el) return;
  const proj = getProject();
  if(!proj){ el.innerHTML = ''; return; }
  const all = getAllTasks(proj.id);
  const total = all.length;
  const done = all.filter(t => t.done).length;
  const overdue = all.filter(isOverdue).length;
  const reopened = all.filter(t => (t.history||[]).some(h => h.type === 'reopened')).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  el.innerHTML = `
    <div class="d-card"><div class="d-lbl">Done</div><div class="d-num pct-accent">${pct}%</div><div class="d-sub">${done}/${total||0} tasks</div></div>
    <div class="d-card"><div class="d-lbl">Tasks</div><div class="d-num">${total}</div><div class="d-sub">${total-done} open</div></div>
    <div class="d-card"><div class="d-lbl">Overdue</div><div class="d-num ${overdue?'red':''}">${overdue}</div><div class="d-sub">past due date</div></div>
    <div class="d-card"><div class="d-lbl">Reopened</div><div class="d-num ${reopened?'orange':''}">${reopened}</div><div class="d-sub">tasks reopened</div></div>`;
}

function renderTimeline(){
  const section = document.querySelector('.tl-section');
  const panel = document.getElementById('tlPanel');
  if(!section || !panel) return;
  const open = localStorage.getItem('pt_tl_open') === '1';
  section.classList.toggle('open', open);
  if(!open){ panel.innerHTML = ''; return; } // don't build gantt unless shown
  const proj = getProject();
  if(!proj){ panel.innerHTML = ''; return; }
  panel.innerHTML = buildGantt(getAllTasks(proj.id)) || '';
}

function toggleTimeline(){
  const open = localStorage.getItem('pt_tl_open') === '1';
  localStorage.setItem('pt_tl_open', open ? '0' : '1');
  renderTimeline();
}

function renderProjectBar(){
  if(!S.activeProject && S.projects.length) S.activeProject = S.projects[0].id;
  const invBtn = document.getElementById('inviteBtn');
  if(invBtn){
    // Show the Members button whenever there's an active project — the modal
    // will render the correct controls based on the viewer's role.
    invBtn.style.display = S.activeProject ? '' : 'none';
  }
  document.getElementById('projectBar').innerHTML =
    S.projects.map(p=>`<div class="pchip ${p.id===S.activeProject?'active':''}" onclick="selectProject('${p.id}')">${esc(p.name)}</div>`).join('')
    +`<button class="dashed-btn" onclick="openProjectModal()">+ Project</button>`;
}

function renderBoard(){
  const board=document.getElementById('board');
  const proj=getProject();
  if(!proj){ board.innerHTML=''; return; }

  let html=proj.phases.map((ph,i)=>{
    const tasks=getColTasks(proj.id,ph);
    const doneN=tasks.filter(t=>t.done).length;
    const cc=colColor(i);
    // Build unified card list: main tasks + deployed subtasks, sorted by order
    const items=[];
    tasks.forEach(t=>{
      items.push({type:'task',task:t,order:typeof t.order==='number'?t.order:9999,done:t.done});
    });
    S.tasks.filter(t=>t.projectId===proj.id).forEach(t=>{
      (t.subtasks||[]).forEach((s,si)=>{
        if(s.phase===ph&&!s.done) items.push({type:'sub',task:t,sub:s,idx:si,order:typeof s.phaseOrder==='number'?s.phaseOrder:9999,done:false});
      });
    });
    items.sort((a,b)=>{
      if(a.done!==b.done) return a.done?1:-1;
      if(a.order!==b.order) return a.order-b.order;
      return 0;
    });
    const cardsHtml=items.map(it=>it.type==='task'?renderCard(it.task):renderSubCard(it.task,it.sub,it.idx)).join('');
    return `<div class="col" data-ph="${esc(ph)}" draggable="true" ondragstart="colDragStart(event,'${esc(ph)}')" ondragend="colDragEnd(event)" ondragover="colDragOver(event)" ondragleave="colDragLeave(event)" ondrop="colDrop(event,'${esc(ph)}')">
      <div class="col-head">
        <div class="col-dot ${cc}"></div>
        <div class="col-title">${esc(ph)}</div>
        <div class="col-count">${doneN}/${tasks.length}</div>
        <button class="col-menu-btn" onclick="openColCtx(event,'${esc(ph)}')">⋯</button>
      </div>
      <div class="col-body" id="col-${esc(ph)}">
        ${cardsHtml}
      </div>
      <button class="col-add-btn" onclick="openAddTask('${esc(ph)}')">+ Add Task</button>
    </div>`;
  }).join('');

  // new column button
  html+=`<div class="col-new">
    <div class="col-new-inner" id="addColBtn" onclick="showAddColForm()">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" stroke="#4a5568" stroke-width="1.5"/><path d="M10 6v8M6 10h8" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span>Add Phase</span>
    </div>
    <div class="col-new-form" id="addColForm">
      <input type="text" id="fNewCol" placeholder="Phase name..." />
      <div class="col-new-form-actions">
        <button class="btn btn-primary btn-sm" onclick="submitNewCol()">Add</button>
        <button class="btn btn-ghost btn-sm" onclick="hideAddColForm()">Cancel</button>
      </div>
    </div>
  </div>`;

  board.innerHTML=html;
}

function renderCard(t){
  const reopens=(t.history||[]).filter(h=>h.type==='reopened');
  const lastH=t.history?.length?t.history[t.history.length-1]:null;
  const isReopened=lastH?.type==='reopened'&&!t.done;
  const timeFmt=fmtMsCard(getDisplayMs(t));
  const subs=t.subtasks||[];
  const subsDone=subs.filter(s=>s.done).length;

  // Row 1: title + urgency badge
  const row1=`<div class="tc-row1">
    <div class="tc-title">${esc(t.title)}</div>
    <span class="badge b-${t.urgency} tc-urgency">${urgencyLabel(t.urgency)}</span>
  </div>`;

  // Row 2: due date
  const row2=t.due?`<div class="tc-row2"><span class="badge ${isOverdue(t)?'b-overdue':'b-meta'}">DUE ${fmtDate(t.due)}${isOverdue(t)?' ⚠':''}</span></div>`:'';

  // Row 3: done, duration, reopens, subtasks progress
  const r3=[];
  if(t.done) r3.push(`<span class="badge b-done">✓ DONE</span>`);
  if(timeFmt) r3.push(`<span class="badge b-time">⏱ ${timeFmt}</span>`);
  if(reopens.length) r3.push(`<span class="badge b-reopen">↩ ${reopens.length}</span>`);
  if(subs.length) r3.push(`<span class="badge b-subtask">☑ ${subsDone}/${subs.length}</span>`);
  const row3=r3.length?`<div class="tc-row3">${r3.join('')}</div>`:'';

  // Row 4: assignee
  const row4=t.assignee?`<div class="tc-row4"><span class="badge b-assign">@${esc(t.assignee)}</span></div>`:'';

  const imgs=t.screenshots?.slice(0,2).map(s=>`<img class="tc-img" src="${shotUrl(s)}" />`).join('')||'';

  return `<div class="tcard u-${t.urgency} ${t.done?'done':''} ${isReopened?'is-reopened':''}" id="tc-${t.id}" draggable="true" ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)" onclick="openDrawer('${t.id}')">
    <div class="tc-tick ${t.done?'checked':''}" onclick="event.stopPropagation();handleCheck('${t.id}')"></div>
    <div class="tc-content">${row1}${row2}${row3}
      ${imgs?`<div class="tc-attach-thumb">${imgs}</div>`:''}
      ${row4}
    </div>
  </div>`;
}

function renderSubCard(t,s,idx){
  const timeFmt=fmtMsCard(getSubDisplayMs(s));
  const subId=`sc-${t.id}-${idx}`;
  const subReopens=(s.history||[]).filter(h=>h.type==='reopened');
  const r3=[];
  if(timeFmt) r3.push(`<span class="badge b-time">⏱ ${timeFmt}</span>`);
  if(subReopens.length) r3.push(`<span class="badge b-reopen">↩ ${subReopens.length}</span>`);
  const subRow4=s.assignee?`<div class="tc-row4"><span class="badge b-assign">@${esc(s.assignee)}</span></div>`:'';
  return `<div class="tcard tcard-sub u-${t.urgency}" id="${subId}" draggable="true" ondragstart="dragStartSub(event,'${t.id}',${idx})" ondragend="dragEndSub(event)" onclick="openSubtaskDetail('${t.id}',${idx})">
    <div class="tc-tick ${s.done?'checked':''}" onclick="event.stopPropagation();toggleSubtask('${t.id}',${idx})"></div>
    <div class="tc-content">
      <div class="sc-labels"><span class="sc-label">SUBTASK</span><span class="sc-label sc-urgency-${t.urgency}">${urgencyLabel(t.urgency)}</span></div>
      <div class="tc-row1"><div class="tc-title">${esc(s.title)}</div></div>
      <div class="tc-row2"><span class="badge b-meta sc-parent" title="${esc(t.title)}">↩ ${esc(t.title)}</span></div>
      ${r3.length?`<div class="tc-row3">${r3.join('')}</div>`:''}
      ${subRow4}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════
// DETAIL DRAWER
// ═══════════════════════════════════════════════
let _drawerId=null;
let _dragTaskId=null;
let _drawerSubIdx=null;

function openDrawer(id){
  _drawerId=id;
  renderDrawer();
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}

function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  _drawerId=null; _drawerSubIdx=null;
}

function renderDrawer(){
  if(_drawerSubIdx!==null){ renderSubtaskDrawer(); return; }
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t) return;
  const reopens=(t.history||[]).filter(h=>h.type==='reopened');
  const isReopened=!t.done&&reopens.length&&t.history[t.history.length-1]?.type==='reopened';
  const timeFmt=fmtMs(getDisplayMs(t));

  // HEAD
  document.getElementById('drawerHead').innerHTML=`
    <div class="drawer-check ${t.done?'checked':''}" onclick="handleCheck('${t.id}')"></div>
    <div class="drawer-title-wrap">
      <div class="drawer-title ${t.done?'done':''}" style="${t.done?'text-decoration:line-through;opacity:.6':''}">${esc(t.title)}</div>
      <div class="drawer-phase">${esc(t.phase)} · ${urgencyLabel(t.urgency)}</div>
    </div>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>`;

  // BODY
  let body='';

  // Badges row
  let badges='';
  badges+=`<span class="badge b-${t.urgency}">${urgencyLabel(t.urgency)}</span>`;
  if(t.done) badges+=`<span class="badge b-done">✓ DONE</span>`;
  if(isReopened) badges+=`<span class="badge b-reopen">↩ REOPENED</span>`;
  if(t.assignee) badges+=`<span class="badge b-assign">@${esc(t.assignee)}</span>`;
  if(t.startDate) badges+=`<span class="badge b-meta">▶ ${fmtDate(t.startDate)}</span>`;
  if(t.due) badges+=`<span class="badge ${isOverdue(t)?'b-overdue':'b-meta'}">⏹ ${fmtDate(t.due)}${isOverdue(t)?' ⚠':''}</span>`;
  if(timeFmt) badges+=`<span class="badge b-time">⏱ ${timeFmt}</span>`;
  if(reopens.length) badges+=`<span class="badge b-reopen">↩ ${reopens.length}x reopened</span>`;
  body+=`<div class="d-section"><div class="d-section-label">Details</div><div class="d-badges">${badges}</div></div>`;

  // Description
  body+=`<div class="d-section"><div class="d-section-label">Description</div>
    <div class="d-desc ${t.desc?'':'empty'}">${t.desc?esc(t.desc):'No description added.'}</div></div>`;

  // Completion date (editable only when done)
  if(t.done){
    body+=`<div class="d-section"><div class="d-section-label">Completed</div>
      <div class="sub-dates-row">
        <div class="sub-date-field"><label>Date</label>
          <input type="date" id="fCompletedAt_${t.id}" value="${tsToDateInput(t.completedAt)}" onchange="saveTaskCompletedAt('${t.id}')" />
        </div>
      </div>
    </div>`;
  }

  // Subtasks
  const subs=t.subtasks||[];
  const subsDone=subs.filter(s=>s.done).length;
  const subsPct=subs.length?Math.round(subsDone/subs.length*100):0;
  let subsHtml='';
  if(subs.length){
    subsHtml+=`<div class="st-progress">
      <div class="st-progress-track"><div class="st-progress-fill" style="width:${subsPct}%"></div></div>
      <div class="st-progress-txt">${subsDone}/${subs.length}</div>
    </div>`;
    subsHtml+=`<div class="subtask-list">`+subs.map((s,i)=>{
      const subTimeFmt=fmtMsSub(getSubDisplayMs(s));
      const stReopens=(s.history||[]).filter(h=>h.type==='reopened').length;
      return `<div class="subtask-row" onclick="openSubtaskDetail('${t.id}',${i})">
        <div class="st-check ${s.done?'checked':''}" onclick="event.stopPropagation();toggleSubtask('${t.id}',${i})"></div>
        <div class="st-info">
          <div class="st-title ${s.done?'done':''}">${esc(s.title)}</div>
          ${s.phase&&!s.done?`<div class="st-phase">📌 Deployed to ${esc(s.phase)}</div>`:''}
        </div>
        ${stReopens?`<div class="st-reopen">↩ ${stReopens}</div>`:''}
        ${s.assignee?`<div class="st-assign">@${esc(s.assignee)}</div>`:''}
        ${subTimeFmt?`<div class="st-time">⏱ ${subTimeFmt}</div>`:''}
        <button class="st-del" onclick="event.stopPropagation();deleteSubtask('${t.id}',${i})">✕</button>
      </div>`;
    }).join('')+`</div>`;
  }
  subsHtml+=`<div class="st-add-row">
    <input class="st-add-input" id="stInput_${t.id}" placeholder="Add subtask..." onkeydown="if(event.key==='Enter') addSubtask('${t.id}')" />
    <select class="st-add-assign" id="stAssign_${t.id}">${buildAssigneeOptions('')}</select>
    <button class="btn btn-ghost btn-sm" onclick="addSubtask('${t.id}')">+</button>
  </div>`;
  const totalSubMs=subs.filter(s=>s.done).reduce((sum,s)=>sum+(s.elapsed||0),0);
  body+=`<div class="d-section"><div class="d-section-label">Subtasks${subs.length?` (${subsDone}/${subs.length})${totalSubMs&&fmtMsSub(totalSubMs)?' · '+fmtMsSub(totalSubMs):''}`:''}</div>${subsHtml}</div>`;

  // Screenshots
  const shots=t.screenshots||[];
  let ssGrid=shots.map((s,i)=>`
    <div class="ss-thumb" onclick="openLightbox('${t.id}',${i})">
      <img src="${shotUrl(s)}" loading="lazy" />
      <button class="ss-del" onclick="deleteShot(event,'${t.id}',${i})">✕</button>
    </div>`).join('');
  ssGrid+=`<button class="ss-upload-btn" onclick="triggerUpload('${t.id}')">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M5 8l5-5 5 5" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17h14" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round"/></svg>
    <span>Add screenshot</span>
  </button>`;
  body+=`<div class="d-section"><div class="d-section-label">Screenshots (${shots.length})</div><div class="screenshots-grid">${ssGrid}</div></div>`;

  // History
  if(t.history?.length){
    const entries=[...t.history].reverse();
    const histHtml=entries.map(h=>{
      if(h.type==='created') return `<div class="h-entry"><div class="h-dot created"></div><div class="h-info"><div class="h-label">Task created</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='completed') return `<div class="h-entry"><div class="h-dot completed"></div><div class="h-info"><div class="h-label">Marked done${h.elapsed&&fmtMs(h.elapsed)?` · <span style="color:var(--accent)">${fmtMs(h.elapsed)}</span>`:''}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='reopened') return `<div class="h-entry"><div class="h-dot reopened"></div><div class="h-info"><div class="h-label">Reopened</div><div class="h-time">${fmtTs(h.ts)}</div>${h.reason?`<div class="h-reason">"${esc(h.reason)}"</div>`:''}</div></div>`;
      return '';
    }).join('');
    body+=`<div class="d-section"><div class="d-section-label">Activity</div><div class="h-list">${histHtml}</div></div>`;
  }

  document.getElementById('drawerBody').innerHTML=body;

  // FOOT
  document.getElementById('drawerFoot').innerHTML=`
    <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openEditTask('${t.id}')">✏️ Edit</button>
    <button class="btn btn-danger btn-sm" onclick="deleteFromDrawer('${t.id}')">🗑 Delete</button>`;
}

function deleteFromDrawer(id){
  if(!confirm('Delete this task?')) return;
  const t = S.tasks.find(x => x.id === id);
  if(t) removePathsFromStorage(collectTaskPaths(t));
  S.tasks=S.tasks.filter(t=>t.id!==id); save(); closeDrawer(); render();
}
function saveTaskCompletedAt(taskId){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.done) return;
  const inp=document.getElementById('fCompletedAt_'+taskId);
  if(inp&&inp.value){
    const[y,m,d]=inp.value.split('-').map(Number);
    t.completedAt=new Date(y,m-1,d).getTime();
  }
  save(); render();
}

function openSubtaskDetail(taskId,idx){
  _drawerId=taskId; _drawerSubIdx=idx;
  renderDrawer();
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}
function backToTask(){ _drawerSubIdx=null; renderDrawer(); }

function renderSubtaskDrawer(){
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t||_drawerSubIdx===null) return;
  const s=t.subtasks[_drawerSubIdx]; if(!s) return;
  // migrate old subtasks
  if(!s.screenshots) s.screenshots=[];
  if(!s.history) s.history=[{type:'created',ts:s.createdAt||Date.now()}];

  const timeFmt=fmtMsSub(getSubDisplayMs(s));

  // HEAD
  document.getElementById('drawerHead').innerHTML=`
    <button class="drawer-back" onclick="backToTask()">← ${esc(t.title)}</button>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>`;

  // BODY
  let body='';
  body+=`<div class="sub-detail-header">
    <div class="drawer-check ${s.done?'checked':''}" onclick="toggleSubtask('${t.id}',${_drawerSubIdx})"></div>
    <div class="drawer-title ${s.done?'done':''}" style="${s.done?'text-decoration:line-through;opacity:.6':''}">${esc(s.title)}</div>
  </div>`;

  const drawerReopens=(s.history||[]).filter(h=>h.type==='reopened');
  let badges='';
  if(s.done) badges+=`<span class="badge b-done">✓ DONE</span>`;
  if(s.phase&&!s.done) badges+=`<span class="badge b-meta">📌 ${esc(s.phase)}</span>`;
  if(timeFmt) badges+=`<span class="badge b-time">⏱ ${timeFmt}</span>`;
  if(s.assignee) badges+=`<span class="badge b-assign">@${esc(s.assignee)}</span>`;
  if(drawerReopens.length) badges+=`<span class="badge b-reopen">↩ ${drawerReopens.length}x reopened</span>`;
  if(badges) body+=`<div class="d-section"><div class="d-badges">${badges}</div></div>`;

  const _phases=getPhases();
  body+=`<div class="d-section"><div class="d-section-label">Assign To</div>
    <select class="sub-phase-select" id="subAssign_${s.id}" onchange="saveSubAssignee('${t.id}',${_drawerSubIdx})">${buildAssigneeOptions(s.assignee||'')}</select>
  </div>`;

  body+=`<div class="d-section"><div class="d-section-label">Deploy to Phase</div>
    <select class="sub-phase-select" id="subPhase_${s.id}" onchange="saveSubPhase('${t.id}',${_drawerSubIdx})">
      <option value="">— Not deployed —</option>
      ${_phases.map(p=>`<option value="${esc(p)}" ${s.phase===p?'selected':''}>${esc(p)}</option>`).join('')}
    </select>
  </div>`;

  body+=`<div class="d-section"><div class="d-section-label">Timeline</div>
    <div class="sub-dates-row">
      <div class="sub-date-field"><label>Start Date</label><input type="date" id="subStart_${s.id}" value="${s.startDate?s.startDate.slice(0,10):''}" onchange="saveSubtaskDates('${t.id}',${_drawerSubIdx})" /></div>
      ${s.done?`<div class="sub-date-field"><label>Completed</label><input type="date" id="subCompleted_${s.id}" value="${tsToDateInput(s.completedAt)}" onchange="saveSubtaskDates('${t.id}',${_drawerSubIdx})" /></div>`:''}
    </div>
  </div>`;

  body+=`<div class="d-section"><div class="d-section-label">Description</div>
    <textarea class="sub-desc-input" id="subDesc_${s.id}" placeholder="Add notes, links, details..." oninput="debounceSaveSubDesc('${t.id}',${_drawerSubIdx})">${esc(s.desc||'')}</textarea>
  </div>`;

  const shots=s.screenshots;
  let ssGrid=shots.map((ss,i)=>`
    <div class="ss-thumb" onclick="openSubLightbox('${t.id}',${_drawerSubIdx},${i})">
      <img src="${shotUrl(ss)}" loading="lazy" />
      <button class="ss-del" onclick="deleteSubShot(event,'${t.id}',${_drawerSubIdx},${i})">✕</button>
    </div>`).join('');
  ssGrid+=`<button class="ss-upload-btn" onclick="triggerSubUpload('${t.id}',${_drawerSubIdx})">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M5 8l5-5 5 5" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17h14" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round"/></svg>
    <span>Add screenshot</span>
  </button>`;
  body+=`<div class="d-section"><div class="d-section-label">Screenshots (${shots.length})</div><div class="screenshots-grid">${ssGrid}</div></div>`;

  if(s.history.length){
    const histHtml=[...s.history].reverse().map(h=>{
      if(h.type==='created') return `<div class="h-entry"><div class="h-dot created"></div><div class="h-info"><div class="h-label">Subtask created</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='completed') return `<div class="h-entry"><div class="h-dot completed"></div><div class="h-info"><div class="h-label">Marked done${h.elapsed&&fmtMsSub(h.elapsed)?` · <span style="color:var(--accent)">${fmtMsSub(h.elapsed)}</span>`:''}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='reopened') return `<div class="h-entry"><div class="h-dot reopened"></div><div class="h-info"><div class="h-label">Reopened</div><div class="h-time">${fmtTs(h.ts)}</div>${h.reason?`<div class="h-reason">"${esc(h.reason)}"</div>`:''}</div></div>`;
      return '';
    }).join('');
    body+=`<div class="d-section"><div class="d-section-label">Activity</div><div class="h-list">${histHtml}</div></div>`;
  }

  document.getElementById('drawerBody').innerHTML=body;
  document.getElementById('drawerFoot').innerHTML=`
    <button class="btn btn-danger btn-sm" onclick="deleteSubtaskFromDrawer('${t.id}',${_drawerSubIdx})">🗑 Delete Subtask</button>`;
}

let _subDescTimer=null;
function debounceSaveSubDesc(taskId,idx){
  clearTimeout(_subDescTimer);
  _subDescTimer=setTimeout(()=>saveSubtaskDesc(taskId,idx),500);
}
function saveSubtaskDesc(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s) return;
  const inp=document.getElementById('subDesc_'+s.id);
  if(inp){ s.desc=inp.value.trim(); save(); }
}
function saveSubtaskDates(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s) return;
  const start=document.getElementById('subStart_'+s.id);
  if(start) s.startDate=start.value||null;
  if(s.done){
    const comp=document.getElementById('subCompleted_'+s.id);
    if(comp&&comp.value){
      const[y,m,d]=comp.value.split('-').map(Number);
      s.completedAt=new Date(y,m-1,d).getTime();
    }
  }
  save();
}
function saveSubAssignee(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s) return;
  const inp=document.getElementById('subAssign_'+s.id);
  s.assignee=inp?(inp.value||'').trim().replace(/^@/,''):s.assignee;
  save(); renderDrawer(); render();
}
function saveSubPhase(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s) return;
  const sel=document.getElementById('subPhase_'+s.id);
  s.phase=sel?sel.value||null:null;
  save(); render();
}
function deleteSubtaskFromDrawer(taskId,idx){
  if(!confirm('Delete this subtask?')) return;
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const removedSub = t.subtasks.splice(idx,1)[0]; _drawerSubIdx=null;
  if(removedSub) removePathsFromStorage(collectTaskPaths({ screenshots: removedSub.screenshots }));
  save(); render(); renderDrawer();
}
function openSubLightbox(taskId,idx,shotIdx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s||!s.screenshots) return;
  document.getElementById('lbImg').src=shotUrl(s.screenshots[shotIdx]);
  document.getElementById('lightbox').classList.add('open');
}
function deleteSubShot(e,taskId,idx,shotIdx){
  e.stopPropagation();
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s||!s.screenshots) return;
  const removed = s.screenshots.splice(shotIdx,1)[0];
  removeFromStorage(removed);
  save(); renderDrawer(); render();
}

// ═══════════════════════════════════════════════
// CHECK / REOPEN
// ═══════════════════════════════════════════════
let _reopenId=null;
let _reopenSubInfo=null;

function handleCheck(id){
  const t=S.tasks.find(t=>t.id===id); if(!t) return;
  if(!t.done){
    const now=Date.now();
    t.done=true; t.completedAt=now;
    if(!t.history) t.history=[];
    t.history.push({type:'completed',ts:now,elapsed:t.startedAt?now-t.startedAt:null,prevStart:t.startedAt||null});
    t.startedAt=null;
    // Cascade: complete any ongoing subtasks. (Reopening the parent later
    // does NOT reopen these — subtasks stay done.)
    (t.subtasks||[]).forEach(s=>{
      if(!s.done){
        s.done=true; s.completedAt=now;
        const started=s.startedAt||s.createdAt;
        s.elapsed=(s.elapsed||0)+(started?now-started:0);
        s.startedAt=null;
        if(!s.history) s.history=[{type:'created',ts:s.createdAt||now}];
        s.history.push({type:'completed',ts:now,elapsed:s.elapsed,reason:'parent task completed'});
      }
    });
    save(); render(); if(_drawerId===id) renderDrawer();
  } else {
    _reopenId=id;
    document.getElementById('fReopenReason').value='';
    document.getElementById('reopenModal').classList.add('open');
    setTimeout(()=>document.getElementById('fReopenReason').focus(),300);
  }
}

function confirmReopen(){
  const now=Date.now();
  const reason=document.getElementById('fReopenReason').value.trim();
  if(_reopenSubInfo){
    const {taskId,idx}=_reopenSubInfo;
    const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks){closeReopenModal();return;}
    const s=t.subtasks[idx];
    s.done=false; s.completedAt=null; s.startedAt=now;
    if(!s.history) s.history=[{type:'created',ts:s.createdAt||now}];
    s.history.push({type:'reopened',ts:now,reason:reason||null});
    save(); closeReopenModal(); render(); if(_drawerId===taskId) renderDrawer();
  } else if(_reopenId){
    const t=S.tasks.find(t=>t.id===_reopenId); if(!t){closeReopenModal();return;}
    t.done=false; t.completedAt=null; t.startedAt=now;
    if(!t.history) t.history=[];
    t.history.push({type:'reopened',ts:now,reason:reason||null});
    save(); closeReopenModal(); render(); if(_drawerId===_reopenId) renderDrawer();
  }
}
function closeReopenModal(){ document.getElementById('reopenModal').classList.remove('open'); _reopenId=null; _reopenSubInfo=null; }

// ═══════════════════════════════════════════════
// TASK MODAL
// ═══════════════════════════════════════════════
let _editId=null;

// Build <option> list of project members for the assignee dropdown.
// Returns HTML string. `selected` is the currently-assigned name (may be legacy text).
function buildAssigneeOptions(selected){
  const members = (typeof _membersByProject !== 'undefined' && _membersByProject[S.activeProject]) || [];
  const names = members.map(m => m.display_name);
  // If selected is set but not in members list (legacy or former member), keep it as an option.
  if(selected && !names.includes(selected)) names.push(selected);
  const opts = [`<option value="">— Unassigned —</option>`]
    .concat(names.map(n => `<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`));
  return opts.join('');
}

function openAddTask(ph){
  _editId=null;
  document.getElementById('mTitle').textContent='New Task';
  ['fTitle','fDesc','fDue'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fStartDate').value=tsToDateInput(Date.now());
  document.getElementById('fUrgency').value='medium';
  const phases=getPhases();
  document.getElementById('fPhase').innerHTML=phases.map(p=>`<option value="${esc(p)}" ${p===(ph||phases[0])?'selected':''}>${esc(p)}</option>`).join('');
  document.getElementById('fAssignee').innerHTML=buildAssigneeOptions('');
  document.getElementById('taskModal').classList.add('open');
  setTimeout(()=>document.getElementById('fTitle').focus(),300);
}

function openEditTask(id){
  const t=S.tasks.find(t=>t.id===id); if(!t) return;
  _editId=id;
  document.getElementById('mTitle').textContent='Edit Task';
  document.getElementById('fTitle').value=t.title;
  document.getElementById('fDesc').value=t.desc||'';
  document.getElementById('fDue').value=t.due||'';
  document.getElementById('fStartDate').value=t.startDate?t.startDate.slice(0,10):'';
  document.getElementById('fUrgency').value=t.urgency;
  const phases=getPhases();
  document.getElementById('fPhase').innerHTML=phases.map(p=>`<option value="${esc(p)}" ${p===t.phase?'selected':''}>${esc(p)}</option>`).join('');
  document.getElementById('fAssignee').innerHTML=buildAssigneeOptions(t.assignee||'');
  document.getElementById('taskModal').classList.add('open');
}

function saveTask(){
  const title=document.getElementById('fTitle').value.trim();
  if(!title){document.getElementById('fTitle').focus();return;}
  const data={
    title,desc:document.getElementById('fDesc').value.trim(),
    phase:document.getElementById('fPhase').value,
    urgency:document.getElementById('fUrgency').value,
    assignee:document.getElementById('fAssignee').value.trim(),
    due:document.getElementById('fDue').value,
    startDate:document.getElementById('fStartDate').value,
    projectId:S.activeProject
  };
  if(_editId){
    const t=S.tasks.find(t=>t.id===_editId); if(t) Object.assign(t,data);
  } else {
    const now=Date.now();
    S.tasks.push({id:uid(),done:false,createdAt:now,startedAt:now,screenshots:[],subtasks:[],history:[{type:'created',ts:now}],...data});
  }
  save(); closeTaskModal(); render(); if(_drawerId&&_editId===_drawerId) renderDrawer();
}
function closeTaskModal(){ document.getElementById('taskModal').classList.remove('open'); }

// ═══════════════════════════════════════════════
// PROJECT MODAL
// ═══════════════════════════════════════════════
function openProjectModal(){ document.getElementById('fProjectName').value=''; document.getElementById('projectModal').classList.add('open'); setTimeout(()=>document.getElementById('fProjectName').focus(),300); }
function closeProjectModal(){ document.getElementById('projectModal').classList.remove('open'); }
function saveProject(){
  const name=document.getElementById('fProjectName').value.trim(); if(!name) return;
  const p={id:uuid(),name,phases:[...DEF_PHASES]};
  S.projects.push(p); S.activeProject=p.id;
  save(); closeProjectModal(); render();
}
function selectProject(id){
  S.activeProject=id;
  if(typeof fetchMembers==='function') fetchMembers(id);
  render();
  closeSidebar(); // auto-close on mobile after picking
}

function toggleSidebar(){
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if(!sb || !bd) return;
  const isOpen = sb.classList.contains('open');
  sb.classList.toggle('open', !isOpen);
  bd.classList.toggle('open', !isOpen);
}
function closeSidebar(){
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if(sb) sb.classList.remove('open');
  if(bd) bd.classList.remove('open');
}

// ═══════════════════════════════════════════════
// COLUMN MANAGEMENT (board-style)
// ═══════════════════════════════════════════════
function showAddColForm(){
  document.getElementById('addColBtn').style.display='none';
  document.getElementById('addColForm').classList.add('open');
  document.getElementById('fNewCol').value='';
  setTimeout(()=>document.getElementById('fNewCol').focus(),100);
}
function hideAddColForm(){
  document.getElementById('addColBtn').style.display='';
  document.getElementById('addColForm').classList.remove('open');
}
function submitNewCol(){
  const name=document.getElementById('fNewCol').value.trim(); if(!name) return;
  const proj=getProject(); if(!proj) return;
  if(proj.phases.includes(name)){ document.getElementById('fNewCol').style.borderColor='var(--red)'; setTimeout(()=>document.getElementById('fNewCol').style.borderColor='',1200); return; }
  proj.phases.push(name); save(); render();
}
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&document.activeElement===document.getElementById('fNewCol')) submitNewCol(); });

// col context menu
let _colCtxPh=null;
function openColCtx(e,ph){
  e.stopPropagation(); _colCtxPh=ph;
  const m=document.getElementById('colCtx'); m.classList.add('open');
  m.style.left=Math.min(e.clientX,innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,innerHeight-100)+'px';
}
function closeColCtx(){ document.getElementById('colCtx').classList.remove('open'); _colCtxPh=null; }

let _renamingPh=null;
function colCtxRename(){
  _renamingPh=_colCtxPh; closeColCtx();
  document.getElementById('fColName').value=_renamingPh;
  document.getElementById('renameColModal').classList.add('open');
  setTimeout(()=>document.getElementById('fColName').focus(),300);
}
function closeRenameCol(){ document.getElementById('renameColModal').classList.remove('open'); _renamingPh=null; }
function saveRenameCol(){
  const newName=document.getElementById('fColName').value.trim(); if(!newName) return;
  const proj=getProject(); if(!proj) return;
  const idx=proj.phases.indexOf(_renamingPh); if(idx<0) return;
  // remap tasks
  S.tasks.forEach(t=>{ if(t.projectId===proj.id&&t.phase===_renamingPh) t.phase=newName; });
  proj.phases[idx]=newName;
  save(); closeRenameCol(); render(); if(_drawerId){ const t=S.tasks.find(t=>t.id===_drawerId); if(t) renderDrawer(); }
}

function colCtxDelete(){
  const proj=getProject(); if(!proj||!_colCtxPh) return;
  const ph=_colCtxPh; closeColCtx();
  const n=getColTasks(proj.id,ph).length;
  if(n&&!confirm(`"${ph}" has ${n} task(s). Delete phase anyway? Tasks will be kept but hidden.`)) return;
  proj.phases=proj.phases.filter(p=>p!==ph);
  if(!proj.phases.length) proj.phases=['General'];
  save(); render();
}


// SUBTASKS
function addSubtask(taskId){
  const inp=document.getElementById('stInput_'+taskId);
  const asgn=document.getElementById('stAssign_'+taskId);
  const title=(inp?.value||'').trim(); if(!title) return;
  const assignee=(asgn?.value||'').trim().replace(/^@/,'');
  const t=S.tasks.find(t=>t.id===taskId); if(!t) return;
  if(!t.subtasks) t.subtasks=[];
  const _ts=Date.now();
  t.subtasks.push({id:uid(),title,assignee:assignee||null,done:false,startDate:tsToDateInput(_ts),createdAt:_ts,startedAt:_ts,elapsed:0,desc:'',screenshots:[],history:[{type:'created',ts:_ts}]});
  save(); renderDrawer(); render();
}

function toggleSubtask(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; const now=Date.now();
  if(!s.done){
    s.done=true; s.completedAt=now;
    const started=s.startedAt||s.createdAt;
    s.elapsed=(s.elapsed||0)+(started?now-started:0);
    s.startedAt=null;
    if(!s.history) s.history=[{type:'created',ts:s.createdAt||now}];
    s.history.push({type:'completed',ts:now,elapsed:s.elapsed});
    save(); renderDrawer(); render();
  } else {
    _reopenSubInfo={taskId,idx};
    document.getElementById('fReopenReason').value='';
    document.getElementById('reopenModal').classList.add('open');
    setTimeout(()=>document.getElementById('fReopenReason').focus(),300);
  }
}

function deleteSubtask(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const removedSub = t.subtasks.splice(idx,1)[0];
  if(removedSub) removePathsFromStorage(collectTaskPaths({ screenshots: removedSub.screenshots }));
  save(); renderDrawer(); render();
}

// SCREENSHOTS
let _uploadForTaskId=null;
let _uploadForSubtask=null; // {taskId,idx}

function triggerUpload(taskId){
  _uploadForTaskId=taskId; _uploadForSubtask=null;
  document.getElementById('ssInput').value='';
  document.getElementById('ssInput').click();
}
function triggerSubUpload(taskId,idx){
  _uploadForSubtask={taskId,idx}; _uploadForTaskId=null;
  document.getElementById('ssInput').value='';
  document.getElementById('ssInput').click();
}

const SS_BUCKET = 'vibetracker-screenshots';

// Compress an image File to a JPEG Blob, scaled to max `maxDim` on the longest side.
async function compressImage(file, maxDim = 1600, quality = 0.78){
  // Non-images (shouldn't happen given accept="image/*") pass through as-is.
  if(!file.type.startsWith('image/')) return file;
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  try {
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // flatten any transparency for JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

async function uploadScreenshot(projectId, file){
  const blob = await compressImage(file);
  const path = `${projectId}/${uuid()}.jpg`;
  const { error } = await sb.storage.from(SS_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg', cacheControl: '31536000'
  });
  if(error){ console.error('screenshot upload', error); alert('Upload failed: '+error.message); return null; }
  return path;
}

// Resolve a screenshot value to a URL usable in <img src>.
// Accepts legacy base64 data URLs, in-flight blob: URLs, or storage paths.
function shotUrl(s){
  if(!s) return '';
  if(s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:')) return s;
  return sb.storage.from(SS_BUCKET).getPublicUrl(s).data.publicUrl;
}

document.getElementById('ssInput').addEventListener('change', async function(){
  const files = Array.from(this.files);
  this.value = '';
  if(!files.length) return;

  // Resolve the target (task or subtask) and the project id for storage path.
  let target = null, projectId = null, isSubUpload = false, subInfo = null;
  if(_uploadForSubtask){
    subInfo = _uploadForSubtask; _uploadForSubtask = null; isSubUpload = true;
    const t = S.tasks.find(x => x.id === subInfo.taskId); if(!t || !t.subtasks) return;
    target = t.subtasks[subInfo.idx]; if(!target) return;
    projectId = t.projectId;
  } else if(_uploadForTaskId){
    const id = _uploadForTaskId; _uploadForTaskId = null;
    target = S.tasks.find(x => x.id === id); if(!target) return;
    projectId = target.projectId;
  } else { return; }
  if(!target.screenshots) target.screenshots = [];

  // Phase 1: show a local preview immediately so the UI feels instant.
  const pending = files.map(f => ({ blobUrl: URL.createObjectURL(f), file: f }));
  pending.forEach(p => target.screenshots.push(p.blobUrl));
  if(_drawerId) renderDrawer();
  render();

  // Phase 2: compress + upload in the background; swap blob URL for storage path.
  for(const p of pending){
    const path = await uploadScreenshot(projectId, p.file);
    const idx = target.screenshots.indexOf(p.blobUrl);
    if(idx >= 0){
      if(path) target.screenshots[idx] = path;
      else target.screenshots.splice(idx, 1); // upload failed
    }
    URL.revokeObjectURL(p.blobUrl);
  }
  save();
  if(_drawerId) renderDrawer();
  render();
});

// True if the given string is an actual Supabase storage path (not base64/http/blob).
function isStoragePath(s){
  return typeof s === 'string' && s && !s.startsWith('data:') && !s.startsWith('http') && !s.startsWith('blob:');
}

// Raw-fetch storage delete — bypasses supabase-js auth state, uses JWT directly.
async function storageDeleteRaw(paths){
  if(!paths || !paths.length) return { data: [], error: null };
  const stored = (typeof readStoredSession === 'function') ? readStoredSession() : null;
  const token = stored?.access_token;
  if(!token) return { data: null, error: { message: 'no access token' } };
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SS_BUCKET}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefixes: paths })
    });
    const body = await res.json().catch(() => null);
    if(!res.ok) return { data: null, error: { message: body?.message || ('HTTP ' + res.status), status: res.status } };
    return { data: body, error: null };
  } catch(e){
    return { data: null, error: { message: e.message || String(e) } };
  }
}

// Best-effort remove the file from storage. Skips legacy/in-flight entries.
async function removeFromStorage(pathOrData){
  if(!isStoragePath(pathOrData)) return;
  try {
    const { data, error } = await sb.storage.from(SS_BUCKET).remove([pathOrData]);
    if(error) console.warn('[storage] remove error:', error.message, pathOrData);
    else if(!data?.length) console.warn('[storage] no rows deleted for', pathOrData);
    else console.log('[storage] removed', pathOrData);
  } catch(e){ console.warn('[storage] remove threw', e); }
}

// Collect storage paths (ignore legacy base64 / in-flight blob) from a task
// including all of its subtasks.
function collectTaskPaths(task){
  const out = [];
  (task?.screenshots || []).forEach(s => { if(isStoragePath(s)) out.push(s); });
  (task?.subtasks || []).forEach(sub => {
    (sub?.screenshots || []).forEach(s => { if(isStoragePath(s)) out.push(s); });
  });
  return out;
}

// Batch-delete a list of paths. Safe with 0 entries. Best-effort.
async function removePathsFromStorage(paths){
  if(!paths || !paths.length) return;
  try {
    const { data, error } = await sb.storage.from(SS_BUCKET).remove(paths);
    if(error) console.warn('[storage] batch remove error:', error.message);
    else console.log('[storage] batch removed:', data?.length, 'of', paths.length);
  } catch(e){ console.warn('[storage] batch remove threw', e); }
}

function deleteShot(e,taskId,idx){
  e.stopPropagation();
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.screenshots) return;
  const removed = t.screenshots.splice(idx,1)[0];
  removeFromStorage(removed);
  save(); if(_drawerId===taskId){ renderDrawer(); render(); } else render();
}

function openLightbox(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.screenshots) return;
  document.getElementById('lbImg').src=shotUrl(t.screenshots[idx]);
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox(){ document.getElementById('lightbox').classList.remove('open'); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeLightbox(); closeDrawer(); } });

// CTX MENU (task)
let _ctxId=null;
function openCtx(e,id){
  e.stopPropagation(); _ctxId=id;
  const t=S.tasks.find(t=>t.id===id);
  document.getElementById('ctxToggleItem').textContent=t?.done?'↩ Reopen':'✅ Mark Done';
  const m=document.getElementById('ctx'); m.classList.add('open');
  m.style.left=Math.min(e.clientX,innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,innerHeight-110)+'px';
}
function closeCtx(){ document.getElementById('ctx').classList.remove('open'); _ctxId=null; }
function ctxEdit(){ const id=_ctxId; closeCtx(); openEditTask(id); }
function ctxToggle(){ const id=_ctxId; closeCtx(); handleCheck(id); }
function ctxDelete(){
  if(!confirm('Delete?')) return;
  const t = S.tasks.find(x => x.id === _ctxId);
  if(t) removePathsFromStorage(collectTaskPaths(t));
  S.tasks=S.tasks.filter(t=>t.id!==_ctxId); save(); render(); closeCtx();
}
document.addEventListener('click',e=>{ if(!e.target.closest('.ctx')) closeCtx(); if(!e.target.closest('.ctx')) closeColCtx(); });

// ═══════════════════════════════════════════════
// GANTT
// ═══════════════════════════════════════════════
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildGantt(tasks){
  if(!tasks.length) return '';
  const DAY=86400000;
  const now=Date.now();

  // Time range — prefer user-set startDate, fall back to timestamps
  const tStart=t=>t.startDate?parseStartDate(t.startDate):(t.startedAt||t.createdAt||now);
  const sStart=s=>s.startDate?parseStartDate(s.startDate):(s.startedAt||s.createdAt||now);
  let lo=Math.min(...tasks.map(tStart));
  let hi=now;
  tasks.forEach(t=>{
    if(t.completedAt&&t.completedAt>hi) hi=t.completedAt;
    (t.subtasks||[]).forEach(s=>{
      const ss=sStart(s);
      if(ss<lo) lo=ss;
      if(s.completedAt&&s.completedAt>hi) hi=s.completedAt;
    });
  });
  hi=Math.max(hi,now); // always extend to today

  // Ensure minimum 28-day span
  if(hi-lo<28*DAY) hi=lo+28*DAY;

  // Snap to full month boundaries
  const dLo=new Date(lo);
  const chartStart=new Date(dLo.getFullYear(),dLo.getMonth(),1).getTime();
  const dHi=new Date(hi);
  const chartEnd=new Date(dHi.getFullYear(),dHi.getMonth()+1,1).getTime(); // exclusive start of next month
  const totalMs=chartEnd-chartStart;

  const xPct=ts=>+(Math.max(0,Math.min(100,(ts-chartStart)/totalMs*100)).toFixed(2));
  const wPct=(s,e)=>+(Math.max(0.5,Math.min(100-xPct(s),(e-s)/totalMs*100)).toFixed(2));

  // Month header
  let monthHtml='';
  let cur=new Date(chartStart);
  while(cur.getTime()<chartEnd){
    const y=cur.getFullYear(), m=cur.getMonth();
    const mS=new Date(y,m,1).getTime(), mE=new Date(y,m+1,1).getTime();
    const left=+((mS-chartStart)/totalMs*100).toFixed(2);
    const w=+((mE-mS)/totalMs*100).toFixed(2);
    const label=w>7?`${MONTH_NAMES[m]} ${y}`:w>3.5?MONTH_NAMES[m]:'';
    monthHtml+=`<div class="gc-month" style="left:${left}%;width:${w}%">${label}</div>`;
    cur=new Date(y,m+1,1);
  }
  const todayPct=xPct(now);
  const todayLine=`<div class="gc-nowline" style="left:${todayPct}%"></div>`;

  // Sort by start time (prefer startDate)
  const sorted=[...tasks].sort((a,b)=>tStart(a)-tStart(b));
  let rows='';
  sorted.forEach(t=>{
    const tS=tStart(t);
    const tE=t.done?(t.completedAt||tS):now;
    const subs=(t.subtasks||[]).filter(s=>s.createdAt||s.startDate);
    rows+=`<div class="gc-row">
      <div class="gc-lbl">
        <div class="gc-tname${t.done?' done':''}" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="gc-tph">${esc(t.phase)}</div>
      </div>
      <div class="gc-track">
        ${todayLine}
        <div class="gc-bar u-${t.urgency}${t.done?' done':''}" style="left:${xPct(tS)}%;width:${wPct(tS,tE)}%" title="${esc(t.title)} · ${fmtTs(tS)}${t.done?' → '+fmtTs(tE):' · in progress'}"></div>
      </div>
    </div>`;
    subs.forEach(s=>{
      const sS=sStart(s);
      const sE=s.done?(s.completedAt||sS):now;
      rows+=`<div class="gc-row gc-srow">
        <div class="gc-lbl"><div class="gc-tname sub${s.done?' done':''}" title="${esc(s.title)}">${esc(s.title)}</div></div>
        <div class="gc-track">
          ${todayLine}
          <div class="gc-bar gc-sbar u-${t.urgency}${s.done?' done':''}" style="left:${xPct(sS)}%;width:${wPct(sS,sE)}%"  title="${esc(s.title)}${s.done?' ✓':' · in progress'}"></div>
        </div>
      </div>`;
    });
  });

  return `<div class="gc-outer">
    <div class="gc-head">
      <div class="gc-lbl"></div>
      <div class="gc-months">${monthHtml}<div class="gc-today-label" style="left:${todayPct}%">today</div></div>
    </div>
    ${rows}
  </div>`;
}

// REPORT
document.getElementById('reportBtn').addEventListener('click',()=>{
  const proj=getProject(); if(!proj) return;
  const all=getAllTasks(proj.id);
  const total=all.length,doneN=all.filter(t=>t.done).length;
  const overdue=all.filter(isOverdue).length;
  const pct=total?Math.round(doneN/total*100):0;
  const reopenedN=all.filter(t=>(t.history||[]).some(h=>h.type==='reopened')).length;
  const totalMs=all.reduce((s,t)=>s+(t.history||[]).filter(h=>h.type==='completed').reduce((a,h)=>a+(h.elapsed||0),0),0);

  const phRows=proj.phases.map(ph=>{
    const pts=getColTasks(proj.id,ph);
    const d=pts.filter(t=>t.done).length;
    const p=pts.length?Math.round(d/pts.length*100):0;
    const ms=pts.reduce((s,t)=>s+(t.history||[]).filter(h=>h.type==='completed').reduce((a,h)=>a+(h.elapsed||0),0),0);
    return{ph,total:pts.length,done:d,pct:p,ms};
  }).filter(r=>r.total>0);

  const high=all.filter(t=>t.urgency==='high'&&!t.done).length;
  const med=all.filter(t=>t.urgency==='medium'&&!t.done).length;
  const low=all.filter(t=>t.urgency==='low'&&!t.done).length;

  let h='';

  if(totalMs>0) h+=`<div class="rs"><div class="rs-title">Time Tracked</div>
    <div class="rcard" style="text-align:left;padding:14px 18px">
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:var(--accent)">${fmtMs(totalMs)||'<1m'}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:3px">Auto-tracked across all completed tasks</div>
    </div></div>`;

  if(phRows.length){
    h+=`<div class="rs"><div class="rs-title">Phase Breakdown</div>`
      +phRows.map(r=>`<div class="pbar-item">
        <div class="pbar-label">${esc(r.ph)}</div>
        <div class="pbar-track"><div class="pbar-fill" style="width:${r.pct}%"></div></div>
        <div class="pbar-pct">${r.pct}%</div>
        ${r.ms&&fmtMs(r.ms)?`<div style="font-size:10px;color:var(--text3);width:40px;text-align:right">${fmtMs(r.ms)}</div>`:''}
      </div>`).join('')+`</div>`;
  }

  const pending=all.filter(t=>!t.done).sort((a,b)=>({high:0,medium:1,low:2}[a.urgency]||1)-({high:0,medium:1,low:2}[b.urgency]||1));
  if(pending.length){
    h+=`<div class="rs"><div class="rs-title">Pending (${pending.length})</div>
      <table class="rtable"><tr><th>Task</th><th>Phase</th><th>Urgency</th><th>Assignee</th><th>Due</th></tr>
      ${pending.map(t=>`<tr><td><span class="tn">${esc(t.title)}</span></td><td>${esc(t.phase)}</td>
        <td><span class="badge b-${t.urgency}">${urgencyLabel(t.urgency)}</span></td>
        <td>${t.assignee?'@'+esc(t.assignee):'—'}</td>
        <td style="${isOverdue(t)?'color:var(--red)':''}">${t.due?fmtDate(t.due):'—'}</td></tr>`).join('')}
      </table></div>`;
  }

  const rlogs=all.flatMap(t=>(t.history||[]).filter(h=>h.type==='reopened').map(h=>({title:t.title,h})));
  if(rlogs.length){
    h+=`<div class="rs"><div class="rs-title">Reopen Log</div>
      <table class="rtable"><tr><th>Task</th><th>When</th><th>Reason</th></tr>
      ${rlogs.map(({title,h:e})=>`<tr><td><span class="tn">${esc(title)}</span></td>
        <td style="white-space:nowrap">${fmtTs(e.ts)}</td>
        <td style="color:var(--orange)">${e.reason?esc(e.reason):'<em style="color:var(--text3)">—</em>'}</td></tr>`).join('')}
      </table></div>`;
  }

  if(high||med||low) h+=`<div class="rs"><div class="rs-title">Open by Urgency</div>
    <div class="rgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="rcard"><div class="num" style="color:var(--red)">${high}</div><div class="lbl">Urgent</div></div>
      <div class="rcard"><div class="num" style="color:var(--amber)">${med}</div><div class="lbl">Medium</div></div>
      <div class="rcard"><div class="num" style="color:var(--blue)">${low}</div><div class="lbl">Low</div></div>
    </div></div>`;

  document.getElementById('reportTitle').textContent=`📊 ${proj.name}`;
  document.getElementById('reportContent').innerHTML=h;
  document.getElementById('reportModal').classList.add('open');
});
function closeReportModal(){ document.getElementById('reportModal').classList.remove('open'); }

// backdrop close for modals
['taskModal','reopenModal','projectModal','renameColModal','reportModal'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click',function(e){if(e.target===this) this.classList.remove('open');});
});

// ═══════════════════════════════════════════════
// DRAG AND DROP
// ═══════════════════════════════════════════════
function dragStart(e,id){
  e.stopPropagation();
  _dragTaskId=id;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',id);
  setTimeout(()=>{ const el=document.getElementById('tc-'+id); if(el) el.classList.add('dragging'); },0);
}
function dragEnd(){
  document.querySelectorAll('.tcard.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.col.col-task-over').forEach(el=>el.classList.remove('col-task-over'));
  _dragTaskId=null;
}

// Subtask card drag (deployed subtasks between phases)
let _dragSubInfo=null;
function dragStartSub(e,taskId,idx){
  e.stopPropagation();
  _dragSubInfo={taskId,idx};
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','sub:'+taskId+':'+idx);
  setTimeout(()=>{ const el=e.target.closest('.tcard-sub'); if(el) el.classList.add('dragging'); },0);
}
function dragEndSub(){
  document.querySelectorAll('.tcard.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.col.col-task-over').forEach(el=>el.classList.remove('col-task-over'));
  _dragSubInfo=null;
}

function getDropIndex(colBody,y){
  const cards=[...colBody.querySelectorAll('.tcard:not(.dragging)')];
  for(let i=0;i<cards.length;i++){
    const r=cards[i].getBoundingClientRect();
    if(y<r.top+r.height/2) return i;
  }
  return cards.length;
}
// Build a unified ordered list of items in a phase, reinsert the dragged item at dropIdx, reassign orders
function reorderPhaseItems(ph,dragType,dragRef,dropIdx){
  const proj=getProject(); if(!proj) return;
  // Collect all non-done items in this phase with their current order
  const items=[];
  S.tasks.filter(t=>t.projectId===proj.id&&t.phase===ph&&!t.done).forEach(t=>{
    items.push({type:'task',ref:t,key:'t:'+t.id,order:typeof t.order==='number'?t.order:9999});
  });
  S.tasks.filter(t=>t.projectId===proj.id).forEach(t=>{
    (t.subtasks||[]).forEach((s,si)=>{
      if(s.phase===ph&&!s.done) items.push({type:'sub',ref:s,key:'s:'+t.id+':'+si,order:typeof s.phaseOrder==='number'?s.phaseOrder:9999});
    });
  });
  items.sort((a,b)=>a.order-b.order);
  // Identify dragged item key
  const dragKey=dragType==='task'?'t:'+dragRef:'s:'+dragRef;
  // Remove dragged from list
  const filtered=items.filter(it=>it.key!==dragKey);
  const dragged=items.find(it=>it.key===dragKey);
  if(!dragged) return;
  const idx=Math.min(dropIdx,filtered.length);
  filtered.splice(idx,0,dragged);
  // Reassign orders
  filtered.forEach((it,i)=>{
    if(it.type==='task') it.ref.order=i;
    else it.ref.phaseOrder=i;
  });
}
// (Task/subtask drops are now handled by colDrop on the whole column.)

// ═══════════════════════════════════════════════
// COLUMN (PHASE) DRAG
// ═══════════════════════════════════════════════
let _dragColPh=null;
function colDragStart(e,ph){
  // Don't interfere with task drag
  if(_dragTaskId) return;
  _dragColPh=ph;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','col:'+ph);
  setTimeout(()=>{
    const el=e.target.closest('.col');
    if(el) el.classList.add('col-dragging');
  },0);
}
function colDragEnd(e){
  document.querySelectorAll('.col.col-dragging').forEach(el=>el.classList.remove('col-dragging'));
  document.querySelectorAll('.col.col-drag-over').forEach(el=>el.classList.remove('col-drag-over'));
  _dragColPh=null;
}
// Unified dragover for columns — accepts task/sub drops (anywhere in column)
// AND handles column reorder. No visual feedback for task drops per UX request.
function colDragOver(e){
  if(_dragTaskId || _dragSubInfo){
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('col-task-over');
    return;
  }
  if(_dragColPh){
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const col = e.currentTarget;
    if(col) col.classList.add('col-drag-over');
  }
}
function colDragLeave(e){
  const col = e.currentTarget;
  if(!col || col.contains(e.relatedTarget)) return;
  col.classList.remove('col-drag-over');
  col.classList.remove('col-task-over');
}
function colDrop(e, targetPh){
  e.currentTarget.classList.remove('col-task-over');
  // Task/subtask drop — anywhere in the column
  if(_dragTaskId || _dragSubInfo){
    e.preventDefault();
    const colBody = e.currentTarget.querySelector('.col-body');
    const dropIdx = colBody ? getDropIndex(colBody, e.clientY) : 0;
    if(_dragTaskId){
      const t = S.tasks.find(t => t.id === _dragTaskId);
      if(t){
        t.phase = targetPh;
        reorderPhaseItems(targetPh, 'task', t.id, dropIdx);
        save(); render(); if(_drawerId === _dragTaskId) renderDrawer();
      }
      _dragTaskId = null;
    } else {
      const t = S.tasks.find(t => t.id === _dragSubInfo.taskId);
      if(t && t.subtasks){
        const s = t.subtasks[_dragSubInfo.idx];
        if(s){
          s.phase = targetPh;
          reorderPhaseItems(targetPh, 'sub', t.id + ':' + _dragSubInfo.idx, dropIdx);
          save(); render();
        }
      }
      _dragSubInfo = null;
    }
    return;
  }
  // Column reorder
  e.preventDefault();
  e.stopPropagation();
  const col = e.currentTarget;
  if(col) col.classList.remove('col-drag-over');
  if(!_dragColPh || _dragColPh === targetPh) return;
  const proj = getProject(); if(!proj) return;
  const fromIdx = proj.phases.indexOf(_dragColPh);
  const toIdx = proj.phases.indexOf(targetPh);
  if(fromIdx < 0 || toIdx < 0) return;
  proj.phases.splice(fromIdx, 1);
  proj.phases.splice(toIdx, 0, _dragColPh);
  save(); render();
  _dragColPh = null;
}

// ═══════════════════════════════════════════════
// INIT — bootstrap is in supabase.js (boot() on DOMContentLoaded)
// ═══════════════════════════════════════════════
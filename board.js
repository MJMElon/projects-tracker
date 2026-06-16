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
// Ethereum-style faceted 3D diamond — pure white with varying opacity per facet.
const ETH_DIAMOND_SVG = `<svg class="col-eth" viewBox="0 0 256 417" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M127.961 0L125.166 9.5v275.668l2.795 2.79 127.962-75.638z" fill="#fff" fill-opacity="0.95"/>
  <path d="M127.962 0L0 212.32l127.962 75.639V154.158z" fill="#fff" fill-opacity="0.55"/>
  <path d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z" fill="#fff" fill-opacity="0.85"/>
  <path d="M127.962 416.905v-104.72L0 236.585z" fill="#fff" fill-opacity="0.35"/>
  <path d="M127.961 287.958l127.962-75.637-127.962-58.162z" fill="#fff" fill-opacity="0.7"/>
  <path d="M0 212.32l127.96 75.638v-133.8z" fill="#fff" fill-opacity="0.45"/>
</svg>`;
// Shared user icon — solid silhouette in currentColor (light grey via .assign-wrap)
const USER_ICON_SVG = `<svg class="assign-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8H4z"/></svg>`;
function colColor(i){ return COL_COLORS[i%COL_COLORS.length]; }
function urgencyLabel(u){ return u==='high'?'URGENT':u.toUpperCase(); }

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
function render(){
  renderProjectBar();
  renderViewToggle();
  renderDashboard();
  if(_viewMode === 'list'){
    document.getElementById('board').style.display = 'none';
    const list = document.getElementById('taskList');
    if(list){ list.style.display = ''; _renderTaskList(list); }
  } else {
    document.getElementById('board').style.display = '';
    const list = document.getElementById('taskList');
    if(list){ list.style.display = 'none'; }
    renderBoard();
  }
}

// ═══════════════════════════════════════════════
// VIEW MODE (Board ↔ List) — persisted per device
// ═══════════════════════════════════════════════
let _viewMode = 'board';
try { _viewMode = localStorage.getItem('pt_view_mode') || 'board'; } catch(e){}
let _listSort = { col: 'startDate', dir: 'desc' };
let _listFilter = { status: 'all', q: '' };

function setViewMode(mode){
  if(mode !== 'board' && mode !== 'list') return;
  _viewMode = mode;
  try { localStorage.setItem('pt_view_mode', mode); } catch(e){}
  render();
}

function renderViewToggle(){
  const el = document.getElementById('viewToggle');
  if(!el) return;
  el.innerHTML = `
    <button class="seg-btn ${_viewMode==='board'?'active':''}" onclick="setViewMode('board')" title="Board view" aria-label="Board view">
      <svg class="hdr-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="6" height="16" rx="1.5"/><rect x="11" y="4" width="6" height="16" rx="1.5" opacity=".55"/><rect x="19" y="4" width="2" height="16" rx="1" opacity=".3"/></svg>
    </button>
    <button class="seg-btn ${_viewMode==='list'?'active':''}" onclick="setViewMode('list')" title="List view" aria-label="List view">
      <svg class="hdr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
  `;
}

function _renderTaskList(container){
  const proj = getProject();
  if(!proj){ container.innerHTML = '<div class="list-empty">No project selected.</div>'; return; }
  const all = S.tasks.filter(t => t.projectId === proj.id);
  const q = _listFilter.q.toLowerCase();
  const filtered = all.filter(t => {
    if(_listFilter.status === 'open' && t.done) return false;
    if(_listFilter.status === 'done' && !t.done) return false;
    if(q && !(t.title || '').toLowerCase().includes(q)) return false;
    return true;
  });
  const dir = _listSort.dir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const va = _listSortValue(a, _listSort.col);
    const vb = _listSortValue(b, _listSort.col);
    if(va == null && vb == null) return 0;
    if(va == null) return 1; // nulls always last
    if(vb == null) return -1;
    if(typeof va === 'string') return dir * va.localeCompare(vb);
    return dir * (va - vb);
  });
  const fmtMaybe = ms => ms ? fmtDate(tsToDateInput(ms)) : '';
  const rowsHtml = sorted.length ? sorted.map(t => {
    const dur = _taskDurationLabel(t);
    return `<div class="list-row" onclick="openDrawer('${t.id}')">
      <div class="lc lc-check"><div class="tc-tick ${t.done?'checked':''}" onclick="event.stopPropagation();handleCheck('${t.id}')"></div></div>
      <div class="lc lc-title ${t.done?'done':''}">${esc(t.title)}</div>
      <div class="lc lc-assign">${t.assignee ? '@'+esc(t.assignee) : '<span class="muted">—</span>'}</div>
      <div class="lc lc-start">${t.startDate ? fmtDate(t.startDate) : '<span class="muted">—</span>'}</div>
      <div class="lc lc-done">${fmtMaybe(t.completedAt) || '<span class="muted">—</span>'}</div>
      <div class="lc lc-dur">${dur ? `<span class="lc-dur-badge">⏱ ${dur}</span>` : '<span class="muted">—</span>'}</div>
    </div>`;
  }).join('') : '<div class="list-empty">No tasks match the current filters.</div>';
  container.innerHTML = `
    <div class="list-filters">
      <input class="list-search" type="text" placeholder="Filter tasks…" value="${esc(_listFilter.q)}" oninput="_listFilterText(this.value)" />
      <select class="list-status" onchange="_listFilterStatus(this.value)">
        <option value="all" ${_listFilter.status==='all'?'selected':''}>All statuses</option>
        <option value="open" ${_listFilter.status==='open'?'selected':''}>Open</option>
        <option value="done" ${_listFilter.status==='done'?'selected':''}>Completed</option>
      </select>
      <span class="list-count">${sorted.length} of ${all.length}</span>
    </div>
    <div class="list-table">
      <div class="list-row list-head">
        <div class="lc lc-check"></div>
        <div class="lc lc-title ${_sortClass('title')}" onclick="_listSortBy('title')">Title</div>
        <div class="lc lc-assign ${_sortClass('assignee')}" onclick="_listSortBy('assignee')">Assignee</div>
        <div class="lc lc-start ${_sortClass('startDate')}" onclick="_listSortBy('startDate')">Start</div>
        <div class="lc lc-done ${_sortClass('completedAt')}" onclick="_listSortBy('completedAt')">Completed</div>
        <div class="lc lc-dur ${_sortClass('duration')}" onclick="_listSortBy('duration')">Duration</div>
      </div>
      ${rowsHtml}
    </div>
  `;
}

function _listSortValue(t, col){
  switch(col){
    case 'title':       return (t.title || '').toLowerCase();
    case 'assignee':    return (t.assignee || '').toLowerCase();
    case 'startDate':   return parseStartDate(t.startDate);
    case 'completedAt': return t.completedAt || null;
    case 'duration':    return getDisplayMs(t) || 0;
    default:            return null;
  }
}
function _sortClass(col){
  if(_listSort.col !== col) return 'sortable';
  return _listSort.dir === 'asc' ? 'sortable sort-asc' : 'sortable sort-desc';
}
function _listSortBy(col){
  if(_listSort.col === col){
    _listSort.dir = _listSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _listSort.col = col;
    _listSort.dir = col === 'title' || col === 'assignee' ? 'asc' : 'desc';
  }
  const list = document.getElementById('taskList');
  if(list) _renderTaskList(list);
}
function _listFilterText(v){
  _listFilter.q = v;
  const list = document.getElementById('taskList');
  if(list) _renderTaskList(list);
  // Preserve text-input focus across the re-render.
  const s = document.querySelector('.list-search');
  if(s){ s.focus(); try { s.setSelectionRange(s.value.length, s.value.length); } catch(e){} }
}
function _listFilterStatus(v){
  _listFilter.status = v;
  const list = document.getElementById('taskList');
  if(list) _renderTaskList(list);
}
function _taskDurationLabel(t){
  let timeFmt = fmtMs(getDisplayMs(t));
  if(t.done && !timeFmt) timeFmt = '<1d';
  return timeFmt;
}

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

// Project ordering — per-device, stored in localStorage.
function getProjectOrderMap(){
  try { return JSON.parse(localStorage.getItem('pt_proj_order') || '{}'); }
  catch(e){ return {}; }
}
function sortedProjects(){
  const m = getProjectOrderMap();
  return [...S.projects].sort((a, b) => {
    const oa = m[a.id], ob = m[b.id];
    const ah = typeof oa === 'number', bh = typeof ob === 'number';
    if(ah && bh) return oa - ob;
    if(ah) return -1;
    if(bh) return 1;
    return 0;
  });
}
function saveProjectOrder(orderedIds){
  const map = {};
  orderedIds.forEach((id, i) => { map[id] = i; });
  localStorage.setItem('pt_proj_order', JSON.stringify(map));
}

function renderProjectBar(){
  const ordered = sortedProjects();
  // Default to the top of the user's saved arrangement (not the raw DB order).
  if(!S.activeProject && ordered.length) S.activeProject = ordered[0].id;
  const invBtn = document.getElementById('inviteBtn');
  if(invBtn) invBtn.style.display = S.activeProject ? '' : 'none';
  const list = ordered;
  document.getElementById('projectBar').innerHTML =
    list.map(p =>
      `<div class="pchip ${p.id===S.activeProject?'active':''}"
            draggable="true"
            ondragstart="projDragStart(event,'${p.id}')"
            ondragover="projDragOver(event)"
            ondragleave="projDragLeave(event)"
            ondrop="projDrop(event,'${p.id}')"
            ondragend="projDragEnd(event)"
            onclick="selectProject('${p.id}')">${esc(p.name)}</div>`
    ).join('')
    +`<button class="dashed-btn" onclick="openProjectModal()">+ Project</button>`;
}

let _dragProjId = null;
function projDragStart(e, id){
  e.stopPropagation();
  _dragProjId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'proj:' + id);
  setTimeout(() => { const t = e.target; if(t && t.classList) t.classList.add('dragging'); }, 0);
}
function projDragOver(e){
  if(!_dragProjId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.pchip.proj-over').forEach(el => el.classList.remove('proj-over'));
  e.currentTarget.classList.add('proj-over');
}
function projDragLeave(e){
  if(e.currentTarget && !e.currentTarget.contains(e.relatedTarget)){
    e.currentTarget.classList.remove('proj-over');
  }
}
function projDrop(e, targetId){
  e.preventDefault();
  e.currentTarget.classList.remove('proj-over');
  if(!_dragProjId || _dragProjId === targetId){ _dragProjId = null; return; }
  const list = sortedProjects();
  const fromIdx = list.findIndex(p => p.id === _dragProjId);
  const toIdx = list.findIndex(p => p.id === targetId);
  if(fromIdx < 0 || toIdx < 0){ _dragProjId = null; return; }
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  saveProjectOrder(list.map(p => p.id));
  _dragProjId = null;
  render();
}
function projDragEnd(){
  document.querySelectorAll('.pchip.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.pchip.proj-over').forEach(el => el.classList.remove('proj-over'));
  _dragProjId = null;
}

// Returns a small {id, name} stamp describing who's performing the action right now.
function currentActor(){
  const id = (typeof _user !== 'undefined' && _user) ? _user.id : null;
  const name = (typeof getMyDisplayName === 'function')
    ? getMyDisplayName()
    : ((typeof _user !== 'undefined' && _user) ? (_user.user_metadata?.full_name || _user.user_metadata?.name || _user.email) : '');
  return { id, name: name || '' };
}

// Auto-hide threshold: tasks marked done more than 30 days ago
const OLD_DONE_MS = 30 * 86400000;
// Tasks completed more than this long ago are auto-deleted (with their attachments)
// to keep database + storage costs bounded.
const AUTO_DELETE_MS = 3 * 365 * 86400000;

// Permanently delete all tasks (with screenshots from storage) completed >3 years ago.
// Runs once per session after hydrate; safe to call repeatedly.
async function purgeExpiredTasks(){
  const now = Date.now();
  const expired = S.tasks.filter(t => t.done && t.completedAt && (now - t.completedAt) > AUTO_DELETE_MS);
  if(!expired.length) return;
  const paths = [];
  expired.forEach(t => {
    try { paths.push(...collectTaskPaths(t)); } catch(e){}
  });
  if(paths.length && typeof removePathsFromStorage === 'function'){
    try { await removePathsFromStorage(paths); }
    catch(e){ console.warn('[purge] storage cleanup failed', e); }
  }
  const expiredIds = new Set(expired.map(t => t.id));
  S.tasks = S.tasks.filter(t => !expiredIds.has(t.id));
  if(typeof save === 'function') save();
  if(typeof render === 'function') render();
  console.log('[purge] auto-deleted', expired.length, 'tasks completed >3 years ago');
}
function isOldDone(t){
  return !!(t.done && t.completedAt && (Date.now() - t.completedAt) > OLD_DONE_MS);
}
// Previously hid auto-generated recurring tasks until their start date arrived.
// Recurring tasks now open immediately when the previous instance is completed
// (startDate=today, due=next repeat date), so nothing should be hidden by this check.
// Kept as a no-op stub so call sites still work; old hidden recurring rows in storage
// will surface again on next render.
function isFutureScheduled(t){ return false; }
function getOldDoneShown(){
  try { return JSON.parse(localStorage.getItem('pt_show_old_done') || '{}'); }
  catch(e){ return {}; }
}
function isOldDoneShown(projectId, phase){
  return !!getOldDoneShown()[`${projectId}:${phase}`];
}
function toggleOldDoneShown(phase){
  const pid = S.activeProject; if(!pid) return;
  const map = getOldDoneShown();
  const key = `${pid}:${phase}`;
  map[key] = !map[key];
  localStorage.setItem('pt_show_old_done', JSON.stringify(map));
  render();
}

function renderBoard(){
  const board=document.getElementById('board');
  const proj=getProject();
  if(!proj){ board.innerHTML=''; return; }

  let html=proj.phases.map((ph,i)=>{
    const tasks=getColTasks(proj.id,ph);
    const activeN=tasks.filter(t=>!t.done).length;
    const cc=colColor(i);
    const showOld = isOldDoneShown(proj.id, ph);
    // Build unified card list: main tasks + deployed subtasks, sorted by order
    const items=[];
    tasks.forEach(t=>{
      // Hide old-completed tasks unless the toggle is on.
      if(isOldDone(t) && !showOld) return;
      // Hide tasks scheduled to start on a future date (recurring or manual).
      if(isFutureScheduled(t)) return;
      items.push({type:'task',task:t,order:typeof t.order==='number'?t.order:9999,done:t.done});
    });
    S.tasks.filter(t=>t.projectId===proj.id).forEach(t=>{
      // If the parent task is hidden (future start), hide all its deployed subtasks too.
      if(isFutureScheduled(t)) return;
      (t.subtasks||[]).forEach((s,si)=>{
        if(s.phase===ph && !s.done && !isFutureScheduled(s))
          items.push({type:'sub',task:t,sub:s,idx:si,order:typeof s.phaseOrder==='number'?s.phaseOrder:9999,done:false});
      });
    });
    items.sort((a,b)=>{
      if(a.done!==b.done) return a.done?1:-1;
      if(a.order!==b.order) return a.order-b.order;
      return 0;
    });
    const cardsHtml=items.map(it=>it.type==='task'?renderCard(it.task):renderSubCard(it.task,it.sub,it.idx)).join('');
    const hiddenCount = tasks.filter(isOldDone).length;
    const toggleHtml = (hiddenCount > 0 || showOld)
      ? `<button class="col-old-toggle" onclick="toggleOldDoneShown('${esc(ph)}')">${
          showOld
            ? '⌃ Hide completed over 30 days'
            : `⌄ Show ${hiddenCount} completed over 30 days`
        }</button>`
      : '';
    return `<div class="col" data-ph="${esc(ph)}" draggable="true" ondragstart="colDragStart(event,'${esc(ph)}')" ondragend="colDragEnd(event)" ondragover="colDragOver(event)" ondragleave="colDragLeave(event)" ondrop="colDrop(event,'${esc(ph)}')">
      <div class="col-head">
        <div class="col-dot">${ETH_DIAMOND_SVG}</div>
        <div class="col-title">${esc(ph)}</div>
        <div class="col-count" title="active / total">${activeN}/${tasks.length}</div>
        <button class="col-menu-btn" onclick="openColCtx(event,'${esc(ph)}')">⋯</button>
      </div>
      <div class="col-body" id="col-${esc(ph)}">
        ${cardsHtml}
        ${toggleHtml}
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

  // Preserve scroll positions across the innerHTML swap — column bodies + horizontal board scroll.
  const _colScrolls = {};
  board.querySelectorAll('.col[data-ph]').forEach(col => {
    const body = col.querySelector('.col-body');
    if(body) _colScrolls[col.dataset.ph] = body.scrollTop;
  });
  const _boardX = board.scrollLeft;
  board.innerHTML=html;
  board.scrollLeft = _boardX;
  board.querySelectorAll('.col[data-ph]').forEach(col => {
    const body = col.querySelector('.col-body');
    const y = _colScrolls[col.dataset.ph];
    if(body && typeof y === 'number') body.scrollTop = y;
  });
}

// Replace a drawer body's innerHTML without losing the body's vertical scroll or the
// scroll position of any inner subtask-list. Synchronous restore beats layout races.
function _drawerBodySetHtml(html){
  const el = document.getElementById('drawerBody');
  if(!el){ return; }
  const ownY = el.scrollTop;
  const subYs = [];
  el.querySelectorAll('.subtask-list').forEach(ll => subYs.push(ll.scrollTop));
  el.innerHTML = html;
  el.scrollTop = ownY;
  el.querySelectorAll('.subtask-list').forEach((ll, i) => {
    if(typeof subYs[i] === 'number') ll.scrollTop = subYs[i];
  });
}

function renderCard(t){
  const reopens=(t.history||[]).filter(h=>h.type==='reopened');
  const lastH=t.history?.length?t.history[t.history.length-1]:null;
  const isReopened=lastH?.type==='reopened'&&!t.done;
  let timeFmt=fmtMsCard(getDisplayMs(t));
  // Done tasks freeze at completedAt — if under a day, still show "<1d" so duration is always visible.
  if(t.done && !timeFmt) timeFmt='<1d';
  const subs=t.subtasks||[];
  const subsDone=subs.filter(s=>s.done).length;

  // Row 1: title + urgency badge
  const row1=`<div class="tc-row1">
    <div class="tc-title">${esc(t.title)}</div>
  </div>`;

  // Row 2: urgency + due date (same line)
  const row2=`<div class="tc-row2">
    <span class="badge b-${t.urgency} tc-urgency">${urgencyLabel(t.urgency)}</span>
    ${t.due?`<span class="badge ${isOverdue(t)?'b-overdue':'b-meta'}">DUE ${fmtDate(t.due)}${isOverdue(t)?' ⚠':''}</span>`:''}
  </div>`;

  // Row 3: duration (replaces the old "DONE" badge — strikethrough + filled tick already signal done), reopens, subtasks progress
  const r3=[];
  if(timeFmt) r3.push(`<span class="badge b-time">⏱ ${timeFmt}</span>`);
  if(reopens.length) r3.push(`<span class="badge b-reopen">↩ ${reopens.length}</span>`);
  if(subs.length) r3.push(`<span class="badge b-subtask">☑ ${subsDone}/${subs.length}</span>`);
  const row3=r3.length?`<div class="tc-row3">${r3.join('')}</div>`:'';

  // Row 4: assignee
  const row4=`<div class="tc-row4"><span class="assign-wrap ${t.assignee?'':'unassigned'}" onclick="event.stopPropagation();openAssignPicker(event,'task','${t.id}')" title="Click to reassign">${USER_ICON_SVG}<span class="badge b-assign">${t.assignee?'@'+esc(t.assignee):'Unassigned'}</span></span></div>`;

  const imgs=t.screenshots?.slice(0,2).map(s=>`<img class="tc-img" src="${shotUrl(s)}" />`).join('')||'';

  const selectedCls = _selectedTaskIds.has(t.id) ? ' selected' : '';
  return `<div class="tcard u-${t.urgency} ${t.done?'done':''} ${isReopened?'is-reopened':''}${selectedCls}" id="tc-${t.id}" draggable="true" ondragstart="dragStart(event,'${t.id}')" ondragend="dragEnd(event)" onclick="onCardClick(event,'${t.id}')">
    <div class="tc-tick ${t.done?'checked':''}" onclick="event.stopPropagation();handleCheck('${t.id}')"></div>
    <div class="tc-content">${row1}${row2}${row3}
      ${imgs?`<div class="tc-attach-thumb">${imgs}</div>`:''}
      ${row4}
    </div>
  </div>`;
}

function renderSubCard(t,s,idx){
  let timeFmt=fmtMsCard(getSubDisplayMs(s));
  if(s.done && !timeFmt) timeFmt='<1d';
  const subId=`sc-${t.id}-${idx}`;
  const subReopens=(s.history||[]).filter(h=>h.type==='reopened');
  const nests=s.subtasks||[];
  const nestsDone=nests.filter(n=>n.done).length;
  const r3=[];
  if(timeFmt) r3.push(`<span class="badge b-time">⏱ ${timeFmt}</span>`);
  if(subReopens.length) r3.push(`<span class="badge b-reopen">↩ ${subReopens.length}</span>`);
  if(nests.length) r3.push(`<span class="badge b-subtask">☑ ${nestsDone}/${nests.length}</span>`);
  const subRow4=`<div class="tc-row4"><span class="assign-wrap ${s.assignee?'':'unassigned'}" onclick="event.stopPropagation();openAssignPicker(event,'sub','${t.id}:${idx}')" title="Click to reassign">${USER_ICON_SVG}<span class="badge b-assign">${s.assignee?'@'+esc(s.assignee):'Unassigned'}</span></span></div>`;
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

// ═══════════════════════════════════════════════
// TASK MULTI-SELECT (Shift/Ctrl click on tcards, then drag the group)
// ═══════════════════════════════════════════════
let _selectedTaskIds = new Set();
let _lastSelectedId = null;

function clearTaskSelection(rerender = true){
  if(!_selectedTaskIds.size && !_lastSelectedId) return;
  _selectedTaskIds.clear();
  _lastSelectedId = null;
  if(rerender) render();
}

// Range-select main tasks within the same phase as the clicked card, between the
// last-selected card and this one.
function rangeSelectTask(id){
  const t = S.tasks.find(t => t.id === id); if(!t) return;
  const proj = getProject(); if(!proj) return;
  const phaseTasks = S.tasks
    .filter(x => x.projectId === proj.id && x.phase === t.phase && !x.done)
    .sort((a,b) => (typeof a.order==='number'?a.order:9999) - (typeof b.order==='number'?b.order:9999));
  const ids = phaseTasks.map(x => x.id);
  const curIdx = ids.indexOf(id); if(curIdx < 0) return;
  const lastIdx = _lastSelectedId ? ids.indexOf(_lastSelectedId) : -1;
  const [a, b] = lastIdx >= 0
    ? [Math.min(lastIdx, curIdx), Math.max(lastIdx, curIdx)]
    : [curIdx, curIdx];
  for(let i = a; i <= b; i++) _selectedTaskIds.add(ids[i]);
  _lastSelectedId = id;
  render();
}

// Main entry point for clicking a tcard. Plain click opens the drawer (clearing any
// active selection); Shift = range-select; Ctrl/Cmd = toggle single.
function onCardClick(e, id){
  e.stopPropagation();
  if(e.shiftKey){
    rangeSelectTask(id);
    return;
  }
  if(e.ctrlKey || e.metaKey){
    if(_selectedTaskIds.has(id)) _selectedTaskIds.delete(id);
    else _selectedTaskIds.add(id);
    _lastSelectedId = id;
    render();
    return;
  }
  if(_selectedTaskIds.size){
    _selectedTaskIds.clear();
    _lastSelectedId = null;
    render();
  }
  openDrawer(id);
}

// Clicking on empty board space clears the selection.
document.addEventListener('click', e => {
  if(!_selectedTaskIds.size) return;
  // Ignore clicks inside any tcard, the drawer, modals, popup, or the assign picker
  if(e.target.closest('.tcard, .drawer, .modal, #assignPop, .ctx, .col-head, .col-add-btn, .col-menu-btn')) return;
  clearTaskSelection();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && _selectedTaskIds.size) clearTaskSelection();
});
let _drawerSubIdx=null;
let _drawerNestIdx=null;

function openDrawer(id){
  _drawerId=id;
  renderDrawer();
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}

function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  _drawerId=null; _drawerSubIdx=null; _drawerNestIdx=null;
}

function renderDrawer(){
  if(_drawerNestIdx!==null){ renderNestedDrawer(); return; }
  if(_drawerSubIdx!==null){ renderSubtaskDrawer(); return; }
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t) return;
  const reopens=(t.history||[]).filter(h=>h.type==='reopened');
  const isReopened=!t.done&&reopens.length&&t.history[t.history.length-1]?.type==='reopened';
  let timeFmt=fmtMs(getDisplayMs(t));
  if(t.done && !timeFmt) timeFmt='<1d';

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

  // Badges row — "DONE" badge dropped; strikethrough title + filled tick signal completion, duration chip shows the day count.
  let badges='';
  badges+=`<span class="badge b-${t.urgency}">${urgencyLabel(t.urgency)}</span>`;
  if(isReopened) badges+=`<span class="badge b-reopen">↩ REOPENED</span>`;
  if(t.assignee) badges+=`<span class="assign-wrap">${USER_ICON_SVG}<span class="badge b-assign">@${esc(t.assignee)}</span></span>`;
  if(t.startDate) badges+=`<span class="badge b-meta">▶ ${fmtDate(t.startDate)}</span>`;
  if(t.due) badges+=`<span class="badge ${isOverdue(t)?'b-overdue':'b-meta'}">⏹ ${fmtDate(t.due)}${isOverdue(t)?' ⚠':''}</span>`;
  if(timeFmt) badges+=`<span class="badge b-time">⏱ ${timeFmt}</span>`;
  if(reopens.length) badges+=`<span class="badge b-reopen">↩ ${reopens.length}x reopened</span>`;
  body+=`<div class="d-section"><div class="d-section-label">Details</div><div class="d-badges">${badges}</div></div>`;

  // Description
  body+=`<div class="d-section"><div class="d-section-label">Description</div>
    <div class="d-desc ${t.desc?'':'empty'}">${t.desc?esc(t.desc):'No description added.'}</div></div>`;

  // Timeline — Start + Completed in row 1 (matches subtask layout); Due Date on its own row.
  body+=`<div class="d-section"><div class="d-section-label">Timeline</div>
    <div class="sub-dates-row">
      <div class="sub-date-field"><label>Start Date</label>
        <input type="date" id="fTaskStart_${t.id}" value="${t.startDate?t.startDate.slice(0,10):''}" onchange="saveTaskDates('${t.id}')" />
      </div>
      ${t.done?`<div class="sub-date-field"><label>Completed</label>
        <input type="date" id="fCompletedAt_${t.id}" value="${tsToDateInput(t.completedAt)}" onchange="saveTaskCompletedAt('${t.id}')" />
      </div>`:''}
    </div>
    <div class="sub-dates-row" style="margin-top:8px">
      <div class="sub-date-field"><label>Due Date</label>
        <input type="date" id="fTaskDue_${t.id}" value="${t.due||''}" onchange="saveTaskDates('${t.id}')" />
      </div>
    </div>
    ${t.repeat && t.repeat.freq && t.repeat.freq !== 'off' ? `<div class="repeat-info">🔁 ${esc(formatRepeatInfo(t.repeat))}</div>` : ''}
  </div>`;

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
    subsHtml+=`<div class="subtask-list" ondragover="subRowDragOver(event)" ondrop="subRowDrop(event)">`+subs.map((s,i)=>{
      const subTimeFmt=fmtMsSub(getSubDisplayMs(s));
      const stReopens=(s.history||[]).filter(h=>h.type==='reopened').length;
      const metaChips=[];
      if(s.phase&&!s.done) metaChips.push(`<span class="st-phase">📌 ${esc(s.phase)}</span>`);
      if(stReopens) metaChips.push(`<span class="st-reopen">↩ ${stReopens}</span>`);
      if(subTimeFmt) metaChips.push(`<span class="st-time">⏱ ${subTimeFmt}</span>`);
      const metaHtml=metaChips.length?`<div class="st-meta">${metaChips.join('')}</div>`:'';
      return `<div class="subtask-row" draggable="true" ondragstart="subRowDragStart(event,'sub',${i})" ondragend="subRowDragEnd(event)" onclick="openSubtaskDetail('${t.id}',${i})">
        <div class="st-check ${s.done?'checked':''}" onclick="event.stopPropagation();toggleSubtask('${t.id}',${i})"></div>
        <div class="st-info">
          <div class="st-title ${s.done?'done':''}">${esc(s.title)}</div>
          ${metaHtml}
        </div>
        <span class="assign-wrap ${s.assignee?'':'unassigned'}" onclick="event.stopPropagation();openAssignPicker(event,'sub','${t.id}:${i}')" title="Click to reassign">${USER_ICON_SVG}<span class="st-assign">${s.assignee?'@'+esc(s.assignee):'Unassigned'}</span></span>
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
      const byTxt = h.by?.name ? ` <span class="h-by">by ${esc(h.by.name)}</span>` : '';
      if(h.type==='created') return `<div class="h-entry"><div class="h-dot created"></div><div class="h-info"><div class="h-label">Task created${byTxt}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='completed') return `<div class="h-entry"><div class="h-dot completed"></div><div class="h-info"><div class="h-label">Marked done${byTxt}${h.elapsed&&fmtMs(h.elapsed)?` · <span style="color:var(--accent)">${fmtMs(h.elapsed)}</span>`:''}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='reopened') return `<div class="h-entry"><div class="h-dot reopened"></div><div class="h-info"><div class="h-label">Reopened${byTxt}</div><div class="h-time">${fmtTs(h.ts)}</div>${h.reason?`<div class="h-reason">"${esc(h.reason)}"</div>`:''}</div></div>`;
      return '';
    }).join('');
    body+=`<div class="d-section"><div class="d-section-label">Activity</div><div class="h-list">${histHtml}</div></div>`;
  }

  _drawerBodySetHtml(body);

  // FOOT
  document.getElementById('drawerFoot').innerHTML=`
    <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openEditTask('${t.id}')">✏️ Edit</button>
    <button class="btn btn-ghost btn-sm" onclick="duplicateTask('${t.id}')">📋 Duplicate</button>
    <button class="btn btn-danger btn-sm" onclick="deleteFromDrawer('${t.id}')">🗑 Delete</button>`;
}

// Duplicate a main task — clones subtasks AND nested subtasks. Everything is
// reset to a fresh "open" state with start dates set to now. Screenshots are
// shared by reference (same storage paths) to avoid extra uploads.
function duplicateTask(taskId){
  const src = S.tasks.find(t => t.id === taskId);
  if(!src) return;
  const now = Date.now();
  const startDate = tsToDateInput(now);

  // Duplicates start unassigned across all levels so the new copy is a clean template.
  function cloneNested(n){
    return {
      id: uid(),
      title: n.title,
      desc: n.desc || '',
      assignee: null,
      done: false, completedAt: null,
      startedAt: now, createdAt: now,
      startDate, due: n.due || '',
      elapsed: 0,
      screenshots: [...(n.screenshots || [])],
      history: [{ type: 'created', ts: now, by: currentActor() }]
    };
  }
  function cloneSub(s){
    return {
      id: uid(),
      title: s.title,
      desc: s.desc || '',
      assignee: null,
      done: false, completedAt: null,
      startedAt: now, createdAt: now,
      startDate, due: s.due || '',
      elapsed: 0,
      phase: s.phase || null,
      screenshots: [...(s.screenshots || [])],
      subtasks: (s.subtasks || []).map(cloneNested),
      history: [{ type: 'created', ts: now, by: currentActor() }]
    };
  }

  const dup = {
    id: uid(),
    projectId: src.projectId,
    title: 'Copy of ' + src.title,
    desc: src.desc || '',
    phase: src.phase,
    urgency: src.urgency,
    assignee: '',
    due: src.due || '',
    startDate,
    done: false,
    completedAt: null,
    startedAt: now,
    createdAt: now,
    screenshots: [...(src.screenshots || [])],
    subtasks: (src.subtasks || []).map(cloneSub),
    repeat: src.repeat ? { ...src.repeat } : null,
    history: [{ type: 'created', ts: now, by: currentActor() }]
  };
  S.tasks.push(dup);
  save();
  render();
}

function deleteFromDrawer(id){
  if(!confirm('Delete this task?')) return;
  const t = S.tasks.find(x => x.id === id);
  if(t) removePathsFromStorage(collectTaskPaths(t));
  S.tasks=S.tasks.filter(t=>t.id!==id); save(); closeDrawer(); render();
}
function saveTaskDates(taskId){
  const t=S.tasks.find(t=>t.id===taskId); if(!t) return;
  const start=document.getElementById('fTaskStart_'+taskId);
  const due=document.getElementById('fTaskDue_'+taskId);
  if(start) t.startDate = start.value || '';
  if(due) t.due = due.value || '';
  save(); render();
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
function backToTask(){ _drawerSubIdx=null; _drawerNestIdx=null; renderDrawer(); }
function openNestedDetail(nestIdx){ _drawerNestIdx=nestIdx; renderDrawer(); }
function backToSubtask(){ _drawerNestIdx=null; renderDrawer(); }

function renderNestedDrawer(){
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t) return;
  const s=t.subtasks?.[_drawerSubIdx]; if(!s) return;
  const n=s.subtasks?.[_drawerNestIdx]; if(!n) return;
  if(!n.screenshots) n.screenshots=[];
  if(!n.history) n.history=[{type:'created',ts:n.createdAt||Date.now()}];

  // HEAD
  document.getElementById('drawerHead').innerHTML=`
    <button class="drawer-back" onclick="backToSubtask()">← ${esc(s.title)}</button>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>`;

  // BODY
  let body='';
  body+=`<div class="sub-detail-header">
    <div class="drawer-check ${n.done?'checked':''}" onclick="toggleNestedSubtask('${t.id}',${_drawerSubIdx},${_drawerNestIdx})"></div>
    <input class="drawer-title-input ${n.done?'done':''}" id="nestTitleInputDetail_${n.id}" value="${esc(n.title)}" onblur="saveNestedTitleFromDetail()" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" />
  </div>`;

  let badges='';
  if(n.assignee) badges+=`<span class="assign-wrap">${USER_ICON_SVG}<span class="badge b-assign">@${esc(n.assignee)}</span></span>`;
  if(badges) body+=`<div class="d-section"><div class="d-badges">${badges}</div></div>`;

  body+=`<div class="d-section"><div class="d-section-label">Assign To</div>
    <select class="sub-phase-select" id="nestAssignSel_${n.id}" onchange="saveNestedAssignee()">${buildAssigneeOptions(n.assignee||'')}</select>
  </div>`;

  body+=`<div class="d-section"><div class="d-section-label">Timeline</div>
    <div class="sub-dates-row">
      <div class="sub-date-field"><label>Start Date</label>
        <input type="date" id="nestStart_${n.id}" value="${n.startDate?n.startDate.slice(0,10):''}" onchange="saveNestedDates()" />
      </div>
      ${n.done?`<div class="sub-date-field"><label>Completed</label>
        <input type="date" id="nestCompleted_${n.id}" value="${tsToDateInput(n.completedAt)}" onchange="saveNestedDates()" />
      </div>`:''}
    </div>
    <div class="sub-dates-row" style="margin-top:8px">
      <div class="sub-date-field"><label>Due Date</label>
        <input type="date" id="nestDue_${n.id}" value="${n.due||''}" onchange="saveNestedDates()" />
      </div>
    </div>
  </div>`;

  body+=`<div class="d-section"><div class="d-section-label">Description</div>
    <textarea class="sub-desc-input" id="nestDesc_${n.id}" placeholder="Add notes, links, details..." oninput="debounceSaveNestedDesc()">${esc(n.desc||'')}</textarea>
  </div>`;

  const shots=n.screenshots;
  let ssGrid=shots.map((ss,i)=>`
    <div class="ss-thumb" onclick="openNestedLightbox(${i})">
      <img src="${shotUrl(ss)}" loading="lazy" />
      <button class="ss-del" onclick="deleteNestedShot(event,${i})">✕</button>
    </div>`).join('');
  ssGrid+=`<button class="ss-upload-btn" onclick="triggerNestedUpload()">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3v10M5 8l5-5 5 5" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17h14" stroke="#4a5568" stroke-width="1.5" stroke-linecap="round"/></svg>
    <span>Add screenshot</span>
  </button>`;
  body+=`<div class="d-section"><div class="d-section-label">Screenshots (${shots.length})</div><div class="screenshots-grid">${ssGrid}</div></div>`;

  _drawerBodySetHtml(body);
  document.getElementById('drawerFoot').innerHTML=`
    <button class="btn btn-danger btn-sm" onclick="deleteNestedFromDrawer()">🗑 Delete Subtask</button>`;
}

function _curNested(){
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t) return null;
  const s=t.subtasks?.[_drawerSubIdx]; if(!s) return null;
  const n=s.subtasks?.[_drawerNestIdx]; if(!n) return null;
  return { t, s, n };
}
function saveNestedTitleFromDetail(){
  const ctx=_curNested(); if(!ctx) return;
  const inp=document.getElementById('nestTitleInputDetail_'+ctx.n.id); if(!inp) return;
  const v=inp.value.trim(); if(!v){ inp.value=ctx.n.title; return; }
  if(v===ctx.n.title) return;
  ctx.n.title=v; save(); render();
}
function saveNestedAssignee(){
  const ctx=_curNested(); if(!ctx) return;
  const sel=document.getElementById('nestAssignSel_'+ctx.n.id);
  ctx.n.assignee = sel ? (sel.value || null) : ctx.n.assignee;
  save(); renderDrawer();
}
function saveNestedDates(){
  const ctx=_curNested(); if(!ctx) return;
  const start=document.getElementById('nestStart_'+ctx.n.id);
  const due=document.getElementById('nestDue_'+ctx.n.id);
  if(start) ctx.n.startDate = start.value || null;
  if(due) ctx.n.due = due.value || '';
  if(ctx.n.done){
    const comp=document.getElementById('nestCompleted_'+ctx.n.id);
    if(comp && comp.value){
      const [y,m,d]=comp.value.split('-').map(Number);
      ctx.n.completedAt=new Date(y,m-1,d).getTime();
    }
  }
  save();
}
let _nestDescTimer=null;
function debounceSaveNestedDesc(){
  clearTimeout(_nestDescTimer);
  _nestDescTimer=setTimeout(()=>{
    const ctx=_curNested(); if(!ctx) return;
    const inp=document.getElementById('nestDesc_'+ctx.n.id);
    if(inp){ ctx.n.desc=inp.value.trim(); save(); }
  }, 500);
}
function deleteNestedFromDrawer(){
  const ctx=_curNested(); if(!ctx) return;
  if(!confirm('Delete this nested subtask?')) return;
  // Clean up storage paths first
  removePathsFromStorage((ctx.n.screenshots||[]).filter(isStoragePath));
  ctx.s.subtasks.splice(_drawerNestIdx, 1);
  _drawerNestIdx=null;
  save(); render(); renderDrawer();
}
function openNestedLightbox(idx){
  const ctx=_curNested(); if(!ctx||!ctx.n.screenshots) return;
  document.getElementById('lbImg').src=shotUrl(ctx.n.screenshots[idx]);
  document.getElementById('lightbox').classList.add('open');
}
function deleteNestedShot(e, idx){
  e.stopPropagation();
  const ctx=_curNested(); if(!ctx||!ctx.n.screenshots) return;
  const removed=ctx.n.screenshots.splice(idx,1)[0];
  removeFromStorage(removed);
  save(); renderDrawer();
}
let _uploadForNested=null; // {taskId, subIdx, nestIdx}
function triggerNestedUpload(){
  _uploadForNested={ taskId:_drawerId, subIdx:_drawerSubIdx, nestIdx:_drawerNestIdx };
  _uploadForSubtask=null; _uploadForTaskId=null;
  document.getElementById('ssInput').value='';
  document.getElementById('ssInput').click();
}


function renderSubtaskDrawer(){
  const t=S.tasks.find(t=>t.id===_drawerId); if(!t||_drawerSubIdx===null) return;
  const s=t.subtasks[_drawerSubIdx]; if(!s) return;
  // migrate old subtasks
  if(!s.screenshots) s.screenshots=[];
  if(!s.history) s.history=[{type:'created',ts:s.createdAt||Date.now()}];

  let timeFmt=fmtMsSub(getSubDisplayMs(s));
  if(s.done && !timeFmt) timeFmt='<1d';

  // HEAD
  document.getElementById('drawerHead').innerHTML=`
    <button class="drawer-back" onclick="backToTask()">← ${esc(t.title)}</button>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>`;

  // BODY
  let body='';
  body+=`<div class="sub-detail-header">
    <div class="drawer-check ${s.done?'checked':''}" onclick="toggleSubtask('${t.id}',${_drawerSubIdx})"></div>
    <input class="drawer-title-input ${s.done?'done':''}" id="subTitleInput_${s.id}" value="${esc(s.title)}" onblur="saveSubtaskTitle('${t.id}',${_drawerSubIdx})" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" />
  </div>`;

  const drawerReopens=(s.history||[]).filter(h=>h.type==='reopened');
  let badges='';
  if(s.phase&&!s.done) badges+=`<span class="badge b-meta">📌 ${esc(s.phase)}</span>`;
  if(timeFmt) badges+=`<span class="badge b-time">⏱ ${timeFmt}</span>`;
  if(s.assignee) badges+=`<span class="assign-wrap">${USER_ICON_SVG}<span class="badge b-assign">@${esc(s.assignee)}</span></span>`;
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

  // Nested subtasks (level-2). No phase deployment. Same toggle/delete pattern.
  if(!s.subtasks) s.subtasks=[];
  const nests = s.subtasks;
  const nestsDone = nests.filter(n=>n.done).length;
  const nestsPct = nests.length ? Math.round(nestsDone/nests.length*100) : 0;
  let nestHtml = '';
  if(nests.length){
    nestHtml += `<div class="st-progress">
      <div class="st-progress-track"><div class="st-progress-fill" style="width:${nestsPct}%"></div></div>
      <div class="st-progress-txt">${nestsDone}/${nests.length}</div>
    </div>`;
    nestHtml += `<div class="subtask-list" ondragover="subRowDragOver(event)" ondrop="subRowDrop(event)">`+nests.map((n,ni)=>{
      const ntReopens=(n.history||[]).filter(h=>h.type==='reopened').length;
      const metaChips=[];
      if(ntReopens) metaChips.push(`<span class="st-reopen">↩ ${ntReopens}</span>`);
      const metaHtml=metaChips.length?`<div class="st-meta">${metaChips.join('')}</div>`:'';
      return `<div class="subtask-row" draggable="true" ondragstart="subRowDragStart(event,'nest',${ni})" ondragend="subRowDragEnd(event)" onclick="openNestedDetail(${ni})">
        <div class="st-check ${n.done?'checked':''}" onclick="event.stopPropagation();toggleNestedSubtask('${t.id}',${_drawerSubIdx},${ni})"></div>
        <div class="st-info"><div class="st-title ${n.done?'done':''}">${esc(n.title)}</div>${metaHtml}</div>
        <span class="assign-wrap ${n.assignee?'':'unassigned'}" onclick="event.stopPropagation();openAssignPicker(event,'nest','${t.id}:${_drawerSubIdx}:${ni}')" title="Click to reassign">${USER_ICON_SVG}<span class="st-assign">${n.assignee?'@'+esc(n.assignee):'Unassigned'}</span></span>
        <button class="st-del" onclick="event.stopPropagation();deleteNestedSubtask('${t.id}',${_drawerSubIdx},${ni})">✕</button>
      </div>`;
    }).join('')+`</div>`;
  }
  nestHtml += `<div class="st-add-row">
    <input class="st-add-input" id="nestInput_${s.id}" placeholder="Add nested subtask..." onkeydown="if(event.key==='Enter') addNestedSubtask('${t.id}',${_drawerSubIdx})" />
    <select class="st-add-assign" id="nestAssign_${s.id}">${buildAssigneeOptions('')}</select>
    <button class="btn btn-ghost btn-sm" onclick="addNestedSubtask('${t.id}',${_drawerSubIdx})">+</button>
  </div>`;
  body+=`<div class="d-section"><div class="d-section-label">Subtasks${nests.length?` (${nestsDone}/${nests.length})`:''}</div>${nestHtml}</div>`;

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
      const byTxt = h.by?.name ? ` <span class="h-by">by ${esc(h.by.name)}</span>` : '';
      if(h.type==='created') return `<div class="h-entry"><div class="h-dot created"></div><div class="h-info"><div class="h-label">Subtask created${byTxt}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='completed') return `<div class="h-entry"><div class="h-dot completed"></div><div class="h-info"><div class="h-label">Marked done${byTxt}${h.elapsed&&fmtMsSub(h.elapsed)?` · <span style="color:var(--accent)">${fmtMsSub(h.elapsed)}</span>`:''}</div><div class="h-time">${fmtTs(h.ts)}</div></div></div>`;
      if(h.type==='reopened') return `<div class="h-entry"><div class="h-dot reopened"></div><div class="h-info"><div class="h-label">Reopened${byTxt}</div><div class="h-time">${fmtTs(h.ts)}</div>${h.reason?`<div class="h-reason">"${esc(h.reason)}"</div>`:''}</div></div>`;
      return '';
    }).join('');
    body+=`<div class="d-section"><div class="d-section-label">Activity</div><div class="h-list">${histHtml}</div></div>`;
  }

  _drawerBodySetHtml(body);
  document.getElementById('drawerFoot').innerHTML=`
    <button class="btn btn-danger btn-sm" onclick="deleteSubtaskFromDrawer('${t.id}',${_drawerSubIdx})">🗑 Delete Subtask</button>`;
}

let _subDescTimer=null;
function debounceSaveSubDesc(taskId,idx){
  clearTimeout(_subDescTimer);
  _subDescTimer=setTimeout(()=>saveSubtaskDesc(taskId,idx),500);
}
function saveSubtaskTitle(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s=t.subtasks[idx]; if(!s) return;
  const inp=document.getElementById('subTitleInput_'+s.id);
  if(!inp) return;
  const newTitle=inp.value.trim();
  if(!newTitle){ inp.value = s.title; return; } // ignore empty, restore
  if(newTitle === s.title) return;
  s.title = newTitle;
  save(); render();
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
  if(removedSub){
    const paths = [];
    (removedSub.screenshots||[]).forEach(s => { if(isStoragePath(s)) paths.push(s); });
    (removedSub.subtasks||[]).forEach(n => (n.screenshots||[]).forEach(s => { if(isStoragePath(s)) paths.push(s); }));
    removePathsFromStorage(paths);
  }
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

// Human-readable summary of a repeat rule, e.g. "Repeats weekly on Monday".
function formatRepeatInfo(r){
  if(!r || !r.freq || r.freq === 'off') return '';
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = _MONTH_NAMES;
  const ord = n => {
    const v = n % 100;
    if(v >= 11 && v <= 13) return n + 'th';
    switch(n % 10){ case 1: return n + 'st'; case 2: return n + 'nd'; case 3: return n + 'rd'; default: return n + 'th'; }
  };
  if(r.freq === 'daily') return 'Repeats daily';
  if(r.freq === 'weekly'){
    const wd = (typeof r.weekday === 'number') ? r.weekday : (Array.isArray(r.weekdays) && r.weekdays.length ? r.weekdays[0] : 0);
    return 'Repeats weekly on ' + dayNames[wd];
  }
  if(r.freq === 'monthly') return 'Repeats monthly on the ' + ord(r.monthDay || 1);
  if(r.freq === 'yearly'){
    const m = (typeof r.yearMonth === 'number') ? r.yearMonth : 0;
    return 'Repeats yearly on ' + monthNames[m] + ' ' + (r.yearDay || 1);
  }
  if(r.freq === 'custom'){
    const interval = Math.max(1, r.interval || 1);
    const unit = r.unit || 'months';
    const unitWord = interval === 1 ? unit.slice(0, -1) : unit; // "month" vs "months"
    const prefix = interval === 1 ? 'Repeats every ' + unitWord : 'Repeats every ' + interval + ' ' + unitWord;
    if(unit === 'months') return prefix + ' on the ' + ord(r.monthDay || 1);
    if(unit === 'years')  return prefix + ' on ' + monthNames[r.yearMonth || 0] + ' ' + (r.monthDay || 1);
    if(unit === 'weeks')  return prefix + ' on ' + dayNames[r.weekday || 0];
    return prefix;
  }
  return '';
}

// Compute the next due date based on a repeat rule, starting from `from` (Date).
function nextRepeatDate(rule, from){
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if(rule.freq === 'daily') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if(rule.freq === 'weekly'){
    // Single weekday — find the next date that matches it (1–7 days out).
    const target = (typeof rule.weekday === 'number')
      ? rule.weekday
      : (Array.isArray(rule.weekdays) && rule.weekdays.length ? rule.weekdays[0] : d.getDay());
    for(let i = 1; i <= 7; i++){
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
      if(next.getDay() === target) return next;
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  }
  if(rule.freq === 'monthly'){
    // Find the next occurrence of `monthDay`. If today is that day or past
    // it for the current month, jump to next month. Clamp to month length.
    const targetDay = Math.min(Math.max(rule.monthDay || d.getDate(), 1), 31);
    let y = d.getFullYear(), m = d.getMonth();
    if(d.getDate() >= targetDay){ m += 1; if(m > 11){ m = 0; y += 1; } }
    const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(targetDay, lastDayOfMonth));
  }
  if(rule.freq === 'yearly'){
    const tm = (typeof rule.yearMonth === 'number') ? rule.yearMonth : d.getMonth();
    const td = Math.min(Math.max(rule.yearDay || d.getDate(), 1), 31);
    let y = d.getFullYear();
    const candidate = new Date(y, tm, td);
    if(candidate.getTime() <= d.getTime()) y += 1;
    const lastDayOfMonth = new Date(y, tm + 1, 0).getDate();
    return new Date(y, tm, Math.min(td, lastDayOfMonth));
  }
  if(rule.freq === 'custom'){
    const interval = Math.max(1, rule.interval || 1);
    const unit = rule.unit || 'months';
    if(unit === 'days'){
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + interval);
    }
    if(unit === 'weeks'){
      // Jump `interval` weeks forward, then snap to the configured weekday (forward only).
      const base = new Date(d.getFullYear(), d.getMonth(), d.getDate() + interval * 7);
      const target = (typeof rule.weekday === 'number') ? rule.weekday : base.getDay();
      const diff = (target - base.getDay() + 7) % 7;
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff);
    }
    if(unit === 'months'){
      const targetDay = Math.min(Math.max(rule.monthDay || d.getDate(), 1), 31);
      const totalMonths = d.getFullYear() * 12 + d.getMonth() + interval;
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12;
      const lastDay = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(targetDay, lastDay));
    }
    if(unit === 'years'){
      const tm = (typeof rule.yearMonth === 'number') ? rule.yearMonth : d.getMonth();
      const td = Math.min(Math.max(rule.monthDay || d.getDate(), 1), 31);
      const y = d.getFullYear() + interval;
      const lastDay = new Date(y, tm + 1, 0).getDate();
      return new Date(y, tm, Math.min(td, lastDay));
    }
  }
  return d;
}

function handleCheck(id){
  const t=S.tasks.find(t=>t.id===id); if(!t) return;
  if(!t.done){
    const now=Date.now();
    t.done=true; t.completedAt=now;
    if(!t.history) t.history=[];
    t.history.push({type:'completed',ts:now,by:currentActor(),elapsed:t.startedAt?now-t.startedAt:null,prevStart:t.startedAt||null});
    t.startedAt=null;
    // If this task has a repeat rule, spawn the next recurring instance immediately.
    // It opens NOW (visible) with startDate = today and due = the next computed repeat date,
    // so the user has the next iteration ready to work on right away.
    // Anchor the schedule on the previous task's due date so cadence stays calendar-locked
    // ("every 2 months on the 15th" always means the 15th, no drift from late check-offs).
    // Fall back to completion time when no due date is set.
    if(t.repeat && t.repeat.freq && t.repeat.freq !== 'off'){
      const anchorMs = parseStartDate(t.due) || Date.now();
      const next = nextRepeatDate(t.repeat, new Date(anchorMs));
      const nextStr = tsToDateInput(next.getTime());
      const todayStr = tsToDateInput(now);
      function cloneNested(n){
        return {
          id: uid(), title: n.title, desc: n.desc || '', assignee: n.assignee || null,
          done: false, completedAt: null,
          startedAt: now, createdAt: now,
          startDate: todayStr, due: n.due || '', elapsed: 0,
          screenshots: [...(n.screenshots || [])],
          fromRecurrence: true,
          history: [{ type: 'created', ts: now, reason: 'recurring', by: currentActor() }]
        };
      }
      function cloneSub(s){
        return {
          id: uid(), title: s.title, desc: s.desc || '', assignee: s.assignee || null,
          done: false, completedAt: null,
          startedAt: now, createdAt: now,
          startDate: todayStr, due: s.due || '', elapsed: 0,
          phase: s.phase || null,
          screenshots: [...(s.screenshots || [])],
          subtasks: (s.subtasks || []).map(cloneNested),
          fromRecurrence: true,
          history: [{ type: 'created', ts: now, reason: 'recurring', by: currentActor() }]
        };
      }
      const newTask = {
        id: uid(),
        projectId: t.projectId,
        title: t.title,
        desc: t.desc || '',
        phase: t.phase,
        urgency: t.urgency,
        assignee: t.assignee || '',
        due: nextStr,        // ← due = the next computed repeat date
        startDate: todayStr, // ← visible/open from today, not the next date
        done: false, completedAt: null,
        startedAt: now, createdAt: now,
        screenshots: [...(t.screenshots || [])],
        subtasks: (t.subtasks || []).map(cloneSub),
        repeat: { ...t.repeat },
        fromRecurrence: true,
        history: [{ type: 'created', ts: now, reason: 'recurring', by: currentActor() }]
      };
      S.tasks.push(newTask);
      // The completed task no longer needs a repeat rule (it's the "done" historical instance)
      t.repeat = null;
    }
    // Cascade: complete any ongoing subtasks AND their nested subtasks.
    // (Reopening the parent later does NOT reopen these.)
    (t.subtasks||[]).forEach(s=>{
      if(!s.done){
        s.done=true; s.completedAt=now;
        const started=s.startedAt||s.createdAt;
        s.elapsed=(s.elapsed||0)+(started?now-started:0);
        s.startedAt=null;
        if(!s.history) s.history=[{type:'created',ts:s.createdAt||now}];
        s.history.push({type:'completed',ts:now,by:currentActor(),elapsed:s.elapsed,reason:'parent task completed'});
      }
      (s.subtasks||[]).forEach(n=>{
        if(!n.done){
          n.done=true; n.completedAt=now;
          const ns=n.startedAt||n.createdAt;
          n.elapsed=(n.elapsed||0)+(ns?now-ns:0);
          n.startedAt=null;
          if(!n.history) n.history=[{type:'created',ts:n.createdAt||now}];
          n.history.push({type:'completed',ts:now,by:currentActor(),elapsed:n.elapsed,reason:'parent task completed'});
        }
      });
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
    s.history.push({type:'reopened',ts:now,by:currentActor(),reason:reason||null});
    save(); closeReopenModal(); render(); if(_drawerId===taskId) renderDrawer();
  } else if(_reopenId){
    const t=S.tasks.find(t=>t.id===_reopenId); if(!t){closeReopenModal();return;}
    t.done=false; t.completedAt=null; t.startedAt=now;
    if(!t.history) t.history=[];
    t.history.push({type:'reopened',ts:now,by:currentActor(),reason:reason||null});
    save(); closeReopenModal(); render(); if(_drawerId===_reopenId) renderDrawer();
  }
}
function closeReopenModal(){ document.getElementById('reopenModal').classList.remove('open'); _reopenId=null; _reopenSubInfo=null; }

// ═══════════════════════════════════════════════
// TASK MODAL
// ═══════════════════════════════════════════════
let _editId=null;

// ── ASSIGNEE QUICK PICKER (click @name on a card to reassign) ──
function openAssignPicker(e, kind, ref){
  e.stopPropagation();
  closeAssignPicker();
  const pop = document.getElementById('assignPop'); if(!pop) return;
  const members = (typeof _membersByProject !== 'undefined' && _membersByProject[S.activeProject]) || [];
  const names = members.map(m => m.display_name);
  const cur = (kind === 'task')
    ? (S.tasks.find(t => t.id === ref)?.assignee || '')
    : (kind === 'nest') ? (() => {
        const [tid, six, nix] = ref.split(':');
        const t = S.tasks.find(t => t.id === tid);
        return t?.subtasks?.[+six]?.subtasks?.[+nix]?.assignee || '';
      })() : (() => {
        const [tid, ix] = ref.split(':');
        const t = S.tasks.find(t => t.id === tid);
        return t?.subtasks?.[+ix]?.assignee || '';
      })();
  const items = [
    `<div class="assign-pop-item ${!cur?'active':''}" onclick="pickAssignee('${kind}','${ref}','')">— Unassigned —</div>`,
    ...names.map(n => `<div class="assign-pop-item ${n===cur?'active':''}" onclick="pickAssignee('${kind}','${ref}','${esc(n).replace(/'/g,"\\'")}')">${esc(n)}</div>`)
  ];
  pop.innerHTML = items.join('');
  pop.classList.add('open');
  // Position near the click
  const x = Math.min(e.clientX, innerWidth - 200);
  const y = Math.min(e.clientY + 8, innerHeight - pop.offsetHeight - 12);
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
}
function closeAssignPicker(){
  const pop = document.getElementById('assignPop');
  if(pop) pop.classList.remove('open');
}
function pickAssignee(kind, ref, name){
  if(kind === 'task'){
    const t = S.tasks.find(t => t.id === ref);
    if(t){ t.assignee = name; save(); render(); if(_drawerId === t.id) renderDrawer(); }
  } else if(kind === 'nest'){
    const [tid, six, nix] = ref.split(':');
    const t = S.tasks.find(t => t.id === tid);
    const n = t?.subtasks?.[+six]?.subtasks?.[+nix];
    if(n){ n.assignee = name; save(); render(); if(_drawerId === tid) renderDrawer(); }
  } else {
    const [tid, ix] = ref.split(':');
    const t = S.tasks.find(t => t.id === tid);
    if(t?.subtasks?.[+ix]){ t.subtasks[+ix].assignee = name; save(); render(); if(_drawerId === tid) renderDrawer(); }
  }
  closeAssignPicker();
}
document.addEventListener('click', e => { if(!e.target.closest('#assignPop') && !e.target.closest('.assign-wrap')) closeAssignPicker(); });

// Build <option> list of project members for the assignee dropdown.
// Returns HTML string. `selected` is the currently-assigned name (may be legacy text).
function buildAssigneeOptions(selected){
  const members = (typeof _membersByProject !== 'undefined' && _membersByProject[S.activeProject]) || [];
  const names = members.map(m => m.display_name);
  // If selected is set but not in members list (legacy or former member), keep it as an option.
  if(selected && !names.includes(selected)) names.push(selected);
  const opts = [`<option value="">Unassigned</option>`]
    .concat(names.map(n => `<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`));
  return opts.join('');
}

const _MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function _populateRepeatDropdowns(){
  const monthDay = document.getElementById('fRepeatMonthDay');
  if(monthDay && !monthDay.options.length){
    let html = '';
    for(let i = 1; i <= 31; i++) html += `<option value="${i}">${i}</option>`;
    monthDay.innerHTML = html;
  }
  const yearMonth = document.getElementById('fRepeatYearMonth');
  if(yearMonth && !yearMonth.options.length){
    yearMonth.innerHTML = _MONTH_NAMES.map((n,i) => `<option value="${i}">${n}</option>`).join('');
  }
  const yearDay = document.getElementById('fRepeatYearDay');
  if(yearDay && !yearDay.options.length){
    let html = '';
    for(let i = 1; i <= 31; i++) html += `<option value="${i}">${i}</option>`;
    yearDay.innerHTML = html;
  }
  const customDay = document.getElementById('fRepeatCustomMonthDay');
  if(customDay && !customDay.options.length){
    let html = '';
    for(let i = 1; i <= 31; i++) html += `<option value="${i}">${i}</option>`;
    customDay.innerHTML = html;
  }
  const customYearMonth = document.getElementById('fRepeatCustomYearMonth');
  if(customYearMonth && !customYearMonth.options.length){
    customYearMonth.innerHTML = _MONTH_NAMES.map((n,i) => `<option value="${i}">${n}</option>`).join('');
  }
}

function loadRepeatIntoForm(repeat){
  _populateRepeatDropdowns();
  const freqSel = document.getElementById('fRepeatFreq');
  const r = repeat || { freq: 'off' };
  if(freqSel) freqSel.value = r.freq || 'off';
  // Weekly: single weekday radio (default to today's weekday)
  const wdRow = document.getElementById('fRepeatWeekdaysRow');
  if(wdRow){
    wdRow.style.display = (r.freq === 'weekly') ? '' : 'none';
    let chosen = (typeof r.weekday === 'number') ? r.weekday
              : (Array.isArray(r.weekdays) && r.weekdays.length ? r.weekdays[0] : null);
    if(chosen === null) chosen = new Date().getDay();
    wdRow.querySelectorAll('input[type="radio"]').forEach(rb => {
      rb.checked = parseInt(rb.dataset.d, 10) === chosen;
    });
  }
  // Monthly: day of month
  const today = new Date();
  document.getElementById('fRepeatMonthlyRow').style.display = (r.freq === 'monthly') ? '' : 'none';
  document.getElementById('fRepeatMonthDay').value = String(r.monthDay || today.getDate());
  // Yearly: month + day
  document.getElementById('fRepeatYearlyRow').style.display = (r.freq === 'yearly') ? '' : 'none';
  document.getElementById('fRepeatYearMonth').value = String(typeof r.yearMonth === 'number' ? r.yearMonth : today.getMonth());
  document.getElementById('fRepeatYearDay').value = String(r.yearDay || today.getDate());
  // Custom: every X [unit], with sub-fields driven by unit.
  document.getElementById('fRepeatCustomRow').style.display = (r.freq === 'custom') ? '' : 'none';
  document.getElementById('fRepeatInterval').value = String(r.interval || 1);
  document.getElementById('fRepeatUnit').value = r.unit || 'months';
  document.getElementById('fRepeatCustomMonthDay').value = String(r.monthDay || today.getDate());
  document.getElementById('fRepeatCustomYearMonth').value = String(typeof r.yearMonth === 'number' ? r.yearMonth : today.getMonth());
  const customWd = (typeof r.weekday === 'number') ? r.weekday : today.getDay();
  document.querySelectorAll('#fRepeatCustomWeekdayRow input[type="radio"]').forEach(rb => {
    rb.checked = parseInt(rb.dataset.d, 10) === customWd;
  });
  if(r.freq === 'custom') onRepeatUnitChange();
}

function readRepeatFromForm(){
  const freq = document.getElementById('fRepeatFreq')?.value || 'off';
  if(freq === 'off') return { freq: 'off' };
  const out = { freq };
  if(freq === 'weekly'){
    const sel = document.querySelector('#fRepeatWeekdaysRow input[type="radio"]:checked');
    out.weekday = sel ? parseInt(sel.dataset.d, 10) : new Date().getDay();
  } else if(freq === 'monthly'){
    out.monthDay = parseInt(document.getElementById('fRepeatMonthDay').value, 10) || 1;
  } else if(freq === 'yearly'){
    out.yearMonth = parseInt(document.getElementById('fRepeatYearMonth').value, 10) || 0;
    out.yearDay = parseInt(document.getElementById('fRepeatYearDay').value, 10) || 1;
  } else if(freq === 'custom'){
    out.interval = Math.max(1, parseInt(document.getElementById('fRepeatInterval').value, 10) || 1);
    out.unit = document.getElementById('fRepeatUnit').value || 'months';
    if(out.unit === 'months' || out.unit === 'years'){
      out.monthDay = parseInt(document.getElementById('fRepeatCustomMonthDay').value, 10) || 1;
    }
    if(out.unit === 'years'){
      out.yearMonth = parseInt(document.getElementById('fRepeatCustomYearMonth').value, 10) || 0;
    }
    if(out.unit === 'weeks'){
      const sel = document.querySelector('#fRepeatCustomWeekdayRow input[type="radio"]:checked');
      out.weekday = sel ? parseInt(sel.dataset.d, 10) : new Date().getDay();
    }
  }
  return out;
}

function onRepeatFreqChange(){
  const freq = document.getElementById('fRepeatFreq').value;
  document.getElementById('fRepeatWeekdaysRow').style.display = freq === 'weekly' ? '' : 'none';
  document.getElementById('fRepeatMonthlyRow').style.display = freq === 'monthly' ? '' : 'none';
  document.getElementById('fRepeatYearlyRow').style.display = freq === 'yearly' ? '' : 'none';
  document.getElementById('fRepeatCustomRow').style.display = freq === 'custom' ? '' : 'none';
  if(freq === 'custom') onRepeatUnitChange();
}

// Toggle the right sub-fields under "Custom" based on selected unit.
function onRepeatUnitChange(){
  const unit = document.getElementById('fRepeatUnit').value;
  document.getElementById('fRepeatCustomDayRow').style.display = (unit === 'months' || unit === 'years') ? '' : 'none';
  document.getElementById('fRepeatCustomMonthRow').style.display = (unit === 'years') ? '' : 'none';
  document.getElementById('fRepeatCustomWeekdayRow').style.display = (unit === 'weeks') ? '' : 'none';
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
  loadRepeatIntoForm(null);
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
  loadRepeatIntoForm(t.repeat);
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
    repeat:readRepeatFromForm(),
    projectId:S.activeProject
  };
  if(_editId){
    const t=S.tasks.find(t=>t.id===_editId); if(t) Object.assign(t,data);
  } else {
    const now=Date.now();
    S.tasks.push({id:uid(),done:false,createdAt:now,startedAt:now,screenshots:[],subtasks:[],history:[{type:'created',ts:now,by:currentActor()}],...data});
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

function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pt_theme', next); } catch(e){}
  syncThemeIcon();
}
function syncThemeIcon(){
  const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const dark = document.getElementById('themeIconDark');
  const light = document.getElementById('themeIconLight');
  if(dark && light){
    // In dark mode show moon (to switch to light); in light mode show sun.
    dark.style.display = t === 'dark' ? '' : 'none';
    light.style.display = t === 'light' ? '' : 'none';
  }
}
window.addEventListener('DOMContentLoaded', syncThemeIcon);

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
  t.subtasks.push({id:uid(),title,assignee:assignee||null,done:false,startDate:tsToDateInput(_ts),createdAt:_ts,startedAt:_ts,elapsed:0,desc:'',screenshots:[],history:[{type:'created',ts:_ts,by:currentActor()}]});
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
    s.history.push({type:'completed',ts:now,by:currentActor(),elapsed:s.elapsed});
    // Cascade: complete any open nested subtasks
    (s.subtasks||[]).forEach(n=>{
      if(!n.done){
        n.done=true; n.completedAt=now;
        const ns=n.startedAt||n.createdAt;
        n.elapsed=(n.elapsed||0)+(ns?now-ns:0);
        n.startedAt=null;
        if(!n.history) n.history=[{type:'created',ts:n.createdAt||now}];
        n.history.push({type:'completed',ts:now,by:currentActor(),elapsed:n.elapsed,reason:'parent subtask completed'});
      }
    });
    save(); renderDrawer(); render();
  } else {
    _reopenSubInfo={taskId,idx};
    document.getElementById('fReopenReason').value='';
    document.getElementById('reopenModal').classList.add('open');
    setTimeout(()=>document.getElementById('fReopenReason').focus(),300);
  }
}

// ── NESTED SUBTASKS (level-2; cannot be deployed to a phase) ────
function addNestedSubtask(taskId, subIdx){
  const t = S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s = t.subtasks[subIdx]; if(!s) return;
  if(!s.subtasks) s.subtasks = [];
  const inp = document.getElementById('nestInput_'+s.id);
  const asgn = document.getElementById('nestAssign_'+s.id);
  const title = (inp?.value || '').trim(); if(!title) return;
  const assignee = (asgn?.value || '').trim();
  const now = Date.now();
  s.subtasks.push({
    id: uid(), title, assignee: assignee || null,
    done: false, startDate: tsToDateInput(now), startedAt: now, createdAt: now, elapsed: 0,
    desc: '', screenshots: [],
    history: [{type:'created', ts: now, by: currentActor()}]
  });
  if(inp) inp.value = '';
  save(); renderDrawer();
}
function toggleNestedSubtask(taskId, subIdx, nestIdx){
  const t = S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s = t.subtasks[subIdx]; if(!s||!s.subtasks) return;
  const n = s.subtasks[nestIdx]; if(!n) return;
  const now = Date.now();
  if(!n.done){
    n.done = true; n.completedAt = now;
    const started = n.startedAt || n.createdAt;
    n.elapsed = (n.elapsed||0) + (started ? now - started : 0);
    n.startedAt = null;
    if(!n.history) n.history = [{type:'created', ts: n.createdAt || now}];
    n.history.push({type:'completed', ts: now, by: currentActor(), elapsed: n.elapsed});
  } else {
    n.done = false; n.completedAt = null; n.startedAt = now;
    if(!n.history) n.history = [{type:'created', ts: n.createdAt || now}];
    n.history.push({type:'reopened', ts: now, by: currentActor()});
  }
  save(); renderDrawer(); render();
}
function deleteNestedSubtask(taskId, subIdx, nestIdx){
  const t = S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s = t.subtasks[subIdx]; if(!s||!s.subtasks) return;
  const removed = s.subtasks.splice(nestIdx, 1)[0];
  if(removed) removePathsFromStorage((removed.screenshots||[]).filter(isStoragePath));
  save(); renderDrawer();
}
function saveNestedTitle(taskId, subIdx, nestIdx){
  const t = S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const s = t.subtasks[subIdx]; if(!s||!s.subtasks) return;
  const n = s.subtasks[nestIdx]; if(!n) return;
  const inp = document.getElementById(`nestTitleInput_${s.id}_${nestIdx}`);
  if(!inp) return;
  const newTitle = inp.value.trim();
  if(!newTitle){ inp.value = n.title; return; }
  if(newTitle === n.title) return;
  n.title = newTitle;
  save();
}

function deleteSubtask(taskId,idx){
  const t=S.tasks.find(t=>t.id===taskId); if(!t||!t.subtasks) return;
  const removedSub = t.subtasks.splice(idx,1)[0];
  if(removedSub){
    // Subtask owns its own screenshots + any nested subtask screenshots
    const paths = [];
    (removedSub.screenshots||[]).forEach(s => { if(isStoragePath(s)) paths.push(s); });
    (removedSub.subtasks||[]).forEach(n => (n.screenshots||[]).forEach(s => { if(isStoragePath(s)) paths.push(s); }));
    removePathsFromStorage(paths);
  }
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
let _uploadsInFlight = 0;

// Warn if user tries to navigate away during an in-flight upload.
window.addEventListener('beforeunload', (e) => {
  if(_uploadsInFlight > 0){
    e.preventDefault();
    e.returnValue = 'An image is still uploading. Leave anyway?';
    return e.returnValue;
  }
});

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

  // Resolve the target (task / subtask / nested subtask) and project id.
  let target = null, projectId = null;
  if(_uploadForNested){
    const { taskId, subIdx, nestIdx } = _uploadForNested; _uploadForNested = null;
    const t = S.tasks.find(x => x.id === taskId); if(!t) return;
    const s = t.subtasks?.[subIdx]; if(!s) return;
    target = s.subtasks?.[nestIdx]; if(!target) return;
    projectId = t.projectId;
  } else if(_uploadForSubtask){
    const subInfo = _uploadForSubtask; _uploadForSubtask = null;
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
  _uploadsInFlight++;
  try {
    for(const p of pending){
      const path = await uploadScreenshot(projectId, p.file);
      const idx = target.screenshots.indexOf(p.blobUrl);
      if(idx >= 0){
        if(path) target.screenshots[idx] = path;
        else target.screenshots.splice(idx, 1); // upload failed
      }
      URL.revokeObjectURL(p.blobUrl);
    }
    // Persist immediately — don't leave a freshly-uploaded screenshot sitting
    // in the debounce window where a refresh would orphan the storage file.
    if(typeof flushSync === 'function') await flushSync();
    else save();
  } finally {
    _uploadsInFlight--;
  }
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
// including subtasks AND nested subtasks (level-2).
function collectTaskPaths(task){
  const out = [];
  (task?.screenshots || []).forEach(s => { if(isStoragePath(s)) out.push(s); });
  (task?.subtasks || []).forEach(sub => {
    (sub?.screenshots || []).forEach(s => { if(isStoragePath(s)) out.push(s); });
    (sub?.subtasks || []).forEach(nest => {
      (nest?.screenshots || []).forEach(s => { if(isStoragePath(s)) out.push(s); });
    });
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
function ctxDuplicate(){ const id=_ctxId; closeCtx(); duplicateTask(id); }
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

// REPORT — now shows only the project timeline (gantt). Previous stats were removed.
document.getElementById('reportBtn').addEventListener('click',()=>{
  const proj=getProject(); if(!proj) return;
  const gantt=buildGantt(getAllTasks(proj.id)) || '<div style="color:var(--text3);font-size:13px;padding:20px 0">No timeline data for this project yet.</div>';
  document.getElementById('reportTitle').textContent=`🗓 ${proj.name} — Timeline`;
  document.getElementById('reportContent').innerHTML=gantt;
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
let _dragHeight=60;
function dragStart(e,id){
  e.stopPropagation();
  // If dragging an unselected card, treat it as a single-card drag (and clear any active selection).
  if(!_selectedTaskIds.has(id)){
    if(_selectedTaskIds.size){ _selectedTaskIds.clear(); _lastSelectedId=null; }
  }
  _dragTaskId=id;
  const el=document.getElementById('tc-'+id);
  if(el) _dragHeight=el.offsetHeight||60;
  // Multi-drag: pad the shift gap by the number of additional selected cards.
  const extra = Math.max(0, _selectedTaskIds.size - 1);
  _dragHeight = _dragHeight + extra * (_dragHeight + 8);
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',id);
  setTimeout(()=>{
    if(el) el.classList.add('dragging');
    // Fade the other selected cards too so the user sees the whole group moving.
    _selectedTaskIds.forEach(sid => {
      if(sid === id) return;
      const sel = document.getElementById('tc-'+sid);
      if(sel) sel.classList.add('dragging');
    });
  },0);
}
function dragEnd(){
  clearAllDragShifts();
  document.querySelectorAll('.tcard.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.col.col-task-over').forEach(el=>el.classList.remove('col-task-over'));
  _dragTaskId=null;
}

// Subtask card drag (deployed subtasks between phases)
let _dragSubInfo=null;
function dragStartSub(e,taskId,idx){
  e.stopPropagation();
  _dragSubInfo={taskId,idx};
  const el=e.target.closest('.tcard-sub');
  if(el) _dragHeight=el.offsetHeight||60;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','sub:'+taskId+':'+idx);
  setTimeout(()=>{ if(el) el.classList.add('dragging'); },0);
}
function dragEndSub(){
  clearAllDragShifts();
  document.querySelectorAll('.tcard.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.col.col-task-over').forEach(el=>el.classList.remove('col-task-over'));
  _dragSubInfo=null;
}

// Visual feedback while dragging: non-dragging cards at/below the drop index slide
// down by the dragged card's height, opening a gap so the user sees where it will land.
function applyDragShifts(colBody, dropIdx){
  if(!colBody) return;
  const cards=[...colBody.querySelectorAll('.tcard:not(.dragging)')];
  const offset=(_dragHeight+8)+'px';
  cards.forEach((c,i)=>{
    if(i>=dropIdx){
      c.style.setProperty('--shift-y',offset);
      c.classList.add('tcard-shifted');
    } else if(c.classList.contains('tcard-shifted')){
      c.classList.remove('tcard-shifted');
      c.style.removeProperty('--shift-y');
    }
  });
}
function clearAllDragShifts(){
  if(_dragOverRaf){ cancelAnimationFrame(_dragOverRaf); _dragOverRaf=null; _dragOverPending=null; }
  document.querySelectorAll('.tcard-shifted').forEach(el=>{
    el.classList.remove('tcard-shifted');
    el.style.removeProperty('--shift-y');
  });
}

// ═══════════════════════════════════════════════
// DRAWER SUBTASK + NESTED ROW REORDER (drag-and-drop with shift animation)
// ═══════════════════════════════════════════════
let _subRowDrag=null; // {type:'sub'|'nest', idx, height}
let _subRowRaf=null;
let _subRowPending=null;

function subRowDragStart(e,type,idx){
  e.stopPropagation();
  const row=e.target.closest('.subtask-row');
  if(!row) return;
  _subRowDrag={type,idx,height:row.offsetHeight||40};
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','strow:'+type+':'+idx);
  setTimeout(()=>{ row.classList.add('dragging'); },0);
}
function subRowDragEnd(){
  if(_subRowRaf){ cancelAnimationFrame(_subRowRaf); _subRowRaf=null; _subRowPending=null; }
  document.querySelectorAll('.subtask-row.dragging').forEach(el=>el.classList.remove('dragging'));
  document.querySelectorAll('.subtask-row.st-shifted').forEach(el=>{
    el.classList.remove('st-shifted');
    el.style.removeProperty('--shift-y');
  });
  _subRowDrag=null;
}
function getSubRowDropIndex(list,y){
  const rows=[...list.querySelectorAll('.subtask-row:not(.dragging)')];
  for(let i=0;i<rows.length;i++){
    const r=rows[i].getBoundingClientRect();
    if(y<r.top+r.height/2) return i;
  }
  return rows.length;
}
function applySubRowShifts(list,dropIdx){
  if(!list||!_subRowDrag) return;
  const rows=[...list.querySelectorAll('.subtask-row:not(.dragging)')];
  const offset=(_subRowDrag.height+6)+'px';
  rows.forEach((r,i)=>{
    if(i>=dropIdx){
      r.style.setProperty('--shift-y',offset);
      r.classList.add('st-shifted');
    } else if(r.classList.contains('st-shifted')){
      r.classList.remove('st-shifted');
      r.style.removeProperty('--shift-y');
    }
  });
}
function subRowDragOver(e){
  if(!_subRowDrag) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect='move';
  _subRowPending={list:e.currentTarget,y:e.clientY};
  if(_subRowRaf) return;
  _subRowRaf=requestAnimationFrame(()=>{
    _subRowRaf=null;
    const p=_subRowPending; _subRowPending=null;
    if(!p) return;
    const dropIdx=getSubRowDropIndex(p.list,p.y);
    applySubRowShifts(p.list,dropIdx);
  });
}
function subRowDrop(e){
  if(!_subRowDrag) return;
  e.preventDefault();
  e.stopPropagation();
  const list=e.currentTarget;
  const dropIdx=getSubRowDropIndex(list,e.clientY);
  const {type,idx:fromIdx}=_subRowDrag;
  const t=S.tasks.find(t=>t.id===_drawerId);
  if(t){
    const arr=type==='sub'?t.subtasks:(t.subtasks[_drawerSubIdx]||{}).subtasks;
    if(arr&&Array.isArray(arr)){
      let toIdx=dropIdx;
      if(fromIdx<toIdx) toIdx--; // removal shifts indices down by one
      toIdx=Math.max(0,Math.min(toIdx,arr.length-1));
      if(toIdx!==fromIdx){
        const [item]=arr.splice(fromIdx,1);
        arr.splice(toIdx,0,item);
        save(); renderDrawer(); render();
      }
    }
  }
  subRowDragEnd();
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
// Throttle drag-over to one update per animation frame. dragover fires on every mouse move
// (~60–120/s) — without throttling we'd recompute shifts and write inline styles dozens of times
// per frame for nothing.
let _dragOverRaf = null;
let _dragOverPending = null;
function colDragOver(e){
  if(_dragTaskId || _dragSubInfo){
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    target.classList.add('col-task-over');
    _dragOverPending = {target, clientY: e.clientY};
    if(_dragOverRaf) return;
    _dragOverRaf = requestAnimationFrame(()=>{
      _dragOverRaf = null;
      const p = _dragOverPending; _dragOverPending = null;
      if(!p) return;
      const colBody = p.target.querySelector('.col-body');
      if(!colBody) return;
      // Clear shifts in other columns so they snap back as the cursor crosses columns.
      document.querySelectorAll('.col-body').forEach(cb => {
        if(cb !== colBody){
          cb.querySelectorAll('.tcard-shifted').forEach(el => {
            el.classList.remove('tcard-shifted');
            el.style.removeProperty('--shift-y');
          });
        }
      });
      const dropIdx = getDropIndex(colBody, p.clientY);
      applyDragShifts(colBody, dropIdx);
    });
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
  col.querySelectorAll('.tcard-shifted').forEach(el => {
    el.classList.remove('tcard-shifted');
    el.style.removeProperty('--shift-y');
  });
}
function colDrop(e, targetPh){
  e.currentTarget.classList.remove('col-task-over');
  clearAllDragShifts();
  // Task/subtask drop — anywhere in the column
  if(_dragTaskId || _dragSubInfo){
    e.preventDefault();
    const colBody = e.currentTarget.querySelector('.col-body');
    const dropIdx = colBody ? getDropIndex(colBody, e.clientY) : 0;
    if(_dragTaskId){
      // Multi-select drop: move every selected task to the target phase, preserving their
      // relative on-board order and slotting them contiguously starting at dropIdx.
      const groupIds = (_selectedTaskIds.size > 1 && _selectedTaskIds.has(_dragTaskId))
        ? [..._selectedTaskIds]
        : [_dragTaskId];
      // Preserve current order across the group.
      groupIds.sort((a, b) => {
        const ta = S.tasks.find(t => t.id === a);
        const tb = S.tasks.find(t => t.id === b);
        const oa = typeof ta?.order === 'number' ? ta.order : 9999;
        const ob = typeof tb?.order === 'number' ? tb.order : 9999;
        return oa - ob;
      });
      const focusId = _dragTaskId;
      groupIds.forEach((sid, i) => {
        const t = S.tasks.find(t => t.id === sid);
        if(!t) return;
        t.phase = targetPh;
        reorderPhaseItems(targetPh, 'task', t.id, dropIdx + i);
      });
      // Clear selection after the move so the next click doesn't carry stale state.
      _selectedTaskIds.clear();
      _lastSelectedId = null;
      save(); render(); if(_drawerId === focusId) renderDrawer();
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
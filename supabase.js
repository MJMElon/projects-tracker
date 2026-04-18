// ═══════════════════════════════════════════════
// SUPABASE CLIENT + AUTH + DATA LAYER
// ═══════════════════════════════════════════════
const SUPABASE_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'project_tracker' },
  // autoRefreshToken disabled — supabase-js can hang on the refresh call in
  // some environments; we refresh manually below with a timeout.
  auth: { persistSession: true, autoRefreshToken: false }
});

let _user = null;
let _snap = { projects: {}, tasks: {} };      // id -> JSON string (for diff)
let _syncTimer = null;
let _syncing = false;
let _pendingSync = false;

// ── task shape mapping (client ↔ db) ──────────────────────────
// Client task: {id, projectId, title, desc, phase, urgency, assignee, due, startDate,
//               done, completedAt, startedAt, screenshots[], subtasks[], history[],
//               createdAt, order}
// DB row:      {id, project_id, title, descr, phase, urgency, assignee, due, start_date,
//               done, completed_at, started_at, screenshots, subtasks, history, created_at,
//               created_by}    (note: "order" + "phaseOrder" stashed into row as extras via jsonb? No.
//                                We add an "extras" jsonb later if needed; for now persist order inside
//                                subtasks/history jsonb already covers subtasks. For task.order we reuse
//                                created_at ordering as fallback; persist as column.)
function taskToRow(t, userId){
  return {
    id: t.id,
    project_id: t.projectId,
    created_by: userId || null,
    title: t.title || '',
    descr: t.desc || '',
    phase: t.phase || '',
    urgency: t.urgency || 'medium',
    assignee: t.assignee || '',
    due: t.due || '',
    start_date: t.startDate || '',
    done: !!t.done,
    completed_at: t.completedAt || null,
    started_at: t.startedAt || null,
    screenshots: t.screenshots || [],
    subtasks: t.subtasks || [],
    history: t.history || [],
    created_at: t.createdAt || Date.now(),
    order_idx: (typeof t.order === 'number') ? t.order : null
  };
}
function rowToTask(r){
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    desc: r.descr || '',
    phase: r.phase,
    urgency: r.urgency,
    assignee: r.assignee || '',
    due: r.due || '',
    startDate: r.start_date || '',
    done: !!r.done,
    completedAt: r.completed_at,
    startedAt: r.started_at,
    screenshots: r.screenshots || [],
    subtasks: r.subtasks || [],
    history: r.history || [],
    createdAt: r.created_at,
    order: (typeof r.order_idx === 'number') ? r.order_idx : undefined
  };
}
function projectToRow(p, userId){
  return { id: p.id, name: p.name, phases: p.phases || [], owner_id: p.ownerId || userId };
}
function rowToProject(r){
  return { id: r.id, name: r.name, phases: r.phases || [], ownerId: r.owner_id };
}

function isUuid(s){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||''); }

// ═══════════════════════════════════════════════
// HYDRATE (load from server into S)
// ═══════════════════════════════════════════════
// Raw-fetch an RPC endpoint with the current access token — bypasses
// supabase-js internals (which have been hanging for this user).
async function rpcFetch(fnName, args = {}){
  const stored = readStoredSession();
  const token = stored?.access_token;
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Profile': 'project_tracker',
      'Accept-Profile': 'project_tracker'
    },
    body: JSON.stringify(args)
  });
  const body = await res.json().catch(() => null);
  if(!res.ok) return { data: null, error: { message: body?.message || ('HTTP ' + res.status), status: res.status } };
  return { data: body, error: null };
}

async function hydrate(){
  console.log('[hydrate] fetching get_my_projects');
  const { data: projects, error: pe } = await rpcFetch('get_my_projects');
  console.log('[hydrate] projects returned. count:', projects?.length, 'error:', pe?.message);
  if(pe){ alert('Failed to load projects: '+pe.message); return; }
  console.log('[hydrate] fetching get_my_tasks');
  const { data: tasks, error: te } = await rpcFetch('get_my_tasks');
  console.log('[hydrate] tasks returned. count:', tasks?.length, 'error:', te?.message);
  if(te){ alert('Failed to load tasks: '+te.message); return; }

  S.projects = (projects||[]).map(rowToProject);
  S.tasks = (tasks||[]).map(rowToTask);
  if(S.projects.length && !S.projects.find(p=>p.id===S.activeProject)){
    S.activeProject = S.projects[0].id;
  }

  // seed snapshot for diff
  _snap = { projects: {}, tasks: {} };
  S.projects.forEach(p => { _snap.projects[p.id] = JSON.stringify(projectToRow(p, _user?.id)); });
  S.tasks.forEach(t => { _snap.tasks[t.id] = JSON.stringify(taskToRow(t, _user?.id)); });
}

// ═══════════════════════════════════════════════
// PERSIST (diff & push)
// ═══════════════════════════════════════════════
async function syncNow(){
  if(!_user) return;
  if(_syncing){ _pendingSync = true; return; }
  _syncing = true;
  try {
    // PROJECTS — split dirty rows into inserts (no snapshot) vs updates (diff exists)
    const projIds = new Set(S.projects.map(p=>p.id));
    const projInserts = [];
    const projUpdates = [];
    S.projects.forEach(p=>{
      const row = projectToRow(p, _user.id);
      const key = JSON.stringify(row);
      if(_snap.projects[p.id] === undefined) projInserts.push(row);
      else if(_snap.projects[p.id] !== key) projUpdates.push(row);
    });
    const projDeletes = Object.keys(_snap.projects).filter(id => !projIds.has(id));
    if(projInserts.length){
      const { error } = await sb.from('projects').insert(projInserts);
      if(error){ console.error('project insert', error); alert('Project save failed: '+error.message); }
      else projInserts.forEach(r => { _snap.projects[r.id] = JSON.stringify(r); });
    }
    for(const row of projUpdates){
      const { id, ...fields } = row;
      const { error } = await sb.from('projects').update(fields).eq('id', id);
      if(error){ console.error('project update', error); alert('Project save failed: '+error.message); }
      else _snap.projects[id] = JSON.stringify(row);
    }
    if(projDeletes.length){
      const { error } = await sb.from('projects').delete().in('id', projDeletes);
      if(error){ console.error('project delete', error); alert('Project delete failed: '+error.message); }
      projDeletes.forEach(id => delete _snap.projects[id]);
    }

    // TASKS — same split: inserts vs updates
    const taskIds = new Set(S.tasks.map(t=>t.id));
    const taskInserts = [];
    const taskUpdates = [];
    S.tasks.forEach(t=>{
      if(!t.projectId || !isUuid(t.projectId)) return; // skip orphan/local-only
      const row = taskToRow(t, _user.id);
      const key = JSON.stringify(row);
      if(_snap.tasks[t.id] === undefined) taskInserts.push(row);
      else if(_snap.tasks[t.id] !== key) taskUpdates.push(row);
    });
    const taskDeletes = Object.keys(_snap.tasks).filter(id => !taskIds.has(id));
    if(taskInserts.length){
      const { error } = await sb.from('tasks').insert(taskInserts);
      if(error){ console.error('task insert', error); alert('Save failed: '+error.message); }
      else taskInserts.forEach(r => { _snap.tasks[r.id] = JSON.stringify(r); });
    }
    for(const row of taskUpdates){
      const { id, ...fields } = row;
      const { error } = await sb.from('tasks').update(fields).eq('id', id);
      if(error){ console.error('task update', error); alert('Save failed: '+error.message); }
      else _snap.tasks[id] = JSON.stringify(row);
    }
    if(taskDeletes.length){
      const { error } = await sb.from('tasks').delete().in('id', taskDeletes);
      if(error) console.error('task delete', error);
      taskDeletes.forEach(id => delete _snap.tasks[id]);
    }
  } finally {
    _syncing = false;
    if(_pendingSync){ _pendingSync = false; syncNow(); }
  }
}
function queueSync(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncNow, 350);
}

// ═══════════════════════════════════════════════
// AUTH UI
// ═══════════════════════════════════════════════
function showAuth(){
  document.getElementById('authOverlay').classList.add('open');
  document.querySelector('body').classList.add('locked');
  const loading = document.getElementById('authCardLoading');
  const form = document.getElementById('authCardForm');
  if(loading) loading.style.display = 'none';
  if(form) form.style.display = '';
}
function hideAuth(){
  document.getElementById('authOverlay').classList.remove('open');
  document.querySelector('body').classList.remove('locked');
}
function setAuthMsg(msg, isError){
  const el = document.getElementById('authMsg');
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--accent)';
}

let _authMode = 'signin'; // 'signin' | 'signup'
function toggleAuthMode(){
  _authMode = _authMode === 'signin' ? 'signup' : 'signin';
  document.getElementById('authNameField').style.display = _authMode === 'signup' ? '' : 'none';
  document.getElementById('authPrimaryBtn').textContent = _authMode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('authPrimaryBtn').onclick = _authMode === 'signup' ? doSignUp : doSignIn;
  document.getElementById('authToggleBtn').textContent = _authMode === 'signup' ? 'Have an account? Sign in' : 'Sign up';
  setAuthMsg('', false);
}

async function doSignIn(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ setAuthMsg('Email and password required', true); return; }
  setAuthMsg('Signing in…', false);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ setAuthMsg(error.message, true); return; }
  // onAuthStateChange will hydrate
}
async function doSignUp(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value.trim();
  if(!email || !password){ setAuthMsg('Email and password required', true); return; }
  if(!name){ setAuthMsg('Display name required', true); return; }
  if(password.length < 6){ setAuthMsg('Password must be at least 6 characters', true); return; }
  setAuthMsg('Creating account…', false);
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if(error){ setAuthMsg(error.message, true); return; }
  if(data.user && !data.session){
    setAuthMsg('Check your email to confirm, then sign in.', false);
  } else {
    setAuthMsg('Account created.', false);
  }
}
async function doSignOut(){
  try { await sb.auth.signOut(); } catch(e){ console.warn('signOut error (proceeding anyway)', e); }
  _user = null;
  S.projects = []; S.tasks = []; S.activeProject = null;
  _snap = { projects: {}, tasks: {} };
  render();
  showAuth();
  renderAuthBar();
}

function hasDisplayName(){
  const m = _user?.user_metadata || {};
  return !!(m.full_name || m.name);
}
function getMyDisplayName(){
  const m = _user?.user_metadata || {};
  return m.full_name || m.name || _user?.email || '';
}
function renderAuthBar(){
  const el = document.getElementById('authBar');
  if(!el) return;
  if(!_user){ el.innerHTML = ''; return; }
  const label = hasDisplayName() ? getMyDisplayName() : '⚠ Set your name';
  const cls = hasDisplayName() ? 'auth-email' : 'auth-email auth-email-warn';
  el.innerHTML =
    `<span class="${cls}" onclick="openProfileModal()" title="Edit profile" style="cursor:pointer">${esc(label)}</span>` +
    `<button class="btn btn-ghost btn-sm" onclick="doSignOut()">Sign out</button>`;
}

// PROFILE
function openProfileModal(){
  document.getElementById('profileName').value = _user?.user_metadata?.full_name || _user?.user_metadata?.name || '';
  document.getElementById('profileMsg').textContent = '';
  document.getElementById('profileModal').classList.add('open');
  setTimeout(()=>document.getElementById('profileName').focus(), 200);
}
function closeProfileModal(){ document.getElementById('profileModal').classList.remove('open'); }
async function saveProfile(){
  const name = document.getElementById('profileName').value.trim();
  const msg = document.getElementById('profileMsg');
  if(!name){ msg.style.color='var(--red)'; msg.textContent='Name required'; return; }
  msg.style.color='var(--text2)'; msg.textContent='Saving…';
  const { data, error } = await sb.auth.updateUser({ data: { full_name: name } });
  if(error){ msg.style.color='var(--red)'; msg.textContent=error.message; return; }
  _user = data.user;
  renderAuthBar();
  msg.style.color='var(--accent)'; msg.textContent='Saved.';
  setTimeout(closeProfileModal, 700);
}

// ═══════════════════════════════════════════════
// MEMBERS (list / invite / role / remove / self-leave)
// ═══════════════════════════════════════════════
// cache of member lists per project, populated on demand
let _membersByProject = {};

async function fetchMembers(projectId){
  const r = await rpcFetch('get_project_members', { pid: projectId });
  if(r.error){ console.error('get_project_members', r.error); return []; }
  _membersByProject[projectId] = r.data || [];
  return _membersByProject[projectId];
}

function myRoleInProject(projectId){
  const list = _membersByProject[projectId] || [];
  const me = list.find(m => m.user_id === _user?.id);
  return me?.role || null;
}

function openMembersModal(){
  const proj = getProject(); if(!proj) return;
  document.getElementById('membersProjName').textContent = proj.name;
  document.getElementById('inviteEmail').value = '';
  document.getElementById('inviteMsg').textContent = '';
  document.getElementById('membersList').innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px">Loading…</div>';
  document.getElementById('membersModal').classList.add('open');
  fetchMembers(proj.id).then(() => renderMembersList());
}
function closeMembersModal(){ document.getElementById('membersModal').classList.remove('open'); }

function renderMembersList(){
  const proj = getProject(); if(!proj) return;
  const list = _membersByProject[proj.id] || [];
  const myRole = myRoleInProject(proj.id);
  const canManage = myRole === 'owner' || myRole === 'admin';
  const html = list.map(m => {
    const isSelf = m.user_id === _user?.id;
    const isOwner = m.role === 'owner';
    // role selector: owner can set admin/member for non-owner; admin can too
    let roleHtml;
    if(isOwner){
      roleHtml = `<span class="mem-role role-owner">OWNER</span>`;
    } else if(canManage && !isSelf){
      roleHtml = `<select class="mem-role-sel" onchange="changeMemberRole('${m.user_id}', this.value)">
        <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
        <option value="member" ${m.role==='member'?'selected':''}>Member</option>
      </select>`;
    } else {
      roleHtml = `<span class="mem-role role-${m.role}">${m.role.toUpperCase()}</span>`;
    }
    // remove button: owners+admins can remove non-owner others; anyone (non-owner) can remove self
    const showRemove = !isOwner && (canManage || isSelf);
    const removeHtml = showRemove ? `<button class="mem-remove" onclick="doRemoveMember('${m.user_id}', ${isSelf})" title="${isSelf?'Leave project':'Remove from project'}">✕</button>` : '';
    return `<div class="mem-row ${isSelf?'is-self':''}">
      <div class="mem-info">
        <div class="mem-name">${esc(m.display_name)}${isSelf?' <span style="color:var(--text3);font-weight:400">(you)</span>':''}</div>
        <div class="mem-email">${esc(m.email)}</div>
      </div>
      ${roleHtml}
      ${removeHtml}
    </div>`;
  }).join('');
  document.getElementById('membersList').innerHTML = html || '<div style="color:var(--text3);padding:12px">No members yet.</div>';
  // invite row only for owners/admins
  document.getElementById('memInviteRow').style.display = canManage ? '' : 'none';
  // leave button: visible when I'm a non-owner member
  const iAmNonOwnerMember = myRole && myRole !== 'owner';
  const leaveBtn = document.getElementById('leaveBtn');
  if(leaveBtn) leaveBtn.style.display = iAmNonOwnerMember ? '' : 'none';
  // delete-project button: owner only
  const delBtn = document.getElementById('deleteProjBtn');
  if(delBtn) delBtn.style.display = myRole === 'owner' ? '' : 'none';
  // rename button: owner or admin
  const renameBtn = document.getElementById('renameProjBtn');
  if(renameBtn) renameBtn.style.display = (myRole === 'owner' || myRole === 'admin') ? '' : 'none';
}

// ── RENAME PROJECT ─────────────────────────────────────────
function openRenameProjectModal(){
  const proj = getProject(); if(!proj) return;
  document.getElementById('renameProjInput').value = proj.name || '';
  document.getElementById('renameProjMsg').textContent = '';
  document.getElementById('renameProjModal').classList.add('open');
  setTimeout(()=>{ const i=document.getElementById('renameProjInput'); i.focus(); i.select(); }, 200);
}
function closeRenameProjectModal(){ document.getElementById('renameProjModal').classList.remove('open'); }
async function saveRenameProject(){
  const proj = getProject(); if(!proj) return;
  const newName = document.getElementById('renameProjInput').value.trim();
  const msg = document.getElementById('renameProjMsg');
  if(!newName){ msg.style.color='var(--red)'; msg.textContent='Name required'; return; }
  if(newName === proj.name){ closeRenameProjectModal(); return; }
  msg.style.color='var(--text2)'; msg.textContent='Saving…';
  const { error } = await sb.from('projects').update({ name: newName }).eq('id', proj.id);
  if(error){ msg.style.color='var(--red)'; msg.textContent='Failed: '+error.message; return; }
  // Update local state and snapshot so subsequent diffs don't re-send
  proj.name = newName;
  _snap.projects[proj.id] = JSON.stringify(projectToRow(proj, _user?.id));
  document.getElementById('membersProjName').textContent = newName;
  render();
  closeRenameProjectModal();
}

// ── DELETE PROJECT ─────────────────────────────────────────
function openDeleteProjectModal(){
  const proj = getProject(); if(!proj) return;
  document.getElementById('deleteProjName').textContent = proj.name;
  document.getElementById('deletePassword').value = '';
  document.getElementById('deleteMsg').textContent = '';
  document.getElementById('deleteProjModal').classList.add('open');
  setTimeout(()=>document.getElementById('deletePassword').focus(), 200);
}
function closeDeleteProjectModal(){ document.getElementById('deleteProjModal').classList.remove('open'); }

async function confirmDeleteProject(){
  const proj = getProject(); if(!proj) return;
  const msg = document.getElementById('deleteMsg');
  const password = document.getElementById('deletePassword').value;
  if(!password){ msg.style.color='var(--red)'; msg.textContent='Password required'; return; }
  msg.style.color='var(--text2)'; msg.textContent='Verifying password…';
  // Verify by attempting sign-in with the current email + entered password.
  // On success, this just refreshes the session — no other effect.
  const { error: authErr } = await sb.auth.signInWithPassword({ email: _user.email, password });
  if(authErr){ msg.style.color='var(--red)'; msg.textContent='Wrong password'; return; }
  msg.style.color='var(--text2)'; msg.textContent='Deleting…';
  const { error: delErr } = await sb.from('projects').delete().eq('id', proj.id);
  if(delErr){ msg.style.color='var(--red)'; msg.textContent='Delete failed: '+delErr.message; return; }
  // Local cleanup
  S.projects = S.projects.filter(p => p.id !== proj.id);
  S.tasks = S.tasks.filter(t => t.projectId !== proj.id);
  delete _snap.projects[proj.id];
  S.activeProject = S.projects[0]?.id || null;
  closeDeleteProjectModal();
  closeMembersModal();
  render();
}

async function submitInvite(){
  const proj = getProject(); if(!proj) return;
  const email = document.getElementById('inviteEmail').value.trim();
  const msgEl = document.getElementById('inviteMsg');
  if(!email){ msgEl.style.color='var(--red)'; msgEl.textContent='Email required'; return; }
  msgEl.style.color='var(--text2)'; msgEl.textContent='Inviting…';
  const { data, error } = await rpcFetch('invite_member', { pid: proj.id, email_in: email });
  if(error){ msgEl.style.color='var(--red)'; msgEl.textContent=error.message; return; }
  if(data && data.ok === false){ msgEl.style.color='var(--red)'; msgEl.textContent=data.error; return; }
  msgEl.style.color='var(--accent)'; msgEl.textContent='Added.';
  document.getElementById('inviteEmail').value = '';
  await fetchMembers(proj.id);
  renderMembersList();
}

async function changeMemberRole(userId, newRole){
  const proj = getProject(); if(!proj) return;
  const { data, error } = await rpcFetch('set_member_role', { pid: proj.id, uid: userId, new_role: newRole });
  if(error){ alert('Role change failed: '+error.message); await fetchMembers(proj.id); renderMembersList(); return; }
  await fetchMembers(proj.id);
  renderMembersList();
}

async function doRemoveMember(userId, isSelf){
  const proj = getProject(); if(!proj) return;
  if(!confirm(isSelf ? `Leave "${proj.name}"?` : 'Remove this member from the project?')) return;
  const { data, error } = await rpcFetch('remove_member', { pid: proj.id, uid: userId });
  if(error){ alert('Remove failed: '+error.message); return; }
  if(isSelf){
    // Refresh the whole app — the project is no longer mine to see
    closeMembersModal();
    await hydrate();
    render();
  } else {
    await fetchMembers(proj.id);
    renderMembersList();
  }
}

async function doSelfLeave(){
  if(!_user) return;
  await doRemoveMember(_user.id, true);
}

// ═══════════════════════════════════════════════
// REALTIME (optional multi-user updates)
// ═══════════════════════════════════════════════
let _realtimeCh = null;
function subscribeRealtime(){
  if(_realtimeCh) { try{ sb.removeChannel(_realtimeCh); }catch(e){} }
  _realtimeCh = sb.channel('pt-changes')
    .on('postgres_changes', { event:'*', schema:'project_tracker', table:'tasks' }, payload => {
      // Ignore our own writes (optimistic)
      if(_syncing) return;
      applyTaskChange(payload);
    })
    .on('postgres_changes', { event:'*', schema:'project_tracker', table:'projects' }, payload => {
      if(_syncing) return;
      applyProjectChange(payload);
    })
    .subscribe();
}
function applyTaskChange(p){
  if(p.eventType === 'DELETE'){
    const id = p.old?.id;
    S.tasks = S.tasks.filter(t=>t.id!==id);
    delete _snap.tasks[id];
  } else {
    const t = rowToTask(p.new);
    const i = S.tasks.findIndex(x=>x.id===t.id);
    if(i>=0) S.tasks[i] = t; else S.tasks.push(t);
    _snap.tasks[t.id] = JSON.stringify(taskToRow(t, _user?.id));
  }
  render(); if(_drawerId) { const t=S.tasks.find(x=>x.id===_drawerId); if(t) renderDrawer(); else closeDrawer(); }
}
function applyProjectChange(p){
  if(p.eventType === 'DELETE'){
    const id = p.old?.id;
    S.projects = S.projects.filter(x=>x.id!==id);
    delete _snap.projects[id];
    if(S.activeProject===id) S.activeProject = S.projects[0]?.id || null;
  } else {
    const pr = rowToProject(p.new);
    const i = S.projects.findIndex(x=>x.id===pr.id);
    if(i>=0) S.projects[i] = pr; else S.projects.push(pr);
    _snap.projects[pr.id] = JSON.stringify(projectToRow(pr, _user?.id));
  }
  render();
}

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
// Read session directly from localStorage — bypasses any locks in supabase-js
function readStoredSession(){
  try {
    const raw = localStorage.getItem('sb-kibqjztozokohqmhqqqf-auth-token');
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    // Storage format varies across supabase-js versions; try both shapes.
    return parsed?.currentSession || parsed || null;
  } catch(e){ return null; }
}

// Refresh the access token via direct fetch (racing against a short timeout)
async function refreshTokenSafe(refreshToken){
  try {
    const res = await Promise.race([
      fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      }).then(r => r.json()),
      new Promise((_, rej) => setTimeout(() => rej(new Error('refresh timeout')), 5000))
    ]);
    if(res && res.access_token) return res;
    return null;
  } catch(e){ console.warn('[refresh] failed', e); return null; }
}

async function boot(){
  console.log('[boot] start');
  try {
    // 1) Read stored session instantly (no network call, no locks).
    let stored = readStoredSession();
    console.log('[boot] stored session:', !!stored, 'expires_at:', stored?.expires_at);

    // 2) If expired or near expiry, refresh manually; overwrite localStorage so
    //    supabase-js picks up the new token on its next API call.
    const now = Math.floor(Date.now() / 1000);
    if(stored && stored.expires_at && stored.expires_at <= now + 60 && stored.refresh_token){
      console.log('[boot] token expired, refreshing...');
      const refreshed = await refreshTokenSafe(stored.refresh_token);
      if(refreshed){
        console.log('[boot] refresh OK');
        stored = refreshed;
        try {
          localStorage.setItem(
            'sb-kibqjztozokohqmhqqqf-auth-token',
            JSON.stringify({ ...refreshed, currentSession: refreshed, expires_at: refreshed.expires_at })
          );
        } catch(e){ console.warn('[boot] could not persist refreshed token', e); }
      } else {
        console.warn('[boot] refresh failed → forcing sign-in');
        stored = null;
      }
    }

    _user = stored?.user || null;
    renderAuthBar();
    if(!_user){ console.log('[boot] no user → showAuth'); showAuth(); return; }
    hideAuth();
    console.log('[boot] hydrating...');
    await hydrate();
    console.log('[boot] hydrate done. projects:', S.projects.length, 'tasks:', S.tasks.length);
    render();
    // Preload members for the active project so the assignee dropdown
    // in new-task / edit-task modals is populated without extra wait.
    if(S.activeProject) fetchMembers(S.activeProject);
    subscribeRealtime();
    _lastHydratedUid = _user?.id;
    // First-time users (pre-existing accounts from nurseryAI) may not have a
    // display name — prompt once so they show up nicely in member lists.
    if(!hasDisplayName() && !sessionStorage.getItem('pt_name_prompted')){
      sessionStorage.setItem('pt_name_prompted', '1');
      setTimeout(openProfileModal, 400);
    }
    console.log('[boot] done');
  } catch(e){
    console.error('[boot] failed', e);
    alert('Failed to start: '+(e.message||e));
    showAuth();
  }
}

// Emergency reset — clear local session state and reload
function hardReset(){
  try { Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)); } catch(e){}
  location.reload();
}

let _lastHydratedUid = null;
sb.auth.onAuthStateChange(async (event, session) => {
  _user = session?.user || null;
  renderAuthBar();
  if(event === 'SIGNED_IN'){
    // Skip re-hydrating if boot() already hydrated this same user on load.
    if(_lastHydratedUid === _user?.id) return;
    _lastHydratedUid = _user?.id;
    hideAuth();
    await hydrate();
    render();
    if(S.activeProject) fetchMembers(S.activeProject);
    subscribeRealtime();
  } else if(event === 'SIGNED_OUT'){
    _lastHydratedUid = null;
    showAuth();
  }
});

// Kick things off (scripts are at end of body — DOM is already parsed)
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// Allow sign-in form submit with Enter key
document.addEventListener('keydown', e => {
  if(e.key === 'Enter' && document.getElementById('authOverlay').classList.contains('open')){
    const a = document.activeElement;
    if(a && (a.id === 'authEmail' || a.id === 'authPassword')) doSignIn();
  }
  if(e.key === 'Enter' && document.getElementById('inviteModal').classList.contains('open')){
    const a = document.activeElement;
    if(a && a.id === 'inviteEmail') submitInvite();
  }
});

// Backdrop close for invite modal
document.addEventListener('click', e => {
  const im = document.getElementById('inviteModal');
  if(im && e.target === im) closeInviteModal();
});

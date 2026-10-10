(() => {
  'use strict';
  if(window.gptNavigation.redirecting)return;
  const $ = id => document.getElementById(id), tg = window.Telegram?.WebApp;
  const root = document.documentElement;
  let state, working = false, toastTimer, savedTimer, confirmedEngine, engineSync, effortKey = '';
  const initData = tg?.initData || '';
  $('library-link').href='./library.html'+location.hash;
  const labels = {low:'Низкий',medium:'Средний',high:'Высокий',xhigh:'Очень высокий',max:'Максимальный',ultra:'Предельный'};
  // Служебные уровни рабочей зоны, пользователю бота в настройках не нужны.
  const hiddenLevels = new Set(['ultracode']);
  const permissions = {
    gpt:[['auto','Самостоятельно'],['read','Только чтение']],
    claude:[['default','С подтверждением'],['acceptEdits','Сам правит файлы'],['auto','Автопроверка'],['plan','Сначала план'],['bypassPermissions','Без подтверждений']],
  };
  const haptic = (kind, value) => { try { tg?.HapticFeedback?.[kind]?.(value); } catch {} };
  function theme(){
    root.dataset.theme=tg?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    // Шапка и низ Telegram — в цвет фона страницы, без шва.
    if(tg?.themeParams?.secondary_bg_color&&tg.isVersionAtLeast?.('6.1')){
      try{tg.setHeaderColor('secondary_bg_color');tg.setBackgroundColor('secondary_bg_color');if(tg.isVersionAtLeast('7.10'))tg.setBottomBarColor('secondary_bg_color');}catch{}
    }
  }
  theme(); tg?.onEvent?.('themeChanged',theme); tg?.ready(); tg?.expand();
  // «Назад» Telegram включают подстраницы; на главной она не нужна.
  try{tg?.BackButton?.hide();}catch{}
  function notify(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
  async function api(path, value){
    const response=await fetch(path,{method:value===undefined?'GET':'POST',headers:{'x-telegram-init-data':initData,...(value===undefined?{}:{'content-type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)}),cache:'no-store',keepalive:value!==undefined,signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>({error:'Сервер временно недоступен'}));
    if(!response.ok)throw Error(data.error||'Не удалось выполнить действие');
    return data;
  }
  function setSaved(mode){
    clearTimeout(savedTimer);const el=$('saved');
    if(mode==='saving'){el.textContent='Сохраняем…';el.dataset.state='saving';}
    else if(mode==='saved'){el.textContent='Сохранено';el.dataset.state='saved';savedTimer=setTimeout(()=>{el.dataset.state='idle'},1600);}
    else el.dataset.state='idle';
  }
  function updateControls(){
    const pending=working||!!engineSync;
    for(const el of document.querySelectorAll('.engines button'))el.disabled=working;
    for(const el of document.querySelectorAll('#open-web,#install,#profile-web'))el.disabled=pending;
    if(!state)return;
    const data=state[state.engine];
    for(const el of document.querySelectorAll('.settings-card button,.settings-card select'))el.disabled=pending||!data.available;
    if(state.engine==='claude'&&data.thinking==='disabled'){for(const el of $('efforts').children)el.disabled=true;$('effort-auto').disabled=true;}
    if(state.engine==='claude'&&data.orchestrationAvailable===false)$('orchestration').disabled=true;
  }
  function busy(value){working=value;updateControls();}
  function redraw(engineChanged=false){
    const card=document.querySelector('.settings-card');
    const done=window.aiMotion.change(render,{layout:card,target:engineChanged?document.querySelector('.hero-copy'):null});
    if(engineChanged){
      // Новые значения появляются в том же кадре, но мягко проявляются без сдвига строк.
      for(const item of [$('hero-model'),...card.querySelectorAll('.group')])void window.aiMotion.enter(item,0);
    }
    return done;
  }
  function option(select,value,label){const el=document.createElement('option');el.value=value;el.textContent=label;select.append(el);}
  function modelLabel(model){const name=model.description?.split(' · ')[0]||model.displayName;return model.value==='default'?'По умолчанию · '+name:name;}
  function currentModel(){return state?.claude.models.find(m=>m.value===state.claude.model);}
  function syncValues(){for(const el of document.querySelectorAll('[data-value-of]')){const select=$(el.dataset.valueOf);el.textContent=select.selectedOptions[0]?.textContent||'—';}}
  /** Столбики заполняются до выбранного уровня; при «Авто» — приглушены. */
  function paintEffort(effort){
    const bars=[...$('efforts').children],index=bars.findIndex(b=>b.dataset.level===effort);
    bars.forEach((bar,i)=>{bar.classList.toggle('is-filled',index>=0&&i<=index);bar.setAttribute('aria-pressed',String(i===index));});
    const auto=$('effort-auto');auto.setAttribute('aria-checked',String(effort===null));
    document.querySelector('.depth').classList.toggle('is-auto',effort===null&&!auto.hidden);
    $('effort-value').textContent=bars.length?(effort===null?'Авто':labels[effort]||effort):'Без настройки';
  }
  function chooseEffort(effort){
    if(working||engineSync||!state)return;
    const data=state[state.engine];if(data.effort===effort)return;
    haptic('selectionChanged');paintEffort(effort);save({effort});
  }
  function render(){
    window.gptNavigation.setEngine(state.engine);
    const engine=state.engine, claude=engine==='claude', data=state[engine];
    root.dataset.engine=engine;document.title=claude?'Клод бот':'GPT бот';
    $('bot-title').textContent=document.title;$('engine-caption').textContent=claude?'Claude Code':'GPT · Codex';
    const connection=$('connection');connection.dataset.state=data.available?'on':'off';
    connection.replaceChildren(document.createElement('span'),document.createTextNode(data.available?'Подключён':'Не подключён'));
    for(const button of document.querySelectorAll('.engines button'))button.setAttribute('aria-pressed',String(button.dataset.engine===engine));
    const model=$('model');model.replaceChildren();
    if(claude){for(const entry of data.models)option(model,entry.value,modelLabel(entry));}
    else for(const [id,label] of data.models||[])option(model,id,label.replace(/^[^\p{L}\p{N}]+/u,''));
    model.value=data.model||'';model.disabled=working||!data.available;
    $('hero-model').textContent=model.selectedOptions[0]?.textContent||'Подключение готовится';
    $('thinking-field').hidden=!claude;
    $('thinking').value=data.thinking||'auto';$('thinking').disabled=working||!data.available;
    const selectedModel=currentModel();
    const levels=(claude?(selectedModel?.supportedEffortLevels||[]):(data.efforts||[]).map(([id])=>id)).filter(level=>!hiddenLevels.has(level));
    const efforts=$('efforts'),key=engine+':'+levels.join(',');
    // Набор уровней не поменялся — обновляем на месте, чтобы столбики переливались, а не мигали.
    if(key!==effortKey){
      effortKey=key;efforts.replaceChildren();efforts.style.setProperty('--count',String(Math.max(2,levels.length)));
      levels.forEach((level,i)=>{
        const button=document.createElement('button');button.type='button';button.className='depth-step';button.dataset.level=level;
        button.style.setProperty('--i',String(i));button.setAttribute('aria-label',labels[level]||level);
        button.append(document.createElement('i'));button.onclick=()=>chooseEffort(level);efforts.append(button);
      });
    }
    const off=working||!data.available||(claude&&data.thinking==='disabled');
    for(const button of efforts.children)button.disabled=off;
    document.querySelector('.depth').hidden=!levels.length;
    const auto=$('effort-auto');auto.hidden=!(claude&&levels.length);auto.disabled=off;
    // Оркестрация агентами (ultracode) — только у Claude и только на моделях с уровнем xhigh.
    const orch=$('orchestration'),orchOn=claude&&data.orchestration===true,orchOk=claude&&data.orchestrationAvailable!==false;
    for(const id of ['orchestration-head','orchestration-group','orchestration-foot'])$(id).hidden=!claude;
    orch.setAttribute('aria-checked',String(orchOn));orch.disabled=working||!data.available||!orchOk;
    $('orchestration-note').textContent=!orchOk?'Нужна модель с уровнем «Очень высокий»: Opus, Fable или Sonnet 5.':orchOn?(data.effort===null?'Включена. При глубине «Авто» модель работает на «Очень высоком». Тратит больше лимита.':'Включена: большие задачи раскладываются на субагентов с перепроверкой. Тратит больше лимита.'):'Большие задачи модель раскладывает на субагентов и перепроверяет. Тратит заметно больше лимита.';
    paintEffort(data.effort??null);
    const permission=$('permission');permission.replaceChildren();
    for(const [id,label]of permissions[engine]){if(claude&&id==='auto'&&!selectedModel?.supportsAutoMode)continue;option(permission,id,label);}
    permission.value=claude?data.permissionMode:data.mode;permission.disabled=working||!data.available;
    syncValues();
    $('admin-link').hidden=!state.profile.admin;
    $('profile-name').textContent=state.profile.name;$('profile-id').textContent='Telegram ID · '+state.profile.id;
    const initial=state.profile.name.match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase('ru-RU')||'Я';for(const el of document.querySelectorAll('.avatar-initial'))el.textContent=initial;
    try{localStorage.setItem('bot:engine:'+state.profile.id,engine)}catch{}
    for(const [id,section]of [['stats-link','cats'],['world-link','world'],['admin-link','admin']]){const url=new URL(section==='admin'?(claude?'./claude-admin.html':'./chats.html'):'./index.html',location.href);url.searchParams.set('section',section);url.searchParams.set('engine',engine);url.hash=location.hash;$(id).href=url.href;}
    $('app').hidden=false;$('loading').hidden=true;$('error').hidden=true;updateControls();
  }
  let avatarUrl;
  async function loadAvatar(){
    if(avatarUrl)return;
    try{
      const r=await fetch('/api/miniapp/avatar',{headers:{'x-telegram-init-data':initData},cache:'no-store',signal:AbortSignal.timeout(40000)});
      if(!r.ok||r.status===204)return;
      const blob=await r.blob();if(!blob.type.startsWith('image/'))return;
      avatarUrl=URL.createObjectURL(blob);
      for(const parent of document.querySelectorAll('.avatar')){const img=parent.querySelector('img');img.onload=()=>{img.hidden=false;parent.querySelector('.avatar-initial').hidden=true};img.src=avatarUrl;}
    }catch{}
  }
  async function load(){
    $('loading').hidden=false;$('error').hidden=true;$('app').hidden=true;
    try{if(!initData)throw Error('Открой миниапку кнопкой меню в Telegram-боте. Для установки на главный экран используй личную ссылку /web.');state=await api('/api/miniapp/state');confirmedEngine=state.engine;render();void loadAvatar();await window.gptNavigation.reveal();if(window.gptNavigation.ui().profileOpen)window.aiMotion.openDialog($('profile-dialog'));}
    catch(error){$('loading').hidden=true;$('error').hidden=false;$('error-text').textContent=error.name==='TimeoutError'?'Сервер долго отвечает. Попробуй ещё раз.':error.message;void window.gptNavigation.reveal(false);}
  }
  async function save(patch){
    if(working||engineSync)return;busy(true);setSaved('saving');let ok=false;
    try{const path=state.engine==='claude'?'/api/miniapp/claude':'/api/gpt/preferences';await api(path,patch);state=await api('/api/miniapp/state');ok=true;haptic('notificationOccurred','success');}
    catch(error){notify(error.message);haptic('notificationOccurred','error');}
    finally{busy(false);setSaved(ok?'saved':'idle');await redraw();}
  }
  async function syncEngine(){
    while(state.engine!==confirmedEngine){
      const requested=state.engine;
      try{
        const result=await api('/api/miniapp/engine',{engine:requested});
        if(result.engine!==requested)throw Error('Не удалось сохранить режим');
        confirmedEngine=result.engine;
      }catch(error){
        if(state.engine===requested){state.engine=confirmedEngine;void redraw(true);}
        notify(error.message);
      }
    }
  }
  for(const button of document.querySelectorAll('.engines button'))button.onclick=()=>{
    if(!state||working||button.dataset.engine===state.engine)return;
    state.engine=button.dataset.engine;
    if(!engineSync)engineSync=Promise.resolve().then(syncEngine).finally(()=>{engineSync=null;updateControls();});
    void redraw(true);haptic('selectionChanged');
  };
  function onSelect(id,patch){$(id).onchange=()=>{syncValues();haptic('selectionChanged');save(patch());};}
  onSelect('model',()=>({model:$('model').value}));
  onSelect('thinking',()=>({thinking:$('thinking').value}));
  onSelect('permission',()=>({[state.engine==='claude'?'permissionMode':'mode']:$('permission').value}));
  $('orchestration').onclick=()=>{
    if(!state||working||engineSync||state.engine!=='claude')return;
    const next=state.claude.orchestration!==true;haptic('impactOccurred','light');
    $('orchestration').setAttribute('aria-checked',String(next));save({orchestration:next});
  };
  $('effort-auto').onclick=()=>{
    if(!state)return;const data=state[state.engine];
    if(data.effort===null){const levels=[...$('efforts').children].map(b=>b.dataset.level);chooseEffort(levels.includes('high')?'high':levels[Math.floor(levels.length/2)]);}
    else chooseEffort(null);
  };
  async function openWeb(profile=false){
    if(working||engineSync)return;busy(true);haptic('impactOccurred','light');
    const pending=$('open-web').querySelector('span');pending.textContent='Открываем…';
    try{
      const result=await api('/api/gpt/web-link',{});const url=new URL(result.url);
      if(url.protocol!=='https:'||!url.hostname.startsWith('u'+state.profile.id+'.bb.'))throw Error('Не удалось проверить ссылку профиля');
      if(profile)url.searchParams.set('next','profile');
      else {
        url.searchParams.set('engine',state.engine);
        const model=state.engine==='claude'?currentModel()?.resolvedModel:state.gpt.model;
        if(model)url.searchParams.set('model',model);
        if(state[state.engine].effort)url.searchParams.set('effort',state[state.engine].effort);
      }
      if(tg?.openLink)tg.openLink(url.href);else location.assign(url.href);
    }catch(error){notify(error.message);}
    finally{busy(false);pending.textContent='Рабочая зона';render();}
  }
  $('open-web').onclick=()=>openWeb();$('profile-web').onclick=()=>openWeb(true);$('install').onclick=()=>openWeb(true);
  $('back-chat').onclick=()=>tg?.close?tg.close():notify('Вернись в чат с ботом в Telegram');
  $('profile-open').onclick=()=>{if(state){haptic('impactOccurred','light');window.gptNavigation.updateUI({profileOpen:true});window.aiMotion.openDialog($('profile-dialog'));}};$('profile-close').onclick=()=>window.aiMotion.closeDialog($('profile-dialog'));
  $('profile-dialog').addEventListener('close',()=>window.gptNavigation.updateUI({profileOpen:false}));
  $('profile-dialog').addEventListener('click',event=>{if(event.target===$('profile-dialog')){const r=$('profile-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)window.aiMotion.closeDialog($('profile-dialog'));}});
  $('retry').onclick=load;
  load();
})();

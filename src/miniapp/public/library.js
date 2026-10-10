const $=id=>document.getElementById(id),tg=window.Telegram?.WebApp;
tg?.ready();tg?.expand();window.gptNavigation?.reveal();
// Шапка Telegram — в цвет страницы; системная кнопка «Назад» ведёт на главную.
if(tg?.themeParams?.secondary_bg_color&&tg.isVersionAtLeast?.('6.1')){try{tg.setHeaderColor('secondary_bg_color');tg.setBackgroundColor('secondary_bg_color')}catch{}}
if(tg?.BackButton&&tg.isVersionAtLeast?.('6.1')){tg.BackButton.onClick(()=>{tg.BackButton.hide();location.assign($('back').href)});tg.BackButton.show();}
function syncValues(){for(const el of document.querySelectorAll('[data-value-of]')){const select=$(el.dataset.valueOf);el.textContent=select.selectedOptions[0]?.textContent||'—'}}
for(const id of ['engine','kind','dialog'])$(id).addEventListener('change',()=>{syncValues();tg?.HapticFeedback?.selectionChanged?.()});
$('back').href='./modes.html?section=home'+location.hash;
const headers={'content-type':'application/json','x-telegram-init-data':tg?.initData||''};
let activeFile,searchVersion=0,searchRunning=false,searchPending=false,offset=0,selectedTab='search',fileVersion=0;
const uid=tg?.initDataUnsafe?.user?.id||'guest',stateKey='bot:library:v1:'+uid;
let saved={};try{saved=JSON.parse(localStorage.getItem(stateKey)||'{}')}catch{}
function remember(){try{localStorage.setItem(stateKey,JSON.stringify({tab:selectedTab,dialog:$('dialog').value,engine:$('engine').value,kind:$('kind').value}))}catch{}}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
async function api(action,body={},binary=false){
 const response=await fetch('/api/tools/'+action,{method:'POST',headers,body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(binary?90000:60000)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Не удалось выполнить запрос')}
 return binary?response:response.json();
}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
function empty(el,text){el.replaceChildren(node('p',text,'empty'))}
function button(text,action){const b=node('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await action()}catch(e){status(e.message,true)}finally{b.disabled=false}};return b}
function card(title,engine,body){const c=node('article',undefined,'card'),badge=node('span',engine==='gpt'?'GPT':'Claude','badge');badge.dataset.engine=engine==='gpt'?'gpt':'claude';c.append(badge,node('h3',title));if(body)c.append(node('p',body));return c}
function size(n){return n<1024*1024?(n/1024).toFixed(1)+' КБ':(n/1024/1024).toFixed(1)+' МБ'}
async function download(body,zip=false){status('Готовлю скачивание…');const res=await api(zip?'zip':'download',body,true),blob=await res.blob(),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;const raw=res.headers.get('content-disposition')?.split("UTF-8''")[1];a.download=raw?decodeURIComponent(raw):zip?'files.zip':body.path.split('/').pop();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Файл готов.');}
async function preview(body){activeFile=body;$('filename').textContent=body.path.split('/').pop();$('preview-content').replaceChildren(node('p','Загружаю…','muted'));window.aiMotion?window.aiMotion.openDialog($('preview')):$('preview').showModal();const data=await api('preview',body);if(activeFile!==body)return;const content=$('preview-content');content.replaceChildren();if(data.image){const img=node('img');img.src=data.image;img.alt=data.name;content.append(img)}else content.append(node('pre',data.text));}
$('close').onclick=()=>{window.aiMotion?window.aiMotion.closeDialog($('preview')):$('preview').close();activeFile=null};$('preview').addEventListener('click',e=>{if(e.target!==$('preview'))return;const r=$('preview').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('close').click()});
$('download').onclick=async()=>{try{await download(activeFile)}catch(e){status(e.message,true)}};
$('send').onclick=async()=>{try{await api('telegram-file',activeFile);status('Файл отправлен в Telegram.')}catch(e){status(e.message,true)}};
function fileCard(f,key,title){const c=card(f.path,f.engine||key.split('-')[0],size(f.size)+(title?' · '+title:''));c.append(button('Посмотреть',()=>preview({dialog:key,path:f.path})));return c}
async function search(append=false){
 if(searchRunning){searchPending=true;return;}searchRunning=true;const version=searchVersion;
 const query=$('query').value.trim(),engine=$('engine').value,kind=$('kind').value;
 if(!append)offset=0;
 if(query.length<2){empty($('results'),'Введи хотя бы два символа.');$('more').hidden=true;searchRunning=false;return;}
 status('Ищу…');$('more').disabled=true;
 try{const data=await api(kind,{query,engine,offset});if(version!==searchVersion)return;
   if(!append)$('results').replaceChildren();
   for(const r of data.results){let c;if(kind==='file-search')c=fileCard(r,r.dialog,r.title);else{c=card(r.title,r.engine,r.excerpt);if(r.openable)c.append(button('Продолжить этот чат',async()=>{await api('open',{dialog:r.id});status('Диалог выбран. Вернись в Telegram и напиши сообщение.');tg?.HapticFeedback?.notificationOccurred('success')}));}$('results').append(c)}
   offset+=data.results.length;$('more').hidden=offset>=data.total;
   if(!data.total)empty($('results'),'Совпадений не найдено.');status('Найдено: '+data.total+(data.partial?' · часть папок недоступна':''));
 }catch(e){if(version===searchVersion)status(e.message,true)}finally{searchRunning=false;$('more').disabled=false;if(searchPending){searchPending=false;void search()}}
}
let debounce;function queueSearch(){searchVersion++;clearTimeout(debounce);debounce=setTimeout(()=>search(),450);remember()}
$('query').oninput=queueSearch;$('engine').onchange=queueSearch;$('kind').onchange=queueSearch;$('more').onclick=()=>search(true);
async function files(){const version=++fileVersion,key=$('dialog').value;if(!key)return;status('Загружаю файлы…');$('zip').disabled=$('zip-tg').disabled=true;
 try{const data=await api('list',{dialog:key});if(version!==fileVersion)return;$('file-list').replaceChildren();let shown=0;const draw=()=>{const batch=data.files.slice(shown,shown+30);shown+=batch.length;for(const f of batch)$('file-list').append(fileCard(f,key));if(shown<data.files.length){const more=button('Показать ещё',async()=>{more.remove();draw()});$('file-list').append(more)}};draw();if(!data.files.length)empty($('file-list'),'В диалоге пока нет файлов.');$('zip').disabled=$('zip-tg').disabled=!data.files.length;status(data.truncated?'Показана часть файлов: слишком большая папка.':'Файлов: '+data.files.length);remember();}catch(e){status(e.message,true)}}
async function loadChats(){const data=await api('chats');$('dialog').replaceChildren();for(const c of data.chats){const o=node('option',(c.engine==='gpt'?'GPT':'Claude')+' · '+c.title);o.value=c.id;$('dialog').append(o)}if(data.chats.some(c=>c.id===saved.dialog))$('dialog').value=saved.dialog;syncValues();await files()}
$('dialog').onchange=files;$('zip').onclick=async()=>{const b=$('zip');b.disabled=true;try{await download({dialog:$('dialog').value},true)}catch(e){status(e.message,true)}finally{b.disabled=false}};
$('zip-tg').onclick=async()=>{const b=$('zip-tg');b.disabled=true;try{await api('telegram-file',{dialog:$('dialog').value,zip:true});status('ZIP отправлен в Telegram.')}catch(e){status(e.message,true)}finally{b.disabled=false}};
async function tasks(){status('Проверяю задачи…');const data=await api('recoveries');$('task-list').replaceChildren();for(const t of data.tasks){const c=card(t.title,t.engine,t.prompt);let steps=[];try{steps=JSON.parse(t.steps)}catch{}if(steps.length){const details=node('details'),summary=node('summary','Последние этапы');details.append(summary,node('p',steps.slice(-5).map(s=>(s.done?'✓ ':'• ')+s.label).join('\n')));c.append(details)}c.append(button('Продолжить',async()=>{await api('recover',{id:t.id});c.remove();status('Задача продолжена. Ответ придёт в Telegram.')}));$('task-list').append(c)}if(!data.tasks.length)empty($('task-list'),'Прерванных задач нет.');status('')}
$('refresh').onclick=()=>tasks().catch(e=>status(e.message,true));
let chatsLoaded=false;async function tab(name){selectedTab=name;for(const n of ['search','files','tasks']){const section=$(n);section.hidden=n!==name;section.classList.toggle('enter',n===name)}for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===name));status('');remember();try{if(name==='files'&&!chatsLoaded){await loadChats();chatsLoaded=true}else if(name==='tasks')await tasks()}catch(e){status(e.message,true)}}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>tab(b.dataset.tab);
if(['all','gpt','claude'].includes(saved.engine))$('engine').value=saved.engine;if(['search','file-search'].includes(saved.kind))$('kind').value=saved.kind;
syncValues();const initial=new URLSearchParams(location.search).get('tab')||saved.tab;void tab(['search','files','tasks'].includes(initial)?initial:'search');

(()=>{
 if(window.gptNavigation.redirecting)return;
 const tg=window.Telegram?.WebApp,$=id=>document.getElementById(id),nf=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1});
 document.documentElement.dataset.theme=tg?.colorScheme||'light';tg?.ready();tg?.expand();
 for(const a of document.querySelectorAll('a')){const url=new URL(a.href);url.hash=location.hash;a.href=url.href;}
 function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
 async function load(){
  $('refresh').disabled=true;
  try{
   const r=await fetch('/api/miniapp/claude-admin',{headers:{'x-telegram-init-data':tg?.initData||''},signal:AbortSignal.timeout(25000),cache:'no-store'}),data=await r.json();
   if(!r.ok)throw Error(data.error||'Не удалось загрузить');
   $('limits').replaceChildren();
   for(const w of data.usage.windows){const card=node('div');card.className='usage-window';card.append(node('strong',w.title));if(w.used!==null){const bar=node('progress');bar.max=100;bar.value=w.used;bar.setAttribute('aria-label',w.title);card.append(node('span',Math.round(w.used)+'% использовано'),bar);}else card.append(node('span','Нет данных'));if(w.resetsAt)card.append(node('p','Сброс: '+new Date(w.resetsAt).toLocaleString('ru-RU')));$('limits').append(card);}
   $('limit-note').textContent=data.usage.stale?(data.usage.notice||'Свежие лимиты недоступны')+'. Показаны последние полученные данные.':'Лимиты из Claude Code. Расход ниже — только через бота.';
   $('users').replaceChildren();
   for(const u of data.users){const row=node('tr'),name=node('td',(u.name||'').replace(/[\u200B-\u200D\uFEFF\u3164]/g,'').trim()||(u.owner?'Мой профиль':String(u.id)));name.append(node('small',u.owner?'Администратор':u.allowed?'Доступ открыт':'Без доступа'));row.append(name,node('td',nf.format(u.today)),node('td',nf.format(u.week)));$('users').append(row);}
   $('status').textContent='';$('content').hidden=false;await window.gptNavigation.reveal();
  }catch(e){$('status').textContent=e.message;void window.gptNavigation.reveal(false);}finally{$('refresh').disabled=false;}
 }
 $('refresh').onclick=load;
 $('usage-chat').onclick=()=>{const url='https://t.me/AI_wIw_bot?start=usage_claude';if(tg?.openTelegramLink)tg.openTelegramLink(url);else location.assign(url);};
 load();
})();

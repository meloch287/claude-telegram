(() => {
  const tg=window.Telegram?.WebApp,root=document.documentElement,params=new URLSearchParams(location.search);
  // Dismiss Telegram native loading before a saved-route redirect.
  tg?.ready();tg?.expand();
  let uid=tg?.initDataUnsafe?.user?.id;
  try{uid??=JSON.parse(new URLSearchParams(tg?.initData||'').get('user')||'{}').id}catch{}
  const user=Number.isSafeInteger(Number(uid))&&Number(uid)>0?String(uid):'guest';
  const get=(key)=>{try{return localStorage.getItem(key)}catch{return null}};
  const put=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
  const parse=key=>{try{return JSON.parse(get(key))}catch{return null}};
  const validEngine=value=>value==='gpt'||value==='claude';
  const pages={library:'library.html',home:'modes.html',cats:'index.html',world:'index.html',admin:'chats.html','claude-admin':'chats.html'};
  const sections=Object.keys(pages),viewKey=`bot:last-view:v3:${user}`;
  const previous=parse(viewKey),saved=previous&&sections.includes(previous.section)&&validEngine(previous.engine)?previous:null;
  const requested=params.get('engine');
  let engine=validEngine(requested)?requested:root.dataset.page==='claude-admin'?'claude':saved?.engine||get(`bot:engine:${user}`)||'gpt';
  if(!validEngine(engine))engine='gpt';
  let section=root.dataset.page==='library'?'library':root.dataset.page==='modes'?'home':root.dataset.page==='claude-admin'?'claude-admin':root.dataset.page==='chats'?'admin':'cats';
  const explicit=params.get('section'),legacy=get(`bot:last-section:${user}:${engine}`);
  if(root.dataset.page==='cats')section=['cats','world'].includes(explicit)?explicit:['cats','world'].includes(legacy)?legacy:'cats';
  root.dataset.engine=engine;
  root.dataset.theme=tg?.colorScheme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  let loaded=false,scrollTimer,revealPromise;
  const stateKey=()=>`bot:view-state:v3:${user}:${engine}:${section}`;
  function state(){const value=parse(stateKey());return value&&typeof value==='object'?value:{}}
  function record(){
    if(user==='guest')return;
    put(viewKey,JSON.stringify({section,engine,at:Date.now()}));
    put(`bot:engine:${user}`,engine);
    if(section!=='home'&&section!=='claude-admin')put(`bot:last-section:${user}:${engine}`,section);
  }
  function capture(){
    if(!loaded||user==='guest')return;
    const old=state();put(stateKey(),JSON.stringify({...old,scroll:Math.max(0,Math.min(1e6,window.scrollY||0))}));record();
  }
  function rememberSection(value){if(!sections.includes(value))return;section=value;if(loaded)record();}
  function lastSection(){return section;}
  function setEngine(value){if(!validEngine(value)||value===engine)return;capture();engine=value;navigation.engine=value;root.dataset.engine=value;if(loaded)record();}
  function updateUI(patch){if(user==='guest')return;const old=state();put(stateKey(),JSON.stringify({...old,ui:{...old.ui,...patch}}));}
  const ui=()=>state().ui||{};
  function reveal(remember=true){
    if(!root.hasAttribute('data-boot')){loaded=remember;if(remember)record();return Promise.resolve();}
    if(revealPromise)return revealPromise;
    revealPromise=new Promise(resolve=>requestAnimationFrame(()=>{
      const y=state().scroll;
      if(remember&&Number.isFinite(y))window.scrollTo({top:Math.max(0,Math.min(1e6,y)),behavior:'instant'});
      void document.querySelector('.page-content')?.offsetWidth;
      requestAnimationFrame(()=>{
        loaded=remember;root.removeAttribute('data-boot');
        if(remember)record();
        const loader=document.querySelector('.page-loader');
        if(loader){loader.setAttribute('aria-hidden','true');setTimeout(()=>{loader.hidden=true},320)}
        resolve();
      });
    }));return revealPromise;
  }
  const navigation={lastSection,rememberSection,sections,engine,setEngine,capture,updateUI,ui,reveal,redirecting:false};
  window.gptNavigation=navigation;
  if('scrollRestoration' in history)history.scrollRestoration='manual';
  const launch=root.dataset.page==='modes'&&!explicit&&!params.has('engine')&&!params.has('demo')&&!params.has('visit');
  let redirect=launch&&saved&&saved.section!=='home'?saved:null;
  if(root.dataset.page==='claude-admin')redirect={section:'admin',engine};
  if(root.dataset.page==='chats'&&['cats','world'].includes(explicit))redirect={section:explicit,engine};
  if(redirect){
    const url=new URL('./'+pages[redirect.section],location.href);url.searchParams.set('section',redirect.section);url.searchParams.set('engine',redirect.engine);url.hash=location.hash;
    navigation.redirecting=true;location.replace(url.href);return;
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;
    const url=new URL(link.href,location.href);if(url.origin!==location.origin||!Object.values(pages).some(name=>url.pathname.endsWith('/'+name)))return;
    capture();if(url.pathname.endsWith('/modes.html')){url.searchParams.set('section','home');url.searchParams.set('engine',engine)}
    if(!url.hash)url.hash=location.hash;link.href=url.href;
  },{capture:true});
  addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(capture,180)},{passive:true});
  addEventListener('pagehide',capture);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)capture()});
  const bootTimeout=setTimeout(()=>{
    if(!root.hasAttribute('data-boot'))return;
    const loader=document.querySelector('.page-loader');if(!loader)return;
    loader.classList.add('boot-error');loader.setAttribute('role','alert');loader.removeAttribute('aria-label');
    const title=document.createElement('p'),hint=document.createElement('p'),retry=document.createElement('button');
    title.textContent='Не удалось загрузить приложение';hint.textContent='Проверь соединение и повтори.';retry.type='button';retry.textContent='Попробовать ещё раз';retry.onclick=()=>location.reload();loader.replaceChildren(title,hint,retry);tg?.ready();
  },20000);
  const observer=new MutationObserver(()=>{if(!root.hasAttribute('data-boot')){clearTimeout(bootTimeout);document.querySelector('.page-loader')?.classList.remove('boot-error');observer.disconnect()}});
  observer.observe(root,{attributes:true,attributeFilter:['data-boot']});
})();

(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let leaving = false;
  const closing = new WeakMap(), animations = new WeakMap(), pending = new Set();
  function animate(element, frames, options = {}) {
    if (!element?.animate || reduced.matches) return Promise.resolve();
    const old = animations.get(element);
    if (old?.playState === 'running') {
      const current = getComputedStyle(element), first = {...frames[0]};
      for (const key of Object.keys(first)) {
        if (key === 'opacity' || key === 'transform' || key === 'height') first[key] = current[key];
      }
      frames = [first, ...frames.slice(1)];
    }
    old?.cancel();
    const animation = element.animate(frames, {duration:220,easing:ease,...options});
    animations.set(element, animation);
    const done = animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) animations.delete(element);
      pending.delete(done);
    });
    pending.add(done);
    return done;
  }
  function enter(element, distance = 6) {
    return animate(element,[{opacity:.75,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'}]);
  }
  function change(update, options = {}) {
    const layout = options.layout;
    const height = layout?.getBoundingClientRect().height;
    if (layout) animations.get(layout)?.cancel();
    update();
    if (reduced.matches || options.animate === false) return Promise.resolve();
    const target = typeof options.target === 'function' ? options.target() : options.target;
    const tasks = [enter(target)];
    if (layout && height) {
      const next = layout.getBoundingClientRect().height;
      if (Math.abs(height-next) > .5) tasks.push(animate(layout,[{height:`${height}px`},{height:`${next}px`}],{duration:320}));
    }
    return Promise.all(tasks);
  }
  const sheetEase = 'cubic-bezier(.32,.72,0,1)';
  const isSheet = dialog => dialog.classList.contains('sheet');
  function backdrop(dialog, frames, duration) {
    try { dialog.animate(frames, {duration, easing: sheetEase, pseudoElement: '::backdrop', fill: 'forwards'}); } catch {}
  }
  function openDialog(dialog) {
    const old = closing.get(dialog);
    let current;
    if(old){current=getComputedStyle(dialog);current={opacity:current.opacity,transform:current.transform};old.cancelled=true;old.animation?.cancel();closing.delete(dialog);}
    if(!dialog.open)dialog.showModal();
    if(isSheet(dialog)){
      if(reduced.matches)return;
      backdrop(dialog,[{opacity:0},{opacity:1}],320);
      animate(dialog,[current&&current.transform!=='none'?current:{transform:'translateY(100%)'},{transform:'translateY(0)'}],{duration:480,easing:sheetEase});
      return;
    }
    if(current)animate(dialog,[current,{opacity:1,transform:'translateY(0)'}]);
    else enter(dialog,16);
  }
  async function closeDialog(dialog) {
    if(!dialog.open || closing.has(dialog))return;
    if(reduced.matches){dialog.close();return;}
    const current=getComputedStyle(dialog),start={opacity:current.opacity,transform:current.transform};
    animations.get(dialog)?.cancel();
    const record={cancelled:false};closing.set(dialog,record);
    if(isSheet(dialog)){
      backdrop(dialog,[{opacity:1},{opacity:0}],260);
      record.animation=dialog.animate([start,{transform:'translateY(100%)'}],{duration:280,easing:sheetEase});
    } else record.animation=dialog.animate([start,{opacity:0,transform:'translateY(12px)'}],{duration:180,easing:ease});
    await record.animation.finished.catch(()=>{});
    if(!record.cancelled)dialog.close();
    record.animation.cancel();if(closing.get(dialog)===record)closing.delete(dialog);
  }
  /** Шторку можно смахнуть вниз пальцем, как в Telegram. */
  function draggable(dialog) {
    let startY=null,lastY=0,lastT=0,velocity=0,dy=0;
    dialog.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'||dialog.scrollTop>0||event.target.closest('button,a,input,select,textarea'))return;
      startY=event.clientY;lastY=startY;lastT=event.timeStamp;velocity=0;dy=0;animations.get(dialog)?.cancel();
    });
    dialog.addEventListener('pointermove',event=>{
      if(startY===null)return;
      dy=Math.max(0,event.clientY-startY);
      const dt=Math.max(1,event.timeStamp-lastT);velocity=(event.clientY-lastY)/dt;lastY=event.clientY;lastT=event.timeStamp;
      if(dy>4)dialog.style.transform=`translateY(${dy}px)`;
    });
    const end=()=>{
      if(startY===null)return;startY=null;
      const moved=dy;dialog.style.transform='';
      if(moved>110||velocity>0.6){animations.set(dialog,null);dialog.style.transform=`translateY(${moved}px)`;closeDialog(dialog).finally(()=>{dialog.style.transform='';});}
      else if(moved>4)animate(dialog,[{transform:`translateY(${moved}px)`},{transform:'translateY(0)'}],{duration:420,easing:sheetEase});
    };
    dialog.addEventListener('pointerup',end);dialog.addEventListener('pointercancel',end);
  }
  function restore(){leaving=false;document.documentElement.removeAttribute('data-leaving');}
  addEventListener('pageshow',restore);
  // Без слушателя touchstart iOS не показывает :active — подсветка строк под пальцем.
  document.addEventListener('touchstart',()=>{},{passive:true});
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin||!['/','/modes.html','/index.html','/chats.html','/claude-admin.html','/library.html'].includes(url.pathname))return;
    if(url.pathname===location.pathname&&url.search===location.search){if(!url.hash||url.hash===location.hash)event.preventDefault();return;}
    if(!url.hash)url.hash=location.hash;
    link.href=url.href;
    if(leaving){event.preventDefault();return;}
    if(reduced.matches||'onpagereveal' in window)return;
    event.preventDefault();leaving=true;document.documentElement.dataset.leaving='true';
    setTimeout(()=>location.assign(url.href),140);
    setTimeout(restore,2500);
  });
  document.addEventListener('DOMContentLoaded',()=>{
    for(const dialog of document.querySelectorAll('dialog')){dialog.addEventListener('cancel',event=>{event.preventDefault();void closeDialog(dialog);});if(isSheet(dialog))draggable(dialog);}
  });
  window.aiMotion={change,enter,openDialog,closeDialog,settled:()=>Promise.all([...pending])};
})();

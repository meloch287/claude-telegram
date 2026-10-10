import {resolve,relative,isAbsolute} from 'node:path';
export const FILE_DELIVERY_PROMPT='Файлы: если пользователь просит прислать, скачать или получить файл, самостоятельно найди/создай его и прикрепи в этом же ответе. Для каждого готового файла добавь отдельную строку [[file:путь]]. Это работает и для ранее созданных файлов. Не отправляй пользователя к /file или /files и не обещай вложение без маркера. До 5 файлов, каждый до 49 МиБ. Для общего файла используй [[file:shared:Shared/Images/имя.png]] или путь внутри текущей папки. Если файлов больше — собери нужные в архив. Служебные ключи не прикрепляй.';
export function outgoingFiles(body:string){
 const files:string[]=[];
 const add=(value:string)=>{const path=value.trim().replace(/^sandbox:/,'');if(path&&!files.includes(path))files.push(path)};
 const visible=body.replace(/\[\[file:([^\]\n]+)\]\]/g,(_,p:string)=>{add(p);return ''}).trim();
 for(const m of visible.matchAll(/\[[^\]\n]+\]\((?:<)?((?:sandbox:|\/)[^\n)<>]+)(?:>)?\)/g))add(m[1]!);
 return {visible,files};
}
export function deliveryPath(cwd:string,sharedRoot:string,input:string){
 if(input.startsWith('shared:')){const name=input.slice(7);if(!/^(Shared|GPT_BOT|Claude_BOT)\//.test(name))throw Error('Недопустимый общий файл');return checked(sharedRoot,name)}
 if(isAbsolute(input)){
  for(const root of [cwd,sharedRoot]){const name=relative(root,input);if(name&&!name.startsWith('../')&&!isAbsolute(name)){if(root===sharedRoot&&!/^(Shared|GPT_BOT|Claude_BOT)\//.test(name))throw Error('Служебный файл недоступен');return checked(root,name)}}
  throw Error('Файл находится вне твоей рабочей папки');
 }
 return checked(cwd,input);
}
function checked(root:string,name:string){if(!name||name.includes('\0')||name.split('/').some(p=>!p||p==='.'||p==='..')||isAbsolute(name))throw Error('Недопустимый путь');return {root:resolve(root),name,path:resolve(root,name)}}

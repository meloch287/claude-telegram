import { fetchTelegramFile } from "./tgFile.js";
import { constants, openSync, closeSync, fstatSync, fchmodSync, fchownSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workerFor } from "../agent/isolation.js";
import type { Api } from "grammy";
export interface SavedAttachment {path:string;name:string;}
export function saveAttachment(userId:number,cwd:string,suggested:string,bytes:Buffer):SavedAttachment {
  const worker=workerFor(userId),flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
  const project=openSync(cwd,flags);
  let dir:number|undefined,file:number|undefined;
  const clean=suggested.replace(/[^\w.\-А-Яа-яЁё ]+/g,"_").replace(/^[.\s]+/,"").slice(0,80)||"файл";
  const name=`${randomUUID().slice(0,8)}-${clean}`;
  try{
    if(fstatSync(project).uid!==worker.uid)throw Error("Чужая рабочая папка");
    const upload=`/proc/self/fd/${project}/вложения`;
    try{mkdirSync(upload,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
    dir=openSync(upload,flags);
    if(![0,worker.uid].includes(fstatSync(dir).uid))throw Error("Чужая папка вложений");
    fchownSync(dir,worker.uid,worker.gid);fchmodSync(dir,0o700);
    file=openSync(`/proc/self/fd/${dir}/${name}`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    fchownSync(file,worker.uid,worker.gid);writeFileSync(file,bytes);
    return {path:join(cwd,"вложения",name),name};
  }finally{if(file!==undefined)closeSync(file);if(dir!==undefined)closeSync(dir);closeSync(project);}
}
export async function saveTelegramFile(api:Api,fileId:string,cwd:string,suggestedName:string,userId:number):Promise<SavedAttachment>{
  const file=await api.getFile(fileId),limit=20*1024*1024;
  if((file.file_size??0)>limit)throw Error("Вложение больше 20 МБ. Раздели файл или пришли ссылку.");
  if(!file.file_path)throw Error("Telegram не вернул путь к файлу");
  const response=await fetchTelegramFile(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`);
  if(!response.ok||!response.body)throw Error(`Не удалось скачать файл: HTTP ${response.status}`);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error("Вложение больше 20 МБ");chunks.push(value);}}
  finally{await reader.cancel();reader.releaseLock();}
  return saveAttachment(userId,cwd,suggestedName,Buffer.concat(chunks));
}

import path from 'node:path';
export function imageType(bytes) {
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
export function turnInput(prompt, images=[], cwd) {
 const input=[{type:'text',text:prompt,text_elements:[]}];
 if(!Array.isArray(images)||images.length>20)throw Error('Слишком много изображений');
 for(const file of [...new Set(images)]) {
  if(typeof file!=='string'||path.posix.normalize(file)!==file||!/^\.uploads\/[\p{L}\p{N}._-]+$/u.test(file)||!path.posix.isAbsolute(cwd))throw Error('Изображение должно находиться в папке вложений текущего диалога');
  input.push({type:'localImage',path:path.posix.join(cwd,file)});
 }
 return input;
}

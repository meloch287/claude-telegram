import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
export function imageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const b=Buffer.from(bytes);
  if(b[0]===255&&b[1]===216&&b[2]===255)return "image/jpeg";
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(b.toString("ascii",0,4)==="RIFF"&&b.toString("ascii",8,12)==="WEBP")return "image/webp";
  return null;
}
export async function videoPreview(bytes: Buffer, signal?: AbortSignal): Promise<{frames:Buffer[];duration:number}> {
  const dir=await mkdtemp(join(tmpdir(),"ai-video-"));
  const source=join(dir,"source");
  const input=["-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,webm,avi,ogg,gif,mpeg,mpegts"];
  try {
    await writeFile(source,bytes,{mode:0o600});
    const probe=await exec("ffprobe",["-v","error",...input,"-show_entries","format=duration","-of","json",source],{timeout:15000,maxBuffer:65536,signal});
    const duration=Number(JSON.parse(probe.stdout).format?.duration)||0;
    const times=duration>2?[0,duration*.4,duration*.8]:[0];
    const frames:Buffer[]=[];
    for(let i=0;i<times.length;i++){
      const output=join(dir,`frame-${i}.jpg`);
      await exec("ffmpeg",["-nostdin","-v","error","-threads","1",...input,"-ss",String(times[i]),"-i",source,"-frames:v","1","-filter_threads","1","-vf","scale=640:-2","-q:v","3",output],{timeout:20000,maxBuffer:65536,signal});
      frames.push(await readFile(output));
    }
    if(!frames.length)throw Error("В видео не найдены кадры");
    return {frames,duration};
  }finally{await rm(dir,{recursive:true,force:true});}
}

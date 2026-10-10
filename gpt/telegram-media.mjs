export function telegramMedia(message) {
  const media=message.voice||message.audio||message.video||message.video_note||message.animation||message.document||message.photo?.at(-1);
  if(!media)return null;
  const isAudio=!!(message.voice||message.audio||message.document?.mime_type?.startsWith('audio/'));
  const isVideo=!!(message.video||message.video_note||message.animation||message.document?.mime_type?.startsWith('video/'));
  return {media,isAudio,isVideo,filename:media.file_name||(isAudio?'voice.ogg':isVideo?'video.mp4':'photo.jpg'),caption:message.caption,messageId:message.message_id};
}

import { GrammyError, type Context, type InlineKeyboard } from 'grammy';
import { isAdmin } from '../admin.js';

type Row = [string,string];
type Section = {title:string;rows?:Row[];text?:string[]};
const escape = (s:string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function helpContent(engine:'gpt'|'claude', admin=false) {
 const gpt=engine==='gpt';
 const title=gpt?'GPT бот · Команды':'Клод бот · Команды';
 const main:Row[]=[['/search текст','Поиск по GPT и Claude'],['/continue','Прерванные задачи'],['/files','Галерея и ZIP'],['/voice','Включить / выключить озвучку'],['/start','Главный экран'],['/web','Открыть в браузере'],['/new','Новый диалог'],['/resume','Прошлые диалоги'],['/model','Выбрать модель'],['/effort','Глубина размышления'],['/stop','Остановить задачу'],[gpt?'/usage':'/stats',gpt?'Лимиты GPT':'Моя статистика']];
 const sections:Section[]=[
  {title:'Диалоги и файлы',rows:gpt?[
   ['/rename название','Название диалога'],['/delete','Удаление диалогов'],['/project имя','Выбрать проект'],['/projects','Список проектов'],['/file путь','Скачать файл'],['/storage','Место на диске'],['/summary','Сводка перенесённого чата'],['/export','Экспорт переписки'],
  ]:[['/rename название','Название диалога'],['/delete','Удалить чаты Claude и их файлы'],['/storage','Место на диске и очистка'],['/project имя','Выбрать проект'],['/file путь','Скачать файл'],['/context','Заполнение контекста'],['/bg задача','Задача в фоне'],['/clone адрес','Клонировать репозиторий'],['/diff','Изменения в коде'],['/commit текст','Создать коммит']]},
  {title:'Настройки и подключения',rows:gpt?[
   ['/settings','Модель и разрешения'],['/permissions','Самостоятельно / чтение'],['/github','Подключить GitHub'],['/logout','Выйти из ChatGPT'],
  ]:[['/mode','Режим разрешений'],['/effort','Глубина размышления'],['/usage','Лимиты Claude'],['/cats','Коты и достижения'],['/github','Подключить GitHub'],['/logout','Удалить свой доступ']]},
  {title:'Фото, файлы и рабочая папка',text:[
   'Напиши задачу или отправь фото, видео, голосовое и документы.',
   'Фото и скриншоты передаются как изображения, из видео извлекаются отдельные кадры, голосовые расшифровываются и отправляются только после подтверждения текста. Документы сохраняются в папку диалога.',
   'У каждого пользователя свои файлы и история. В своей рабочей папке можно создавать, читать и изменять файлы; режим «Только чтение» ограничивает изменения.',
   'В миниапке выбери GPT или Claude: у каждого режима свои настройки, кот, статистика и мир.',
  ]},
 ];
 if(admin)sections.push({title:'Администратору',rows:[['/admin','Пользователи и доступ'],...(gpt?[]:[['/logs','Журнал бота'] as Row])],text:['Управление доступом доступно только владельцу бота.']});
 const table=(rows:Row[])=>'<table bordered striped compact><tr><th>Команда</th><th>Действие</th></tr>'+rows.map(([cmd,label])=>`<tr><td>${escape(cmd)}</td><td>${escape(label)}</td></tr>`).join('')+'</table>';
 const html=`<h2>${title}</h2><p>Напиши задачу или выбери команду.</p>${table(main)}`+sections.map(s=>`<details><summary>${escape(s.title)}</summary>${s.rows?table(s.rows):''}${(s.text||[]).map(t=>`<p>${escape(t)}</p>`).join('')}</details>`).join('');
 const compact=(rows:Row[])=>rows.map(([cmd,label])=>`${cmd.padEnd(13)} ${label}`).join('\n');
 const fallback=`<b>${title}</b>\n\n<pre>${escape(compact(main))}</pre>\n\n`+sections.map(s=>`<blockquote expandable><b>${escape(s.title)}</b>\n${s.rows?s.rows.map(([cmd,label])=>`${escape(cmd)} — ${escape(label)}`).join('\n'):''}${s.text?'\n'+s.text.map(escape).join('\n\n'):''}</blockquote>`).join('\n\n');
 return {html,fallback};
}
export async function sendHelp(ctx:Context,engine:'gpt'|'claude',keyboard?:InlineKeyboard){
 const content=helpContent(engine,isAdmin(ctx.from?.id));
 try {
  return await ctx.api.raw.sendRichMessage({chat_id:ctx.chat!.id,rich_message:{html:content.html},...(keyboard?{reply_markup:keyboard}:{})});
 } catch(error) {
  if(!(error instanceof GrammyError)||error.error_code!==400)throw error;
  return ctx.reply(content.fallback,{parse_mode:'HTML',...(keyboard?{reply_markup:keyboard}:{})});
 }
}

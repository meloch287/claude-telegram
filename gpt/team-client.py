import argparse,json,os,sys,urllib.request,urllib.error
from pathlib import Path
p=argparse.ArgumentParser(description='Общая история GPT и Claude, консультации и изображения')
s=p.add_subparsers(dest='op',required=True)
h=s.add_parser('history');h.add_argument('--engine',choices=['gpt','claude','all'],default='all');h.add_argument('--chat');h.add_argument('--offset',type=int,default=0);h.add_argument('--limit',type=int,default=100)
a=s.add_parser('ask');a.add_argument('engine',choices=['gpt','claude']);a.add_argument('prompt',nargs='?');a.add_argument('--chat');a.add_argument('--history-engine',choices=['gpt','claude'],default='gpt')
i=s.add_parser('image');i.add_argument('prompt',nargs='?')
s.add_parser('refresh');s.add_parser('status');s.add_parser('cancel')
args=vars(p.parse_args())
if args['op'] in ['ask','image'] and not args.get('prompt'):args['prompt']=sys.stdin.read(64001)
try:
 config=json.loads(Path(__file__).with_name('.ai-team.json').read_text())
 args['source']=os.environ.get('AI_TEAM_ENGINE','gpt')
 request=urllib.request.Request(config['url'],data=json.dumps(args).encode(),headers={'Authorization':'Bearer '+config['token'],'Content-Type':'application/json'},method='POST')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(request,timeout=360) as response:result=json.load(response)
 except urllib.error.HTTPError as e:
  result=json.load(e);print(json.dumps(result,ensure_ascii=False));sys.exit(1)
 print(json.dumps(result,ensure_ascii=False,indent=2))
except Exception as e:
 print('Не удалось связаться с личной командой ИИ. Повтори запрос позже.',file=sys.stderr);sys.exit(1)

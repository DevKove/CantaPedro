import { createMidiEngine } from './vendor/midi-engine.js';

const DB_NAME='cantapedro-db', DB_VERSION=1, STORE='tracks';
const supported=new Set(['kar','mid','midi','mp3','wav','ogg','flac','m4a','aac','mp4','webm','mkv']);
const $=id=>document.getElementById(id);
let db, tracks=[], queue=[], current=null, media=null, mediaUrl=null, midiEngine=null, midiEnginePromise=null, lyrics=[], raf=0, view='library', favorites=new Set();
const openDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const tx=(mode,fn)=>new Promise((resolve,reject)=>{
 const transaction=db.transaction(STORE,mode),store=transaction.objectStore(STORE);
 let request;
 try{request=fn(store)}catch(error){reject(error);return}
 transaction.oncomplete=()=>resolve(request?.result);
 transaction.onerror=()=>reject(transaction.error||new Error('Falha na transação do banco local'));
 transaction.onabort=()=>reject(transaction.error||new Error('Transação do banco local cancelada'));
 if(request)request.onerror=()=>reject(request.error||new Error('Falha ao acessar a biblioteca local'));
});
const ext=f=>f.name.split('.').pop().toLowerCase();
const id=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
const fmt=s=>{if(!Number.isFinite(s))return '0:00';let m=Math.floor(s/60),sec=Math.floor(s%60);return m+':'+String(sec).padStart(2,'0')};
const titleOf=n=>n.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
async function init(){db=await openDB();tracks=(await tx('readonly',s=>s.getAll()))||[];tracks.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));render();if(location.protocol!=='cantapedro:'&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});$('file-picker').addEventListener('change',e=>importFiles(e.target.files));$('folder-picker').addEventListener('change',e=>importFiles(e.target.files));}
async function importFiles(list){const files=[...list].filter(f=>supported.has(ext(f)));if(!files.length){toast('Nenhum formato compatível foi selecionado.');return}let added=0;for(const file of files){const format=ext(file),name=titleOf(file.name),record={id:id(),name:file.name,title:name,artist:'Arquivo local',format,size:file.size,blob:file,addedAt:Date.now(),favorite:false};if(['kar','mid','midi'].includes(format)){try{const parsed=parseMidi(await file.arrayBuffer());record.title=parsed.title||name;record.artist=parsed.artist||'Arquivo MIDI';record.lyrics=parsed.lyrics;record.notes=parsed.notes;record.duration=parsed.duration}catch(e){console.warn('Falha ao ler MIDI/KAR',file.name,e);record.error='MIDI não reconhecido'}}await tx('readwrite',s=>s.put(record));tracks.push(record);added++}tracks.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));render();toast(added+' arquivo(s) importado(s) para sua biblioteca.');$('file-picker').value='';$('folder-picker').value=''}
function readVar(data,state){let value=0,b;do{if(state.i>=data.length)throw Error('MIDI truncado');b=data[state.i++];value=(value<<7)|(b&127)}while(b&128);return value}
function parseMidi(buffer){
 const d=new DataView(buffer),bytes=new Uint8Array(buffer);let p=0;
 const ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
 if(ascii(0,4)!=='MThd')throw Error('Cabeçalho inválido');
 const headerLen=d.getUint32(4),division=d.getUint16(12);
 if(division&0x8000)throw Error('MIDI SMPTE não suportado');
 const ppq=division||480;let pos=8+headerLen,all=[],tempo=[{tick:0,us:500000}],meta=[];
 while(pos+8<=bytes.length){
  const tag=ascii(pos,4),len=d.getUint32(pos+4);pos+=8;
  if(tag!=='MTrk'||pos+len>bytes.length)break;
  const end=pos+len,state={i:pos};let tick=0,running=0;
  while(state.i<end){
   tick+=readVar(bytes,state);let status=bytes[state.i];
   if(status<128)status=running;else state.i++;
   if(status<128)throw Error('Status MIDI inválido');
   if(status<240)running=status;
   const type=status&240,ch=status&15;
   if(status===255){
    const mt=bytes[state.i++],n=readVar(bytes,state),payload=bytes.slice(state.i,state.i+n);state.i+=n;
    if(mt===3||mt===1||mt===5){
     const text=new TextDecoder('latin1').decode(payload).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim();
     if(text)meta.push({tick,text,type:mt});
    }
    if(mt===81&&n===3)tempo.push({tick,us:(payload[0]<<16)|(payload[1]<<8)|payload[2]});
    if(mt===47)break;
    continue;
   }
   if(status===240||status===247){const n=readVar(bytes,state);state.i+=n;continue}
   const a=bytes[state.i++],b=(type===192||type===208)?0:bytes[state.i++];
   if(type===144&&b>0)all.push({tick,type:'on',note:a,velocity:b,ch});
   else if(type===128||(type===144&&b===0))all.push({tick,type:'off',note:a,ch});
  }
  pos=end;
 }
 tempo.sort((a,b)=>a.tick-b.tick);
 const toSec=t=>{let sec=0,last=0,us=500000;for(const x of tempo){if(x.tick>=t)break;sec+=(x.tick-last)*us/ppq/1e6;last=x.tick;us=x.us}return sec+(t-last)*us/ppq/1e6};
 const notes=all.map(e=>({...e,time:toSec(e.tick)})).sort((a,b)=>a.time-b.time);
 const lyricEvents=meta.filter(x=>x.type===5);
 const source=lyricEvents.length?lyricEvents:meta.filter(x=>x.type===1);
 const lines=[];let line='',lineTime=0,lastLyricTime=0;
 const flush=()=>{const text=line.replace(/\s+/g,' ').trim();if(text)lines.push({time:lineTime,text});line='';lastLyricTime=0};
 const appendLyric=(chunk,eventTime)=>{
  const value=chunk.replace(/\s+/g,' ');
  if(!value.trim())return;
  if(line&&(line.length+value.length>72||eventTime-lastLyricTime>2.8))flush();
  if(!line)lineTime=eventTime;
  // KAR stores syllables as separate lyric events; only preserve spaces explicitly present in the source.
  const syllable=value.replace(/[-_=]+$/,'').replace(/^[-_=]+/,'');
  line+=syllable;lastLyricTime=eventTime;
 };
 for(const event of source.sort((a,b)=>a.tick-b.tick)){
  const text=event.text;
  if(/^@(T|L|K|V|I|KMIDI|LEN|W)/i.test(text))continue;
  const eventTime=toSec(event.tick);
  for(const part of text.split(/([\\/\r\n]+)/)){
   if(/^[\\/\r\n]+$/.test(part))flush();
   else appendLyric(part,eventTime);
  }
 }
 flush();
 const end=Math.max(0,...notes.map(x=>x.time),...lines.map(x=>x.time));
 return{title:meta.find(x=>x.type===3)?.text||'',artist:'Arquivo MIDI/KAR',lyrics:lines,notes,duration:end+2};
}
function render(){const query=$('search').value.toLocaleLowerCase('pt-BR');let list=tracks.filter(t=>(t.title+' '+t.artist+' '+t.name).toLocaleLowerCase('pt-BR').includes(query));if(view==='favorites')list=list.filter(t=>t.favorite);if(view==='queue')list=queue.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);if(view==='formats'){list=[];$('empty').querySelector('h3').textContent='Formatos compatíveis';$('empty').querySelector('p').innerHTML='KAR, MID, MIDI · MP3, WAV, OGG, FLAC, M4A, AAC · MP4 e WebM.<br>Compatibilidade de áudio/vídeo depende do codec disponível no sistema.';$('empty').style.display='block';$('song-list').innerHTML='';$('page-title').textContent='Formatos aceitos';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;return}$('page-title').textContent=view==='queue'?'Fila de reprodução':view==='favorites'?'Favoritas':'Minha biblioteca';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;$('empty').style.display=list.length?'none':'block';$('empty').querySelector('h3').textContent=view==='queue'?'Sua fila está vazia':view==='favorites'?'Nenhuma favorita ainda':'Sua biblioteca está esperando';$('empty').querySelector('p').textContent=view==='queue'?'Adicione músicas à fila para organizar sua apresentação.':view==='favorites'?'Marque músicas com o coração para encontrá-las aqui.':'Importe arquivos KAR, MIDI, MP3, WAV, OGG, FLAC ou vídeos de karaokê.';$('song-list').innerHTML=list.map(t=>`<article class="song-row"><div class="song-cover">♫</div><div class="song-name"><b>${escapeHTML(t.title)}</b><small>${escapeHTML(t.artist||'Arquivo local')}</small></div><span class="format">${t.format.toUpperCase()}</span><button class="song-action" data-play="${t.id}" title="Reproduzir">▶</button><button class="song-action" data-fav="${t.id}" title="Favoritar">${t.favorite?"♥":"♡"}</button><button class="song-action" data-more="${t.id}" title="Adicionar à fila">＋</button></article>`).join('');$('song-list').querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>play(b.dataset.play));$('song-list').querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{queue.push(b.dataset.more);render();toast('Adicionada à fila.')});$('song-list').querySelectorAll('[data-fav]').forEach(b=>b.onclick=async()=>{const t=tracks.find(x=>x.id===b.dataset.fav);t.favorite=!t.favorite;await tx('readwrite',s=>s.put(t));render()})}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function stop(){
 if(media){media.pause();media.src='';media=null}
 if(mediaUrl){URL.revokeObjectURL(mediaUrl);mediaUrl=null}
 $('video-stage').hidden=true;$('video-stage').innerHTML='';
 midiEngine?.stop();
 cancelAnimationFrame(raf);$('play').textContent='▶';
}
async function getMidiEngine(){
 if(!midiEnginePromise)midiEnginePromise=createMidiEngine(Number($('volume').value)).then(engine=>(midiEngine=engine)).catch(error=>{midiEnginePromise=null;throw error});
 return midiEnginePromise;
}
async function play(trackId){const t=tracks.find(x=>x.id===trackId);if(!t)return;stop();current=t;$('now-title').textContent=t.title;$('now-artist').textContent=t.artist;$('lyrics-title').textContent=t.title;showLyrics(t);if(['kar','mid','midi'].includes(t.format)){if(!t.notes){toast('Este arquivo MIDI não contém uma faixa reproduzível.');return}playMidi(t)}else{const url=URL.createObjectURL(t.blob);mediaUrl=url;const isVideo=['mp4','webm','mkv'].includes(t.format);media=document.createElement(isVideo?'video':'audio');media.src=url;media.volume=Number($('volume').value);if(isVideo){media.controls=true;media.playsInline=true;$('video-stage').appendChild(media);$('video-stage').hidden=false;}media.onloadedmetadata=()=>{$('duration').textContent=fmt(media.duration)};media.ontimeupdate=()=>{$('current-time').textContent=fmt(media.currentTime);if(media.duration)$('progress').value=media.currentTime/media.duration*1000};media.onended=next;media.play().then(()=>$('play').textContent='Ⅱ').catch(()=>toast('Não foi possível reproduzir este formato neste navegador.'))}}
async function playMidi(t){
 try{
  const engine=await getMidiEngine();
  await engine.play(await t.blob.arrayBuffer());
  const duration=Math.max(engine.duration||0,Number(t.duration)||0,1);
  $('duration').textContent=fmt(duration);$('play').textContent='Ⅱ';
  const update=()=>{
   if(current!==t)return;
   const elapsed=engine.currentTime;
   $('current-time').textContent=fmt(elapsed);
   $('progress').value=Math.min(1000,elapsed/duration*1000);
   syncLyrics(elapsed);
   if(engine.isFinished){next();return}
   raf=requestAnimationFrame(update);
  };
  cancelAnimationFrame(raf);raf=requestAnimationFrame(update);
 }catch(error){console.error('Falha no sintetizador SoundFont',error);toast(error.message||'Não foi possível inicializar o sintetizador de áudio.')}
}
function playMidiProgress(){if(!current||!midiEngine||midiEngine.paused)return;const elapsed=midiEngine.currentTime,duration=Math.max(midiEngine.duration,1);$('current-time').textContent=fmt(elapsed);$('progress').value=Math.min(1000,elapsed/duration*1000);syncLyrics(elapsed);if(midiEngine.isFinished){next();return}raf=requestAnimationFrame(playMidiProgress)}
function showLyrics(t){
 const first=t.lyrics?.[0]?.text||'Este arquivo não possui letras sincronizadas embutidas.';
 $('lyrics-lines').innerHTML='<p id="active-lyric" class="current"></p>';
 $('lyrics-lines').querySelector('#active-lyric').textContent=first;
}
function syncLyrics(time){
 const lines=current?.lyrics;
 if(!lines?.length)return;
 let low=0,high=lines.length-1,idx=-1;
 while(low<=high){const mid=(low+high)>>1;if(lines[mid].time<=time){idx=mid;low=mid+1}else high=mid-1}
 const target=$('lyrics-lines').querySelector('#active-lyric');
 if(target)target.textContent=idx>=0?lines[idx].text:'♪';
}
function next(){if(!queue.length){stop();current=null;$('now-title').textContent='Reprodução finalizada';return}const id=queue.shift();render();play(id)}
async function clearLibrary(){
 try{
  const persistedCount=await tx('readonly',s=>s.count());
  if(!persistedCount&&!tracks.length){toast('A biblioteca já está vazia.');return}
  const confirmed=window.confirm('Tem certeza de que deseja apagar TODAS as músicas da biblioteca? Esta ação não pode ser desfeita. Os arquivos originais no computador não serão apagados.');
  if(!confirmed)return;
  stop();
  await tx('readwrite',s=>s.clear());
  const remaining=await tx('readonly',s=>s.count());
  if(remaining!==0)throw new Error('A verificação encontrou '+remaining+' registro(s) que não foram removidos.');
  tracks=[];queue=[];current=null;favorites.clear();
  $('now-title').textContent='Nenhuma música selecionada';
  $('now-artist').textContent='Importe suas músicas para começar';
  $('current-time').textContent='0:00';$('duration').textContent='0:00';$('progress').value=0;
  $('lyrics-title').textContent='Letras sincronizadas';
  $('lyrics-lines').innerHTML='<p>Importe uma música com letras sincronizadas.</p>';
  view='library';document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='library'));
  render();
  toast('Biblioteca limpa e conferida. Os arquivos originais foram preservados.');
 }catch(error){console.error('Falha ao limpar biblioteca',error);toast(error.message||'Não foi possível limpar a biblioteca.')}
}
$('clear-library').onclick=clearLibrary;
$('add-files').onclick=$('hero-import').onclick=$('empty-import').onclick=$('nav-import').onclick=()=>$('file-picker').click();$('import-folder').onclick=()=>$('folder-picker').click();$('search').oninput=render;
document.querySelectorAll('.nav[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));render();closeSidebar()});$('menu-toggle').onclick=()=>{const open=document.body.classList.toggle('sidebar-open');$('menu-toggle').setAttribute('aria-expanded',String(open))};$('sidebar-backdrop').onclick=closeSidebar;function closeSidebar(){document.body.classList.remove('sidebar-open');$('menu-toggle').setAttribute('aria-expanded','false')}
$('test-audio').onclick=async()=>{try{const engine=await getMidiEngine();await engine.testTone();toast('Teste de instrumento SoundFont iniciado.')}catch(error){console.error(error);toast(error.message||'Falha ao testar o áudio.')}};
$('play').onclick=async()=>{if(!current){if(tracks[0])play(tracks[0].id);return}if(media){media.paused?media.play():media.pause();$('play').textContent=media.paused?'▶':'Ⅱ'}else if(['kar','mid','midi'].includes(current.format)){try{const engine=await getMidiEngine();if(engine.paused){await engine.resume();$('play').textContent='Ⅱ';raf=requestAnimationFrame(()=>playMidiProgress())}else{engine.pause();$('play').textContent='▶';cancelAnimationFrame(raf)}}catch(error){toast(error.message||'Falha no áudio.')}}};
$('next').onclick=next;$('prev').onclick=()=>{if(current)play(current.id)};$('volume').oninput=()=>{const value=Number($('volume').value);if(media)media.volume=value;midiEngine?.setVolume(value)};
$('progress').oninput=()=>{const ratio=Number($('progress').value)/1000;if(media&&media.duration)media.currentTime=media.duration*ratio;else if(midiEngine&&midiEngine.duration)midiEngine.seek(midiEngine.duration*ratio)};
$('toggle-lyrics').onclick=()=>$('lyrics-panel').classList.toggle('open');$('close-lyrics').onclick=()=>$('lyrics-panel').classList.remove('open');$('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
window.addEventListener('keydown',e=>{if(e.target.matches('input'))return;if(e.code==='Space'){e.preventDefault();$('play').click()}if(e.key==='/'){e.preventDefault();$('search').focus()}if(e.key==='Escape')$('lyrics-panel').classList.remove('open')});
init().catch(e=>{console.error(e);toast('Erro ao abrir biblioteca local.')});
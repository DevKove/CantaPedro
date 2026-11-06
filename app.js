const DB_NAME='cantapedro-db', DB_VERSION=1, STORE='tracks';
const supported=new Set(['kar','mid','midi','mp3','wav','ogg','flac','m4a','aac','mp4','webm','mkv']);
const $=id=>document.getElementById(id);
let db, tracks=[], queue=[], current=null, media=null, mediaUrl=null, audioCtx=null, midiMaster=null, midiNodes=[], midiStart=0, midiEvents=[], lyrics=[], raf=0, view='library', favorites=new Set();
const openDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const tx=(mode,fn)=>new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),s=t.objectStore(STORE);let req=fn(s);t.oncomplete=()=>resolve(req?.result);t.onerror=()=>reject(t.error)});
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
 const lines=[];let line='',lineTime=0;
 const flush=()=>{const text=line.replace(/\s+/g,' ').trim();if(text)lines.push({time:lineTime,text});line=''};
 for(const event of source.sort((a,b)=>a.tick-b.tick)){
  let text=event.text;
  if(/^@(T|L|K|V|I|KMIDI|LEN|W)/i.test(text))continue;
  if(!line)lineTime=toSec(event.tick);
  text=text.replace(/\//g,'');
  const parts=text.split(/([\\\r\n]+)/);
  for(const part of parts){
   if(/^[\\\r\n]+$/.test(part)){flush();lineTime=toSec(event.tick)}
   else line+=part;
  }
 }
 flush();
 const end=Math.max(0,...notes.map(x=>x.time));
 return{title:meta.find(x=>x.type===3)?.text||'',artist:'Arquivo MIDI/KAR',lyrics:lines,notes,duration:end+2};
}
function render(){const query=$('search').value.toLocaleLowerCase('pt-BR');let list=tracks.filter(t=>(t.title+' '+t.artist+' '+t.name).toLocaleLowerCase('pt-BR').includes(query));if(view==='favorites')list=list.filter(t=>t.favorite);if(view==='queue')list=queue.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);if(view==='formats'){list=[];$('empty').querySelector('h3').textContent='Formatos compatíveis';$('empty').querySelector('p').innerHTML='KAR, MID, MIDI · MP3, WAV, OGG, FLAC, M4A, AAC · MP4 e WebM.<br>Compatibilidade de áudio/vídeo depende do codec disponível no sistema.';$('empty').style.display='block';$('song-list').innerHTML='';$('page-title').textContent='Formatos aceitos';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;return}$('page-title').textContent=view==='queue'?'Fila de reprodução':view==='favorites'?'Favoritas':'Minha biblioteca';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;$('empty').style.display=list.length?'none':'block';$('empty').querySelector('h3').textContent=view==='queue'?'Sua fila está vazia':view==='favorites'?'Nenhuma favorita ainda':'Sua biblioteca está esperando';$('empty').querySelector('p').textContent=view==='queue'?'Adicione músicas à fila para organizar sua apresentação.':view==='favorites'?'Marque músicas com o coração para encontrá-las aqui.':'Importe arquivos KAR, MIDI, MP3, WAV, OGG, FLAC ou vídeos de karaokê.';$('song-list').innerHTML=list.map(t=>`<article class="song-row"><div class="song-cover">♫</div><div class="song-name"><b>${escapeHTML(t.title)}</b><small>${escapeHTML(t.artist||'Arquivo local')}</small></div><span class="format">${t.format.toUpperCase()}</span><button class="song-action" data-play="${t.id}" title="Reproduzir">▶</button><button class="song-action" data-fav="${t.id}" title="Favoritar">${t.favorite?"♥":"♡"}</button><button class="song-action" data-more="${t.id}" title="Adicionar à fila">＋</button></article>`).join('');$('song-list').querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>play(b.dataset.play));$('song-list').querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{queue.push(b.dataset.more);render();toast('Adicionada à fila.')});$('song-list').querySelectorAll('[data-fav]').forEach(b=>b.onclick=async()=>{const t=tracks.find(x=>x.id===b.dataset.fav);t.favorite=!t.favorite;await tx('readwrite',s=>s.put(t));render()})}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function stop(){if(media){media.pause();media.src='';media=null}if(mediaUrl){URL.revokeObjectURL(mediaUrl);mediaUrl=null}$('video-stage').hidden=true;$('video-stage').innerHTML='';midiNodes.forEach(n=>{try{n.stop()}catch{}});midiNodes=[];cancelAnimationFrame(raf);$('play').textContent='▶'}
async function play(trackId){const t=tracks.find(x=>x.id===trackId);if(!t)return;stop();current=t;$('now-title').textContent=t.title;$('now-artist').textContent=t.artist;$('lyrics-title').textContent=t.title;showLyrics(t);if(['kar','mid','midi'].includes(t.format)){if(!t.notes){toast('Este arquivo MIDI não contém uma faixa reproduzível.');return}playMidi(t)}else{const url=URL.createObjectURL(t.blob);mediaUrl=url;const isVideo=['mp4','webm','mkv'].includes(t.format);media=document.createElement(isVideo?'video':'audio');media.src=url;media.volume=Number($('volume').value);if(isVideo){media.controls=true;media.playsInline=true;$('video-stage').appendChild(media);$('video-stage').hidden=false;}media.onloadedmetadata=()=>{$('duration').textContent=fmt(media.duration)};media.ontimeupdate=()=>{$('current-time').textContent=fmt(media.currentTime);if(media.duration)$('progress').value=media.currentTime/media.duration*1000};media.onended=next;media.play().then(()=>$('play').textContent='Ⅱ').catch(()=>toast('Não foi possível reproduzir este formato neste navegador.'))}}
async function playMidi(t){
 const AC=window.AudioContext||window.webkitAudioContext;
 if(!AC){toast('Áudio Web não disponível neste sistema.');return}
 try{
  audioCtx=audioCtx||new AC();
  if(audioCtx.state!=='running')await audioCtx.resume();
  if(!midiMaster){midiMaster=audioCtx.createGain();midiMaster.connect(audioCtx.destination)}
  midiMaster.gain.setTargetAtTime(Number($('volume').value),audioCtx.currentTime,.015);
  const start=audioCtx.currentTime+.08; midiStart=start; midiEvents=t.notes;
  const active=new Map();
  for(const e of t.notes){
   const at=start+Math.max(0,e.time),key=e.ch+':'+e.note;
   if(e.type==='on'){
    const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
    osc.type='triangle';osc.frequency.setValueAtTime(440*Math.pow(2,(e.note-69)/12),at);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.002,e.velocity/127*.22),at+.025);
    osc.connect(gain).connect(midiMaster);osc.start(at);
    const node={osc,gain};midiNodes.push(osc);active.set(key,node);
   }else{
    const node=active.get(key);
    if(node){
     node.gain.gain.cancelScheduledValues(at);
     node.gain.gain.setTargetAtTime(.0001,at,.035);
     try{node.osc.stop(at+.16)}catch{}
     active.delete(key);
    }
   }
  }
  const duration=Math.max(t.duration||0,...t.notes.map(x=>x.time),1);
  $('duration').textContent=fmt(duration);$('play').textContent='Ⅱ';
  const update=()=>{
   if(!current)return;
   const elapsed=Math.max(0,audioCtx.currentTime-midiStart);
   $('current-time').textContent=fmt(elapsed);
   $('progress').value=Math.min(1000,elapsed/duration*1000);
   syncLyrics(elapsed);
   if(elapsed<duration)raf=requestAnimationFrame(update);else next();
  };
  cancelAnimationFrame(raf);raf=requestAnimationFrame(update);
 }catch(error){console.error('Falha na reprodução MIDI',error);toast('Não foi possível iniciar o áudio. Verifique a saída de som do Windows.')}
}
function showLyrics(t){
 const lines=t.lyrics||[];
 $('lyrics-lines').innerHTML=lines.length?lines.map((x,i)=>`<p data-line="${i}">${escapeHTML(x.text)}</p>`).join(''):'<p>Este arquivo não possui letras sincronizadas embutidas.</p>';
}
function syncLyrics(time){
 if(!current?.lyrics?.length)return;
 let idx=-1;current.lyrics.forEach((line,i)=>{if(line.time<=time)idx=i});
 const nodes=$('lyrics-lines').querySelectorAll('p');
 nodes.forEach((p,i)=>p.classList.toggle('current',i===idx));
 const active=$('lyrics-lines').querySelector('.current');
 if(active)active.scrollIntoView({block:'center',behavior:'auto'});
}
function next(){if(!queue.length){stop();current=null;$('now-title').textContent='Reprodução finalizada';return}const id=queue.shift();render();play(id)}
$('add-files').onclick=$('hero-import').onclick=$('empty-import').onclick=$('nav-import').onclick=()=>$('file-picker').click();$('import-folder').onclick=()=>$('folder-picker').click();$('search').oninput=render;
document.querySelectorAll('.nav[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));render();closeSidebar()});$('menu-toggle').onclick=()=>{const open=document.body.classList.toggle('sidebar-open');$('menu-toggle').setAttribute('aria-expanded',String(open))};$('sidebar-backdrop').onclick=closeSidebar;function closeSidebar(){document.body.classList.remove('sidebar-open');$('menu-toggle').setAttribute('aria-expanded','false')}
$('play').onclick=()=>{if(!current){if(tracks[0])play(tracks[0].id);return}if(media){media.paused?media.play():media.pause();$('play').textContent=media.paused?'▶':'Ⅱ'}else if(audioCtx?.state==='running'){audioCtx.suspend();$('play').textContent='▶'}else if(audioCtx){audioCtx.resume();$('play').textContent='Ⅱ'}};
$('next').onclick=next;$('prev').onclick=()=>{if(current)play(current.id)};$('volume').oninput=()=>{const value=Number($('volume').value);if(media)media.volume=value;if(midiMaster&&audioCtx)midiMaster.gain.setTargetAtTime(value,audioCtx.currentTime,.015)};
$('progress').oninput=()=>{if(media&&media.duration)media.currentTime=media.duration*Number($('progress').value)/1000};
$('toggle-lyrics').onclick=()=>$('lyrics-panel').classList.toggle('open');$('close-lyrics').onclick=()=>$('lyrics-panel').classList.remove('open');$('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
window.addEventListener('keydown',e=>{if(e.target.matches('input'))return;if(e.code==='Space'){e.preventDefault();$('play').click()}if(e.key==='/'){e.preventDefault();$('search').focus()}if(e.key==='Escape')$('lyrics-panel').classList.remove('open')});
init().catch(e=>{console.error(e);toast('Erro ao abrir biblioteca local.')});
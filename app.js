import { createMidiEngine } from './vendor/midi-engine.js';
import { parseMidi } from './midi-parser.js';
import { appVersion } from './vendor/app-version.js';

const DB_NAME='cantapedro-db', DB_VERSION=1, STORE='tracks';
const supported=new Set(['kar','mid','midi','mp3','wav','ogg','flac','m4a','aac','mp4','webm','mkv']);
const $=id=>document.getElementById(id);
let db, tracks=[], queue=[], current=null, media=null, mediaUrl=null, midiEngine=null, midiEnginePromise=null, raf=0, playbackToken=0, view='library';
const openDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=()=>reject(r.error||new Error('Não foi possível abrir o banco local.'));r.onblocked=()=>reject(new Error('O banco local está bloqueado por outra janela do CantaPedro. Feche as outras janelas e tente novamente.'))});
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
async function init(){$('app-version').textContent='CantaPedro • '+appVersion;db=await openDB();tracks=(await tx('readonly',s=>s.getAll()))||[];tracks.sort((a,b)=>String(a.title||a.name||'').localeCompare(String(b.title||b.name||''),'pt-BR'));render();$('file-picker').addEventListener('change',e=>importFiles(e.target.files));$('folder-picker').addEventListener('change',e=>importFiles(e.target.files));}
let importing=false;
async function importFiles(list){
 if(importing){toast('Aguarde a importação atual terminar.');return}
 const files=[...list].filter(file=>supported.has(ext(file)));
 if(!files.length){toast('Nenhum formato compatível foi selecionado.');return}
 importing=true;
 const records=[];
 try{
  for(const file of files){
   const format=ext(file),name=titleOf(file.name);
   const record={id:id(),name:file.name,title:name,artist:'Arquivo local',format,size:file.size,lastModified:file.lastModified,blob:file,addedAt:Date.now(),favorite:false};
   if(['kar','mid','midi'].includes(format)){
    try{
     const parsed=parseMidi(await file.arrayBuffer());
     record.title=parsed.title||name;record.artist=parsed.artist||'Arquivo MIDI';record.lyrics=parsed.lyrics;record.notes=parsed.notes;record.duration=parsed.duration;
    }catch(error){
     console.warn('Falha ao ler MIDI/KAR',file.name,error);
     record.error=error.message||'MIDI não reconhecido';
    }
   }
   records.push(record);
  }
  await tx('readwrite',store=>{for(const record of records)store.put(record)});
  tracks.push(...records);
  tracks.sort((a,b)=>String(a.title||a.name).localeCompare(String(b.title||b.name),'pt-BR'));
  render();
  const failed=records.filter(record=>record.error).length;
  toast(records.length+' arquivo(s) importado(s).'+(failed?' '+failed+' MIDI(s) com erro de leitura.':''));
 }catch(error){
  console.error('Falha ao importar arquivos',error);
  toast('Não foi possível salvar a importação: '+(error.message||'erro no banco local.'));
 }finally{
  importing=false;$('file-picker').value='';$('folder-picker').value='';
 }
}
function render(){const query=$('search').value.toLocaleLowerCase('pt-BR');let list=tracks.filter(t=>[t.title,t.artist,t.name].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(query));if(view==='favorites')list=list.filter(t=>t.favorite);if(view==='queue')list=queue.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);if(view==='formats'){list=[];$('empty').querySelector('h3').textContent='Formatos compatíveis';$('empty').querySelector('p').innerHTML='KAR, MID, MIDI · MP3, WAV, OGG, FLAC, M4A, AAC · MP4 e WebM.<br>Compatibilidade de áudio/vídeo depende do codec disponível no sistema.';$('empty').style.display='block';$('song-list').innerHTML='';$('page-title').textContent='Formatos aceitos';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;return}$('page-title').textContent=view==='queue'?'Fila de reprodução':view==='favorites'?'Favoritas':'Minha biblioteca';$('library-total').textContent=tracks.length+' música(s)';$('queue-count').textContent=queue.length;$('empty').style.display=list.length?'none':'block';$('empty').querySelector('h3').textContent=view==='queue'?'Sua fila está vazia':view==='favorites'?'Nenhuma favorita ainda':'Sua biblioteca está esperando';$('empty').querySelector('p').textContent=view==='queue'?'Adicione músicas à fila para organizar sua apresentação.':view==='favorites'?'Marque músicas com o coração para encontrá-las aqui.':'Importe arquivos KAR, MIDI, MP3, WAV, OGG, FLAC ou vídeos de karaokê.';$('song-list').innerHTML=list.map(t=>`<article class="song-row"><div class="song-cover">♫</div><div class="song-name"><b>${escapeHTML(t.title)}</b><small>${escapeHTML(t.artist||'Arquivo local')}</small></div><span class="format">${t.format.toUpperCase()}</span><button class="song-action" data-play="${t.id}" title="Reproduzir">▶</button><button class="song-action" data-fav="${t.id}" title="Favoritar">${t.favorite?"♥":"♡"}</button><button class="song-action" data-more="${t.id}" title="Adicionar à fila">＋</button></article>`).join('');$('song-list').querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>play(b.dataset.play));$('song-list').querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{queue.push(b.dataset.more);render();toast('Adicionada à fila.')});$('song-list').querySelectorAll('[data-fav]').forEach(b=>b.onclick=async()=>{const t=tracks.find(x=>x.id===b.dataset.fav);t.favorite=!t.favorite;await tx('readwrite',s=>s.put(t));render()})}
function escapeHTML(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function stop(){
 playbackToken++;
 if(media){media.pause();media.src='';media=null}
 if(mediaUrl){URL.revokeObjectURL(mediaUrl);mediaUrl=null}
 $('video-stage').hidden=true;$('video-stage').innerHTML='';
 midiEngine?.stop();
 cancelAnimationFrame(raf);$('play').textContent='▶';$('current-time').textContent='0:00';$('duration').textContent='0:00';$('progress').value=0;
}
async function getMidiEngine(){
 if(!midiEnginePromise)midiEnginePromise=createMidiEngine(Number($('volume').value)).then(engine=>(midiEngine=engine)).catch(error=>{midiEnginePromise=null;throw error});
 return midiEnginePromise;
}
async function play(trackId){
 const t=tracks.find(x=>x.id===trackId);if(!t)return;
 stop();const token=playbackToken;current=t;
 $('now-title').textContent=t.title;$('now-artist').textContent=t.artist;$('lyrics-title').textContent=t.title;showLyrics(t);
 if(['kar','mid','midi'].includes(t.format)){
  if(!t.notes?.some(note=>note.type==='on')){current=null;$('now-title').textContent='Arquivo MIDI sem notas';$('now-artist').textContent='Não há eventos reproduzíveis neste arquivo';toast('Este arquivo MIDI não contém eventos de notas reproduzíveis.');return}
  playMidi(t,token);return;
 }
 const url=URL.createObjectURL(t.blob);mediaUrl=url;
 const isVideo=['mp4','webm','mkv'].includes(t.format);
 const element=document.createElement(isVideo?'video':'audio');
 media=element;element.src=url;element.volume=Number($('volume').value);
 if(isVideo){element.controls=true;element.playsInline=true;$('video-stage').appendChild(element);$('video-stage').hidden=false;}
 element.onloadedmetadata=()=>{if(token===playbackToken)$('duration').textContent=fmt(element.duration)};
 element.ontimeupdate=()=>{if(token!==playbackToken)return;$('current-time').textContent=fmt(element.currentTime);if(element.duration)$('progress').value=element.currentTime/element.duration*1000};
 element.onplay=()=>{if(token===playbackToken)$('play').textContent='Ⅱ'};
 element.onpause=()=>{if(token===playbackToken)$('play').textContent='▶'};
 element.onended=()=>{if(token===playbackToken&&current===t)next()};
 element.onerror=()=>{if(token===playbackToken)toast('O arquivo não pôde ser decodificado neste sistema.')};
 element.play().then(()=>{if(token===playbackToken)$('play').textContent='Ⅱ'}).catch(error=>{if(token===playbackToken){console.warn('Falha ao reproduzir mídia',error);toast('Não foi possível reproduzir este formato neste sistema.')}});
}
async function playMidi(t,token){
 try{
  const engine=await getMidiEngine();
  const binary=await t.blob.arrayBuffer();
  if(token!==playbackToken||current!==t)return;
  const started=await engine.play(binary,()=>token===playbackToken&&current===t);
  if(!started||token!==playbackToken||current!==t)return;
  const duration=Math.max(engine.duration||0,Number(t.duration)||0,1);
  $('duration').textContent=fmt(duration);$('play').textContent='Ⅱ';
  const update=()=>{
   if(token!==playbackToken||current!==t)return;
   const elapsed=engine.currentTime;
   $('current-time').textContent=fmt(elapsed);
   $('progress').value=Math.min(1000,elapsed/duration*1000);
   syncLyrics(elapsed);
   if(engine.isFinished){next();return}
   raf=requestAnimationFrame(update);
  };
  cancelAnimationFrame(raf);raf=requestAnimationFrame(update);
 }catch(error){
  if(token===playbackToken){console.error('Falha no sintetizador SoundFont',error);toast(error.message||'Não foi possível inicializar o sintetizador de áudio.')}
 }
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
  tracks=[];queue=[];current=null;$('search').value='';
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
$('play').onclick=async()=>{if(!current){const first=tracks.find(t=>!['kar','mid','midi'].includes(t.format)||t.notes?.some(note=>note.type==='on'));if(first)play(first.id);return}if(media){media.paused?media.play():media.pause();$('play').textContent=media.paused?'▶':'Ⅱ'}else if(['kar','mid','midi'].includes(current.format)){try{const engine=await getMidiEngine();if(engine.paused){await engine.resume();$('play').textContent='Ⅱ';raf=requestAnimationFrame(()=>playMidiProgress())}else{engine.pause();$('play').textContent='▶';cancelAnimationFrame(raf)}}catch(error){toast(error.message||'Falha no áudio.')}}};
$('next').onclick=next;$('prev').onclick=()=>{if(current)play(current.id)};$('volume').oninput=()=>{const value=Number($('volume').value);if(media)media.volume=value;midiEngine?.setVolume(value)};
$('progress').oninput=()=>{const ratio=Number($('progress').value)/1000;if(media&&media.duration)media.currentTime=media.duration*ratio;else if(midiEngine&&midiEngine.duration)midiEngine.seek(midiEngine.duration*ratio)};
$('toggle-lyrics').onclick=()=>$('lyrics-panel').classList.toggle('open');$('close-lyrics').onclick=()=>$('lyrics-panel').classList.remove('open');$('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
window.addEventListener('keydown',e=>{if(e.target.matches('input'))return;if(e.code==='Space'){e.preventDefault();$('play').click()}if(e.key==='/'){e.preventDefault();$('search').focus()}if(e.key==='Escape')$('lyrics-panel').classList.remove('open')});
init().catch(e=>{console.error(e);toast('Erro ao abrir biblioteca local.')});
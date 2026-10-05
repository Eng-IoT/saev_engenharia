const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n,d=1) => Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const nowISO = () => new Date().toISOString();

class DB {
  constructor(){ this.db=null; }
  open(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('save-engenharia-db',1);
      req.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains('projects')) db.createObjectStore('projects',{keyPath:'id'});
        if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings',{keyPath:'key'});
      };
      req.onsuccess=e=>{this.db=e.target.result;resolve(this.db)};
      req.onerror=()=>reject(req.error);
    });
  }
  store(name,mode='readonly'){return this.db.transaction(name,mode).objectStore(name)}
  getAll(name='projects'){return new Promise((res,rej)=>{const r=this.store(name).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  get(name,key){return new Promise((res,rej)=>{const r=this.store(name).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  put(name,obj){return new Promise((res,rej)=>{const r=this.store(name,'readwrite').put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
  delete(name,key){return new Promise((res,rej)=>{const r=this.store(name,'readwrite').delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
  clear(name){return new Promise((res,rej)=>{const r=this.store(name,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
}
const db=new DB();

const state={projects:[],active:null,curve:null,deferredPrompt:null};

function defaultCurve(project,profile='commercial',intensity=1){
  const base=Number(project?.baseLoad||90), peak=Number(project?.existingPeak||150);
  const patterns={
    commercial:[.45,.42,.40,.40,.42,.50,.65,.78,.88,.94,.98,1,.98,.96,.95,.96,.98,1,.93,.78,.66,.58,.52,.48],
    residential:[.38,.34,.32,.31,.33,.40,.58,.72,.62,.50,.46,.44,.46,.49,.52,.58,.70,.90,1,.96,.88,.72,.58,.46],
    industrial:[.65,.62,.60,.60,.62,.68,.82,.94,1,.98,.96,.95,.94,.95,.96,.98,1,.98,.94,.86,.78,.72,.68,.66],
    flat:Array(24).fill(.75)
  };
  const p=patterns[profile]||patterns.commercial;
  const min=Math.min(base,peak*.75), span=Math.max(peak-min,1);
  const building=p.map(v=>Math.max(0,(min+span*((v-.3)/.7))*intensity));
  const qty=Number(project?.chargerQty||20), cp=Number(project?.chargerPower||7.4);
  const full=qty*cp, dlm=project?.dlm==='yes', lim=dlm?Number(project?.dlmLimit||60):full;
  const start=Number(project?.chargeStart ?? 18), end=Number(project?.chargeEnd ?? 6);
  const ev=Array(24).fill(0);
  for(let h=0;h<24;h++){
    const active = start<end ? h>=start && h<end : (h>=start || h<end);
    if(active){
      let factor;
      if(start>end){
        if(h>=start) factor=.78 + .15*Math.sin((h-start+1)/6*Math.PI);
        else factor=.55 + .28*Math.cos(h/6*Math.PI/2);
      } else factor=.75;
      ev[h]=Math.min(full,lim)*Math.max(.35,Math.min(1,factor));
    }
  }
  return {building,ev,limit:Number(project?.siteLimit||200),source:'SIMULADA',updatedAt:nowISO()};
}
function calcCurve(c){
  const total=c.building.map((v,i)=>v+(c.ev[i]||0));
  const p1=Math.max(...c.building), p2=Math.max(...c.ev), p3=Math.max(...total), margin=Math.min(...total.map(v=>c.limit-v));
  return {total,existingPeak:p1,evPeak:p2,totalPeak:p3,margin};
}
function chargerTotal(p){return Number(p?.chargerQty||0)*Number(p?.chargerPower||0)}

async function setActive(id){
  const p=state.projects.find(x=>x.id===id); if(!p)return;
  state.active=p; state.curve=p.curve||defaultCurve(p);
  await db.put('settings',{key:'activeProjectId',value:id});
  populateForm(p); refreshAll(); showToast('Projeto aberto');
}
function uid(){return 'p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7)}

function readForm(){
  const fd=new FormData($('#projectForm')); const o=Object.fromEntries(fd.entries());
  ['voltage','phases','siteLimit','baseLoad','existingPeak','transformerKva','chargerQty','chargerPower','powerFactor','length','dlmLimit','chargeStart','chargeEnd'].forEach(k=>o[k]=Number(o[k]));
  return o;
}
function populateForm(p={}){
  const f=$('#projectForm');
  [...f.elements].forEach(el=>{if(el.name && p[el.name]!==undefined) el.value=p[el.name]});
}
function blankForm(){
  $('#projectForm').reset();
  populateForm({voltage:220,phases:3,siteLimit:200,baseLoad:90,existingPeak:150,transformerKva:225,chargerQty:20,chargerPower:7.4,powerFactor:.99,length:25,dlm:'yes',dlmLimit:60,chargeStart:18,chargeEnd:6,utility:'Energisa Acre',installationType:'Condomínio'});
}

function deriveChecklist(p,c){
  if(!p) return [];
  const m=calcCurve(c||defaultCurve(p));
  const save=chargerTotal(p);
  const items=[
    {status:p.name?'ok':'bad',title:'Identificação do empreendimento',detail:p.name?`${p.name} • ${p.utility}`:'Nome do projeto ausente',rule:'Cadastro técnico'},
    {status:Number(p.chargerQty)>0&&Number(p.chargerPower)>0?'ok':'bad',title:'Caracterização dos SAVE',detail:`${p.chargerQty||0} × ${fmt(p.chargerPower)} kW = ${fmt(save)} kW`,rule:'ABNT NBR 17019 / fabricante'},
    {status:m.margin>=0?'ok':'bad',title:'Capacidade operacional simulada',detail:m.margin>=0?`Margem mínima ${fmt(m.margin)} kW`:`Excedente de ${fmt(Math.abs(m.margin))} kW no cenário`,rule:'Curva de carga / demanda'},
    {status:p.dlm==='yes'?'ok':'warn',title:'Gerenciamento de recarga',detail:p.dlm==='yes'?`DLM limitado a ${fmt(p.dlmLimit)} kW`:'Sem DLM: considerar simultaneidade conforme critérios aplicáveis',rule:'ABNT NBR 17019'},
    {status:'warn',title:'Proteção diferencial residual',detail:'Confirmar tipo de DR e detecção de corrente residual CC conforme SAVE selecionado.',rule:'ABNT NBR 17019 / IEC 62423 / fabricante'},
    {status:'warn',title:'DPS, aterramento e equipotencialização',detail:'Validar esquema de aterramento, coordenação de DPS e requisitos da instalação existente.',rule:'NBR 5410 / NBR 5419 / NBR 17019'},
    {status:'warn',title:'Concessionária',detail:`Aplicar versão vigente das normas da ${p.utility||'concessionária'} na data do protocolo.`,rule:'Norma da distribuidora'},
    {status:'warn',title:'Documentação de responsabilidade técnica',detail:'ART/TRT, plantas, unifilar, memorial e demais documentos devem ser conferidos antes do protocolo.',rule:'CREA/CFT / concessionária'}
  ];
  return items;
}
function checklistScore(items){
  if(!items.length)return 0;
  const pts=items.reduce((a,x)=>a+(x.status==='ok'?1:x.status==='warn'?.5:0),0);
  return Math.round(100*pts/items.length);
}
function checklistHTML(items,compact=false){
  return items.slice(0,compact?5:items.length).map(x=>`<div class="${compact?'quick-item':'check-item'} ${x.status}">
    <div class="status-icon">${x.status==='ok'?'✓':x.status==='warn'?'!':'×'}</div>
    <div><strong>${x.title}</strong><small>${x.detail}</small></div>
    ${compact?`<span class="status-label">${x.status==='ok'?'OK':x.status==='warn'?'REVISAR':'CRÍTICO'}</span>`:`<div class="rule">${x.rule}</div>`}
  </div>`).join('');
}

function drawChart(canvas,c){
  if(!canvas||!c)return;
  const ctx=canvas.getContext('2d'), dpr=window.devicePixelRatio||1;
  const cssW=canvas.clientWidth||700, cssH=canvas.getAttribute('height')?Number(canvas.getAttribute('height')):300;
  canvas.width=cssW*dpr; canvas.height=cssH*dpr; ctx.scale(dpr,dpr);
  const w=cssW,h=cssH,pad={l:42,r:16,t:18,b:30}; ctx.clearRect(0,0,w,h);
  const m=calcCurve(c), max=Math.max(c.limit,m.totalPeak)*1.15||1;
  const X=i=>pad.l+i*(w-pad.l-pad.r)/23, Y=v=>h-pad.b-v*(h-pad.b-pad.t)/max;
  ctx.strokeStyle='#E6ECE8';ctx.lineWidth=1;ctx.font='10px system-ui';ctx.fillStyle='#98A2B3';
  for(let g=0;g<=4;g++){const v=max*g/4,y=Y(v);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(Math.round(v),4,y+3)}
  [0,4,8,12,16,20,23].forEach(i=>ctx.fillText(String(i).padStart(2,'0')+'h',X(i)-10,h-8));
  const line=(arr,color,width=2,dash=[])=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);arr.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));ctx.stroke();ctx.setLineDash([])};
  line(Array(24).fill(c.limit),'#FF4D4F',1.5,[6,5]);
  line(c.building,'#6B7280',2);
  line(c.ev,'#00E676',2.5);
  line(m.total,'#111827',3);
  const danger=m.total.map((v,i)=>({v,i})).filter(x=>x.v>c.limit);
  danger.forEach(x=>{ctx.fillStyle='#FF4D4F';ctx.beginPath();ctx.arc(X(x.i),Y(x.v),4,0,Math.PI*2);ctx.fill()});
}
function renderHourTable(){
  const c=state.curve;if(!c)return $('#hourTable').innerHTML='<tr><td colspan="3">Crie um projeto.</td></tr>';
  $('#hourTable').innerHTML=c.building.map((v,i)=>`<tr><td>${String(i).padStart(2,'0')}:00</td>
    <td><input data-hour="${i}" data-series="building" type="number" step="0.1" value="${Number(v).toFixed(1)}"></td>
    <td><input data-hour="${i}" data-series="ev" type="number" step="0.1" value="${Number(c.ev[i]).toFixed(1)}"></td></tr>`).join('');
  $$('#hourTable input').forEach(el=>el.addEventListener('change',e=>{
    const h=Number(e.target.dataset.hour),s=e.target.dataset.series;
    state.curve[s][h]=Number(e.target.value)||0; refreshCurve();
  }));
}
function refreshCurve(){
  if(!state.curve)return;
  const m=calcCurve(state.curve);
  drawChart($('#mainChart'),state.curve);drawChart($('#miniChart'),state.curve);
  $('#mExistingPeak').textContent=fmt(m.existingPeak)+' kW';
  $('#mEvPeak').textContent=fmt(m.evPeak)+' kW';
  $('#mTotalPeak').textContent=fmt(m.totalPeak)+' kW';
  $('#mMargin').textContent=fmt(m.margin)+' kW';
  $('#mMargin').style.color=m.margin<0?'#FF4D4F':'#168F35';
  $('#curveSourceBadge').textContent=state.curve.source||'SIMULADA';
}

function renderReport(){
  const p=state.active,c=state.curve;
  if(!p){$('#reportSheet').innerHTML='<h3>Nenhum projeto ativo</h3><p>Crie ou abra um projeto para gerar o memorial.</p>';return}
  const m=calcCurve(c), items=deriveChecklist(p,c), score=checklistScore(items);
  $('#reportSheet').innerHTML=`
    <div style="border-bottom:4px solid #39FF14;padding-bottom:16px;margin-bottom:24px">
      <div style="font-size:10px;letter-spacing:.18em;font-weight:800">SAVE ENGENHARIA • MEMORIAL RESUMIDO</div>
      <h2>${p.name}</h2><div style="color:#667085">${p.client||'Cliente não informado'} • ${p.utility||''}</div>
    </div>
    <h3>1. Identificação</h3>
    <table><tr><th>Responsável</th><td>${p.responsible||'—'}</td><th>CREA/CFT</th><td>${p.registry||'—'}</td></tr>
    <tr><th>Tipo</th><td>${p.installationType||'—'}</td><th>Sistema</th><td>${p.phases===3?'Trifásico':'Monofásico'} ${p.voltage} V</td></tr></table>
    <h3>2. Infraestrutura de recarga</h3>
    <table><tr><th>Quantidade</th><td>${p.chargerQty}</td><th>Potência unitária</th><td>${fmt(p.chargerPower)} kW</td></tr>
    <tr><th>Potência instalada SAVE</th><td>${fmt(chargerTotal(p))} kW</td><th>DLM</th><td>${p.dlm==='yes'?'Sim — '+fmt(p.dlmLimit)+' kW':'Não'}</td></tr></table>
    <h3>3. Curva de carga</h3>
    <table><tr><th>Pico existente</th><td>${fmt(m.existingPeak)} kW</td><th>Pico SAVE</th><td>${fmt(m.evPeak)} kW</td></tr>
    <tr><th>Pico total</th><td>${fmt(m.totalPeak)} kW</td><th>Margem mínima</th><td>${fmt(m.margin)} kW</td></tr></table>
    ${m.margin<0?`<div class="report-alert"><strong>Atenção:</strong> o cenário simulado ultrapassa o limite operacional em ${fmt(Math.abs(m.margin))} kW.</div>`:''}
    <h3>4. Pré-validação</h3>
    <p>Índice de preenchimento técnico: <strong>${score}%</strong>. Este indicador representa somente verificações internas do software e não equivale à aprovação da concessionária.</p>
    <table><thead><tr><th>Item</th><th>Status</th><th>Referência</th></tr></thead><tbody>${items.map(x=>`<tr><td>${x.title}<br><small>${x.detail}</small></td><td>${x.status==='ok'?'OK':x.status==='warn'?'REVISAR':'CRÍTICO'}</td><td>${x.rule}</td></tr>`).join('')}</tbody></table>
    <h3>5. Observações</h3>
    <p style="font-size:12px;line-height:1.6">Relatório de apoio ao pré-dimensionamento. O responsável técnico deve validar integralmente os parâmetros de instalação, características dos equipamentos, métodos de instalação, proteções, aterramento, curto-circuito, seletividade, coordenação, documentação e versões vigentes das normas ABNT/IEC e da distribuidora antes da emissão do projeto executivo e protocolo.</p>
    <div style="margin-top:42px;border-top:1px solid #D9DFDC;padding-top:12px;font-size:10px;color:#667085">Gerado localmente em ${new Date().toLocaleString('pt-BR')} • SAVE Engenharia Local V1</div>`;
}

function refreshAll(){
  $('#statProjects').textContent=state.projects.length;
  $('#backupProjects').textContent=state.projects.length;
  const p=state.active;
  if(p){
    state.curve=state.curve||p.curve||defaultCurve(p);
    const m=calcCurve(state.curve),items=deriveChecklist(p,state.curve),score=checklistScore(items);
    $('#healthScore').textContent=score+'%';$('#activeProjectName').textContent=p.name;$('#activeProjectMeta').textContent=`${p.utility} • ${p.installationType}`;
    $('#statSavePower').textContent=fmt(chargerTotal(p))+' kW';$('#statPeak').textContent=fmt(m.totalPeak)+' kW';$('#statHeadroom').textContent=fmt(m.margin)+' kW';
    $('#statHeadroom').style.color=m.margin<0?'#C62828':'#168F35';
    $('#quickChecklist').innerHTML=checklistHTML(items,true);$('#fullChecklist').innerHTML=checklistHTML(items,false);
    $('#backupActive').textContent=p.name;$('#curveLimit').value=state.curve.limit;$('#curveDlm').value=p.dlm==='yes'?p.dlmLimit:chargerTotal(p);
    refreshCurve();renderHourTable();renderReport();
    $('#szPower').value=p.chargerPower||7.4;$('#szVoltage').value=p.voltage||220;$('#szPhases').value=p.phases||1;$('#szPf').value=p.powerFactor||.99;$('#szLength').value=p.length||25;
  }else{
    $('#healthScore').textContent='—';$('#activeProjectName').textContent='Nenhum projeto ativo';$('#activeProjectMeta').textContent='Crie ou abra um projeto';
    $('#statSavePower').textContent='0 kW';$('#statPeak').textContent='0 kW';$('#statHeadroom').textContent='—';$('#quickChecklist').innerHTML='<p class="muted">Nenhum projeto ativo.</p>';$('#fullChecklist').innerHTML='<p class="muted">Nenhum projeto ativo.</p>';
    state.curve={building:Array(24).fill(0),ev:Array(24).fill(0),limit:200,source:'SIMULADA'};refreshCurve();renderHourTable();renderReport();
  }
  renderProjects(); updateOnline();
}
function renderProjects(){
  const wrap=$('#projectList');
  if(!state.projects.length){wrap.innerHTML='<div class="muted">Nenhum projeto salvo. Use “Novo projeto” ou crie o exemplo.</div>';return}
  wrap.innerHTML=state.projects.slice().sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).map(p=>`<article class="project-card ${state.active?.id===p.id?'active':''}">
    <h4>${p.name}</h4><p>${p.client||'Sem cliente'} • ${p.utility||''}</p><p>${p.chargerQty} × ${fmt(p.chargerPower)} kW • ${fmt(chargerTotal(p))} kW</p>
    <div class="card-actions"><button class="btn small primary" data-open="${p.id}">Abrir</button><button class="btn small secondary" data-delete="${p.id}">Excluir</button></div></article>`).join('');
  $$('[data-open]').forEach(b=>b.onclick=()=>setActive(b.dataset.open));
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{if(confirm('Excluir este projeto do dispositivo?')){await db.delete('projects',b.dataset.delete);state.projects=await db.getAll();if(state.active?.id===b.dataset.delete){state.active=null}refreshAll()}});
}

async function saveProjectFromForm(e){
  e.preventDefault(); const o=readForm(), existing=state.active?.id?state.active:null;
  const p={...(existing||{}),...o,id:existing?.id||uid(),createdAt:existing?.createdAt||nowISO(),updatedAt:nowISO()};
  p.curve=defaultCurve(p,$('#profileSelect')?.value||'commercial',Number($('#profileIntensity')?.value||100)/100);
  await db.put('projects',p);state.projects=await db.getAll();state.active=p;state.curve=p.curve;await db.put('settings',{key:'activeProjectId',value:p.id});
  refreshAll();showToast('Projeto salvo e calculado');switchView('curve');
}
function sizing(){
  const P=Number($('#szPower').value)*1000,V=Number($('#szVoltage').value),ph=Number($('#szPhases').value),pf=Number($('#szPf').value)||1,L=Number($('#szLength').value),der=Number($('#szDerating').value)||1;
  const I=ph===3?P/(Math.sqrt(3)*V*pf):P/(V*pf);
  const designI=I/der;
  const cables=[{s:1.5,a:15.5},{s:2.5,a:21},{s:4,a:28},{s:6,a:36},{s:10,a:50},{s:16,a:68},{s:25,a:89},{s:35,a:110},{s:50,a:134},{s:70,a:171},{s:95,a:207},{s:120,a:239},{s:150,a:272},{s:185,a:310},{s:240,a:364}];
  const cab=cables.find(x=>x.a>=designI)||cables[cables.length-1];
  const breakers=[6,10,16,20,25,32,40,50,63,80,100,125,160,200,250,315,400];
  const breaker=breakers.find(x=>x>=I)||Math.ceil(I/10)*10;
  const rho=.0175, dropV=ph===3?Math.sqrt(3)*L*I*rho/cab.s:2*L*I*rho/cab.s, drop=100*dropV/V;
  $('#rCurrent').textContent=fmt(I,2)+' A';$('#rCable').textContent=cab.s+' mm²';$('#rBreaker').textContent=breaker+' A';$('#rDrop').textContent=fmt(drop,2)+' %';
  $('#szStatus').textContent=drop<=2?'Pré-dimensionamento dentro da meta de 2%':'Revisar queda de tensão';
  $('#szStatus').style.color=drop<=2?'#39FF14':'#FF4D4F';
  $('#formulaBox').innerHTML=ph===3?`I = P / (√3 × V × FP)<br>I = ${P.toFixed(0)} / (1,732 × ${V} × ${pf}) = <b>${fmt(I,2)} A</b><br>I projeto = I / Fc = ${fmt(I,2)} / ${der} = <b>${fmt(designI,2)} A</b><br>ΔV ≈ √3 × L × I × ρ / S = <b>${fmt(dropV,2)} V (${fmt(drop,2)}%)</b>`:`I = P / (V × FP)<br>I = ${P.toFixed(0)} / (${V} × ${pf}) = <b>${fmt(I,2)} A</b><br>I projeto = I / Fc = ${fmt(I,2)} / ${der} = <b>${fmt(designI,2)} A</b><br>ΔV ≈ 2 × L × I × ρ / S = <b>${fmt(dropV,2)} V (${fmt(drop,2)}%)</b>`;
}
function switchView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${name}`).classList.add('active');
  $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
  const titles={dashboard:['Dashboard','Projetos SAVE no seu dispositivo'],project:['Novo projeto','Assistente de cadastro e cálculo'],curve:['Curva de carga','Simulação e edição horária'],sizing:['Dimensionamento','Pré-dimensionamento de circuito terminal'],checklist:['Pré-validação','Checklist técnico do projeto'],report:['Relatório','Memorial resumido do projeto'],backup:['Backup local','Proteção e transferência dos seus dados']};
  $('#pageTitle').textContent=titles[name][0];$('#pageSubtitle').textContent=titles[name][1];window.scrollTo({top:0,behavior:'smooth'});
  if(innerWidth<920)$('#sidebar').classList.remove('open');
}
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
function updateOnline(){if($('#onlineStatus'))$('#onlineStatus').textContent=navigator.onLine?'Online':'Offline'}
function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

async function exportBackup(){
  const payload={app:'SAVE Engenharia Local',version:1,exportedAt:nowISO(),projects:await db.getAll('projects')};
  download(`SAVE_Backup_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2));showToast('Backup exportado');
}
async function importBackup(file){
  try{const data=JSON.parse(await file.text());if(!Array.isArray(data.projects))throw new Error('Formato inválido');
    for(const p of data.projects)await db.put('projects',p);state.projects=await db.getAll();refreshAll();showToast('Backup importado');
  }catch(e){alert('Não foi possível importar o backup: '+e.message)}
}
async function createSample(){
  const p={id:uid(),name:'Exemplo • Condomínio Eletromobilidade',client:'Cliente demonstração',responsible:'Responsável técnico',registry:'CREA/CFT',utility:'Energisa Acre',installationType:'Condomínio',voltage:220,phases:3,siteLimit:200,baseLoad:90,existingPeak:145,transformerKva:225,chargerQty:20,chargerPower:7.4,powerFactor:.99,length:25,dlm:'yes',dlmLimit:60,chargeStart:18,chargeEnd:6,createdAt:nowISO(),updatedAt:nowISO()};
  p.curve=defaultCurve(p);await db.put('projects',p);state.projects=await db.getAll();await setActive(p.id);
}

async function init(){
  await db.open();state.projects=await db.getAll();const s=await db.get('settings','activeProjectId');
  if(s?.value){state.active=state.projects.find(p=>p.id===s.value)||null}
  if(state.active){state.curve=state.active.curve||defaultCurve(state.active);populateForm(state.active)} else blankForm();
  refreshAll();

  $$('.nav-item').forEach(n=>n.onclick=()=>switchView(n.dataset.view));
  $$('[data-jump]').forEach(b=>b.onclick=()=>switchView(b.dataset.jump));
  $('#projectForm').addEventListener('submit',saveProjectFromForm);
  $('#newBlankBtn').onclick=()=>{state.active=null;blankForm();showToast('Formulário limpo')};
  $('#createSampleBtn').onclick=createSample;
  $('#calcSizingBtn').onclick=sizing;
  $('#profileIntensity').oninput=e=>$('#profileIntensityValue').textContent=e.target.value+'%';
  $('#generateCurveBtn').onclick=()=>{
    if(!state.active)return showToast('Crie ou abra um projeto');
    const profile=$('#profileSelect').value,intensity=Number($('#profileIntensity').value)/100;
    state.curve=defaultCurve(state.active,profile,intensity);state.curve.limit=Number($('#curveLimit').value)||state.curve.limit;
    const dlm=Number($('#curveDlm').value);if(dlm>=0){const full=chargerTotal(state.active);state.curve.ev=state.curve.ev.map(v=>Math.min(v,dlm||full))}
    state.curve.source='SIMULADA';refreshCurve();renderHourTable();refreshAll();showToast('Curva recalculada');
  };
  $('#applyCurveBtn').onclick=async()=>{
    if(!state.active)return;state.active.curve={...state.curve,updatedAt:nowISO()};state.active.updatedAt=nowISO();await db.put('projects',state.active);state.projects=await db.getAll();refreshAll();showToast('Curva salva no projeto');
  };
  $('#printReportBtn').onclick=()=>{renderReport();window.print()};
  $('#exportBackupBtn').onclick=exportBackup;
  $('#importBackupInput').onchange=e=>e.target.files[0]&&importBackup(e.target.files[0]);
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);
  window.addEventListener('resize',()=>{refreshCurve()});

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;$('#installBtn').hidden=false});
  $('#installBtn').onclick=async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;$('#installBtn').hidden=true}};
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
init();

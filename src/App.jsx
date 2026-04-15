import { useState, useRef, useCallback } from "react";

const CATS = {
  "★": { label: "Importante", ink: "#b45309", wash: "#fef3c7", dot: "#f59e0b" },
  "#": { label: "Trabajo",    ink: "#1d4ed8", wash: "#dbeafe", dot: "#3b82f6" },
  "~": { label: "Iglesia",    ink: "#6d28d9", wash: "#ede9fe", dot: "#8b5cf6" },
  "$": { label: "Finanzas",   ink: "#065f46", wash: "#d1fae5", dot: "#10b981" },
  "+": { label: "Salud",      ink: "#991b1b", wash: "#fee2e2", dot: "#ef4444" },
  "@": { label: "Reunión",    ink: "#1e3a5f", wash: "#e0f2fe", dot: "#0ea5e9" },
  "!": { label: "Urgente",    ink: "#7f1d1d", wash: "#fff1f2", dot: "#f43f5e" },
  ">": { label: "Pendiente",  ink: "#7c2d12", wash: "#ffedd5", dot: "#f97316" },
  "✓": { label: "Completado", ink: "#14532d", wash: "#dcfce7", dot: "#22c55e" },
  "?": { label: "Tentativo",  ink: "#374151", wash: "#f3f4f6", dot: "#9ca3af" },
  "&": { label: "Familia",    ink: "#831843", wash: "#fce7f3", dot: "#ec4899" },
  "^": { label: "Viaje",      ink: "#134e4a", wash: "#ccfbf1", dot: "#14b8a6" },
};

const SYSTEM_PROMPT = `Eres un experto en interpretar fotografías de planners mensuales escritos a mano.

La plantilla tiene: grilla mensual (7 col Lun-Dom, 6 filas), panel lateral de TAREAS con checkbox, sección NOTAS, y leyenda de símbolos.

SÍMBOLOS: ★=importante  #=trabajo  ~=iglesia  $=finanzas  +=salud  @=reunión  !=urgente  >=pendiente  ✓=completado  ?=tentativo  &=familia  ^=viaje

REGLAS:
- Símbolos al inicio de línea, pueden combinarse: "!★ Reunión" → urgente+importante
- Hora detectada (10am, 18:30) → time_start/time_end en HH:MM 24h; sin hora → all_day:true
- Texto tachado o con ✓ → completed:true; con ? → confirmed:false
- Tareas del panel lateral → array "tasks" (sin día)
- Ilegible → "[ilegible]"

Devuelve SOLO JSON válido sin markdown:
{"month":"Enero","year":2026,"events":[{"day":14,"title":"Reunión","time_start":"10:00","time_end":"11:00","all_day":false,"categories":["#","@"],"confirmed":true,"completed":false}],"tasks":[{"title":"Comprar cables","categories":["#"],"completed":false}],"notes":""}`;

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function addHour(t) {
  if (!t) return "01:00";
  const [h, m] = t.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

function Tag({ sym }) {
  const c = CATS[sym];
  if (!c) return null;
  return (
    <span style={{
      background: c.wash, color: c.ink, border: `1px solid ${c.dot}55`,
      borderRadius: 4, padding: "1px 7px", fontSize: 11,
      fontWeight: 700, fontFamily: "monospace", letterSpacing: 0.3,
      display: "inline-flex", alignItems: "center", gap: 3,
    }}>
      {sym} <span style={{ fontSize: 10, fontFamily: "inherit", fontWeight: 400 }}>{c.label}</span>
    </span>
  );
}

function Check({ on }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 5, flexShrink: 0,
      border: `2px solid ${on ? "#1c1612" : "#cbd5e1"}`,
      background: on ? "#1c1612" : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, color: "#f8f6f2", transition: "all .12s",
    }}>
      {on && "✓"}
    </div>
  );
}

function DayBadge({ day, month }) {
  return (
    <div style={{
      width: 42, height: 42, borderRadius: 10, background: "#1c1612",
      color: "#f8f6f2", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1.1,
    }}>
      <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.5 }}>{day}</span>
      <span style={{ fontSize: 8, opacity: 0.55, letterSpacing: 1 }}>{(month || "").slice(0, 3).toUpperCase()}</span>
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid #f8f6f230", borderTop: "2px solid #f8f6f2", animation: "spin .7s linear infinite", flexShrink: 0 }} />;
}

export default function PlannerSync() {
  const [step, setStep]           = useState("capture");
  const [imgFile, setImgFile]     = useState(null);
  const [imgURL, setImgURL]       = useState(null);
  const [imgB64, setImgB64]       = useState(null);
  const [data, setData]           = useState(null);
  const [selEv, setSelEv]         = useState(new Set());
  const [selTk, setSelTk]         = useState(new Set());
  const [catFilter, setCatFilter] = useState("all");
  const [syncMsg, setSyncMsg]     = useState("");
  const [error, setError]         = useState("");
  const [loadTxt, setLoadTxt]     = useState("");
  const [drag, setDrag]           = useState(false);
  const fileRef = useRef(null);
  const camRef  = useRef(null);

  const loadImage = useCallback(async (file) => {
    if (!file?.type?.startsWith("image/")) return;
    setImgFile(file);
    setImgURL(URL.createObjectURL(file));
    setImgB64(await toBase64(file));
    setError("");
  }, []);

  function clearAll() {
    setImgFile(null); setImgURL(null); setImgB64(null);
    setData(null); setSyncMsg(""); setError(""); setStep("capture");
  }

  async function extract() {
    setStep("extracting"); setLoadTxt("Analizando con Claude Vision…");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { 
     "Content-Type": "application/json",
     "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
     "anthropic-version": "2023-06-01"
   },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: imgFile.type, data: imgB64 } },
            { type: "text",  text: "Analiza este planner y devuelve el JSON." },
          ]}],
        }),
      });
      const raw    = await res.json();
      if (raw.error) throw new Error(raw.error.message);
      const txt    = raw.content?.[0]?.text || "{}";
      const clean  = txt.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean);
      setData(parsed);
      setSelEv(new Set((parsed.events||[]).map((_,i)=>`e${i}`).filter((_,i)=>!parsed.events[i].completed)));
      setSelTk(new Set((parsed.tasks ||[]).map((_,i)=>`t${i}`).filter((_,i)=>!parsed.tasks[i].completed)));
      setCatFilter("all"); setStep("review");
    } catch(e) { setError("Error al analizar: " + e.message); setStep("capture"); }
  }

  async function syncCalendar() {
    setStep("syncing"); setLoadTxt("Creando eventos en Google Calendar…");
    const { events=[], tasks=[], month, year } = data;
    const MONTHS = {Enero:1,Febrero:2,Marzo:3,Abril:4,Mayo:5,Junio:6,Julio:7,Agosto:8,Septiembre:9,Octubre:10,Noviembre:11,Diciembre:12};
    const m = MONTHS[month] || 1;
    const p = n => String(n).padStart(2, "0");
    const evList = events.filter((_,i)=>selEv.has(`e${i}`)).map(e => {
      const d = `${year}-${p(m)}-${p(e.day)}`;
      return e.all_day || !e.time_start
        ? { summary:e.title, start:{date:d}, end:{date:d}, status:e.confirmed?"confirmed":"tentative", description:`Categorías: ${(e.categories||[]).join(" ")}` }
        : { summary:e.title, start:{dateTime:`${d}T${e.time_start}:00`,timeZone:"America/Santiago"}, end:{dateTime:`${d}T${e.time_end||addHour(e.time_start)}:00`,timeZone:"America/Santiago"}, status:e.confirmed?"confirmed":"tentative", description:`Categorías: ${(e.categories||[]).join(" ")}` };
    });
    const tkList = tasks.filter((_,i)=>selTk.has(`t${i}`)).map(t=>({
      summary:t.title, start:{date:`${year}-${p(m)}-01`}, end:{date:`${year}-${p(m)}-01`},
      description:`Tarea. Categorías: ${(t.categories||[]).join(" ")}`
    }));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1024,
          messages: [{ role:"user", content:`Crea estos eventos en Google Calendar (America/Santiago).\n\nEVENTOS:\n${JSON.stringify(evList,null,2)}\n\nTAREAS:\n${JSON.stringify(tkList,null,2)}\n\nResponde en español con un resumen breve.` }],
          mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"google-calendar"}],
        }),
      });
      const raw = await res.json();
      if (raw.error) throw new Error(raw.error.message);
      setSyncMsg(raw.content.filter(b=>b.type==="text").map(b=>b.text).join("\n") || "¡Sincronización completada!");
      setStep("done");
    } catch(e) { setError("Error al sincronizar: " + e.message); setStep("review"); }
  }

  const { events=[], tasks=[], month, year, notes="" } = data || {};
  const allCats = [...new Set([...events.flatMap(e=>e.categories||[]),...tasks.flatMap(t=>t.categories||[])])].filter(c=>CATS[c]);
  const visEv = catFilter==="all" ? events : events.filter(e=>(e.categories||[]).includes(catFilter));
  const visTk = catFilter==="all" ? tasks  : tasks.filter(t=>(t.categories||[]).includes(catFilter));
  const total = selEv.size + selTk.size;
  const tog = (set, setFn, id) => { const s=new Set(set); s.has(id)?s.delete(id):s.add(id); setFn(s); };

  const cardSt = on => ({
    background: on ? "#fff" : "#f5f2ec",
    border: `1.5px solid ${on ? "#1c1612" : "#e2ddd6"}`,
    borderRadius: 11, padding: "11px 14px",
    cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
    transition: "all .12s",
  });

  const steps = [["capture","1","Captura"],["review","2","Revisión"],["done","3","Listo"]];

  return (
    <div style={{ fontFamily:"'DM Serif Display',Georgia,serif", minHeight:"100vh", background:"#f5f2ec" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Lato:wght@300;400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes spin   {to{transform:rotate(360deg)}}
        @keyframes fadeUp {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes pulse  {0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes scan   {0%,100%{top:8%}50%{top:84%}}
        .fade{animation:fadeUp .28s ease both}
        .card:hover{box-shadow:0 2px 14px #1c161216}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#c8bfb0;border-radius:2px}
      `}</style>

      {/* Header */}
      <header style={{background:"#1c1612",color:"#f5f2ec",padding:"0 28px",display:"flex",alignItems:"center",justifyContent:"space-between",height:58,gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:32,height:32,border:"1.5px solid #d4a574",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>📅</div>
          <span style={{fontSize:20,letterSpacing:-0.3,fontStyle:"italic"}}>PlannerSync</span>
          <span style={{fontSize:9,fontFamily:"'Lato',sans-serif",background:"#3d2b1f",color:"#d4a574",padding:"2px 7px",borderRadius:20,letterSpacing:1,fontWeight:700}}>BETA</span>
        </div>
        <div style={{display:"flex",alignItems:"center"}}>
          {steps.map(([s,n,label],i) => {
            const past   = (s==="capture"&&["review","syncing","done"].includes(step))||(s==="review"&&step==="done");
            const active = step===s||(step==="extracting"&&s==="capture")||(step==="syncing"&&s==="review");
            return (
              <div key={s} style={{display:"flex",alignItems:"center"}}>
                {i>0 && <div style={{width:26,height:1,background:past?"#6ee7b7":"#3d2b1f"}}/>}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 4px"}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:past?"#059669":active?"#d4a574":"#2d221c",color:past||active?"#fff":"#6b5c52",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontFamily:"'Lato',sans-serif",fontWeight:700,transition:"all .2s"}}>
                    {past?"✓":n}
                  </div>
                  <span style={{fontSize:11,fontFamily:"'Lato',sans-serif",color:active?"#d4a574":past?"#6ee7b7":"#5a4a3f",letterSpacing:.5}}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      <main style={{maxWidth:740,margin:"0 auto",padding:"36px 22px 60px"}}>

        {error && (
          <div className="fade" style={{background:"#fff1f2",border:"1px solid #fca5a5",borderRadius:10,padding:"12px 18px",marginBottom:24,color:"#9f1239",fontSize:13,fontFamily:"'Lato',sans-serif",display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{fontSize:15,flexShrink:0}}>⚠️</span>{error}
          </div>
        )}

        {/* ── CAPTURA ── */}
        {(step==="capture"||step==="extracting") && (
          <div className="fade">
            <h1 style={{fontSize:34,fontStyle:"italic",marginBottom:6,color:"#1c1612",lineHeight:1.1}}>Captura tu planner</h1>
            <p style={{fontFamily:"'Lato',sans-serif",color:"#78716c",fontSize:14,marginBottom:28,fontWeight:300}}>
              Fotografía el planner mensual — buena luz, ángulo perpendicular.
            </p>

            <div
              onDragOver={e=>{e.preventDefault();setDrag(true)}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);loadImage(e.dataTransfer.files[0])}}
              onClick={()=>!imgURL&&fileRef.current?.click()}
              style={{border:`2px dashed ${drag?"#d4a574":imgURL?"#1c1612":"#c8bfb0"}`,borderRadius:16,overflow:"hidden",background:drag?"#fef9f3":imgURL?"#fff":"#faf8f4",minHeight:240,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",cursor:imgURL?"default":"pointer",transition:"border-color .15s, background .15s"}}
            >
              {imgURL ? (
                <>
                  <img src={imgURL} alt="planner" style={{width:"100%",maxHeight:400,objectFit:"contain",display:"block"}}/>
                  {step==="extracting" && (
                    <div style={{position:"absolute",inset:0,background:"#1c161240",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14}}>
                      <div style={{position:"absolute",left:"5%",right:"5%",height:2,background:"#d4a574cc",animation:"scan 1.6s ease-in-out infinite",boxShadow:"0 0 12px #d4a574"}}/>
                      <Spinner/>
                      <span style={{fontFamily:"'Lato',sans-serif",color:"#f5f2ec",fontSize:14,fontWeight:300,letterSpacing:.5}}>{loadTxt}</span>
                    </div>
                  )}
                  {step==="capture" && (
                    <button onClick={e=>{e.stopPropagation();clearAll()}} style={{position:"absolute",top:12,right:12,background:"#1c1612cc",color:"#f5f2ec",border:"none",borderRadius:20,padding:"4px 13px",fontSize:12,cursor:"pointer",fontFamily:"'Lato',sans-serif"}}>
                      ✕ Cambiar
                    </button>
                  )}
                </>
              ) : (
                <div style={{textAlign:"center",padding:44}}>
                  <div style={{fontSize:50,marginBottom:14}}>📷</div>
                  <p style={{fontSize:16,fontStyle:"italic",marginBottom:6,color:"#1c1612"}}>Arrastra tu foto aquí</p>
                  <p style={{fontSize:13,fontFamily:"'Lato',sans-serif",color:"#a8a29e",marginBottom:22,fontWeight:300}}>o haz click para seleccionar</p>
                  <button onClick={e=>{e.stopPropagation();camRef.current?.click()}} style={{background:"#1c1612",color:"#f5f2ec",border:"none",borderRadius:8,padding:"9px 22px",fontSize:13,cursor:"pointer",fontFamily:"'Lato',sans-serif",letterSpacing:.3}}>
                    📸 Usar cámara
                  </button>
                </div>
              )}
            </div>

            <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>loadImage(e.target.files[0])}/>
            <input ref={camRef}  type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>loadImage(e.target.files[0])}/>

            {imgURL && step==="capture" && (
              <button onClick={extract} style={{marginTop:14,width:"100%",background:"#1c1612",color:"#f5f2ec",border:"none",borderRadius:11,padding:"15px 0",fontSize:16,fontStyle:"italic",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,letterSpacing:.2}}>
                ✦ Analizar con Claude Vision →
              </button>
            )}

            <div style={{marginTop:30,background:"#fff",border:"1px solid #e7e2da",borderRadius:14,padding:"18px 20px"}}>
              <p style={{fontSize:10,fontFamily:"'Lato',sans-serif",fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#a8a29e",marginBottom:12}}>Símbolos del planner</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {Object.entries(CATS).map(([sym])=><Tag key={sym} sym={sym}/>)}
              </div>
            </div>
          </div>
        )}

        {/* ── REVISIÓN ── */}
        {step==="review" && data && (
          <div className="fade">
            <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6,flexWrap:"wrap"}}>
              <h1 style={{fontSize:32,fontStyle:"italic",color:"#1c1612",lineHeight:1}}>Revisar extracción</h1>
              <span style={{fontFamily:"'Lato',sans-serif",fontSize:14,color:"#a8a29e",fontWeight:300}}>{month} {year}</span>
            </div>
            <p style={{fontFamily:"'Lato',sans-serif",fontSize:14,color:"#78716c",marginBottom:22,fontWeight:300}}>
              <strong style={{color:"#1c1612",fontWeight:700}}>{total}</strong> elemento{total!==1?"s":""} seleccionado{total!==1?"s":""}. Click para incluir/excluir.
            </p>

            {/* Filtros */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:22}}>
              {[["all","Todo",events.length+tasks.length], ...allCats.map(sym=>[sym, `${sym} ${CATS[sym].label}`, events.filter(e=>(e.categories||[]).includes(sym)).length+tasks.filter(t=>(t.categories||[]).includes(sym)).length])].map(([val,label,n]) => {
                const c   = val==="all" ? null : CATS[val];
                const sel = catFilter===val;
                return (
                  <button key={val} onClick={()=>setCatFilter(catFilter===val&&val!=="all"?"all":val)} style={{
                    padding:"5px 13px", borderRadius:20, fontSize:12,
                    fontFamily:"'Lato',sans-serif", fontWeight:700,
                    border:`1.5px solid ${c?c.dot:"#d1cdc5"}`,
                    background: sel ? (c?c.ink:"#1c1612") : (c?c.wash:"#fff"),
                    color: sel ? "#fff" : (c?c.ink:"#1c1612"),
                    cursor:"pointer", transition:"all .12s",
                  }}>
                    {label} · {n}
                  </button>
                );
              })}
            </div>

            {visEv.length>0 && (
              <section style={{marginBottom:20}}>
                <div style={{fontSize:10,fontFamily:"'Lato',sans-serif",fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#b8b0a5",marginBottom:8}}>Eventos · {visEv.length}</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {visEv.map(ev=>{
                    const idx=events.indexOf(ev); const id=`e${idx}`; const on=selEv.has(id);
                    return (
                      <div key={id} onClick={()=>tog(selEv,setSelEv,id)} className="card" style={{...cardSt(on),opacity:ev.completed?.5:1}}>
                        <Check on={on}/>
                        <DayBadge day={ev.day} month={month}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:15,fontStyle:"italic",marginBottom:4,textDecoration:ev.completed?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#1c1612"}}>{ev.title}</div>
                          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                            {ev.all_day||!ev.time_start
                              ? <span style={{fontSize:11,fontFamily:"'Lato',sans-serif",color:"#b8b0a5"}}>Todo el día</span>
                              : <span style={{fontSize:11,fontFamily:"'Lato',sans-serif",color:"#78716c"}}>🕐 {ev.time_start}{ev.time_end?` – ${ev.time_end}`:""}</span>}
                            {!ev.confirmed && <span style={{fontSize:10,background:"#fef3c7",color:"#92400e",padding:"1px 6px",borderRadius:4,fontFamily:"'Lato',sans-serif"}}>? tentativo</span>}
                            {(ev.categories||[]).map(sym=><Tag key={sym} sym={sym}/>)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {visTk.length>0 && (
              <section style={{marginBottom:20}}>
                <div style={{fontSize:10,fontFamily:"'Lato',sans-serif",fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#b8b0a5",marginBottom:8}}>Tareas · {visTk.length}</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {visTk.map(tk=>{
                    const idx=tasks.indexOf(tk); const id=`t${idx}`; const on=selTk.has(id);
                    return (
                      <div key={id} onClick={()=>tog(selTk,setSelTk,id)} className="card" style={{...cardSt(on),opacity:tk.completed?.5:1}}>
                        <Check on={on}/>
                        <div style={{width:42,height:42,borderRadius:10,border:"1.5px solid #d1cdc5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,color:"#a8a29e"}}>☐</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:15,fontStyle:"italic",marginBottom:4,textDecoration:tk.completed?"line-through":"none",color:"#1c1612"}}>{tk.title}</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {(tk.categories||[]).map(sym=><Tag key={sym} sym={sym}/>)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {notes && (
              <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:11,padding:"13px 16px",marginBottom:18}}>
                <div style={{fontSize:10,fontFamily:"'Lato',sans-serif",fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#92400e",marginBottom:6}}>Notas</div>
                <p style={{fontFamily:"'Lato',sans-serif",fontSize:13,color:"#78350f",lineHeight:1.6}}>{notes}</p>
              </div>
            )}

            {events.length===0&&tasks.length===0 && (
              <div style={{textAlign:"center",padding:"44px 0",color:"#a8a29e"}}>
                <div style={{fontSize:40,marginBottom:10}}>🔍</div>
                <p style={{fontSize:16,fontStyle:"italic"}}>No se encontraron elementos</p>
                <p style={{fontFamily:"'Lato',sans-serif",fontSize:13,marginTop:6,fontWeight:300}}>Intenta con una foto más clara</p>
              </div>
            )}

            <button onClick={syncCalendar} disabled={total===0} style={{marginTop:8,width:"100%",background:total===0?"#d1cdc5":"#15803d",color:"#fff",border:"none",borderRadius:11,padding:"15px 0",fontSize:16,fontStyle:"italic",cursor:total===0?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,letterSpacing:.2,transition:"background .15s"}}>
              📅 Sincronizar {total} elemento{total!==1?"s":""} con Google Calendar →
            </button>
            <button onClick={clearAll} style={{marginTop:8,width:"100%",background:"transparent",color:"#a8a29e",border:"1px solid #e2ddd6",borderRadius:11,padding:"11px 0",fontSize:13,cursor:"pointer",fontFamily:"'Lato',sans-serif"}}>
              ← Capturar otra imagen
            </button>
          </div>
        )}

        {/* ── SINCRONIZANDO ── */}
        {step==="syncing" && (
          <div className="fade" style={{textAlign:"center",paddingTop:80}}>
            <div style={{fontSize:56,marginBottom:22,animation:"pulse 1.6s ease-in-out infinite"}}>📅</div>
            <h2 style={{fontSize:28,fontStyle:"italic",marginBottom:10,color:"#1c1612"}}>Sincronizando…</h2>
            <p style={{fontFamily:"'Lato',sans-serif",color:"#78716c",fontSize:14,fontWeight:300}}>{loadTxt}</p>
          </div>
        )}

        {/* ── LISTO ── */}
        {step==="done" && (
          <div className="fade" style={{textAlign:"center",paddingTop:60}}>
            <div style={{fontSize:64,marginBottom:20}}>✅</div>
            <h2 style={{fontSize:32,fontStyle:"italic",marginBottom:12,color:"#1c1612"}}>¡Sincronizado!</h2>
            <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:14,padding:"18px 24px",maxWidth:480,margin:"0 auto 32px",textAlign:"left"}}>
              <p style={{fontFamily:"'Lato',sans-serif",fontSize:14,color:"#166534",lineHeight:1.8,fontWeight:300}}>{syncMsg}</p>
            </div>
            <button onClick={clearAll} style={{background:"#1c1612",color:"#f5f2ec",border:"none",borderRadius:11,padding:"13px 36px",fontSize:16,fontStyle:"italic",cursor:"pointer",letterSpacing:.2}}>
              ✦ Escanear otro planner
            </button>
          </div>
        )}

      </main>
    </div>
  );
}

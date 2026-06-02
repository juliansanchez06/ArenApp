// ARENERA · PANEL DE CONTROL — un solo archivo JSX
// Deploy: proyecto Vite React -> reemplazá src/App.jsx por este archivo -> push a GitHub -> import en Vercel.
// Persistencia: localStorage (funciona en Vercel; en la vista previa del chat puede no guardar entre recargas).

import React, { useState, useEffect, useMemo } from "react";

/* ────────────────────────────────────────────────────────────
   SUPUESTOS POR DEFECTO (editables desde la app)
   ──────────────────────────────────────────────────────────── */
const DEFAULTS = {
  precioBruta: 9000,        // $/tn boca de pozo
  precioGrillada: 9000,     // $/tn (subilo cuando confirmes el corralón)
  comisionSocios: 30,       // %
  regalia: 3,               // % de boca de mina
  tnPorBatea: 30,           // tn
  objetivoSemana: 3,        // bateas/semana
  gasoilPrecio: 1800,       // $/L
  palaConsumo: 9,           // L/h
  palaReserva: 11400,       // $/h (reparación + amortización pala)
  jornal: 35000,            // $/día
  horasPalaBruta: 3,
  horasPalaGrillada: 5.5,
  jornalesBruta: 1,
  jornalesGrillada: 2,
  variosBruta: 8000,
  variosGrillada: 15000,
  costoGrilla: 1500000,     // $ inversión grilla
  vidaGrillaAnios: 4,
};

/* ────────────────────────────────────────────────────────────
   MOTOR DE CÁLCULO
   ──────────────────────────────────────────────────────────── */
function calcDia(cfg, modo, bateas) {
  const tn = bateas * cfg.tnPorBatea;
  const precio = modo === "grillada" ? cfg.precioGrillada : cfg.precioBruta;
  const ingresoBruto = tn * precio;
  const comision = ingresoBruto * (cfg.comisionSocios / 100);
  const regaliaMonto = ingresoBruto * (cfg.regalia / 100);
  const ingresoNeto = ingresoBruto - comision;

  const horas = modo === "grillada" ? cfg.horasPalaGrillada : cfg.horasPalaBruta;
  const jornales = modo === "grillada" ? cfg.jornalesGrillada : cfg.jornalesBruta;
  const varios = modo === "grillada" ? cfg.variosGrillada : cfg.variosBruta;

  const gasoil = horas * cfg.palaConsumo * cfg.gasoilPrecio;
  const reserva = horas * cfg.palaReserva;
  const manoObra = jornales * cfg.jornal;
  const amortGrilla = modo === "grillada" ? amortGrillaTn(cfg) * tn : 0;

  const costoTotal = gasoil + reserva + manoObra + varios + regaliaMonto + amortGrilla;
  const margen = ingresoNeto - costoTotal;
  return {
    tn, precio, ingresoBruto, comision, regaliaMonto, ingresoNeto,
    gasoil, reserva, manoObra, varios, amortGrilla, costoTotal,
    margen, margenTn: tn ? margen / tn : 0, margenBatea: bateas ? margen / bateas : 0,
  };
}

function amortGrillaTn(cfg) {
  const tnVida = cfg.tnPorBatea * cfg.objetivoSemana * 52 * cfg.vidaGrillaAnios;
  return tnVida ? cfg.costoGrilla / tnVida : 0;
}

// neto $/tn de cada modo, a la escala del objetivo semanal
function netoTn(cfg, modo) {
  const r = calcDia(cfg, modo, cfg.objetivoSemana);
  return r.margenTn;
}

// precio de grillada al que EMPATA con bruta (break-even para que valga grillar)
function breakEvenGrillada(cfg) {
  const factor = 1 - cfg.comisionSocios / 100 - cfg.regalia / 100;
  if (factor <= 0) return Infinity;
  const tn = cfg.objetivoSemana * cfg.tnPorBatea;
  const opG =
    (cfg.horasPalaGrillada * cfg.palaConsumo * cfg.gasoilPrecio +
      cfg.horasPalaGrillada * cfg.palaReserva +
      cfg.jornalesGrillada * cfg.jornal +
      cfg.variosGrillada) / tn + amortGrillaTn(cfg);
  const netoB = netoTn(cfg, "bruta");
  return (netoB + opG) / factor;
}

// precio de bruta al que el margen se hace cero (zona de pérdida)
function breakEvenBruta(cfg) {
  const factor = 1 - cfg.comisionSocios / 100 - cfg.regalia / 100;
  if (factor <= 0) return Infinity;
  const tn = cfg.objetivoSemana * cfg.tnPorBatea;
  const opB =
    (cfg.horasPalaBruta * cfg.palaConsumo * cfg.gasoilPrecio +
      cfg.horasPalaBruta * cfg.palaReserva +
      cfg.jornalesBruta * cfg.jornal +
      cfg.variosBruta) / tn;
  return opB / factor;
}

/* ────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────── */
const $ = (n) => (isFinite(n) ? "$" + Math.round(n).toLocaleString("es-AR") : "—");
const N = (n) => (isFinite(n) ? Math.round(n).toLocaleString("es-AR") : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // lunes = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

const C = {
  bg: "#ffffff", panel: "#faf8f4", line: "#e6e2da", ink: "#1a1714",
  ink2: "#7a736b", accent: "#540c18",
  verde: "#15803d", amarillo: "#ca8a04", rojo: "#dc2626",
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ────────────────────────────────────────────────────────────
   COMPONENTES CHICOS
   ──────────────────────────────────────────────────────────── */
function Dot({ color }) {
  return (
    <span style={{
      width: 13, height: 13, borderRadius: "50%", background: color,
      display: "inline-block", boxShadow: `0 0 0 4px ${color}22`, flexShrink: 0,
    }} />
  );
}

function Section({ tag, title, right, children }) {
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, background: C.accent, display: "inline-block" }} />
          <span className="label">{tag}</span>
        </div>
        {right}
      </div>
      <h2 style={{ margin: "0 0 18px", fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: "-0.01em", color: C.ink }}>{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="card kpi">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="label">{label}</span>
        <Dot color={color} />
      </div>
      <div className="num" style={{ fontSize: 30, marginTop: 10, color: C.ink }}>{value}</div>
      <div style={{ color: C.ink2, fontSize: 12.5, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Field({ label, value, onChange, suffix, step = 1 }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <div className="inputWrap">
        <input className="input" type="number" step={step} value={value}
          onChange={(e) => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))} />
        {suffix && <span style={{ color: C.ink2, fontSize: 13, paddingRight: 12 }}>{suffix}</span>}
      </div>
    </label>
  );
}

/* ────────────────────────────────────────────────────────────
   APP
   ──────────────────────────────────────────────────────────── */
export default function App() {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULTS, ...load("arenera_cfg_v1", {}) }));
  const [registros, setRegistros] = useState(() => load("arenera_reg_v1", []));
  const [clientes, setClientes] = useState(() => load("arenera_cli_v1", []));
  const [modo, setModo] = useState("bruta");
  const [bateas, setBateas] = useState(DEFAULTS.objetivoSemana);
  const [showCfg, setShowCfg] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  // form de carga
  const [fFecha, setFFecha] = useState(todayISO());
  const [fModo, setFModo] = useState("bruta");
  const [fBateas, setFBateas] = useState(1);
  const [fClienteId, setFClienteId] = useState("");
  const [fCanal, setFCanal] = useState("Socios");

  // form de cliente
  const [cNombre, setCNombre] = useState("");
  const [cLocalidad, setCLocalidad] = useState("");
  const [cTel, setCTel] = useState("");
  const [cCanal, setCCanal] = useState("Socios");

  useEffect(() => save("arenera_cfg_v1", cfg), [cfg]);
  useEffect(() => save("arenera_reg_v1", registros), [registros]);
  useEffect(() => save("arenera_cli_v1", clientes), [clientes]);

  const setC = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }));

  const dia = useMemo(() => calcDia(cfg, modo, bateas), [cfg, modo, bateas]);
  const beG = useMemo(() => breakEvenGrillada(cfg), [cfg]);
  const beB = useMemo(() => breakEvenBruta(cfg), [cfg]);
  const netoB = useMemo(() => netoTn(cfg, "bruta"), [cfg]);
  const netoG = useMemo(() => netoTn(cfg, "grillada"), [cfg]);

  // decisión bruta vs grillada
  const dif = netoG - netoB;
  let dec;
  if (dif > 100) dec = { color: C.verde, txt: "GRILLÁ", msg: `La grillada deja ${$(dif)}/tn más que la bruta.` };
  else if (dif >= -100) dec = { color: C.amarillo, txt: "EMPATE → VENDÉ BRUTA", msg: "Casi lo mismo: menos laburo y desgaste yendo en bruta." };
  else dec = { color: C.rojo, txt: "VENDÉ BRUTA", msg: `Grillar te resta ${$(-dif)}/tn. No conviene a este precio.` };

  // métricas del mes / semana
  const stats = useMemo(() => {
    const now = new Date(); const m = now.getMonth(), y = now.getFullYear();
    const sow = startOfWeek(now);
    let tnMes = 0, ingMes = 0, comMes = 0, costoMes = 0, margenMes = 0, tnDir = 0, batSem = 0;
    for (const r of registros) {
      const d = new Date(r.fecha + "T00:00:00");
      const calc = calcDia(cfg, r.modo, r.bateas);
      if (d.getMonth() === m && d.getFullYear() === y) {
        tnMes += calc.tn; ingMes += calc.ingresoBruto; comMes += calc.comision;
        costoMes += calc.costoTotal; margenMes += calc.margen;
        if (r.canal === "Directo") tnDir += calc.tn;
      }
      if (d >= sow) batSem += r.bateas;
    }
    return { tnMes, ingMes, comMes, costoMes, margenMes, tnDir, batSem,
      pctDir: tnMes ? (tnDir / tnMes) * 100 : 0, costoTn: tnMes ? costoMes / tnMes : 0 };
  }, [registros, cfg]);

  // alertas
  const alertas = [];
  if (cfg.precioBruta <= beB * 1.15)
    alertas.push({ color: C.rojo, t: "Precio cerca de pérdida", d: `La bruta no rinde por debajo de ~${$(beB)}/tn. Estás en zona de riesgo.` });
  if (cfg.precioGrillada === cfg.precioBruta)
    alertas.push({ color: C.amarillo, t: "Falta confirmar precio de grillada", d: `Llamá al corralón. Grillar conviene solo desde ~${$(beG)}/tn.` });
  if (stats.tnMes > 0 && stats.pctDir < 20)
    alertas.push({ color: C.amarillo, t: "Dependés de los socios", d: `Solo ${N(stats.pctDir)}% de las ventas del mes son directas. Cada tn directa recupera ${$(cfg.precioBruta * cfg.comisionSocios / 100)}/tn.` });
  if (stats.batSem >= cfg.objetivoSemana)
    alertas.push({ color: C.verde, t: "Objetivo semanal cumplido", d: `${stats.batSem} bateas esta semana. Cada batea extra el mismo día deja casi puro margen.` });

  const semDir = stats.pctDir > 50 ? C.verde : stats.pctDir >= 20 ? C.amarillo : C.rojo;
  const semBat = stats.batSem >= cfg.objetivoSemana ? C.verde : stats.batSem >= 1 ? C.amarillo : C.rojo;
  const semMar = stats.margenMes > 0 ? C.verde : stats.margenMes < 0 ? C.rojo : C.amarillo;

  // historial por cliente (ordenado por margen, mejores arriba)
  const clientesStats = useMemo(() => {
    return clientes.map((cl) => {
      let tn = 0, margen = 0, cargas = 0, ultima = null;
      for (const r of registros) {
        if (r.clienteId !== cl.id) continue;
        const c = calcDia(cfg, r.modo, r.bateas);
        tn += c.tn; margen += c.margen; cargas += 1;
        if (!ultima || r.fecha > ultima) ultima = r.fecha;
      }
      return { ...cl, tn, margen, cargas, ultima };
    }).sort((a, b) => b.margen - a.margen);
  }, [clientes, registros, cfg]);

  // proyección
  const proySem = calcDia(cfg, modo, cfg.objetivoSemana).margen;
  const proyMes = proySem * 4.33, proyAnio = proySem * 52;

  function registrar() {
    if (!fBateas || fBateas <= 0 || !fClienteId) return;
    const cl = clientes.find((c) => String(c.id) === String(fClienteId));
    setRegistros((rs) => [
      { id: Date.now(), fecha: fFecha, modo: fModo, bateas: fBateas,
        clienteId: fClienteId, cliente: cl ? cl.nombre : "—", canal: fCanal },
      ...rs,
    ]);
    setFBateas(1);
  }
  function borrar(id) { setRegistros((rs) => rs.filter((r) => r.id !== id)); }

  function agregarCliente() {
    if (!cNombre.trim()) return;
    setClientes((cs) => [
      ...cs,
      { id: Date.now(), nombre: cNombre.trim(), localidad: cLocalidad.trim(), tel: cTel.trim(), canal: cCanal },
    ]);
    setCNombre(""); setCLocalidad(""); setCTel(""); setCCanal("Socios");
  }
  function borrarCliente(id) { setClientes((cs) => cs.filter((c) => c.id !== id)); }

  function elegirCliente(id) {
    setFClienteId(id);
    const cl = clientes.find((c) => String(c.id) === String(id));
    if (cl) setFCanal(cl.canal);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .app { font-family: Archivo, sans-serif; max-width: 1120px; margin: 0 auto; padding: 28px 20px 80px; }
        .label { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.ink2}; font-weight:600; }
        .num { font-family:'IBM Plex Mono',monospace; font-weight:700; font-variant-numeric: tabular-nums; letter-spacing:-0.01em; }
        .row { display:flex; gap:14px; }
        .card { background:${C.bg}; border:1px solid ${C.line}; border-radius:16px; padding:22px; }
        .kpi { padding:18px; }
        .grid-kpi { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
        .grid-2 { display:grid; grid-template-columns:1.05fr 0.95fr; gap:18px; }
        .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
        .grid-form { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; align-items:end; }
        .inputWrap { display:flex; align-items:center; border:1px solid ${C.line}; border-radius:10px; background:${C.bg}; overflow:hidden; }
        .input, select.input { width:100%; border:0; outline:0; padding:11px 12px; font-family:'IBM Plex Mono',monospace; font-size:15px; font-weight:600; color:${C.ink}; background:transparent; }
        .input:focus-within {}
        .inputWrap:focus-within { border-color:${C.accent}; box-shadow:0 0 0 3px ${C.accent}1a; }
        select.input { -webkit-appearance:none; appearance:none; cursor:pointer; }
        .selectWrap { position:relative; }
        .selectWrap::after { content:'▾'; position:absolute; right:12px; top:50%; transform:translateY(-50%); color:${C.ink2}; pointer-events:none; }
        .btn { font-family:'IBM Plex Mono',monospace; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:13px; border:0; border-radius:10px; padding:12px 16px; cursor:pointer; background:${C.ink}; color:#fff; }
        .btn:hover { background:#000; }
        .tog { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; padding:10px 18px; border:1px solid ${C.line}; background:${C.bg}; color:${C.ink2}; cursor:pointer; }
        .tog.on { background:${C.accent}; color:#fff; border-color:${C.accent}; }
        .brk td { padding:7px 0; border-bottom:1px dashed ${C.line}; font-size:14px; }
        .brk td:last-child { text-align:right; }
        table.reg { width:100%; border-collapse:collapse; font-size:13.5px; }
        table.reg th { text-align:left; font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:0.1em; text-transform:uppercase; color:${C.ink2}; padding:8px 10px; border-bottom:1px solid ${C.line}; font-weight:600; }
        table.reg td { padding:10px; border-bottom:1px solid ${C.line}; }
        .pill { font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; padding:3px 8px; border-radius:20px; }
        .del { border:0; background:transparent; color:${C.ink2}; cursor:pointer; font-size:16px; line-height:1; }
        .del:hover { color:${C.rojo}; }
        @media (max-width:860px){
          .grid-kpi{ grid-template-columns:repeat(2,1fr);} .grid-2{ grid-template-columns:1fr;}
          .grid-3{ grid-template-columns:1fr;} .grid-form{ grid-template-columns:1fr 1fr;}
        }
        @media (max-width:560px){
          .app{ padding:16px 12px 64px; }
          .card{ padding:16px; border-radius:14px; }
          .grid-kpi{ grid-template-columns:1fr 1fr; gap:10px; }
          .grid-form{ grid-template-columns:1fr; gap:14px; }
          .grid-form > label[style*="span 2"]{ grid-column:auto; }
          .card > .row:first-child{ flex-wrap:wrap; }
          .input, select.input{ font-size:16px; padding:13px 12px; }  /* 16px evita el zoom de iOS */
          .btn{ width:100%; padding:14px; }
          header h1{ font-size:27px !important; }
          .card h2{ font-size:18px !important; }
          .kpi .num{ font-size:21px !important; }
          /* TABLAS -> TARJETAS APILADAS */
          table.reg thead{ display:none; }
          table.reg, table.reg tbody, table.reg tr, table.reg td{ display:block; width:100%; }
          table.reg tr{ border:1px solid ${C.line}; border-radius:12px; padding:4px 14px; margin-bottom:12px; }
          table.reg td{ border:0; border-bottom:1px solid ${C.line}; padding:11px 0; display:flex; justify-content:space-between; align-items:center; gap:16px; text-align:right; }
          table.reg td:last-child{ border-bottom:0; }
          table.reg td::before{ content:attr(data-label); font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:${C.ink2}; }
          table.reg td[data-label=""]{ justify-content:flex-end; }
        }
      `}</style>

      <div className="app">
        {/* HEADER */}
        <header style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `2px solid ${C.ink}` }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
            <div>
              {logoOk ? (
                <img src="/logo.png" alt="El Retiro" onError={() => setLogoOk(false)}
                  style={{ width: "min(230px, 62vw)", height: "auto", display: "block" }} />
              ) : (
                <h1 style={{ margin: 0, fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 38, letterSpacing: "-0.03em", color: C.accent }}>EL RETIRO</h1>
              )}
              <div className="label" style={{ color: C.accent, marginTop: 10 }}>Panel de control · Arenera · Sol de Julio</div>
            </div>
            <button className="tog" onClick={() => setShowCfg((s) => !s)}>{showCfg ? "Ocultar supuestos" : "Editar supuestos"}</button>
          </div>
        </header>

        {/* ALERTAS */}
        {alertas.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
            {alertas.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: `${a.color}10`, borderLeft: `4px solid ${a.color}`, borderRadius: 10, padding: "12px 16px" }}>
                <Dot color={a.color} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink }}>{a.t}</div>
                  <div style={{ fontSize: 13, color: C.ink2, marginTop: 2 }}>{a.d}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="grid-kpi" style={{ marginBottom: 22 }}>
          <Kpi label="Margen del mes" value={$(stats.margenMes)} sub={`${N(stats.tnMes)} tn cargadas`} color={semMar} />
          <Kpi label="Ventas directas" value={`${N(stats.pctDir)}%`} sub="cuanto más alto, más recuperás del 30%" color={semDir} />
          <Kpi label="Bateas esta semana" value={`${stats.batSem} / ${cfg.objetivoSemana}`} sub="objetivo semanal" color={semBat} />
          <Kpi label="Comisión socios (mes)" value={$(stats.comMes)} sub="tu mayor costo" color={C.accent} />
        </div>

        {/* DECISIÓN + CALCULADORA */}
        <div className="grid-2" style={{ marginBottom: 18 }}>
          {/* Decisión */}
          <Section tag="Decisión" title="Bruta vs. grillada">
            <div style={{ display: "flex", alignItems: "center", gap: 16, background: `${dec.color}0d`, border: `1px solid ${dec.color}33`, borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
              <Dot color={dec.color} />
              <div>
                <div className="num" style={{ fontSize: 19, color: dec.color }}>{dec.txt}</div>
                <div style={{ fontSize: 13, color: C.ink2, marginTop: 3 }}>{dec.msg}</div>
              </div>
            </div>
            <table style={{ width: "100%" }} className="brk">
              <tbody>
                <tr><td>Neto bruta</td><td className="num">{$(netoB)}/tn</td></tr>
                <tr><td>Neto grillada</td><td className="num">{$(netoG)}/tn</td></tr>
                <tr><td>Precio grillada para empatar</td><td className="num" style={{ color: C.accent }}>{$(beG)}/tn</td></tr>
                <tr><td>Piso de la bruta (pérdida)</td><td className="num">{$(beB)}/tn</td></tr>
              </tbody>
            </table>
          </Section>

          {/* Calculadora del día */}
          <Section tag="Calculadora" title="Día de carga"
            right={
              <div className="row" style={{ gap: 0 }}>
                <button className={"tog" + (modo === "bruta" ? " on" : "")} style={{ borderRadius: "10px 0 0 10px" }} onClick={() => setModo("bruta")}>Bruta</button>
                <button className={"tog" + (modo === "grillada" ? " on" : "")} style={{ borderRadius: "0 10px 10px 0", borderLeft: 0 }} onClick={() => setModo("grillada")}>Grillada</button>
              </div>
            }>
            <div style={{ marginBottom: 16 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span className="label">Bateas a cargar</span>
                <span className="num" style={{ fontSize: 18, color: C.accent }}>{bateas} · {N(dia.tn)} tn</span>
              </div>
              <input type="range" min={1} max={10} value={bateas} onChange={(e) => setBateas(parseInt(e.target.value))}
                style={{ width: "100%", accentColor: C.accent }} />
            </div>
            <table style={{ width: "100%" }} className="brk">
              <tbody>
                <tr><td>Ingreso bruto</td><td className="num">{$(dia.ingresoBruto)}</td></tr>
                <tr><td>− Socios ({cfg.comisionSocios}%)</td><td className="num" style={{ color: C.rojo }}>−{N(dia.comision)}</td></tr>
                <tr><td>− Gasoil + pala</td><td className="num" style={{ color: C.rojo }}>−{N(dia.gasoil + dia.reserva)}</td></tr>
                <tr><td>− Mano de obra + varios</td><td className="num" style={{ color: C.rojo }}>−{N(dia.manoObra + dia.varios)}</td></tr>
                <tr><td>− Regalía{dia.amortGrilla ? " + amort. grilla" : ""}</td><td className="num" style={{ color: C.rojo }}>−{N(dia.regaliaMonto + dia.amortGrilla)}</td></tr>
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginTop: 14, paddingTop: 14, borderTop: `2px solid ${C.ink}` }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Margen del día</span>
              <span className="num" style={{ fontSize: 26, color: dia.margen >= 0 ? C.verde : C.rojo }}>{$(dia.margen)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: C.ink2, fontSize: 12.5, marginTop: 6 }}>
              <span>{$(dia.margenBatea)} / batea</span><span>{$(dia.margenTn)} / tn</span>
            </div>
          </Section>
        </div>

        {/* CLIENTES */}
        <Section tag="Cartera" title="Clientes"
          right={<span className="label">{clientes.length} cargados</span>}>
          <div className="grid-form" style={{ marginBottom: 20 }}>
            <label style={{ display: "block", gridColumn: "span 2" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Nombre</span>
              <div className="inputWrap">
                <input className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={cNombre} placeholder="Corralón San José…" onChange={(e) => setCNombre(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Localidad</span>
              <div className="inputWrap">
                <input className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={cLocalidad} placeholder="Ojo de Agua…" onChange={(e) => setCLocalidad(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Teléfono</span>
              <div className="inputWrap">
                <input className="input" value={cTel} placeholder="—" onChange={(e) => setCTel(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Canal</span>
              <div className="inputWrap selectWrap">
                <select className="input" value={cCanal} onChange={(e) => setCCanal(e.target.value)}>
                  <option>Socios</option><option>Directo</option>
                </select>
              </div>
            </label>
            <button className="btn" onClick={agregarCliente}>+ Agregar</button>
          </div>

          {clientes.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "16px 0" }}>Cargá tus corralones y clientes acá. Después los elegís de la lista al registrar cada venta y la app te arma el historial de cada uno.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="reg">
                <thead><tr><th>Cliente</th><th>Localidad</th><th>Canal</th><th>Tel</th><th style={{ textAlign: "right" }}>Tn total</th><th style={{ textAlign: "right" }}>Margen</th><th style={{ textAlign: "right" }}>Cargas</th><th>Última</th><th></th></tr></thead>
                <tbody>
                  {clientesStats.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Cliente" style={{ fontWeight: 600 }}>{c.nombre}</td>
                      <td data-label="Localidad" style={{ color: C.ink2 }}>{c.localidad || "—"}</td>
                      <td data-label="Canal"><span className="pill" style={{ background: c.canal === "Directo" ? `${C.verde}1a` : `${C.amarillo}1a`, color: c.canal === "Directo" ? C.verde : C.amarillo }}>{c.canal}</span></td>
                      <td data-label="Tel" className="num" style={{ fontSize: 12.5 }}>{c.tel || "—"}</td>
                      <td data-label="Tn total" className="num" style={{ textAlign: "right" }}>{N(c.tn)}</td>
                      <td data-label="Margen" className="num" style={{ textAlign: "right", color: c.margen > 0 ? C.verde : C.ink2 }}>{$(c.margen)}</td>
                      <td data-label="Cargas" className="num" style={{ textAlign: "right" }}>{c.cargas}</td>
                      <td data-label="Última" className="num" style={{ fontSize: 12.5 }}>{c.ultima || "—"}</td>
                      <td data-label="" style={{ textAlign: "right" }}><button className="del" onClick={() => borrarCliente(c.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* REGISTRO DE CARGAS */}
        <Section tag="Operación" title="Registro de cargas">
          <div className="grid-form" style={{ marginBottom: 20 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Fecha</span>
              <div className="inputWrap">
                <input className="input" type="date" value={fFecha} onChange={(e) => setFFecha(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Modo</span>
              <div className="inputWrap selectWrap">
                <select className="input" value={fModo} onChange={(e) => setFModo(e.target.value)}>
                  <option value="bruta">Bruta</option><option value="grillada">Grillada</option>
                </select>
              </div>
            </label>
            <Field label="Bateas" value={fBateas} onChange={setFBateas} />
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cliente</span>
              <div className="inputWrap selectWrap">
                <select className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={fClienteId} onChange={(e) => elegirCliente(e.target.value)}>
                  <option value="">{clientes.length ? "Elegí…" : "Agregá un cliente ↓"}</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.localidad ? ` · ${c.localidad}` : ""}</option>)}
                </select>
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Canal</span>
              <div className="inputWrap selectWrap">
                <select className="input" value={fCanal} onChange={(e) => setFCanal(e.target.value)}>
                  <option>Socios</option><option>Directo</option>
                </select>
              </div>
            </label>
          </div>
          <button className="btn" style={{ marginBottom: 18 }} onClick={registrar}>+ Registrar carga</button>

          {registros.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "16px 0" }}>Todavía no cargaste ninguna operación. Registrá la primera arriba.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="reg">
                <thead><tr><th>Fecha</th><th>Modo</th><th>Bateas</th><th>Tn</th><th>Cliente</th><th>Canal</th><th style={{ textAlign: "right" }}>Margen</th><th></th></tr></thead>
                <tbody>
                  {registros.map((r) => {
                    const c = calcDia(cfg, r.modo, r.bateas);
                    return (
                      <tr key={r.id}>
                        <td data-label="Fecha" className="num" style={{ fontSize: 12.5 }}>{r.fecha}</td>
                        <td data-label="Modo"><span className="pill" style={{ background: r.modo === "grillada" ? `${C.accent}1a` : `${C.ink}0d`, color: r.modo === "grillada" ? C.accent : C.ink }}>{r.modo}</span></td>
                        <td data-label="Bateas" className="num">{r.bateas}</td>
                        <td data-label="Tn" className="num">{N(c.tn)}</td>
                        <td data-label="Cliente">{r.cliente}</td>
                        <td data-label="Canal"><span className="pill" style={{ background: r.canal === "Directo" ? `${C.verde}1a` : `${C.amarillo}1a`, color: r.canal === "Directo" ? C.verde : C.amarillo }}>{r.canal}</span></td>
                        <td data-label="Margen" className="num" style={{ textAlign: "right", color: c.margen >= 0 ? C.verde : C.rojo }}>{$(c.margen)}</td>
                        <td data-label="" style={{ textAlign: "right" }}><button className="del" onClick={() => borrar(r.id)}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* PROYECCIÓN */}
        <Section tag="Proyección" title={`Si cargás ${cfg.objetivoSemana} bateas/semana (${modo})`}>
          <div className="grid-3">
            <Kpi label="Por semana" value={$(proySem)} sub="margen de contribución" color={C.accent} />
            <Kpi label="Por mes" value={$(proyMes)} sub="≈ 4,33 semanas" color={C.accent} />
            <Kpi label="Por año" value={$(proyAnio)} sub="52 semanas" color={C.accent} />
          </div>
        </Section>

        {/* CONFIGURACIÓN */}
        {showCfg && (
          <Section tag="Parámetros" title="Supuestos editables"
            right={<button className="tog" onClick={() => setCfg({ ...DEFAULTS })}>Restablecer</button>}>
            <div className="grid-3" style={{ rowGap: 16 }}>
              <Field label="Precio bruta" value={cfg.precioBruta} onChange={setC("precioBruta")} suffix="$/tn" step={100} />
              <Field label="Precio grillada" value={cfg.precioGrillada} onChange={setC("precioGrillada")} suffix="$/tn" step={100} />
              <Field label="Comisión socios" value={cfg.comisionSocios} onChange={setC("comisionSocios")} suffix="%" />
              <Field label="Tn por batea" value={cfg.tnPorBatea} onChange={setC("tnPorBatea")} suffix="tn" />
              <Field label="Objetivo semanal" value={cfg.objetivoSemana} onChange={setC("objetivoSemana")} suffix="bateas" />
              <Field label="Regalía" value={cfg.regalia} onChange={setC("regalia")} suffix="%" />
              <Field label="Gasoil" value={cfg.gasoilPrecio} onChange={setC("gasoilPrecio")} suffix="$/L" step={50} />
              <Field label="Consumo pala" value={cfg.palaConsumo} onChange={setC("palaConsumo")} suffix="L/h" step={0.5} />
              <Field label="Reserva pala" value={cfg.palaReserva} onChange={setC("palaReserva")} suffix="$/h" step={500} />
              <Field label="Jornal" value={cfg.jornal} onChange={setC("jornal")} suffix="$/día" step={1000} />
              <Field label="Horas pala (bruta)" value={cfg.horasPalaBruta} onChange={setC("horasPalaBruta")} suffix="h" step={0.5} />
              <Field label="Horas pala (grillada)" value={cfg.horasPalaGrillada} onChange={setC("horasPalaGrillada")} suffix="h" step={0.5} />
              <Field label="Jornales (bruta)" value={cfg.jornalesBruta} onChange={setC("jornalesBruta")} />
              <Field label="Jornales (grillada)" value={cfg.jornalesGrillada} onChange={setC("jornalesGrillada")} />
              <Field label="Costo grilla" value={cfg.costoGrilla} onChange={setC("costoGrilla")} suffix="$" step={50000} />
            </div>
          </Section>
        )}

        <footer style={{ marginTop: 28, color: C.ink2, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em" }}>
          Los números se recalculan solos al editar supuestos. Datos guardados en este dispositivo.
        </footer>
      </div>
    </div>
  );
}

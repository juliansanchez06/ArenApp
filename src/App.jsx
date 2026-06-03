// ARENERA · PANEL DE CONTROL — un solo archivo JSX
// Deploy: proyecto Vite React -> reemplazá src/App.jsx por este archivo -> push a GitHub -> import en Vercel.
// Persistencia: localStorage (funciona en Vercel; en la vista previa del chat puede no guardar entre recargas).

import React, { useState, useEffect, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";

// Config del proyecto Firebase (las claves web son públicas por diseño; la seguridad la dan las reglas + el login)
const firebaseConfig = {
  apiKey: "AIzaSyCWeQ9rWcZGj_29LY14Ztb7fKXU0_6b6X8",
  authDomain: "arenapp-63a04.firebaseapp.com",
  projectId: "arenapp-63a04",
  storageBucket: "arenapp-63a04.firebasestorage.app",
  messagingSenderId: "1040391625845",
  appId: "1:1040391625845:web:4ea7857860180424ad6c3c",
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const msgAuth = (code) => ({
  "auth/invalid-email": "El email no es válido.",
  "auth/missing-password": "Falta la contraseña.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/email-already-in-use": "Ese email ya tiene una cuenta. Iniciá sesión.",
  "auth/invalid-credential": "Email o contraseña incorrectos.",
  "auth/user-not-found": "No existe una cuenta con ese email.",
  "auth/wrong-password": "Contraseña incorrecta.",
  "auth/too-many-requests": "Demasiados intentos. Esperá un momento.",
  "auth/network-request-failed": "Sin conexión. Revisá internet.",
}[code] || "No se pudo entrar. Revisá los datos e intentá de nuevo.");

/* ────────────────────────────────────────────────────────────
   SUPUESTOS POR DEFECTO (editables desde la app)
   ──────────────────────────────────────────────────────────── */
const DEFAULTS = {
  precioBruta: 9000,        // $/tn boca de pozo
  precioGrillada: 9000,     // $/tn (subilo cuando confirmes el corralón)
  comisionSocios: 30,       // %
  regalia: 3,               // % de boca de mina
  tnPorBatea: 30,           // tn
  objetivoMes: 12,          // bateas/mes
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
function calcDia(cfg, modo, tn, precioTn = null) {
  const precio = precioTn != null ? precioTn : (modo === "grillada" ? cfg.precioGrillada : cfg.precioBruta);
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
    margen, margenTn: tn ? margen / tn : 0,
  };
}

function amortGrillaTn(cfg) {
  const tnVida = cfg.tnPorBatea * cfg.objetivoMes * 12 * cfg.vidaGrillaAnios;
  return tnVida ? cfg.costoGrilla / tnVida : 0;
}

// neto $/tn de cada modo, a la escala del objetivo mensual
function netoTn(cfg, modo) {
  const r = calcDia(cfg, modo, cfg.objetivoMes * cfg.tnPorBatea);
  return r.margenTn;
}

// precio de grillada al que EMPATA con bruta (break-even para que valga grillar)
function breakEvenGrillada(cfg) {
  const factor = 1 - cfg.comisionSocios / 100 - cfg.regalia / 100;
  if (factor <= 0) return Infinity;
  const tn = cfg.objetivoMes * cfg.tnPorBatea;
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
  const tn = cfg.objetivoMes * cfg.tnPorBatea;
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
const tomorrowISO = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const fechaCorta = (iso) => { const d = new Date(iso + "T00:00:00"); return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const mesLabel = (key) => { const [y, m] = key.split("-"); return `${MESES[parseInt(m) - 1]} ${y}`; };

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

function Field({ label, value, onChange, suffix }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <div className="inputWrap">
        <input className="input" type="text" inputMode="decimal"
          value={value === null || value === undefined ? "" : value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
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
  const [programadas, setProgramadas] = useState(() => load("arenera_prog_v1", []));
  const [modo, setModo] = useState("bruta");
  const [bateas, setBateas] = useState(DEFAULTS.objetivoMes);
  const [showCfg, setShowCfg] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  const [cal, setCal] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [importErr, setImportErr] = useState("");
  const [pendingImport, setPendingImport] = useState(null);
  const [cfgDraft, setCfgDraft] = useState(() => ({ ...DEFAULTS, ...load("arenera_cfg_v1", {}) }));
  const [cfgSaved, setCfgSaved] = useState(false);
  const [mesSel, setMesSel] = useState("");

  // sesión
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [authErr, setAuthErr] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const hydrated = useRef(false);
  const remoteApplying = useRef(false);

  // form de carga
  const [fFecha, setFFecha] = useState(todayISO());
  const [fModo, setFModo] = useState("bruta");
  const [fBateas, setFBateas] = useState(1);
  const [fTn, setFTn] = useState(DEFAULTS.tnPorBatea);
  const [fClienteId, setFClienteId] = useState("");
  const [fCanal, setFCanal] = useState("Socios");
  const [fFromProg, setFFromProg] = useState(null);
  const [fPatente, setFPatente] = useState("");
  const [fPrecio, setFPrecio] = useState(DEFAULTS.precioBruta);

  // form de programar carga
  const [pFecha, setPFecha] = useState(tomorrowISO());
  const [pClienteId, setPClienteId] = useState("");
  const [pBateas, setPBateas] = useState(1);
  const [pTn, setPTn] = useState(DEFAULTS.tnPorBatea);
  const [pModo, setPModo] = useState("bruta");
  const [pNota, setPNota] = useState("");
  const [pPatente, setPPatente] = useState("");
  const [pPrecio, setPPrecio] = useState(DEFAULTS.precioBruta);

  // edición inline de precio
  const [editingRegId, setEditingRegId] = useState(null);
  const [editPrecio, setEditPrecio] = useState("");
  // cliente seleccionado para exportar
  const [clienteSel, setClienteSel] = useState("");

  // form de cliente
  const [cNombre, setCNombre] = useState("");
  const [cLocalidad, setCLocalidad] = useState("");
  const [cTel, setCTel] = useState("");
  const [cCanal, setCCanal] = useState("Socios");

  useEffect(() => save("arenera_prog_v1", programadas), [programadas]);

  useEffect(() => save("arenera_cfg_v1", cfg), [cfg]);
  useEffect(() => save("arenera_reg_v1", registros), [registros]);
  useEffect(() => save("arenera_cli_v1", clientes), [clientes]);

  // ── SESIÓN Y NUBE (Firebase) ──────────────────────────────
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); }), []);

  // cargar y escuchar en vivo los datos del usuario
  useEffect(() => {
    if (!user) { hydrated.current = false; return; }
    hydrated.current = false;
    const ref = doc(db, "areneras", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        remoteApplying.current = true;
        setCfg({ ...DEFAULTS, ...(d.cfg || {}) });
        setRegistros(Array.isArray(d.registros) ? d.registros : []);
        setClientes(Array.isArray(d.clientes) ? d.clientes : []);
        setProgramadas(Array.isArray(d.programadas) ? d.programadas : []);
        hydrated.current = true;
        setTimeout(() => { remoteApplying.current = false; }, 0);
      } else {
        setDoc(ref, { cfg, registros, clientes, programadas, updated: Date.now() }).catch(() => {});
        hydrated.current = true;
      }
    }, () => {});
    return () => unsub();
  }, [user]);

  // guardar cambios en la nube (con un respiro para no escribir en cada tecla)
  useEffect(() => {
    if (!user || !hydrated.current || remoteApplying.current) return;
    const ref = doc(db, "areneras", user.uid);
    const t = setTimeout(() => {
      setDoc(ref, { cfg, registros, clientes, programadas, updated: Date.now() }, { merge: true }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [cfg, registros, clientes, programadas, user]);

  async function entrar() {
    setAuthErr(""); setAuthBusy(true);
    try {
      if (authMode === "signup") await createUserWithEmailAndPassword(auth, authEmail.trim(), authPass);
      else await signInWithEmailAndPassword(auth, authEmail.trim(), authPass);
      setAuthPass("");
    } catch (e) { setAuthErr(msgAuth(e && e.code)); }
    setAuthBusy(false);
  }

  const setD = (k) => (v) => { setCfgDraft((d) => ({ ...d, [k]: v })); setCfgSaved(false); };
  const normCfg = (obj) => { const o = {}; for (const k in obj) { const v = obj[k]; o[k] = typeof v === "number" ? v : (parseFloat(v) || 0); } return o; };
  const cfgDirty = useMemo(() => JSON.stringify(normCfg(cfgDraft)) !== JSON.stringify(cfg), [cfgDraft, cfg]);
  function guardarCfg() {
    const norm = normCfg(cfgDraft);
    setCfg(norm);
    setCfgDraft(norm);
    setCfgSaved(true);
    setTimeout(() => setCfgSaved(false), 2500);
  }

  // toneladas de una carga: usa las guardadas, o estima por batea estándar (compatibilidad)
  const regTn = (r) => (r.tn != null ? r.tn : (parseFloat(r.bateas) || 0) * cfg.tnPorBatea);
  // precio cerrado de una carga: usa el guardado, o cae al supuesto actual (cargas viejas)
  const regPrecio = (r) => r.precioTn != null ? r.precioTn : (r.modo === "grillada" ? cfg.precioGrillada : cfg.precioBruta);

  const dia = useMemo(() => calcDia(cfg, modo, bateas * cfg.tnPorBatea), [cfg, modo, bateas]);
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

  // métricas del mes
  const stats = useMemo(() => {
    const now = new Date(); const m = now.getMonth(), y = now.getFullYear();
    let tnMes = 0, ingMes = 0, comMes = 0, costoMes = 0, margenMes = 0, tnDir = 0, batMes = 0;
    for (const r of registros) {
      const d = new Date(r.fecha + "T00:00:00");
      const calc = calcDia(cfg, r.modo, regTn(r), regPrecio(r));
      if (d.getMonth() === m && d.getFullYear() === y) {
        tnMes += calc.tn; ingMes += calc.ingresoBruto; comMes += calc.comision;
        costoMes += calc.costoTotal; margenMes += calc.margen; batMes += r.bateas;
        if (r.canal === "Directo") tnDir += calc.tn;
      }
    }
    return { tnMes, ingMes, comMes, costoMes, margenMes, tnDir, batMes,
      pctDir: tnMes ? (tnDir / tnMes) * 100 : 0, costoTn: tnMes ? costoMes / tnMes : 0 };
  }, [registros, cfg]);

  // alertas
  const programadasSort = useMemo(
    () => [...programadas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
    [programadas]
  );
  const pendientesConfirmar = useMemo(
    () => programadas.filter((p) => p.fecha <= todayISO()).length,
    [programadas]
  );

  const alertas = [];
  if (pendientesConfirmar > 0)
    alertas.push({ color: C.accent, t: `${pendientesConfirmar} carga(s) para confirmar`, d: "Llegó el día de cargas programadas. Confirmá si se hicieron o descartalas en 'Cargas programadas'." });
  if (cfg.precioBruta <= beB * 1.15)
    alertas.push({ color: C.rojo, t: "Precio cerca de pérdida", d: `La bruta no rinde por debajo de ~${$(beB)}/tn. Estás en zona de riesgo.` });
  if (cfg.precioGrillada === cfg.precioBruta)
    alertas.push({ color: C.amarillo, t: "Falta confirmar precio de grillada", d: `Llamá al corralón. Grillar conviene solo desde ~${$(beG)}/tn.` });
  if (stats.tnMes > 0 && stats.pctDir < 20)
    alertas.push({ color: C.amarillo, t: "Dependés de los socios", d: `Solo ${N(stats.pctDir)}% de las ventas del mes son directas. Cada tn directa recupera ${$(cfg.precioBruta * cfg.comisionSocios / 100)}/tn.` });
  if (stats.batMes >= cfg.objetivoMes)
    alertas.push({ color: C.verde, t: "Objetivo mensual cumplido", d: `${stats.batMes} bateas este mes. Cada batea extra el mismo día deja casi puro margen.` });

  const semDir = stats.pctDir > 50 ? C.verde : stats.pctDir >= 20 ? C.amarillo : C.rojo;
  const semBat = stats.batMes >= cfg.objetivoMes ? C.verde : stats.batMes >= Math.round(cfg.objetivoMes * 0.5) ? C.amarillo : C.rojo;
  const semMar = stats.margenMes > 0 ? C.verde : stats.margenMes < 0 ? C.rojo : C.amarillo;

  // historial por cliente (ordenado por margen, mejores arriba)
  const clientesStats = useMemo(() => {
    return clientes.map((cl) => {
      let tn = 0, margen = 0, cargas = 0, ultima = null;
      for (const r of registros) {
        if (r.clienteId !== cl.id) continue;
        const c = calcDia(cfg, r.modo, regTn(r), regPrecio(r));
        tn += c.tn; margen += c.margen; cargas += 1;
        if (!ultima || r.fecha > ultima) ultima = r.fecha;
      }
      return { ...cl, tn, margen, cargas, ultima };
    }).sort((a, b) => b.margen - a.margen);
  }, [clientes, registros, cfg]);

  // resumen por mes (más reciente arriba)
  const resumenMeses = useMemo(() => {
    const map = {};
    for (const r of registros) {
      const key = r.fecha.slice(0, 7);
      const c = calcDia(cfg, r.modo, regTn(r), regPrecio(r));
      if (!map[key]) map[key] = { key, tn: 0, bruto: 0, comision: 0, costo: 0, margen: 0, bateas: 0, cargas: 0 };
      const o = map[key];
      o.tn += c.tn; o.bruto += c.ingresoBruto; o.comision += c.comision;
      o.costo += c.costoTotal; o.margen += c.margen; o.bateas += r.bateas; o.cargas += 1;
    }
    return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [registros, cfg]);

  const mesActivo = mesSel || (resumenMeses[0] ? resumenMeses[0].key : "");

  const resumenPorCliente = useMemo(() => {
    if (!mesActivo) return [];
    const map = {};
    for (const r of registros) {
      if (r.fecha.slice(0, 7) !== mesActivo) continue;
      const tn = r.tn != null ? r.tn : (parseFloat(r.bateas) || 0) * cfg.tnPorBatea;
      const p = r.precioTn;
      const ingreso = p != null ? tn * p : null;
      const k = r.clienteId || r.cliente;
      if (!map[k]) map[k] = { clienteId: r.clienteId, nombre: r.cliente, cargas: [], tn: 0, ingreso: 0, pendiente: false };
      map[k].cargas.push({ fecha: r.fecha, bateas: r.bateas, tn, precioTn: p, modo: r.modo, patente: r.patente, ingreso });
      map[k].tn += tn;
      if (ingreso != null) map[k].ingreso += ingreso; else map[k].pendiente = true;
    }
    return Object.values(map).sort((a, b) => (a.nombre < b.nombre ? -1 : 1));
  }, [registros, cfg, mesActivo]);

  // datos del calendario del mes visible
  const calData = useMemo(() => {
    const days = {};
    for (const r of registros) {
      const d = new Date(r.fecha + "T00:00:00");
      if (d.getFullYear() === cal.y && d.getMonth() === cal.m) {
        const day = d.getDate();
        const c = calcDia(cfg, r.modo, regTn(r), regPrecio(r));
        if (!days[day]) days[day] = { tn: 0, bateas: 0, cargas: 0 };
        days[day].tn += c.tn; days[day].bateas += r.bateas; days[day].cargas += 1;
      }
    }
    const offset = (new Date(cal.y, cal.m, 1).getDay() + 6) % 7;
    const ndays = new Date(cal.y, cal.m + 1, 0).getDate();
    const vals = Object.values(days).map((d) => d.tn);
    const maxTn = vals.length ? Math.max(...vals) : 1;
    const tnMes = vals.reduce((a, b) => a + b, 0);
    return { days, offset, ndays, maxTn, tnMes };
  }, [registros, cfg, cal]);

  // picos de extracción (últimos 12 meses, tn por mes)
  const picos = useMemo(() => {
    const arr = [...resumenMeses].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-12);
    const max = arr.length ? Math.max(...arr.map((m) => m.tn)) : 1;
    return { arr, max };
  }, [resumenMeses]);

  function calNav(delta) {
    setCal((c) => { let m = c.m + delta, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  }

  // proyección
  const proyMes = calcDia(cfg, modo, cfg.objetivoMes * cfg.tnPorBatea).margen;
  const proyAnio = proyMes * 12;

  // al cambiar bateas, autocompleta toneladas con la batea estándar (editable aparte)
  const setBateasReg = (v) => { setFBateas(v); setFTn(String((parseFloat(v) || 0) * cfg.tnPorBatea)); };
  const setBateasProg = (v) => { setPBateas(v); setPTn(String((parseFloat(v) || 0) * cfg.tnPorBatea)); };

  function resetFormCarga() {
    setFBateas(1); setFTn(cfg.tnPorBatea); setFFromProg(null); setFPatente(""); setFPrecio("");
  }

  function registrar() {
    const b = parseFloat(fBateas) || 0;
    const tn = parseFloat(fTn) || 0;
    const precio = parseFloat(fPrecio) > 0 ? parseFloat(fPrecio) : null;
    if (tn <= 0 || !fClienteId) return;
    const cl = clientes.find((c) => String(c.id) === String(fClienteId));
    setRegistros((rs) => [
      { id: Date.now(), fecha: fFecha, modo: fModo, bateas: b, tn, precioTn: precio,
        clienteId: fClienteId, cliente: cl ? cl.nombre : "—", canal: fCanal,
        patente: fPatente.trim() },
      ...rs,
    ]);
    if (fFromProg) setProgramadas((ps) => ps.filter((x) => x.id !== fFromProg));
    resetFormCarga();
  }
  function borrar(id) { setRegistros((rs) => rs.filter((r) => r.id !== id)); }

  function guardarEditPrecio(id) {
    const p = parseFloat(editPrecio);
    setRegistros((rs) => rs.map((r) => r.id === id ? { ...r, precioTn: p > 0 ? p : null } : r));
    setEditingRegId(null); setEditPrecio("");
  }

  function programar() {
    const b = parseFloat(pBateas) || 0;
    const tn = parseFloat(pTn) || 0;
    const precio = parseFloat(pPrecio) > 0 ? parseFloat(pPrecio) : null;
    if (tn <= 0 || !pClienteId || !pFecha) return;
    const cl = clientes.find((c) => String(c.id) === String(pClienteId));
    setProgramadas((ps) => [
      ...ps,
      { id: Date.now(), fecha: pFecha, clienteId: pClienteId, cliente: cl ? cl.nombre : "—",
        canal: cl ? cl.canal : "Socios", bateas: b, tn, precioTn: precio, modo: pModo,
        nota: pNota.trim(), patente: pPatente.trim() },
    ]);
    setPBateas(1); setPTn(cfg.tnPorBatea); setPNota(""); setPClienteId(""); setPPatente(""); setPPrecio("");
  }
  function descartarProgramada(id) { setProgramadas((ps) => ps.filter((p) => p.id !== id)); }

  // "Se hizo": pasa la carga al formulario de registro para confirmar/ajustar toneladas
  function prepararDesdeProg(p) {
    setFFecha(p.fecha); setFClienteId(p.clienteId); setFCanal(p.canal || "Socios");
    setFModo(p.modo); setFBateas(p.bateas);
    setFTn(p.tn != null ? p.tn : (parseFloat(p.bateas) || 0) * cfg.tnPorBatea);
    setFPatente(p.patente || "");
    setFPrecio(p.precioTn != null ? String(p.precioTn) : "");
    setFFromProg(p.id);
    const el = document.getElementById("formCarga");
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function mensajeProg(p) {
    const tn = p.tn != null ? p.tn : (parseFloat(p.bateas) || 0) * cfg.tnPorBatea;
    let m = `*Carga El Retiro* — ${fechaCorta(p.fecha)}\n`;
    m += `Cliente: ${p.cliente}\n`;
    m += `${p.bateas} batea(s) · arena ${p.modo} · ${N(tn)} tn · ${$(p.precioTn != null ? p.precioTn : (p.modo === "grillada" ? cfg.precioGrillada : cfg.precioBruta))}/tn`;
    if (p.patente) m += `\nCamión: ${p.patente}`;
    if (p.nota) m += `\nNota: ${p.nota}`;
    return m;
  }
  function enviarOperario(p) {
    const txt = mensajeProg(p);
    try {
      if (navigator.share) { navigator.share({ text: txt }).catch(() => {}); return; }
    } catch {}
    window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
  }

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

  function descargar(nombre, contenido, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function exportarResumenCSV() {
    try {
      const sep = ";";
      const head = ["Mes", "Bateas", "Toneladas", "Ingreso bruto", "Comision socios", "Costo", "Margen"];
      const filas = [...resumenMeses].sort((a, b) => (a.key < b.key ? -1 : 1)).map((m) => [
        mesLabel(m.key), m.bateas, Math.round(m.tn), Math.round(m.bruto), Math.round(m.comision), Math.round(m.costo), Math.round(m.margen),
      ]);
      const csv = "\uFEFF" + [head, ...filas].map((r) => r.join(sep)).join("\n");
      descargar(`el-retiro-resumen-${todayISO()}.csv`, csv, "text/csv;charset=utf-8;");
    } catch {}
  }

  async function dibujarResumen(key) {
    const m = resumenMeses.find((x) => x.key === key);
    if (!m) return null;
    const W = 900, H = 700, s = 2;
    const cv = document.createElement("canvas");
    cv.width = W * s; cv.height = H * s;
    const ctx = cv.getContext("2d");
    ctx.scale(s, s);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#540c18"; ctx.fillRect(0, 0, W, 12);
    ctx.textBaseline = "alphabetic";

    // intentar cargar el logo
    let logoY = 108;
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image(); i.crossOrigin = "anonymous";
        i.onload = () => res(i); i.onerror = rej;
        i.src = "/logo.png";
      });
      const lh = 90, lw = Math.round(lh * img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, (W - lw) / 2, 20, lw, lh);
      logoY = 128;
    } catch {
      ctx.fillStyle = "#540c18";
      ctx.font = "800 42px Archivo, Arial, sans-serif";
      ctx.fillText("EL RETIRO", 48, 88);
      logoY = 116;
    }
    ctx.fillStyle = "#7a736b";
    ctx.font = "600 15px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("RESUMEN MENSUAL · SOL DE JULIO", W / 2, logoY);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1a1714";
    ctx.font = "800 36px Archivo, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(mesLabel(key), W / 2, logoY + 46);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#e6e2da"; ctx.lineWidth = 1;
    const divY = logoY + 64;
    ctx.beginPath(); ctx.moveTo(48, divY); ctx.lineTo(W - 48, divY); ctx.stroke();

    const rowOut = (y, label, value, opts = {}) => {
      ctx.textAlign = "left";
      ctx.fillStyle = opts.lblColor || "#7a736b";
      ctx.font = (opts.big ? "700 " : "500 ") + (opts.big ? "26px" : "22px") + " Archivo, Arial, sans-serif";
      ctx.fillText(label, 48, y);
      ctx.textAlign = "right";
      ctx.fillStyle = opts.valColor || "#1a1714";
      ctx.font = "700 " + (opts.big ? "30px" : "24px") + " 'IBM Plex Mono', monospace";
      ctx.fillText(value, W - 48, y);
      ctx.textAlign = "left";
    };

    let y = divY + 52;
    rowOut(y, "Bateas cargadas", N(m.bateas)); y += 50;
    rowOut(y, "Toneladas", `${N(m.tn)} tn`); y += 60;
    ctx.strokeStyle = "#e6e2da"; ctx.beginPath(); ctx.moveTo(48, y - 24); ctx.lineTo(W - 48, y - 24); ctx.stroke();
    rowOut(y, "Ingreso bruto", `$${N(m.bruto)}`); y += 50;
    rowOut(y, "Comisión socios", `− $${N(m.comision)}`, { valColor: "#dc2626" }); y += 50;
    rowOut(y, "Costo operativo", `− $${N(m.costo)}`, { valColor: "#dc2626" }); y += 70;

    ctx.fillStyle = "#540c1810"; ctx.fillRect(40, y - 44, W - 80, 64);
    rowOut(y, "Margen del mes", `$${N(m.margen)}`, { big: true, lblColor: "#1a1714", valColor: m.margen >= 0 ? "#15803d" : "#dc2626" });

    ctx.textAlign = "left";
    ctx.fillStyle = "#7a736b";
    ctx.font = "500 14px 'IBM Plex Mono', monospace";
    ctx.fillText(`Generado ${todayISO()} · ${m.cargas} carga(s) en el mes`, 48, H - 36);
    return cv;
  }

  async function esperarFuentes() { try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {} }


  async function dibujarResumenCliente(mesKey, clienteData) {
    const rowH = 46, headerH = 220, footerH = 70;
    const W = 900, H = headerH + rowH * (clienteData.cargas.length + 1) + footerH, s = 2;
    const cv = document.createElement("canvas");
    cv.width = W * s; cv.height = H * s;
    const ctx = cv.getContext("2d");
    ctx.scale(s, s);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#540c18"; ctx.fillRect(0, 0, W, 10);
    ctx.textBaseline = "alphabetic";
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = "/logo.png"; });
      const lh = 64, lw = Math.round(lh * img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, (W - lw) / 2, 16, lw, lh);
    } catch {
      ctx.fillStyle = "#540c18"; ctx.font = "800 32px Archivo, Arial, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("EL RETIRO", W / 2, 58); ctx.textAlign = "left";
    }
    ctx.fillStyle = "#7a736b"; ctx.font = "600 14px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText("LIQUIDACION MENSUAL - " + mesLabel(mesKey).toUpperCase(), W / 2, 96);
    ctx.fillStyle = "#1a1714"; ctx.font = "700 26px Archivo, Arial, sans-serif";
    ctx.fillText(clienteData.nombre.toUpperCase(), W / 2, 132);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#e6e2da"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(48, 152); ctx.lineTo(W - 48, 152); ctx.stroke();
    const cols = [48, 170, 300, 420, 570, W - 48];
    const aligns = ["left", "left", "right", "right", "right", "right"];
    let ty = 186;
    ["FECHA", "MODO", "BATEAS", "TONELADAS", "PRECIO/TN", "SUBTOTAL"].forEach(function(h, i) {
      ctx.textAlign = aligns[i]; ctx.fillStyle = "#7a736b"; ctx.font = "600 12px IBM Plex Mono, monospace";
      ctx.fillText(h, cols[i], ty);
    });
    ctx.beginPath(); ctx.moveTo(48, ty + 10); ctx.lineTo(W - 48, ty + 10); ctx.stroke();
    ty += 32;
    for (var ci = 0; ci < clienteData.cargas.length; ci++) {
      var c = clienteData.cargas[ci];
      var vals = [fechaCorta(c.fecha), c.modo, String(c.bateas), N(c.tn) + " tn", c.precioTn != null ? "$" + N(c.precioTn) : "A definir", c.ingreso != null ? "$" + N(c.ingreso) : "--"];
      vals.forEach(function(v, i) {
        ctx.textAlign = aligns[i];
        ctx.fillStyle = (i === 4 && c.precioTn == null) ? "#ca8a04" : "#1a1714";
        ctx.font = "500 14px Archivo, Arial, sans-serif";
        ctx.fillText(v, cols[i], ty);
      });
      ctx.strokeStyle = "#e6e2da"; ctx.beginPath(); ctx.moveTo(48, ty + 10); ctx.lineTo(W - 48, ty + 10); ctx.stroke();
      ty += rowH;
    }
    ctx.fillStyle = "#540c1812"; ctx.fillRect(40, ty - 4, W - 80, 54);
    ctx.textAlign = "left"; ctx.fillStyle = "#1a1714"; ctx.font = "700 15px Archivo, Arial, sans-serif";
    ctx.fillText("TOTAL", 60, ty + 22);
    ctx.font = "500 13px IBM Plex Mono, monospace"; ctx.fillStyle = "#7a736b";
    ctx.fillText(N(clienteData.tn) + " tn - " + clienteData.cargas.length + " carga(s)", 60, ty + 40);
    ctx.textAlign = "right"; ctx.fillStyle = "#15803d"; ctx.font = "700 18px IBM Plex Mono, monospace";
    ctx.fillText(clienteData.pendiente ? "$" + N(clienteData.ingreso) + " + pendiente" : "$" + N(clienteData.ingreso), W - 48, ty + 26);
    ctx.textAlign = "left"; ctx.fillStyle = "#b0a89a"; ctx.font = "500 12px IBM Plex Mono, monospace";
    ctx.fillText("Generado " + todayISO() + " - El Retiro - Sol de Julio", 48, H - 22);
    return cv;
  }

  async function compartirImagenCliente() {
    var cl = resumenPorCliente.find(function(c) { return (c.clienteId || c.nombre) === clienteSel; });
    if (!cl || !mesActivo) return;
    await esperarFuentes();
    var cv = await dibujarResumenCliente(mesActivo, cl);
    if (!cv) return;
    var nombre = "liquidacion-" + cl.nombre.replace(/\s+/g, "-") + "-" + mesActivo + ".png";
    cv.toBlob(async function(blob) {
      if (!blob) return;
      try { var f = new File([blob], nombre, { type: "image/png" }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "Liquidacion " + cl.nombre }); return; } } catch(e) {}
      var url = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, "image/png");
  }

  function exportarClienteCSV() {
    var cl = resumenPorCliente.find(function(c) { return (c.clienteId || c.nombre) === clienteSel; });
    if (!cl || !mesActivo) return;
    var sep = ";";
    var head = ["Fecha", "Modo", "Bateas", "Toneladas", "Precio/tn", "Subtotal"];
    var filas = cl.cargas.map(function(c) { return [fechaCorta(c.fecha), c.modo, c.bateas, Math.round(c.tn), c.precioTn != null ? c.precioTn : "A definir", c.ingreso != null ? Math.round(c.ingreso) : ""]; });
    var total = ["TOTAL", "", cl.cargas.length + " cargas", Math.round(cl.tn), "", Math.round(cl.ingreso)];
    var csv = "\uFEFF" + [head].concat(filas).concat([total]).map(function(r) { return r.join(sep); }).join("\n");
    descargar("liquidacion-" + cl.nombre.replace(/\s+/g, "-") + "-" + mesActivo + ".csv", csv, "text/csv;charset=utf-8;");
  }

  async function compartirImagen() {
    if (!mesActivo) return;
    await esperarFuentes();
    const cv = await dibujarResumen(mesActivo);
    if (!cv) return;
    cv.toBlob(async (blob) => {
      if (!blob) return;
      const nombre = `el-retiro-resumen-${mesActivo}.png`;
      try {
        const file = new File([blob], nombre, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `Resumen ${mesLabel(mesActivo)}` });
          return;
        }
      } catch {}
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, "image/png");
  }

  async function pdfResumen() {
    if (!mesActivo) return;
    await esperarFuentes();
    const cv = await dibujarResumen(mesActivo);
    if (!cv) return;
    const data = cv.toDataURL("image/png");
    const w = window.open("", "_blank");
    if (!w) {
      const a = document.createElement("a"); a.href = data; a.download = `el-retiro-resumen-${mesActivo}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    w.document.write(`<html><head><title>Resumen ${mesLabel(mesActivo)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:12mm;}body{margin:0;text-align:center;}img{width:100%;max-width:760px;}</style></head><body><img src="${data}" onload="setTimeout(function(){window.print();},250)"/></body></html>`);
    w.document.close();
  }

  function exportar() {
    try {
      const data = { app: "El Retiro", version: 1, fecha: new Date().toISOString(), cfg, registros, clientes, programadas };
      descargar(`el-retiro-respaldo-${todayISO()}.json`, JSON.stringify(data, null, 2), "application/json");
      setImportErr("");
    } catch { setImportErr("No se pudo exportar en este navegador."); }
  }

  function archivoElegido(e) {
    setImportErr("");
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.registros)) throw new Error();
        setPendingImport(data);
      } catch { setImportErr("El archivo no es un respaldo válido de El Retiro."); }
    };
    reader.onerror = () => setImportErr("No se pudo leer el archivo.");
    reader.readAsText(file);
    e.target.value = "";
  }

  function confirmarImport() {
    if (!pendingImport) return;
    if (pendingImport.cfg) { const nc = { ...DEFAULTS, ...pendingImport.cfg }; setCfg(nc); setCfgDraft(nc); }
    setRegistros(Array.isArray(pendingImport.registros) ? pendingImport.registros : []);
    setClientes(Array.isArray(pendingImport.clientes) ? pendingImport.clientes : []);
    setProgramadas(Array.isArray(pendingImport.programadas) ? pendingImport.programadas : []);
    setPendingImport(null);
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
        .navbtn { border:1px solid ${C.line}; background:${C.bg}; color:${C.ink}; cursor:pointer; width:32px; height:32px; border-radius:8px; font-size:18px; line-height:1; }
        .navbtn:hover { border-color:${C.accent}; color:${C.accent}; }
        .cal { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
        .cal-h { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:${C.ink2}; text-align:center; padding-bottom:2px; }
        .cal-d { aspect-ratio:1; border:1px solid ${C.line}; border-radius:9px; padding:6px; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
        .cal-d.empty { border:0; }
        .barswrap { overflow-x:auto; }
        .bars { display:flex; align-items:flex-end; gap:10px; height:180px; min-width:100%; padding-top:18px; }
        .bar-col { flex:1; min-width:36px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; position:relative; }
        .bar { width:100%; border-radius:6px 6px 0 0; min-height:3px; }
        @media (max-width:860px){
          .grid-kpi{ grid-template-columns:repeat(2,1fr);} .grid-2{ grid-template-columns:1fr;}
          .grid-3{ grid-template-columns:1fr;} .grid-form{ grid-template-columns:1fr 1fr;}
        }
        @media (max-width:560px){
          .cal { gap:4px; }
          .cal-d { padding:4px; border-radius:7px; }
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

      {!authReady ? (
        <div className="app" style={{ paddingTop: 90, textAlign: "center", color: C.ink2, fontFamily: "'IBM Plex Mono',monospace" }}>Cargando…</div>
      ) : !user ? (
        <div className="app" style={{ maxWidth: 430 }}>
          <div style={{ marginTop: 36, marginBottom: 22, textAlign: "center" }}>
            {logoOk ? (
              <img src="/logo.png" alt="El Retiro" onError={() => setLogoOk(false)}
                style={{ width: "min(240px, 70%)", height: "auto", display: "block", margin: "0 auto" }} />
            ) : (
              <h1 style={{ margin: 0, fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", color: C.accent }}>EL RETIRO</h1>
            )}
            <div className="label" style={{ marginTop: 12 }}>Panel de control · Arenera · Sol de Julio</div>
          </div>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 18, fontFamily: "Archivo, sans-serif" }}>{authMode === "signup" ? "Crear cuenta" : "Iniciar sesión"}</div>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Email</span>
              <div className="inputWrap"><input className="input" style={{ fontFamily: "Archivo, sans-serif" }} type="email" inputMode="email" autoCapitalize="none" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} /></div>
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Contraseña</span>
              <div className="inputWrap"><input className="input" style={{ fontFamily: "Archivo, sans-serif" }} type="password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") entrar(); }} /></div>
            </label>
            {authErr && <div style={{ color: C.rojo, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{authErr}</div>}
            <button className="btn" style={{ width: "100%" }} disabled={authBusy} onClick={entrar}>{authBusy ? "Entrando…" : (authMode === "signup" ? "Crear cuenta" : "Entrar")}</button>
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: C.ink2 }}>
              {authMode === "signup" ? "¿Ya tenés cuenta? " : "¿Primera vez? "}
              <button onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthErr(""); }} style={{ border: 0, background: "transparent", color: C.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{authMode === "signup" ? "Iniciar sesión" : "Crear cuenta"}</button>
            </div>
          </div>
        </div>
      ) : (
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
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="tog" onClick={() => { if (!showCfg) { setCfgDraft(cfg); setCfgSaved(false); } setShowCfg((s) => !s); }}>{showCfg ? "Ocultar supuestos" : "Editar supuestos"}</button>
              <button className="tog" onClick={() => signOut(auth)}>Salir</button>
            </div>
          </div>
        </header>

        {/* CONFIGURACIÓN (se abre debajo del botón Editar supuestos) */}
        {showCfg && (
          <Section tag="Parámetros" title="Supuestos editables"
            right={<button className="tog" onClick={() => setCfgDraft({ ...DEFAULTS })}>Restablecer</button>}>
            <div className="grid-3" style={{ rowGap: 16 }}>
              <Field label="Precio bruta" value={cfgDraft.precioBruta} onChange={setD("precioBruta")} suffix="$/tn" />
              <Field label="Precio grillada" value={cfgDraft.precioGrillada} onChange={setD("precioGrillada")} suffix="$/tn" />
              <Field label="Comisión socios" value={cfgDraft.comisionSocios} onChange={setD("comisionSocios")} suffix="%" />
              <Field label="Tn por batea" value={cfgDraft.tnPorBatea} onChange={setD("tnPorBatea")} suffix="tn" />
              <Field label="Objetivo mensual" value={cfgDraft.objetivoMes} onChange={setD("objetivoMes")} suffix="bateas" />
              <Field label="Regalía" value={cfgDraft.regalia} onChange={setD("regalia")} suffix="%" />
              <Field label="Gasoil" value={cfgDraft.gasoilPrecio} onChange={setD("gasoilPrecio")} suffix="$/L" />
              <Field label="Consumo pala" value={cfgDraft.palaConsumo} onChange={setD("palaConsumo")} suffix="L/h" />
              <Field label="Reserva pala" value={cfgDraft.palaReserva} onChange={setD("palaReserva")} suffix="$/h" />
              <Field label="Jornal" value={cfgDraft.jornal} onChange={setD("jornal")} suffix="$/día" />
              <Field label="Horas pala (bruta)" value={cfgDraft.horasPalaBruta} onChange={setD("horasPalaBruta")} suffix="h" />
              <Field label="Horas pala (grillada)" value={cfgDraft.horasPalaGrillada} onChange={setD("horasPalaGrillada")} suffix="h" />
              <Field label="Jornales (bruta)" value={cfgDraft.jornalesBruta} onChange={setD("jornalesBruta")} />
              <Field label="Jornales (grillada)" value={cfgDraft.jornalesGrillada} onChange={setD("jornalesGrillada")} />
              <Field label="Costo grilla" value={cfgDraft.costoGrilla} onChange={setD("costoGrilla")} suffix="$" />
            </div>
            <div className="row" style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}`, alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <button className="btn" style={{ background: cfgDirty ? C.accent : C.ink2, cursor: cfgDirty ? "pointer" : "default" }} disabled={!cfgDirty} onClick={guardarCfg}>Guardar supuestos</button>
              {cfgSaved && <span className="num" style={{ fontSize: 13, color: C.verde }}>✓ Guardado</span>}
              {!cfgSaved && cfgDirty && <span className="num" style={{ fontSize: 13, color: C.amarillo }}>Cambios sin guardar</span>}
              {!cfgSaved && !cfgDirty && <span style={{ fontSize: 13, color: C.ink2 }}>Los números de toda la app usan estos valores guardados.</span>}
            </div>
          </Section>
        )}

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
          <Kpi label="Bateas este mes" value={`${stats.batMes} / ${cfg.objetivoMes}`} sub="objetivo mensual" color={semBat} />
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
              <input type="range" min={1} max={30} value={bateas} onChange={(e) => setBateas(parseInt(e.target.value))}
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
              <span>{$(bateas ? dia.margen / bateas : 0)} / batea</span><span>{$(dia.margenTn)} / tn</span>
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

        {/* CARGAS PROGRAMADAS */}
        <Section tag="Agenda" title="Cargas programadas"
          right={<span className="label">{programadas.length} en agenda</span>}>
          <div className="grid-form" style={{ marginBottom: 20 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Día</span>
              <div className="inputWrap">
                <input className="input" type="date" value={pFecha} onChange={(e) => setPFecha(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cliente</span>
              <div className="inputWrap selectWrap">
                <select className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={pClienteId} onChange={(e) => setPClienteId(e.target.value)}>
                  <option value="">{clientes.length ? "Elegí…" : "Agregá un cliente ↓"}</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.localidad ? ` · ${c.localidad}` : ""}</option>)}
                </select>
              </div>
            </label>
            <Field label="Bateas" value={pBateas} onChange={setBateasProg} />
            <Field label="Toneladas" value={pTn} onChange={setPTn} suffix="tn" />
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Modo</span>
              <div className="inputWrap selectWrap">
                <select className="input" value={pModo} onChange={(e) => { const m = e.target.value; setPModo(m); setPPrecio(String(m === "grillada" ? cfg.precioGrillada : cfg.precioBruta)); }}>
                  <option value="bruta">Bruta</option><option value="grillada">Grillada</option>
                </select>
              </div>
            </label>
            <Field label="Precio/tn" value={pPrecio} onChange={setPPrecio} suffix="$" />
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Nota</span>
              <div className="inputWrap">
                <input className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={pNota} placeholder="opcional…" onChange={(e) => setPNota(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Patente</span>
              <div className="inputWrap">
                <input className="input" style={{ fontFamily: "Archivo, sans-serif", textTransform: "uppercase" }} value={pPatente} placeholder="ABC 123" onChange={(e) => setPPatente(e.target.value.toUpperCase())} />
              </div>
            </label>
          </div>
          <button className="btn" style={{ marginBottom: 18 }} onClick={programar}>+ Programar carga</button>

          {programadasSort.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "8px 0" }}>No tenés cargas agendadas. Programá la próxima arriba y mandásela al palero.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {programadasSort.map((p) => {
                const hoy = todayISO();
                const estado = p.fecha < hoy ? { c: C.rojo, t: "Pendiente de confirmar" } : p.fecha === hoy ? { c: C.amarillo, t: "Es hoy" } : { c: C.accent, t: "Programada" };
                const tn = p.tn != null ? p.tn : (parseFloat(p.bateas) || 0) * cfg.tnPorBatea;
                return (
                  <div key={p.id} style={{ border: `1px solid ${C.line}`, borderLeft: `4px solid ${estado.c}`, borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 180 }}>
                      <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 4 }}>
                        <span className="num" style={{ fontSize: 15, color: C.ink }}>{fechaCorta(p.fecha)}</span>
                        <span className="pill" style={{ background: `${estado.c}1a`, color: estado.c }}>{estado.t}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{p.cliente}</div>
                      <div className="num" style={{ fontSize: 12.5, color: C.ink2, marginTop: 2 }}>{p.bateas} batea(s) · {p.modo} · {N(tn)} tn · {$(p.precioTn != null ? p.precioTn : (p.modo === "grillada" ? cfg.precioGrillada : cfg.precioBruta))}/tn{p.patente ? ` · ${p.patente}` : ""}</div>
                      {p.nota && <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 4, fontStyle: "italic" }}>“{p.nota}”</div>}
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <button className="tog" onClick={() => enviarOperario(p)}>Enviar al palero</button>
                      <button className="tog" style={{ background: C.verde, color: "#fff", borderColor: C.verde }} onClick={() => prepararDesdeProg(p)}>Se hizo →</button>
                      <button className="tog" onClick={() => descartarProgramada(p.id)}>No se hizo</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* REGISTRO DE CARGAS */}
        <Section tag="Operación" title="Registro de cargas">
          <div id="formCarga" className="grid-form" style={{ marginBottom: 20 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Fecha</span>
              <div className="inputWrap">
                <input className="input" type="date" value={fFecha} onChange={(e) => setFFecha(e.target.value)} />
              </div>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Modo</span>
              <div className="inputWrap selectWrap">
                <select className="input" value={fModo} onChange={(e) => { const m = e.target.value; setFModo(m); setFPrecio(String(m === "grillada" ? cfg.precioGrillada : cfg.precioBruta)); }}>
                  <option value="bruta">Bruta</option><option value="grillada">Grillada</option>
                </select>
              </div>
            </label>
            <Field label="Bateas" value={fBateas} onChange={setBateasReg} />
            <Field label="Toneladas" value={fTn} onChange={setFTn} suffix="tn" />
            <Field label="Precio/tn" value={fPrecio} onChange={setFPrecio} suffix="$" />
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
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 11.5, color: C.ink2, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Patente</span>
              <div className="inputWrap">
                <input className="input" style={{ fontFamily: "Archivo, sans-serif", textTransform: "uppercase" }} value={fPatente} placeholder="ABC 123" onChange={(e) => setFPatente(e.target.value.toUpperCase())} />
              </div>
            </label>
          </div>
          {fFromProg && (
            <div style={{ background: `${C.amarillo}12`, borderLeft: `4px solid ${C.amarillo}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: C.ink2 }}>
              Viene de una carga programada. Revisá las <b>toneladas reales</b> (por si vino una batea más chica) y tocá Registrar.
            </div>
          )}
          {editingRegId && (() => {
            const r = registros.find((x) => x.id === editingRegId);
            return r ? (
              <div style={{ background: `${C.amarillo}12`, border: `1px solid ${C.amarillo}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
                <div className="label" style={{ marginBottom: 8 }}>Editar precio — {r.cliente} · {fechaCorta(r.fecha)}</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field label="Precio/tn" value={editPrecio} onChange={setEditPrecio} suffix="$" />
                  <button className="btn" style={{ background: C.accent, width: "auto" }} onClick={() => guardarEditPrecio(editingRegId)}>Guardar</button>
                  <button className="tog" onClick={() => { setEditingRegId(null); setEditPrecio(""); }}>Cancelar</button>
                </div>
              </div>
            ) : null;
          })()}
          <button className="btn" style={{ marginBottom: 18 }} onClick={registrar}>+ Registrar carga</button>

          {registros.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "16px 0" }}>Todavía no cargaste ninguna operación. Registrá la primera arriba.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="reg">
                <thead><tr><th>Fecha</th><th>Modo</th><th>Bateas</th><th>Tn</th><th>$/tn</th><th>Cliente</th><th>Patente</th><th>Canal</th><th style={{ textAlign: "right" }}>Margen</th><th></th></tr></thead>
                <tbody>
                  {registros.map((r) => {
                    const c = calcDia(cfg, r.modo, regTn(r), regPrecio(r));
                    return (
                      <tr key={r.id}>
                        <td data-label="Fecha" className="num" style={{ fontSize: 12.5 }}>{r.fecha}</td>
                        <td data-label="Modo"><span className="pill" style={{ background: r.modo === "grillada" ? `${C.accent}1a` : `${C.ink}0d`, color: r.modo === "grillada" ? C.accent : C.ink }}>{r.modo}</span></td>
                        <td data-label="Bateas" className="num">{r.bateas}</td>
                        <td data-label="Tn" className="num">{N(c.tn)}</td>
                        <td data-label="$/tn" className="num" style={{ fontSize: 12.5, color: r.precioTn == null ? C.amarillo : C.ink }}>{r.precioTn != null ? $(r.precioTn) : "A definir"}</td>
                        <td data-label="Cliente">{r.cliente}</td>
                        <td data-label="Patente" className="num" style={{ fontSize: 12.5 }}>{r.patente || "—"}</td>
                        <td data-label="Canal"><span className="pill" style={{ background: r.canal === "Directo" ? `${C.verde}1a` : `${C.amarillo}1a`, color: r.canal === "Directo" ? C.verde : C.amarillo }}>{r.canal}</span></td>
                        <td data-label="Margen" className="num" style={{ textAlign: "right", color: c.margen >= 0 ? C.verde : C.rojo }}>{$(c.margen)}</td>
                        <td data-label="" style={{ textAlign: "right" }}>
                          <button className="del" style={{ marginRight: 6, color: C.accent }} title="Editar precio" onClick={() => { setEditingRegId(r.id); setEditPrecio(r.precioTn != null ? String(r.precioTn) : ""); }}>✎</button>
                          <button className="del" onClick={() => borrar(r.id)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* RESUMEN POR MES */}
        <Section tag="Resumen" title="Mes por mes">
          {resumenMeses.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "8px 0" }}>El resumen se arma solo a medida que registrás cargas.</div>
          ) : (
            <>
              <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
                <div className="label" style={{ marginBottom: 10 }}>Resumen total del mes</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div className="inputWrap selectWrap" style={{ flex: "1 1 160px" }}>
                    <select className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={mesActivo} onChange={(e) => { setMesSel(e.target.value); setClienteSel(""); }}>
                      {resumenMeses.map((m) => <option key={m.key} value={m.key}>{mesLabel(m.key)}</option>)}
                    </select>
                  </div>
                  <button className="tog" onClick={compartirImagen}>Compartir imagen</button>
                  <button className="tog" onClick={pdfResumen}>PDF</button>
                  <button className="tog" onClick={exportarResumenCSV}>CSV (todos)</button>
                </div>
                {resumenPorCliente.length > 0 && (
                  <>
                    <div className="label" style={{ marginTop: 14, marginBottom: 8 }}>Liquidación por cliente</div>
                    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div className="inputWrap selectWrap" style={{ flex: "1 1 160px" }}>
                        <select className="input" style={{ fontFamily: "Archivo, sans-serif" }} value={clienteSel} onChange={(e) => setClienteSel(e.target.value)}>
                          <option value="">Elegí cliente…</option>
                          {resumenPorCliente.map((c) => <option key={c.clienteId || c.nombre} value={c.clienteId || c.nombre}>{c.nombre} — {N(c.tn)} tn</option>)}
                        </select>
                      </div>
                      <button className="tog" disabled={!clienteSel} onClick={compartirImagenCliente}>Compartir imagen</button>
                      <button className="tog" disabled={!clienteSel} onClick={exportarClienteCSV}>CSV</button>
                    </div>
                  </>
                )}
              </div>

              {/* Tabla por cliente del mes seleccionado */}
              {resumenPorCliente.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div className="label" style={{ marginBottom: 10 }}>Desglose por cliente — {mesLabel(mesActivo)}</div>
                  {resumenPorCliente.map((cl) => (
                    <div key={cl.clienteId || cl.nombre} style={{ border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
                      <div style={{ background: C.panel, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{cl.nombre}</span>
                        <div className="row" style={{ gap: 16 }}>
                          <span className="num" style={{ fontSize: 13, color: C.ink2 }}>{N(cl.tn)} tn · {cl.cargas.length} carga(s)</span>
                          <span className="num" style={{ fontSize: 15, color: cl.pendiente ? C.amarillo : C.verde, fontWeight: 700 }}>{cl.pendiente ? `$${N(cl.ingreso)} + pend.` : $(cl.ingreso)}</span>
                        </div>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="reg" style={{ fontSize: 13 }}>
                          <thead><tr><th>Fecha</th><th>Modo</th><th style={{ textAlign: "right" }}>Tn</th><th style={{ textAlign: "right" }}>$/tn</th><th style={{ textAlign: "right" }}>Subtotal</th></tr></thead>
                          <tbody>
                            {cl.cargas.map((c, i) => (
                              <tr key={i}>
                                <td data-label="Fecha" className="num" style={{ fontSize: 12 }}>{fechaCorta(c.fecha)}</td>
                                <td data-label="Modo"><span className="pill" style={{ background: c.modo === "grillada" ? `${C.accent}1a` : `${C.ink}0d`, color: c.modo === "grillada" ? C.accent : C.ink }}>{c.modo}</span></td>
                                <td data-label="Tn" className="num" style={{ textAlign: "right" }}>{N(c.tn)}</td>
                                <td data-label="$/tn" className="num" style={{ textAlign: "right", color: c.precioTn == null ? C.amarillo : C.ink }}>{c.precioTn != null ? $(c.precioTn) : "A definir"}</td>
                                <td data-label="Subtotal" className="num" style={{ textAlign: "right", color: c.ingreso != null ? C.verde : C.ink2 }}>{c.ingreso != null ? $(c.ingreso) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table className="reg">
                  <thead><tr><th>Mes</th><th style={{ textAlign: "right" }}>Bateas</th><th style={{ textAlign: "right" }}>Tn</th><th style={{ textAlign: "right" }}>Ingreso</th><th style={{ textAlign: "right" }}>Socios</th><th style={{ textAlign: "right" }}>Margen</th></tr></thead>
                <tbody>
                  {resumenMeses.map((m) => (
                    <tr key={m.key}>
                      <td data-label="Mes" style={{ fontWeight: 600 }}>{mesLabel(m.key)}</td>
                      <td data-label="Bateas" className="num" style={{ textAlign: "right" }}>{m.bateas}</td>
                      <td data-label="Tn" className="num" style={{ textAlign: "right" }}>{N(m.tn)}</td>
                      <td data-label="Ingreso" className="num" style={{ textAlign: "right" }}>{$(m.bruto)}</td>
                      <td data-label="Socios" className="num" style={{ textAlign: "right", color: C.rojo }}>−{N(m.comision)}</td>
                      <td data-label="Margen" className="num" style={{ textAlign: "right", color: m.margen >= 0 ? C.verde : C.rojo, fontWeight: 700 }}>{$(m.margen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Section>

        {/* CALENDARIO */}
        <Section tag="Calendario" title="Días de carga"
          right={
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="navbtn" onClick={() => calNav(-1)}>‹</button>
              <span className="num" style={{ fontSize: 13, minWidth: 104, textAlign: "center" }}>{MESES_LARGO[cal.m]} {cal.y}</span>
              <button className="navbtn" onClick={() => calNav(1)}>›</button>
            </div>
          }>
          <div className="cal" style={{ marginBottom: 8 }}>
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="cal-h">{d}</div>)}
            {Array.from({ length: calData.offset }).map((_, i) => <div key={"e" + i} className="cal-d empty" />)}
            {Array.from({ length: calData.ndays }).map((_, i) => {
              const day = i + 1;
              const info = calData.days[day];
              const ratio = info ? info.tn / calData.maxTn : 0;
              const alpha = info ? 0.6 + 0.4 * ratio : 0;
              return (
                <div key={day} className="cal-d"
                  title={info ? `${N(info.tn)} tn · ${info.bateas} bateas` : ""}
                  style={{ background: info ? `rgba(84,12,24,${alpha})` : C.bg, borderColor: info ? C.accent : C.line }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: info ? "#fff" : C.ink2 }}>{day}</span>
                  {info && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>{N(info.tn)} tn</span>}
                </div>
              );
            })}
          </div>
          <div style={{ color: C.ink2, fontSize: 12.5, marginTop: 12 }}>
            Total del mes: <span className="num" style={{ color: C.ink }}>{N(calData.tnMes)} tn</span>. Más oscuro = más toneladas ese día.
          </div>
        </Section>

        {/* TABLERO DE PICOS */}
        <Section tag="Tablero" title="Picos de extracción"
          right={<span className="label">tn por mes</span>}>
          {picos.arr.length === 0 ? (
            <div style={{ color: C.ink2, fontSize: 14, padding: "8px 0" }}>Cuando tengas cargas en distintos meses, vas a ver acá las barras y el mes pico.</div>
          ) : (
            <div className="barswrap">
              <div className="bars">
                {picos.arr.map((m) => {
                  const h = Math.max(3, (m.tn / picos.max) * 150);
                  const esPico = m.tn === picos.max;
                  return (
                    <div key={m.key} className="bar-col" title={`${mesLabel(m.key)} · ${N(m.tn)} tn`}>
                      <span className="num" style={{ fontSize: 10.5, color: esPico ? C.accent : C.ink2, marginBottom: 4, fontWeight: 700 }}>{N(m.tn)}</span>
                      <div className="bar" style={{ height: h, background: esPico ? C.accent : `${C.accent}40` }} />
                      <span className="num" style={{ fontSize: 9.5, color: C.ink2, marginTop: 6, textAlign: "center" }}>{MESES[parseInt(m.key.split("-")[1]) - 1]}<br />{m.key.split("-")[0].slice(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        {/* PROYECCIÓN */}
        <Section tag="Proyección" title={`Si cargás ${cfg.objetivoMes} bateas/mes (${modo})`}>
          <div className="grid-3">
            <Kpi label="Por mes" value={$(proyMes)} sub={`${cfg.objetivoMes} bateas · ${N(cfg.objetivoMes * cfg.tnPorBatea)} tn`} color={C.accent} />
            <Kpi label="Por año" value={$(proyAnio)} sub="12 meses" color={C.accent} />
            <Kpi label="Por batea" value={$(proyMes / (cfg.objetivoMes || 1))} sub="margen promedio" color={C.accent} />
          </div>
        </Section>

        <footer style={{ marginTop: 28, color: C.ink2, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", letterSpacing: "0.04em" }}>
          Los resúmenes se guardan solos mes a mes. Compartí el del mes como imagen o PDF cuando quieras.
        </footer>
      </div>
      )}
    </div>
  );
}

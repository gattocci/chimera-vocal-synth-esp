/** A private, in-browser dialogue experiment. Open with `?scene=1`. */
import { useEffect, useRef, useState } from "react";
import { AnatomyView3D, type HeadFeed } from "./AnatomyView3D.tsx";
import { Screen } from "./Screen.tsx";
import { engine } from "../../audio/AudioEngine.ts";
import { defaultF0, PRESETS, bodyLabel, type BodyMix } from "../body.ts";
import { getModel } from "../useModel.ts";
import { VoiceModel } from "../analysis.ts";
import { NEUTRAL } from "../../wasm/engine.ts";
import { speakText, speakingNow, stopSpeaking } from "../speech.ts";
import { useSing } from "../singing.ts";
import type { Lang } from "../../wasm/types.ts";
import { useStore } from "../store.ts";
import { Chip } from "./Screen.tsx";

interface Character { id: number; name: string; body: BodyMix }
interface Line { id: number; character: number; text: string }

const bodyNames = ["male", "female", "child"] as const;
const bodyFor = (name: (typeof bodyNames)[number]) => PRESETS[name];
const initialCharacters: Character[] = [
  { id: 1, name: "Personaje 1", body: bodyFor("male") },
  { id: 2, name: "Personaje 2", body: bodyFor("female") },
  { id: 3, name: "Personaje 3", body: bodyFor("male") },
  { id: 4, name: "Personaje 4", body: bodyFor("female") },
];
const initialLines: Line[] = [
  { id: 1, character: 1, text: "" },
  { id: 2, character: 2, text: "" },
  { id: 3, character: 3, text: "" },
  { id: 4, character: 4, text: "" },
];

const VIEW = { pressure: true, particles: true, grid: false, calipers: false };

export function ScenePage() {
  const [characters, setCharacters] = useState(initialCharacters);
  const [lines, setLines] = useState(initialLines);
  const [title, setTitle] = useState("Escena de prueba");
  const [stageColor, setStageColor] = useState("#071522");
  const [lang, setLang] = useState<Lang>("es");
  const setVoiceLanguage = useSing((s) => s.setLang);
  const [rate, setRate] = useState(1);
  const [active, setActive] = useState<number | null>(null);
  const [lineNow, setLineNow] = useState(-1);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  const started = useStore((s) => s.started);

  useEffect(() => () => {
    run.current++;
    stopSpeaking();
    const state = useStore.getState();
    if (state.started) {
      engine.setBody(state.body);
      engine.setSource(state.source);
    }
  }, []);

  const updateCharacter = (id: number, patch: Partial<Character>) =>
    setCharacters((xs) => xs.map((x) => x.id === id ? { ...x, ...patch } : x));

  const play = async () => {
    if (busy) {
      run.current++;
      stopSpeaking();
      setBusy(false);
      setActive(null);
      return;
    }
    const token = ++run.current;
    setBusy(true);
    setVoiceLanguage(lang);
    try {
      await useStore.getState().start();
      if (!useStore.getState().started) return;
      for (let i = 0; i < lines.length && run.current === token; i++) {
        const line = lines[i];
        if (!line.text.trim()) continue;
        const character = characters.find((x) => x.id === line.character) ?? characters[0];
        if (!character) break;
        setLineNow(i);
        setActive(character.id);
        engine.setBody(character.body);
        const f0 = defaultF0(character.body);
        engine.setSource({ f0 });
        const plan = await speakText(line.text, { ipa: false, body: character.body, rate, f0 });
        if (!plan) continue;
        while (run.current === token && speakingNow()) await new Promise((resolve) => window.setTimeout(resolve, 40));
        if (run.current === token) await new Promise((resolve) => window.setTimeout(resolve, 260));
      }
    } finally {
      if (run.current === token) {
        setBusy(false);
        setActive(null);
        setLineNow(-1);
      }
    }
  };

  const addCharacter = () => {
    const id = Math.max(0, ...characters.map((x) => x.id)) + 1;
    setCharacters((xs) => [...xs, { id, name: `Personaje ${id}`, body: bodyFor("male") }]);
  };

  const removeCharacter = (id: number) => {
    if (characters.length <= 1) return;
    const next = characters.filter((x) => x.id !== id);
    setCharacters(next);
    setLines((xs) => xs.map((line) => line.character === id ? { ...line, character: next[0].id } : line));
  };

  return (
    <main className="scene-page">
      <header className="scene-top">
        <a className="wordmark" href="/">Chimera</a>
        <input className="scene-title" aria-label="Título de la escena" value={title} onChange={(e) => setTitle(e.target.value)} />
        <span className="scene-local">Experimento local · no se guarda</span>
      </header>

      <section className="scene-stage" style={{ backgroundColor: stageColor }} aria-label="Escenario">
        <div className="scene-cast" style={{ "--cast": characters.length } as React.CSSProperties}>
          {characters.map((character, i) => (
            <CharacterHead key={character.id} character={character} active={active === character.id} facing={i === 0 ? 1 : -1} />
          ))}
        </div>
      </section>

      <section className="scene-editor">
        <div className="scene-controls">
          <button className="primary large" onClick={() => void play()} disabled={!busy && !lines.some((x) => x.text.trim())}>
            {busy ? "Detener escena" : "Reproducir escena"}
          </button>
          <label>Idioma
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
          <label>Velocidad <span>{rate.toFixed(1)}×</span>
            <input type="range" min="0.6" max="1.5" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </label>
          <label>Fondo <input type="color" value={stageColor} onChange={(e) => setStageColor(e.target.value)} /></label>
          <span className="scene-status" aria-live="polite">{!started ? "El audio se inicia al reproducir" : lineNow >= 0 ? `Línea ${lineNow + 1} de ${lines.length}` : "Listo"}</span>
        </div>

        <div className="scene-config">
          <section className="scene-characters">
            <header><h2>Personajes</h2><Chip toggle={false} onClick={addCharacter} disabled={characters.length >= 8}>+ Añadir</Chip></header>
            {characters.map((character) => (
              <div className="scene-character" key={character.id}>
                <input aria-label="Nombre del personaje" value={character.name} onChange={(e) => updateCharacter(character.id, { name: e.target.value })} />
                <select aria-label="Cuerpo del personaje" value={bodyNames.find((x) => bodyFor(x).female === character.body.female && bodyFor(x).child === character.body.child) ?? "male"} onChange={(e) => updateCharacter(character.id, { body: bodyFor(e.target.value as (typeof bodyNames)[number]) })}>
                  <option value="male">Adulto</option><option value="female">Adulta</option><option value="child">Niño/a</option>
                </select>
                <button className="scene-remove" aria-label={`Quitar ${character.name}`} onClick={() => removeCharacter(character.id)} disabled={characters.length <= 1}>×</button>
              </div>
            ))}
          </section>

          <section className="scene-script">
            <header><h2>Guion</h2><Chip toggle={false} onClick={() => setLines((xs) => [...xs, { id: Math.max(0, ...xs.map((x) => x.id)) + 1, character: characters[0].id, text: "" }])}>+ Línea</Chip></header>
            <div className="scene-lines">
              {lines.map((line, i) => (
                <div className={`scene-line${lineNow === i ? " speaking" : ""}`} key={line.id}>
                  <span className="scene-line-number">{String(i + 1).padStart(2, "0")}</span>
                  <select aria-label={`Quién habla en la línea ${i + 1}`} value={line.character} onChange={(e) => setLines((xs) => xs.map((x) => x.id === line.id ? { ...x, character: Number(e.target.value) } : x))}>
                    {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                  </select>
                  <textarea aria-label={`Texto de la línea ${i + 1}`} rows={1} value={line.text} placeholder="Escribe aquí el diálogo…" onChange={(e) => setLines((xs) => xs.map((x) => x.id === line.id ? { ...x, text: e.target.value } : x))} />
                  <button className="scene-remove" aria-label={`Quitar línea ${i + 1}`} onClick={() => setLines((xs) => xs.filter((x) => x.id !== line.id))}>×</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function CharacterHead(props: { character: Character; active: boolean; facing: 1 | -1 }) {
  const { character, active, facing } = props;
  const activeRef = useRef(active);
  activeRef.current = active;
  const bodyRef = useRef(character.body);
  bodyRef.current = character.body;
  const model = getModel(character.body, useStore.getState().started ? engine.sampleRate : 48000);
  const feed = useRef<HeadFeed | null>(null);
  if (!feed.current) {
    feed.current = {
      model, view: VIEW, maxDpr: 0.8, facing,
      frame: () => {
        const tele = activeRef.current && engine.latest?.body.female === bodyRef.current.female && engine.latest?.body.child === bodyRef.current.child ? engine.latest : null;
        return { tele, artic: NEUTRAL, epoch: 0 };
      },
    };
  }
  feed.current.model = model;
  feed.current.facing = facing;
  return (
    <Screen className={`scene-head${active ? " active" : ""}`} focus title={character.name || "Personaje"} sub={bodyLabel(character.body)} label={`${character.name || "Personaje"}, cabeza animada`}>
      <AnatomyView3D feed={feed.current} readouts={false} />
    </Screen>
  );
}

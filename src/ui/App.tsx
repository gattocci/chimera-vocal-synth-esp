import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "./store.ts";
import { engine } from "../audio/AudioEngine.ts";
import { AnatomyView } from "./components/AnatomyView.tsx";
import { TubeView } from "./components/TubeView.tsx";
import { Stroboscope } from "./components/Stroboscope.tsx";
import { SpectrumView } from "./components/SpectrumView.tsx";
import { VowelMap } from "./components/VowelMap.tsx";
import { VoiceControls, VoiceToggles } from "./components/VoiceControls.tsx";
import { Keys } from "./components/Keys.tsx";
import { Segmented, Toggle } from "./components/Controls.tsx";
import { Screen } from "./components/Screen.tsx";
import { SpeakRight, speechInfo, speechSlots, speechWords } from "./components/SpeakPanel.tsx";
import { BestiaryRight } from "./components/BestiaryPanel.tsx";
import { CreatureView } from "./components/CreatureView.tsx";
import { creatureById } from "../wasm/engine.ts";
import { BeatboxRight, BeatOverlay, beatInfo, beatSlots } from "./components/BeatboxPanel.tsx";
import { SingRight, singInfo, singWords } from "./components/SingPanel.tsx";
import { playDemo, DEMO_SONGS } from "./singing.ts";
import type { Mode } from "./store.ts";
import type { BodyName } from "../worklet/protocol.ts";
import { BodyPad } from "./components/BodyPad.tsx";
import { bodyLabel, presetOf, PRESETS } from "./body.ts";
import { t, useLang, setLang, type Lang } from "./i18n/index.ts";

// three.js only loads when the 3D view is first shown
const AnatomyView3D = lazy(() => import("./components/AnatomyView3D.tsx").then((m) => ({ default: m.AnatomyView3D })));
// the duet page (`?show=<id>`): two 3D heads replaying a pre-rendered song
const DuetPage = lazy(() => import("./components/DuetPage.tsx").then((m) => ({ default: m.DuetPage })));

/** the show to play, from `?show=<id>` (a plain folder name under public/shows) */
function showId(): string | null {
  const id = new URLSearchParams(window.location.search).get("show");
  return id && /^[\w-]+$/.test(id) ? id : null;
}

function TopBar() {
  const started = useStore((s) => s.started);
  const starting = useStore((s) => s.starting);
  const start = useStore((s) => s.start);
  const body = useStore((s) => s.body);
  const setBody = useStore((s) => s.setBody);
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const lang = useLang();
  const [load, setLoad] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLoad(engine.load), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Chimera</span>
        <span className="tagline">{t("A voice grown from a simulated airway")}</span>
      </div>
      <Segmented<Mode>
        label={t("Mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "play", label: t("Play") },
          { value: "speak", label: t("Speak") },
          { value: "sing", label: t("Sing") },
          { value: "bestiary", label: t("Bestiary") },
          { value: "beatbox", label: t("Beatbox") },
        ]}
      />
      {mode !== "bestiary" && (
        <div className="body-control">
          <Segmented<BodyName>
            label={t("Body")}
            value={presetOf(body)}
            onChange={(b) => setBody(PRESETS[b])}
            options={[
              { value: "male", label: t("Male") },
              { value: "female", label: t("Female") },
              { value: "child", label: t("Child") },
            ]}
          />
          <BodyPad />
        </div>
      )}
      <div className="topbar-right">
        <Segmented<Lang>
          label={t("Language")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "es", label: "ES" },
            { value: "en", label: "EN" },
          ]}
        />
        <label className="volume">
          <span>{t("Volume")}</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ "--pos": `${volume * 100}%` } as React.CSSProperties} />
        </label>
        {started ? (
          <span className="load" title={t("Share of the audio thread's time budget used by the simulation")}>
            {t("Engine load")} {Math.round(load * 100)} %
          </span>
        ) : (
          <button className="primary" onClick={() => void start()} disabled={starting}>
            {starting ? t("Starting…") : t("Start audio")}
          </button>
        )}
        <a className="repo-link" href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer" aria-label={t("Source code on GitHub")} title={t("Source code on GitHub")}>
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
      </div>
    </header>
  );
}

function ViewToggles() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const bestiary = useStore((s) => s.mode === "bestiary");
  return (
    <div className="view-toggles">
      {!bestiary && <Toggle label="3D" checked={view.threeD} onChange={(v) => setView({ threeD: v })} />}
      <Toggle label={t("Sound pressure")} checked={view.pressure} onChange={(v) => setView({ pressure: v })} />
      {!bestiary && <Toggle label={t("Airflow")} checked={view.particles} onChange={(v) => setView({ particles: v })} />}
      <Toggle label={bestiary ? t("Labels") : t("Measurements")} checked={view.calipers} onChange={(v) => setView({ calipers: v })} />
      {!bestiary && <Toggle label={t("Grid")} checked={view.grid} onChange={(v) => setView({ grid: v })} />}
    </div>
  );
}

function StartPrompt() {
  const started = useStore((s) => s.started);
  const starting = useStore((s) => s.starting);
  const err = useStore((s) => s.startError);
  const start = useStore((s) => s.start);
  const setHold = useStore((s) => s.setHold);
  const mode = useStore((s) => s.mode);
  const playCall = useStore((s) => s.playCall);
  const creature = useStore((s) => s.creature);
  const setBeatPlaying = useStore((s) => s.setBeatPlaying);
  if (started) return null;
  const copy = {
    bestiary: [t("Each animal's sound comes from a simulation of its own sound source and airway."), t("Start and hear a call"), t("Then play its calls, or hold the keys to sustain it at a pitch.")],
    beatbox: [t("Every drum here is a mouth sound: lips, tongue and larynx pushing, sealing and sucking air."), t("Start the beat"), t("Then edit the pattern, tap the pads, or hum a bass note on the keys.")],
    speak: [t("Every sound here is produced by simulating air moving through a throat, mouth and nose."), t("Start the voice"), t("Then type something and press Speak, or tap a sound in the chart.")],
    sing: [t("Every sound here is produced by simulating air moving through a throat, mouth and nose."), t("Start and hear a song"), t("Then play the keys: each note sings the next syllable of the lyrics.")],
  }[mode as "bestiary" | "beatbox" | "speak" | "sing"] ?? [t("Every sound here is produced by simulating air moving through a throat, mouth and nose."), t("Breathe in and start"), t("Then drag the tongue, lips or jaw, or play the keys.")];
  return (
    <div className="start-prompt" data-layout="overlay">
      <p>{copy[0]}</p>
      <button
        className="primary large"
        disabled={starting}
        onClick={async () => {
          // the demo waits for audio itself, so a stop meanwhile (body, mode) cancels it
          if (mode === "sing") return void playDemo(DEMO_SONGS[0].name, useStore.getState().body, start);
          await start();
          const first = creatureById(creature)?.calls[0];
          if (mode === "bestiary" && first) playCall(first.id);
          else if (mode === "beatbox") setBeatPlaying(true);
          else if (mode === "play") setHold(true);
        }}
      >
        {starting ? t("Starting…") : copy[1]}
      </button>
      {err ? <p className="error">{t("Audio could not start")}: {err}. {t("Reload the page and try again.")}</p> : <p className="hint">{copy[2]}</p>}
    </div>
  );
}

/** The tall left screen: the face (or the creature) with its overlays. */
function LeftScreen() {
  const mode = useStore((s) => s.mode);
  const body = useStore((s) => s.body);
  const threeD = useStore((s) => s.view.threeD);
  const bestiary = mode === "bestiary";
  const Face = threeD ? AnatomyView3D : AnatomyView;
  return (
    <Screen
      className="left"
      focus
      title={bestiary ? t("Creature") : t("Vocal tract")}
      sub={bestiary ? t("Airway / live") : `${bodyLabel(body)} / ${threeD ? "3D" : t("midsagittal")}`}
      label={bestiary ? t("Live creature airway") : t("Live vocal tract")}
      tools={<ViewToggles />}
    >
      <Suspense fallback={null}>
        {bestiary ? <CreatureView /> : mode === "speak" ? <Face slots={speechSlots} info={speechInfo} overlay={speechWords} /> : mode === "sing" ? <Face info={singInfo} overlay={singWords} /> : mode === "beatbox" ? <Face slots={beatSlots} info={beatInfo} showFormants={false} /> : <Face />}
      </Suspense>
      {mode === "beatbox" && <BeatOverlay />}
      <StartPrompt />
    </Screen>
  );
}

function PlayRight() {
  const f0 = useStore((s) => s.source.f0);
  return (
    <div className="right right-play">
      <Screen className="s-tube" title={t("Tube")} sub={t("Glottis to lips")}>
        <TubeView />
      </Screen>
      <Screen className="s-folds" title={t("Vocal folds")} sub={t("Slowed 100×")}>
        <Stroboscope />
      </Screen>
      <Screen className="s-spec" title={t("Spectrum")} sub={t("Resonances")}>
        <SpectrumView />
      </Screen>
      <Screen className="s-vowels" title={t("Vowels")} sub="F1 / F2">
        <VowelMap />
      </Screen>
      <Screen className="s-voice" title={t("Voice")} tools={<VoiceToggles />}>
        <VoiceControls />
      </Screen>
      <Screen className="s-keys" title={t("Keys")} sub={`${Math.round(f0)} Hz`}>
        <Keys />
      </Screen>
    </div>
  );
}

export function App() {
  const show = showId();
  if (show)
    return (
      <Suspense fallback={null}>
        <DuetPage id={show} />
      </Suspense>
    );
  return <Wall />;
}

function Wall() {
  const mode = useStore((s) => s.mode);
  useLang(); // a language change re-renders the whole wall (every screen's texts come from t())
  return (
    <div className={`app text-colors mode-${mode}`}>
      <TopBar />
      <main className={`wall wall-${mode}`}>
        <LeftScreen />
        {mode === "play" ? <PlayRight /> : mode === "speak" ? <SpeakRight /> : mode === "sing" ? <SingRight /> : mode === "beatbox" ? <BeatboxRight /> : <BestiaryRight />}
      </main>
    </div>
  );
}

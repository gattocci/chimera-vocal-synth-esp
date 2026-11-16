import { useEffect, useMemo, useState } from "react";
import { skippedLines } from "../skipped.ts";
import { useStore } from "../store.ts";
import { speakText, speakPhrases, stopSpeaking, onPlan, currentPlan, spokenWordNow, speakingNow } from "../speech.ts";
import { mouthWords } from "../mouthWords.ts";
import { tokenizeIpa, DIALECT_PRESETS, type DialectPreset } from "../../wasm/engine.ts";
import { setVoiceLang, currentVoiceLang, type VoiceLang } from "../speech.ts";
import { Menu, Slider, Segmented } from "./Controls.tsx";
import { Chip, Screen } from "./Screen.tsx";
import { ActionBar, PrimaryButton } from "./ActionBar.tsx";
import { ScoreView, planNow } from "./ScoreView.tsx";
import { TubeView } from "./TubeView.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import type { InfoFn, SlotsFn } from "./AnatomyView.tsx";
import { V } from "../colors.ts";
import { engine } from "../../audio/AudioEngine.ts";

// the examples stay English on purpose: the engine speaks English (CMUdict + letter-to-sound)
const EXAMPLES = ["Hello. Can you hear me?", "She sells sea shells by the sea shore.", "Every sound here is air moving through a throat.", "The quick brown fox jumps over the lazy dog."];

// Local listening aid; deliberately hidden unless the dev server URL includes ?speak-debug=1.
const SPEAK_DEBUG = new URLSearchParams(window.location.search).get("speak-debug") === "1";

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeWav(audio: AudioBuffer): Blob {
  const samples = new Float32Array(audio.length);
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const channel = audio.getChannelData(ch);
    for (let i = 0; i < channel.length; i++) samples[i] += channel[i] / audio.numberOfChannels;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function startSpeakCapture(stream: MediaStream): { finish: () => Promise<Blob> } {
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(200);
  return { finish: () => new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Speak audio recording failed"));
    recorder.onstop = async () => {
      try {
        const compressed = new Blob(chunks, { type: recorder.mimeType });
        const decode = new AudioContext();
        try { resolve(encodeWav(await decode.decodeAudioData(await compressed.arrayBuffer()))); }
        finally { await decode.close(); }
      } catch (e) { reject(e); }
    };
    recorder.stop();
  }) };
}

// IPA pulmonic consonant chart (rows = manner, columns = place); empty cells are null
const PLACES = ["Bilabial", "Labiodental", "Dental", "Alveolar", "Postalveolar", "Retroflex", "Palatal", "Velar", "Uvular", "Pharyngeal", "Glottal"];
/** short headings for the chart's narrow columns (the full names are the cells' titles) */
const PLACE_SHORT = ["Bilab", "Labdent", "Dental", "Alveol", "Postalv", "Retrofl", "Palatal", "Velar", "Uvular", "Pharyn", "Glottal"];
const MANNER_SHORT: Record<string, string> = { "Lateral fricative": "Lat fric", Approximant: "Approx" };
const CHART: [string, (string | null)[][]][] = [
  ["Plosive", [["p", "b"], [null, null], [null, null], ["t", "d"], [null, null], ["ʈ", "ɖ"], ["c", "ɟ"], ["k", "g"], ["q", "ɢ"], [null, null], ["ʔ", null]]],
  ["Nasal", [[null, "m"], [null, "ɱ"], [null, null], [null, "n"], [null, null], [null, "ɳ"], [null, "ɲ"], [null, "ŋ"], [null, "ɴ"], [null, null], [null, null]]],
  ["Trill", [[null, "ʙ"], [null, null], [null, null], [null, "r"], [null, null], [null, null], [null, null], [null, null], [null, "ʀ"], [null, null], [null, null]]],
  ["Tap", [[null, null], [null, null], [null, null], [null, "ɾ"], [null, null], [null, "ɽ"], [null, null], [null, null], [null, null], [null, null], [null, null]]],
  ["Fricative", [["ɸ", "β"], ["f", "v"], ["θ", "ð"], ["s", "z"], ["ʃ", "ʒ"], ["ʂ", "ʐ"], ["ç", "ʝ"], ["x", "ɣ"], ["χ", "ʁ"], ["ħ", "ʕ"], ["h", "ɦ"]]],
  ["Lateral fricative", [[null, null], [null, null], [null, null], ["ɬ", "ɮ"], [null, null], [null, null], [null, null], [null, null], [null, null], [null, null], [null, null]]],
  ["Approximant", [[null, null], [null, "ʋ"], [null, null], [null, "ɹ"], [null, null], [null, "ɻ"], [null, "j"], [null, "ɰ"], [null, null], [null, null], [null, null]]],
  ["Lateral", [[null, null], [null, null], [null, null], [null, "l"], [null, null], [null, "ɭ"], [null, "ʎ"], [null, null], [null, null], [null, null], [null, null]]],
];

/** the segment sounding now in the current utterance */
function soundingSegment(): string | null {
  const sp = currentPlan();
  const now = planNow(sp);
  if (!sp || now < 0) return null;
  return sp.plan.segments.find((s) => now >= s.t0 && now < s.t1)?.ipa ?? null;
}

/** Speak mode's readouts under the chin: the sound being made, jaw, lip shape, soft palate */
/** the word being spoken, at the mouth */
export const speechWords = mouthWords(spokenWordNow, V.white);

export const speechSlots: SlotsFn = (_m, a, f) => {
  const sound = soundingSegment();
  const lips = a.lipAp < 0.05 ? "Closed" : a.lipWidth < 0.55 ? "Round" : a.lipAp > 1.3 ? "Open" : "Spread";
  return [
    sound ? { label: "Sound", value: sound, color: V.green, ipa: true } : { label: "Sound", value: "-", color: V.green },
    { label: "Jaw", value: a.jaw.toFixed(1), unit: "cm", color: V.red },
    { label: "Lips", value: lips, color: V.pink },
    { label: "Soft palate", value: f.velumPort > 0.02 ? "Open" : "Shut", color: V.white },
  ];
};

/** what the voice is doing: voiced or not, where the noise is, the lungs */
export const speechInfo: InfoFn = (m, _f, tele) => {
  if (!tele) return [];
  const t = tele.t;
  const out = [t.voicing > 0.3 ? `Voiced ${t.f0.toFixed(0)} Hz` : "Voiceless"];
  if (t.noiseLevel > 1 && t.noiseNode >= 0) {
    const s = m.branchS(t.noiseNode, t.phLen, t.orLen);
    if (s >= 0) out.push(`Noise at ${s.toFixed(1)} cm`);
  }
  out.push(`Lungs ${t.pLung.toFixed(1)} cmH₂O`);
  return out;
};

function ConsonantChart(props: { onPad: (c: string) => void }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(engine.latest ? soundingSegment() : null), 60);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="chart-scroll">
      <table className="ipa-chart">
        <thead>
          <tr>
            <th />
            {PLACES.map((p, i) => (
              <th key={p} scope="col" title={p} aria-label={p}>
                {PLACE_SHORT[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CHART.map(([manner, cells]) => (
            <tr key={manner}>
              <th scope="row" title={manner} aria-label={manner}>
                {MANNER_SHORT[manner] ?? manner}
              </th>
              {cells.map((pair, i) => (
                <td key={i}>
                  {pair.map((sym, j) =>
                    sym ? (
                      <button key={j} className={`ipa${sym === now ? " now" : ""}`} onClick={() => props.onPad(sym)} title="Say it between two vowels">
                        {sym}
                      </button>
                    ) : (
                      <span key={j} className="ipa-empty" />
                    ),
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Whether speech is sounding, polled each frame (re-renders only when it changes). */
function useSpeaking(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setOn(speakingNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return on;
}

/** Speak mode's right column: the speak button, what to say, the gestural score, the consonant chart, the tube and folds. */
export function SpeakRight() {
  const body = useStore((s) => s.body);
  const f0 = useStore((s) => s.source.f0);
  const start = useStore((s) => s.start);
  const [text, setText] = useState(EXAMPLES[0]);
  const [ipa, setIpa] = useState(false);
  const [rate, setRate] = useState(1);
  const [busy, setBusy] = useState(false);
  const [trans, setTrans] = useState(currentPlan()?.transcription ?? "");
  const [vowel, setVowel] = useState("ɑ");
  // the page's voice language (English by default: nothing changes until it is switched)
  const [lang, setLang] = useState<VoiceLang>(currentVoiceLang());
  const [dialect, setDialect] = useState<DialectPreset>("neutro");
  const speaking = useSpeaking();
  useEffect(() => onPlan((p) => setTrans(p?.transcription ?? "")), []);
  // in IPA mode: the symbols in the box that the voice will not say, updated as the text changes
  const skipped = useMemo(() => (ipa ? skippedLines(text) : []), [ipa, text]);

  const pickLang = (l: VoiceLang) => {
    setLang(l);
    setVoiceLang(l, l === "es" ? DIALECT_PRESETS[dialect] : undefined);
  };
  const pickDialect = (d: DialectPreset) => {
    setDialect(d);
    setVoiceLang("es", DIALECT_PRESETS[d]);
  };

  const speak = async (exportDebug = false) => {
    let capture: ReturnType<typeof startSpeakCapture> | null = null;
    setBusy(true);
    try {
      await start();
      // the audio didn't start (the error shows on the bar): speaking would only light Stop
      if (!useStore.getState().started) return;
      const stream = exportDebug ? engine.recordStream() : null;
      if (exportDebug && stream) capture = startSpeakCapture(stream);
      const spoken = await speakText(text, { ipa, body, rate, f0 });
      if (capture) {
        if (spoken) await new Promise((resolve) => setTimeout(resolve, Math.ceil((spoken.plan.end + 0.18) * 1000)));
        const wav = await capture.finish();
        capture = null;
        if (spoken) {
          const slug = text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "speak";
          const base = `chimera-${lang}-${dialect}-${slug}`;
          downloadBlob(wav, `${base}.wav`);
          downloadBlob(new Blob([JSON.stringify({ text, ipa, language: lang, dialect, transcription: spoken.transcription, sampleRate: engine.sampleRate }, null, 2)], { type: "application/json" }), `${base}.json`);
        }
      }
    } finally {
      if (capture) void capture.finish().catch(() => {});
      setBusy(false);
    }
  };
  const pad = async (c: string) => {
    await start();
    if (!useStore.getState().started) return;
    speakPhrases([{ segments: tokenizeIpa(`ˈ${vowel}${c}${vowel}`), intonation: "flat" }], { body, rate, f0 });
  };

  const press = () => (speaking ? stopSpeaking() : void speak());

  return (
    <div className="right right-speak">
      <ActionBar label="Speak" onSpace={press}>
        <PrimaryButton label="Speak" playing={speaking} busy={busy ? "Preparing…" : null} onClick={press} />
        {SPEAK_DEBUG && <Chip toggle={false} disabled={busy || speaking} onClick={() => void speak(true)} title="Speak this text and download its audio as WAV, with a JSON record of the exact input and transcription">Export WAV</Chip>}
        {/* puts an example in the box: the menu always reads Examples, since the box shows the words */}
        <Menu
          label="Examples"
          value=""
          options={[{ value: "", label: "Examples", disabled: true }, ...EXAMPLES.map((ex) => ({ value: ex, label: ex }))]}
          onChange={(ex) => {
            setText(ex);
            setIpa(false);
          }}
        />
        <div className="act-slider">
          <Slider label="Rate" value={rate} min={0.5} max={1.8} onChange={setRate} format={(v) => `${v.toFixed(2)}×`} />
        </div>
        <Chip on={ipa} onClick={() => setIpa(!ipa)}>
          Text is IPA
        </Chip>
        <Segmented
          label="Voice"
          value={lang}
          options={[
            { value: "en" as const, label: "English" },
            { value: "es" as const, label: "Spanish" },
          ]}
          onChange={pickLang}
        />
      </ActionBar>
      <Screen className="s-say" label="What to say">
        <div className="say">
          <div className="say-row">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void speak();
                e.stopPropagation();
              }}
              rows={2}
              spellCheck={!ipa}
              aria-label={ipa ? "IPA to speak" : "Text to speak"}
              placeholder={ipa ? "Type IPA, for example ˈhɛloʊ" : "Type something for the voice to say"}
            />
          </div>
          <div className="say-row">
            <div className="say-read">
              <p className="transcription" aria-live="polite">
                {trans ? `/${trans}/` : ""}
              </p>
              <div className="say-skipped" aria-live="polite">
                {skipped.map((l) => (
                  <p key={l.what}>
                    {l.what}: <span className="say-skipped-sym">{l.symbols.join(" ")}</span>
                  </p>
                ))}
              </div>
            </div>
          </div>
          {lang === "es" && (
            <div className="examples" role="group" aria-label="Dialect">
              {(Object.keys(DIALECT_PRESETS) as DialectPreset[]).map((d) => (
                <Chip key={d} on={dialect === d} onClick={() => pickDialect(d)}>
                  {d === "neutro" ? "Neutro" : d === "rioplatense" ? "Rioplatense" : "Castellano"}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </Screen>
      <Screen className="s-score" title="Gestural score">
        <ScoreView />
      </Screen>
      <Screen
        className="s-chart"
        title="Consonants"
        sub="Between two vowels"
        tools={
          <div className="vowel-pick" role="group" aria-label="Vowel around it">
            {["ɑ", "i", "u", "ə"].map((v) => (
              <Chip key={v} on={vowel === v} onClick={() => setVowel(v)} className="ipa-chip">
                {v}
              </Chip>
            ))}
          </div>
        }
      >
        <ConsonantChart onPad={(c) => void pad(c)} />
      </Screen>
      <Screen className="s-tube" title="Tube" sub="Glottis to lips">
        <TubeView />
      </Screen>
      <Screen className="s-folds" title="Vocal folds" sub="Slowed 100×">
        <Stroboscope />
      </Screen>
    </div>
  );
}

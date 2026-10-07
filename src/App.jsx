/**
 * 去趣 TripMate — 多人連線排行程 RPG Prototype（Delta v2）
 * ------------------------------------------------------------------
 * 單檔 React SPA：Tailwind CSS + Framer Motion + lucide-react
 *
 * 流程：SETUP（人格快測 → 預算／網路錨定 → 隊伍預備）
 *      → GAME（視覺小說式 4 站答題：場景背景 + 人格立繪 + 對話框，揭曉時角色演招牌動作）
 *      → SUMMARY（人格結算 + 雙欄常駐 eSIM 導購）
 *
 * 多人連線、AI TripMate、AI 排程皆為前端 Mock，集中在「3. Mock 引擎」區塊。
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence, MotionConfig, animate, useInView, useMotionValue, useTransform, Reorder, useDragControls, useReducedMotion } from "framer-motion";
import {
  Wifi, WifiOff, Users, Copy, Check, X, Sparkles, Radio, RotateCcw, Share2,
  ChevronLeft, Plus, Minus, Signal, Loader, MapPin, Wallet,
  Heart, Trash2, Clock, RefreshCw, LogIn, CalendarDays,
  Ticket, Download, ImageDown, Gauge, Rocket, Lock, Unlock,
  Volume2, VolumeX, Music,
} from "lucide-react";

/* ==================================================================
 * 0. 設計 Token
 * ================================================================== */
const INK = "#1F2350";
const PAGE = "#FFE8D1";
const PERSIMMON = "#FF6B35";
const BODY = "#FFB547";
const CHOICE_COLOR = { A: "#FF6B35", B: "#3E8EDE", C: "#2F9E62", D: "#7C5CE0", AFK: "#9CA3AF" };

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Huninn&family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap');
.tm-root{font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
.tm-display{font-family:'Huninn','Noto Sans TC','PingFang TC',sans-serif;font-weight:400;letter-spacing:.01em}
.tm-hand{font-family:'LXGW WenKai TC','Kaiti TC','DFKai-SB',cursive}
.tm-num{font-variant-numeric:tabular-nums}
.tm-noscroll::-webkit-scrollbar{display:none}
.tm-root :focus-visible{outline:3px solid ${PERSIMMON};outline-offset:2px}
.tm-root input[type="date"]{min-width:0;width:100%;-webkit-appearance:none;appearance:none}
`;

const INPUT =
  "w-full rounded-xl border-[3px] border-[#1F2350] bg-white px-3 py-2.5 text-base font-bold text-[#1F2350] outline-none placeholder:font-normal placeholder:text-[#1F2350]/40 focus:ring-4 focus:ring-[#FFC93C]/70";

const TRIP = { destKey: "osaka", dest: "日本大阪", days: 5, date: "2027-02-03" };
const DESTINATIONS = [
  { key: "osaka", name: "日本大阪", emoji: "🇯🇵", note: "2 月冬季劇本", ready: true },
  { key: "tokyo", name: "日本東京", emoji: "🇯🇵", note: "劇本製作中", ready: false },
  { key: "seoul", name: "韓國首爾", emoji: "🇰🇷", note: "劇本製作中", ready: false },
];
const tripLabel = (d) => `${d} 天 ${d - 1} 夜`;
const fmtDate = (d) => (d || "").split("-").join("/");
const SHARE_BASE = "https://tripmate.example/r/";

/* ==================================================================
 * 0.5 音效引擎（Web Audio 即時合成，不載入任何音檔）
 * ------------------------------------------------------------------
 * 全部用振盪器合成，所以不需要 mp3、沒有授權問題、打包後也不會變大。
 * AudioContext 只能在使用者手勢之後啟動，所以一律 lazy init。
 * ================================================================== */
const AudioEngine = (() => {
  const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
  let ctx = null;
  let sfxBus = null;
  let musicBus = null;
  let sfxOn = true;
  let bgmOn = false;
  let timer = null;
  let step = 0;
  let nextAt = 0;

  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.5;
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  /* ---------- 合成基本單元 ---------- */
  function tone(bus, { f, to, type = "sine", dur = 0.12, vol = 0.3, at = 0 }) {
    const c = ctx;
    if (!c || !bus) return;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  function noise(bus, { dur = 0.22, vol = 0.14, from = 1800, to = 500, at = 0 }) {
    const c = ctx;
    if (!c || !bus) return;
    const t = c.currentTime + at;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ---------- 音效表 ---------- */
  const RECIPES = {
    // 一般點擊：短、鈍、不刺耳，連點也不會吵
    tap: (b) => tone(b, { f: 520, to: 430, type: "triangle", dur: 0.06, vol: 0.16 }),
    // 選項命中：兩段上行的小方波，像選單游標
    select: (b) => {
      tone(b, { f: 620, type: "square", dur: 0.05, vol: 0.09 });
      tone(b, { f: 930, type: "square", dur: 0.08, vol: 0.075, at: 0.045 });
    },
    back: (b) => {
      tone(b, { f: 480, type: "triangle", dur: 0.06, vol: 0.12 });
      tone(b, { f: 330, type: "triangle", dur: 0.09, vol: 0.1, at: 0.05 });
    },
    // 卡片彈出
    pop: (b) => tone(b, { f: 700, to: 1050, type: "sine", dur: 0.11, vol: 0.16 }),
    // 轉場風切
    swoosh: (b) => {
      noise(b, { dur: 0.38, vol: 0.13, from: 2600, to: 420 });
      tone(b, { f: 300, to: 620, type: "sine", dur: 0.3, vol: 0.09, at: 0.04 });
    },
    // 抵達新站
    arrive: (b) => {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(b, { f, type: "triangle", dur: 0.26, vol: 0.13, at: i * 0.075 }));
      tone(b, { f: 1046.5, type: "sine", dur: 0.4, vol: 0.09, at: 0.23 });
    },
    // 右滑收藏
    like: (b) => {
      tone(b, { f: 660, to: 990, type: "sine", dur: 0.13, vol: 0.15 });
      tone(b, { f: 1320, type: "sine", dur: 0.16, vol: 0.07, at: 0.1 });
    },
    // 左滑略過
    nope: (b) => {
      noise(b, { dur: 0.16, vol: 0.08, from: 900, to: 260 });
      tone(b, { f: 300, to: 190, type: "triangle", dur: 0.14, vol: 0.1 });
    },
    // 結果揭曉
    success: (b) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(b, { f, type: "triangle", dur: 0.3, vol: 0.14, at: i * 0.09 }));
    },
    // 大成就（購買完成、人格揭曉）
    fanfare: (b) => {
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(b, { f, type: "square", dur: 0.26, vol: 0.09, at: i * 0.085 }));
      [392, 523.25, 783.99].forEach((f) => tone(b, { f: f / 2, type: "sine", dur: 0.7, vol: 0.1, at: 0.42 }));
    },
    // 折扣碼 / 金幣
    coin: (b) => {
      tone(b, { f: 988, type: "square", dur: 0.07, vol: 0.1 });
      tone(b, { f: 1319, type: "square", dur: 0.3, vol: 0.09, at: 0.06 });
    },
    // 定版：厚實的一聲
    lock: (b) => {
      tone(b, { f: 180, to: 90, type: "square", dur: 0.16, vol: 0.18 });
      noise(b, { dur: 0.12, vol: 0.1, from: 600, to: 180, at: 0.02 });
    },
    unlock: (b) => {
      tone(b, { f: 240, to: 420, type: "square", dur: 0.15, vol: 0.13 });
    },
    // AI 提醒 / 排不下
    warn: (b) => {
      tone(b, { f: 440, type: "square", dur: 0.11, vol: 0.09 });
      tone(b, { f: 330, type: "square", dur: 0.18, vol: 0.09, at: 0.12 });
    },
    // 連線中：兩聲握手嗶
    dial: (b) => {
      tone(b, { f: 1180, type: "square", dur: 0.05, vol: 0.06 });
      tone(b, { f: 880, type: "square", dur: 0.05, vol: 0.055, at: 0.09 });
    },
    // 重試：很輕的一聲，每隔幾百毫秒來一次才有「還在轉」的感覺
    retry: (b) => tone(b, { f: 760, to: 700, type: "square", dur: 0.035, vol: 0.035 }),
    // 訊號斷裂的雜訊
    glitch: (b) => {
      noise(b, { dur: 0.2, vol: 0.1, from: 3200, to: 900 });
      tone(b, { f: 620, to: 210, type: "sawtooth", dur: 0.16, vol: 0.055, at: 0.03 });
      noise(b, { dur: 0.1, vol: 0.06, from: 1600, to: 500, at: 0.22 });
    },
    // 載入失敗：往下掉，收在一記悶響
    fail: (b) => {
      tone(b, { f: 392, type: "square", dur: 0.14, vol: 0.09 });
      tone(b, { f: 311, type: "square", dur: 0.16, vol: 0.085, at: 0.13 });
      tone(b, { f: 233, type: "square", dur: 0.3, vol: 0.08, at: 0.27 });
      tone(b, { f: 90, to: 55, type: "sine", dur: 0.5, vol: 0.12, at: 0.3 });
    },
    // 角色動作：合拍時一串往上的和弦
    cheer: (b) => {
      [659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(b, { f, type: "triangle", dur: 0.18, vol: 0.12, at: i * 0.06 }));
    },
    // 角色動作：衝突時「咚」一聲
    bonk: (b) => {
      tone(b, { f: 220, to: 70, type: "square", dur: 0.22, vol: 0.15 });
      noise(b, { dur: 0.15, vol: 0.12, from: 1400, to: 300 });
    },
    // 打字：非常輕的一聲，連續播也不刺耳
    blip: (b) => tone(b, { f: 1150, to: 1000, type: "square", dur: 0.022, vol: 0.022 }),
    // 出發：往上衝的風切 + 爬升音
    takeoff: (b) => {
      noise(b, { dur: 0.7, vol: 0.1, from: 300, to: 3400 });
      tone(b, { f: 180, to: 720, type: "triangle", dur: 0.65, vol: 0.11 });
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(b, { f, type: "triangle", dur: 0.3, vol: 0.1, at: 0.6 + i * 0.09 }));
    },
  };

  /* ---------- 背景音樂：兩種情緒，各自 4 小節循環 ----------
   * calm：快測／結算／排行程用。F–C–Dm–B♭，84 BPM，只有 pad + 低音 + 疏的旋律。
   * game：4 回合答題用。Am–F–C–G，116 BPM，加上大鼓、hi-hat 和更密的旋律。
   * ------------------------------------------------------------------ */
  const hz = (m) => 440 * (2 ** ((m - 69) / 12));

  const MOODS = {
    calm: {
      step: 0.357, // ≈ 84 BPM 的八分音符
      chords: [
        { pad: [65, 69, 72], bass: 41 }, // F
        { pad: [64, 67, 72], bass: 36 }, // C
        { pad: [65, 69, 74], bass: 38 }, // Dm
        { pad: [65, 70, 74], bass: 34 }, // B♭
      ],
      // 只在 0/2/4/6 放旋律，留白才不會聽膩
      lead: [
        [69, null, 72, null, 74, null, 72, null],
        [67, null, 72, null, 76, null, 72, null],
        [69, null, 74, null, 77, null, 74, null],
        [70, null, 74, null, 72, null, 69, null],
      ],
      bassBeats: [0, 4],
      drums: false,
      padVol: 0.055, bassVol: 0.11, leadVol: 0.075,
      leadType: "triangle", bassType: "triangle",
      padCut: 1500,
    },
    game: {
      step: 0.2586, // ≈ 116 BPM，明顯比 calm 快
      chords: [
        { pad: [64, 69, 72], bass: 33 }, // Am
        { pad: [65, 69, 72], bass: 29 }, // F
        { pad: [64, 67, 72], bass: 36 }, // C
        { pad: [62, 67, 71], bass: 31 }, // G
      ],
      // 音符變密、加切分，推著人往前
      lead: [
        [69, null, 72, 74, null, 76, null, 74],
        [72, null, 69, 72, null, 77, null, 76],
        [76, null, 79, 76, null, 72, null, 74],
        [74, null, 71, 74, null, 79, null, 76],
      ],
      bassBeats: [0, 3, 4, 6], // 切分低音
      drums: true,
      padVol: 0.03, bassVol: 0.13, leadVol: 0.085,
      leadType: "square", bassType: "sawtooth",
      padCut: 1100,
    },
  };
  let mood = "calm";

  function playStep(i, t) {
    const c = ctx;
    if (!c || !musicBus) return;
    const M = MOODS[mood];
    const bar = Math.floor(i / 8) % 4;
    const beat = i % 8;
    const pass = Math.floor(i / 32);
    const chord = M.chords[bar];
    const S = M.step;

    const env = (node, vol, attack, dur) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      node.connect(g);
      g.connect(musicBus);
      return g;
    };

    // 和聲墊
    if (beat === 0) {
      chord.pad.forEach((m) => {
        const osc = c.createOscillator();
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = M.padCut;
        osc.type = "sine";
        osc.frequency.value = hz(m);
        osc.connect(lp);
        env(lp, M.padVol, 0.35, S * 7.4);
        osc.start(t);
        osc.stop(t + S * 7.5);
      });
    }

    // 低音
    if (M.bassBeats.includes(beat)) {
      const osc = c.createOscillator();
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      osc.type = M.bassType;
      osc.frequency.value = hz(chord.bass);
      osc.connect(lp);
      env(lp, M.bassVol, 0.02, S * 1.5);
      osc.start(t);
      osc.stop(t + S * 1.6);
    }

    // 旋律：每隔一輪拿掉一個音，聽起來像有呼吸
    const note = M.lead[bar][beat];
    if (note && !(pass % 2 === 1 && beat === 6)) {
      const osc = c.createOscillator();
      osc.type = M.leadType;
      osc.frequency.value = hz(note + (pass % 4 === 3 ? 12 : 0));
      env(osc, M.leadVol, 0.03, S * 1.3);
      osc.start(t);
      osc.stop(t + S * 1.4);
    }

    // 鼓組：只有 game 有，這是「刺激」最主要的來源
    if (M.drums) {
      if (beat === 0 || beat === 4 || (beat === 6 && pass % 2 === 1)) {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.11);
        env(osc, 0.2, 0.006, 0.16);
        osc.start(t);
        osc.stop(t + 0.2);
      }
      if (beat === 4) { // 小鼓
        const len = Math.floor(c.sampleRate * 0.13);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let k = 0; k < len; k += 1) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
        const src = c.createBufferSource();
        src.buffer = buf;
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1900;
        bp.Q.value = 0.7;
        src.connect(bp);
        env(bp, 0.075, 0.004, 0.13);
        src.start(t);
        src.stop(t + 0.15);
      }
      if (beat % 2 === 1) { // hi-hat 踩在反拍
        const len = Math.floor(c.sampleRate * 0.035);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let k = 0; k < len; k += 1) d[k] = (Math.random() * 2 - 1) * (1 - k / len);
        const src = c.createBufferSource();
        src.buffer = buf;
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 6500;
        src.connect(hp);
        env(hp, 0.045, 0.003, 0.035);
        src.start(t);
        src.stop(t + 0.05);
      }
    }
  }

  function tick() {
    const c = ensure();
    if (!c) return;
    const S = MOODS[mood].step;
    while (nextAt < c.currentTime + 0.4) {
      if (nextAt < c.currentTime) nextAt = c.currentTime + 0.05;
      playStep(step, nextAt);
      nextAt += S;
      step += 1;
    }
  }

  function startMusic(fadeIn = 2) {
    const c = ensure();
    if (!c || timer) return;
    nextAt = c.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(c.currentTime);
    musicBus.gain.setValueAtTime(0.0001, c.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(0.5, c.currentTime + fadeIn);
    tick();
    timer = setInterval(tick, 120);
  }

  function stopMusic() {
    if (ctx && musicBus) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      musicBus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 換情緒：淡出舊的循環，從頭接上新的，避免兩段音樂疊在一起
  let swap = null;
  function setMood(name) {
    if (!MOODS[name] || name === mood) return;
    mood = name;
    if (!bgmOn) return;
    const c = ensure();
    if (!c || !timer) return;
    musicBus.gain.cancelScheduledValues(c.currentTime);
    musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), c.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
    clearInterval(timer);
    timer = null;
    clearTimeout(swap);
    swap = setTimeout(() => {
      if (!bgmOn || mood !== name) return;
      step = 0;
      startMusic(0.7);
    }, 420);
  }

  return {
    play(name) {
      if (!sfxOn) return;
      const c = ensure();
      if (!c) return;
      (RECIPES[name] || RECIPES.tap)(sfxBus);
    },
    setSfx(on) {
      sfxOn = on;
      if (on) {
        ensure();
        (RECIPES.pop)(sfxBus);
      }
    },
    setBgm(on) {
      bgmOn = on;
      if (on) startMusic();
      else stopMusic();
    },
    // 'calm'（快測／結算／排行程）或 'game'（4 回合答題）
    setMood,
    // 進到遊戲畫面時，如果使用者已經開了音樂就接著播
    resume() {
      if (bgmOn) startMusic();
    },
    get sfxOn() { return sfxOn; },
    get bgmOn() { return bgmOn; },
  };
})();

const sfx = (name) => AudioEngine.play(name);

/* ==================================================================
 * 1. 8 大旅遊人格 · 偏好維度 · 關鍵字判定
 * ================================================================== */
const PERSONA_ORDER = ["soldier", "capybara", "camera", "shopper", "accountant", "explorer", "taxi", "nanny"];

const PERSONAS = {
  soldier: {
    name: "行程特種兵", short: "特種兵", emoji: "⏱️", color: "#D9481F", soft: "#FFE1D3",
    title: "分秒必爭的晨型衝刺兵",
    trait: "Excel 精準到分鐘、早起吃早餐、跑滿所有景點。",
    quote: "離下一班車還有 4 分鐘，大家加快！",
    gear: ["運動頭帶", "碼錶運動手錶"],
    roast: "{name}的 Excel 已經排到回程登機前 3 分鐘，請全隊配合演出。",
  },
  capybara: {
    name: "隨性慢活水豚", short: "慢活水豚", emoji: "😎", color: "#2A83AD", soft: "#DDF1FA",
    title: "睡飽才有靈魂的鬆弛大師",
    trait: "佛系鬆弛感、睡到自然醒，是全隊情緒最穩定的安全氣囊。",
    quote: "都可以啊，你們決定就好～",
    gear: ["充氣頸枕", "冰咖啡"],
    roast: "{name}是全隊的情緒安全氣囊，吵架時請直接把他推到中間。",
  },
  camera: {
    name: "移動打卡機", short: "打卡機", emoji: "📸", color: "#C93C7E", soft: "#FFE0EE",
    title: "隨時開機的行走攝影棚",
    trait: "行程可以少走，但出片率不能低，專攻 IG 爆紅機位與網美光影。",
    quote: "先別動！這道菜／這個景讓我拍兩張！",
    gear: ["拍立得相機", "頭頂墨鏡"],
    roast: "{name}的相簿會比行程表還長，每一站請預留 5 分鐘補光時間。",
  },
  shopper: {
    name: "暴走購物狂", short: "購物狂", emoji: "🛍️", color: "#B8440E", soft: "#FFE7CC",
    title: "行李箱留半箱的掃貨獵人",
    trait: "行李箱留半箱出發、退稅滿額達人，最容易引發分流的關鍵人物。",
    quote: "這台灣買不到！退稅算下來等於打六折！",
    gear: ["滿載免稅購物袋", "保暖毛帽"],
    roast: "{name}出發時行李箱是空的，回程可能要幫他加購一件行李。",
  },
  accountant: {
    name: "旅費精算師", short: "精算師", emoji: "🧮", color: "#7A5A12", soft: "#F6ECCB",
    title: "每一塊錢都有去處的財務大臣",
    trait: "匯率與信用卡回饋權威，主動去零頭分帳的財務大臣。",
    quote: "這間有 10% 券，刷這張折抵最划算。",
    gear: ["復古計算機", "折價券票夾"],
    roast: "{name}已經把這趟旅費算到小數點後兩位，連零錢都有歸宿。",
  },
  explorer: {
    name: "靈魂探險家", short: "探險家", emoji: "🧭", color: "#6245C4", soft: "#ECE5FF",
    title: "轉個彎就有故事的巷弄偵探",
    trait: "City Walk 流浪者，熱愛下町巷弄、美術館與隱密小酒館。",
    quote: "前面巷子很有味道，我們走過去看看！",
    gear: ["私房地圖手冊", "漁夫帽"],
    roast: "{name}說「轉個彎就到」的時候，請先確認大家手機還有網路。",
  },
  taxi: {
    name: "尊榮計程車星人", short: "計程車星人", emoji: "🚕", color: "#9A7400", soft: "#FFF3C4",
    title: "能坐絕不站的移動貴族",
    trait: "能坐絕不站，走路超過 12 分鐘立刻叫 Uber 的體力儲值型。",
    quote: "走路要 15 分鐘？叫車平攤一人幾十塊，上車！",
    gear: ["懸浮計程車車頂燈", "VIP 徽章"],
    roast: "{name}的每日步數目標是 3,000 步，其中 2,000 步是走去上車。",
  },
  nanny: {
    name: "全能旅行保母", short: "旅行保母", emoji: "🎒", color: "#1F7A55", soft: "#DDF5EA",
    title: "四次元百寶袋的全隊靠山",
    trait: "四次元百寶袋（藥品、行動電源、備份護照），隨時照看全場。",
    quote: "有人口渴嗎？有人需要行動電源嗎？",
    gear: ["救急醫療包", "和平徽章"],
    roast: "{name}的背包裡裝著全隊的備份人生，請不要讓他一個人背。",
  },
};

const DIMS = [
  { key: "food", label: "美食", icon: "🍜", verb: "吃美食" },
  { key: "shop", label: "購物", icon: "🛍️", verb: "買到底" },
  { key: "photo", label: "拍照", icon: "📸", verb: "拍好拍滿" },
  { key: "chill", label: "放空", icon: "☁️", verb: "躺平放空" },
  { key: "explore", label: "探索", icon: "🧭", verb: "鑽巷弄" },
  { key: "hustle", label: "衝刺", icon: "⚡", verb: "衝行程" },
];

const PERSONA_DIMS = {
  soldier: { hustle: 3 }, capybara: { chill: 3 }, camera: { photo: 3 }, shopper: { shop: 3 },
  accountant: { food: 2, shop: 1 }, explorer: { explore: 3 }, taxi: { chill: 2, food: 1 },
  nanny: { hustle: 1, chill: 1, food: 1 },
};

const KEYWORD_RULES = {
  soldier: /早起|準時|衝|趕|搶|排隊|刷|設施|效率|跑/,
  capybara: /睡|躺|賴床|放空|休息|都可以|隨便|佛系|慢慢/,
  camera: /拍|照|打卡|IG|網美|出片|自拍|相機|布丁/i,
  shopper: /買|購|逛|掃貨|退稅|藥妝|爆買|戰利品|shopping/i,
  accountant: /省|便宜|划算|券|折|匯率|分帳|預算|比價|回饋/,
  explorer: /巷|散步|漫步|探險|走走|美術館|小酒館|在地|迷路|city ?walk/i,
  taxi: /車|uber|計程|taxi/i,
  nanny: /照顧|藥品|胃藥|成藥|行動電源|暖暖包|喝水|保暖|大家|幫忙|備用/,
};

/* ==================================================================
 * 2. SETUP 資料：3 題人格快測 · 預算錨定（網路方案改在第 1 站由趣趣提問）
 * ================================================================== */
const QUIZ = [
  {
    id: "q1", ask: "在超好看的街景前，你的第一個動作是？",
    a: { key: "photo", icon: "📸", label: "先拍！出片率最重要", sub: "機位、光線、角度我來喬" },
    b: { key: "deep", icon: "🧭", label: "先走進去，體驗最重要", sub: "照片之後再說，先聞聞味道" },
  },
  {
    id: "q2", ask: "旅途中的早晨，你通常是？",
    a: { key: "early", icon: "⏰", label: "07:00 起床衝第一攤", sub: "早餐是行程的一部分" },
    b: { key: "late", icon: "🛏️", label: "睡到自然醒才有靈魂", sub: "中午出門也是一種節奏" },
  },
  {
    id: "q3", ask: "出發前的行程表，你的版本是？",
    a: { key: "plan", icon: "📊", label: "Excel 排到分鐘，附備案", sub: "雨天備案、交通轉乘都寫好" },
    b: { key: "free", icon: "🍃", label: "到了再說，隨興隨緣", sub: "只訂機票飯店，其他看心情" },
  },
];

// 3 題二選一 → 8 種組合，剛好對應 8 款人格雛形
const QUIZ_MAP = {
  "deep-early-plan": "soldier",
  "deep-early-free": "explorer",
  "deep-late-plan": "accountant",
  "deep-late-free": "capybara",
  "photo-early-plan": "camera",
  "photo-early-free": "shopper",
  "photo-late-plan": "nanny",
  "photo-late-free": "taxi",
};

const BUDGETS = [
  { key: "thrifty", icon: "🪙", name: "特級小資", range: "2 萬內", desc: "住青旅、吃巷弄、購物克制", mealCap: 800, color: "#2F9E62" },
  { key: "standard", icon: "💳", name: "標準玩家", range: "2～4 萬", desc: "商務旅館，該吃吃該買買", mealCap: 1500, color: "#3E8EDE" },
  { key: "luxury", icon: "💎", name: "奢華富豪", range: "4 萬以上", desc: "好飯店、名店預約，放心掃貨", mealCap: 99999, color: "#B8440E" },
];

const NETWORKS = [
  { key: "esim", icon: "📶", name: "去趣 eSIM 每日 2GB", price: 41, desc: "掃 QR 立刻開通，可自選電信商線路", perk: "網路一切順暢", tag: "推薦" },
  { key: "roaming", icon: "📱", name: "電信漫遊 1GB／日", price: 30, desc: "超量後降速，人多的地方最容易卡" },
  { key: "wifi", icon: "🆓", name: "到當地找免費 Wi-Fi", price: 0, desc: "最省，但離開店家就等於失聯" },
];

/* ==================================================================
 * 3. 大地圖節點 & 4 回合大阪冬季題庫
 * ================================================================== */
const MAP_NODES = [
  { key: "market", emoji: "🐟", name: "難波・木津市場", x: 12, y: 74, temp: "5°C" },
  { key: "usj", emoji: "🎢", name: "日本環球影城 USJ", x: 33, y: 30, temp: "4°C" },
  { key: "dotonbori", emoji: "🦀", name: "道頓堀", x: 55, y: 72, temp: "6°C" },
  { key: "shinsaibashi", emoji: "🛍️", name: "心齋橋筋商店街", x: 76, y: 28, temp: "4°C" },
  { key: "hotel", emoji: "🏨", name: "飯店大廳（集合）", x: 93, y: 68, temp: "3°C" },
];

const ROUNDS = [
  {
    id: 1, node: 0, bg: "room", title: "晨間集合", subtitle: "大阪冬晨的起床考驗", clock: "07:00 清晨",
    scene: "2 月初的大阪清晨只有 5 度，窗外冷風颼颼，但今天原定要一早衝去木津卸賣市場吃排隊海鮮丼與白草莓⋯⋯",
    line: "早安⋯⋯窗外只有 5 度耶。今天本來要一早衝木津市場，吃排隊海鮮丼跟白草莓的，你還起得來嗎？", face: "think",
    placeholder: "輸入你的真實應對⋯⋯",
    advice: "這半天直接分頭走，友情比較保險。",
    options: {
      A: { tag: "特種兵／保母", short: "07:00 衝市場", text: "07:00 準時掀被子出發！頂著寒風也要搶第一輪入座吃海膽！", w: { soldier: 3, nanny: 2 }, d: { food: 3, hustle: 3 } },
      B: { tag: "慢活水豚／佛系", short: "賴床到 10 點", text: "鑽回被窩賴床到 10 點，樓下超商買個熱包子和熱咖啡解決。", w: { capybara: 3 }, d: { chill: 3, food: 1 } },
      C: { tag: "計程車／精算師", short: "叫 Uber 直達", text: "拒絕在寒風中走路吹風，立刻開 App 叫 Uber 直達市場門口。", w: { taxi: 3, accountant: 2 }, d: { food: 2, chill: 1 } },
    },
  },
  {
    id: 2, node: 1, bg: "park", title: "USJ 的分歧考驗", subtitle: "整理券只剩下午極少時段", clock: "10:30 上午",
    scene: "全隊抵達 USJ，入園才發現「超級任天堂世界」整理券只剩下午極少時段，且園區人潮滿患——所有人同時掏出手機⋯⋯",
    line: "糟了！超級任天堂世界的整理券只剩下午幾個時段，園區又爆滿⋯⋯大家都掏出手機了，你要怎麼辦？", face: "surprise",
    placeholder: "輸入你的遊園大招⋯⋯",
    advice: "USJ 這 3 小時建議分流，晚點再約集合時間。",
    options: {
      A: { tag: "特種兵／打卡機", short: "狂刷搶整理券", text: "狂刷 App 搶整理券與 Fast Pass，接著直衝哈利波特城堡拍冬季雪景！", w: { soldier: 3, camera: 2 }, d: { hustle: 3, photo: 2 }, needNet: true },
      B: { tag: "暴走購物狂", short: "商店掃貨", text: "既然設施要排 120 分鐘，直接殺進商店把瑪利歐星星爆米花桶買齊！", w: { shopper: 3 }, d: { shop: 3 } },
      C: { tag: "City Walk 探險家", short: "漫步看巡演", text: "放棄排隊，買杯熱奶油啤酒在園區街道漫步、看巡演。", w: { explorer: 3, capybara: 1 }, d: { explore: 2, chill: 1, food: 1 } },
    },
  },
  {
    id: 3, node: 2, bg: "canal", title: "道頓堀晚餐攻防", subtitle: "預算與食慾的正面對決", clock: "18:00 傍晚",
    scene: "細雨中的道頓堀，霓虹全開、香味四溢。名店門口排著長龍，隔壁巷子也飄出醬香，大家的肚子同時叫了⋯⋯",
    line: "聞到了嗎？名店門口排了長長一條，可是隔壁巷子也飄出醬香⋯⋯大家肚子同時叫了，今晚吃哪邊？", face: "happy",
    placeholder: "輸入你的晚餐方案⋯⋯",
    advice: "晚餐可以各吃各的，甜點再會合。",
    options: {
      A: { tag: "名店奢華／打卡機", short: "蟹道樂全席", text: "衝蟹道樂本店螃蟹全席，配黑門和牛串——來都來了，一人約 NT$2,500。", w: { camera: 2, shopper: 2 }, d: { food: 3, photo: 1 }, price: 2500 },
      B: { tag: "CP 值精算／探險家", short: "巷弄大阪燒", text: "打開 Tabelog 找隔壁巷子 3.6 分的隱藏版大阪燒＋章魚燒，一人約 NT$600。", w: { accountant: 3, explorer: 2 }, d: { food: 3, explore: 1 }, price: 600 },
      C: { tag: "慢活／計程車", short: "超商回飯店", text: "腳快斷了，超商買熱食和罐裝啤酒，回飯店邊泡腳邊吃，一人約 NT$300。", w: { capybara: 3, taxi: 2 }, d: { chill: 3, food: 1 }, price: 300 },
    },
  },
  {
    id: 4, node: 3, bg: "arcade", title: "心齋橋分流行動", subtitle: "20:30 打烊前的最後衝刺", clock: "18:30 夜晚",
    scene: "夜幕降臨心齋橋筋商店街，藥妝店、Bic Camera 與古著店分散在不同街區，而店鋪即將在 20:30 打烊⋯⋯",
    line: "藥妝店、Bic Camera、古著店散在不同街區，而且 20:30 就打烊⋯⋯只剩兩小時，你想怎麼分？", face: "worry",
    placeholder: "輸入你的最後衝刺方式⋯⋯",
    advice: "今晚分頭逛，回飯店再開戰利品發表會。",
    options: {
      A: { tag: "原地分流自由行", short: "原地分流", text: "時間不夠了！原地解散分頭逛 2 小時，靠網路傳比價與照片，晚上飯店集合。", w: { shopper: 2, explorer: 2, camera: 1, soldier: 1 }, d: { shop: 2, explore: 2 }, needNet: true },
      B: { tag: "全員抱團行動", short: "全員抱團", text: "天冷迷路很麻煩！大家緊緊跟在一起，一間一間陪著逛到底。", w: { nanny: 3, soldier: 1 }, d: { shop: 1, hustle: 1 } },
      C: { tag: "定點駐紮避難", short: "星巴克駐紮", text: "我完全走不動了，你們去逛，我找一間星巴克坐著等你們來領我。", w: { capybara: 2, taxi: 2 }, d: { chill: 3 } },
    },
  },
];

const MOCK_POOL = [
  { id: "m1", name: "小明", color: "#3E8EDE", type: "soldier", alt: "nanny", dLines: { 1: "單人通道狂刷設施", 3: "我先衝 Bic 再回來接人" } },
  { id: "m2", name: "阿美", color: "#E0508F", type: "shopper", alt: "camera", dLines: { 0: "先拍窗外雪景再出門", 3: "直奔藥妝店掃貨" } },
  { id: "m3", name: "阿強", color: "#2F9E62", type: "capybara", alt: "taxi", dLines: { 0: "躺著叫外送到飯店", 2: "直接叫車回飯店睡" } },
  { id: "m4", name: "小芸", color: "#7C5CE0", type: "camera", alt: "explorer", dLines: { 2: "去喫茶店拍網美布丁" } },
  { id: "m5", name: "阿凱", color: "#C98A00", type: "accountant", alt: "taxi", dLines: { 0: "先查市場有沒有折價券", 1: "比價完再決定買哪個" } },
];


/* 視覺小說用的隊友台詞：每站依人格各一句，舞台上輪流由 1～2 位隊友講 */
const CHATTER = [
  {
    soldier: "五點半就醒了，鞋都穿好了，誰還在被窩裡？",
    capybara: "5 度欸⋯⋯被窩就是我的領土，午餐再叫我。",
    camera: "清晨的光超柔！窗戶結霜先讓我拍一張再說。",
    shopper: "市場隔壁的乾貨店 8 點開，要不要順路掃一波？",
    accountant: "早市海鮮丼比晚上便宜三成，早起等於賺到。",
    explorer: "市場後面那條巷子聽說有間老喫茶，我想去探探。",
    taxi: "走過去要 15 分鐘？我已經打開叫車 App 了。",
    nanny: "暖暖包我帶了 8 片，出門前每人先拿兩片！",
  },
  {
    soldier: "整理券倒數 30 秒，手機電量 100%，準備開刷！",
    capybara: "要排 120 分鐘⋯⋯我可以在長椅上等你們嗎。",
    camera: "城堡配雪景！這個機位今天不拍會後悔一輩子。",
    shopper: "限定爆米花桶只剩最後幾批，我先衝商店了！",
    accountant: "快速通關一張多少？我算一下每分鐘的成本。",
    explorer: "後街好像有冬季巡演，人比較少，要不要繞過去？",
    taxi: "園區這麼大⋯⋯有沒有接駁車可以坐？",
    nanny: "人太多了，走散的話就回這個門口集合喔！",
  },
  {
    soldier: "晚餐 40 分鐘內解決，後面還有三個點要跑。",
    capybara: "我只想找個有暖氣的位子坐下來⋯⋯",
    camera: "霓虹燈下拍食物，出片率直接翻倍！",
    shopper: "吃完剛好去旁邊那間 24 小時折扣店！",
    accountant: "名店一人兩千五？巷子那間 3.6 分只要六百。",
    explorer: "巷子裡飄出來的醬香，跟著味道走就對了。",
    taxi: "下雨了，哪間離車站近我就選哪間。",
    nanny: "有人胃不舒服嗎？我包包裡有帶胃藥。",
  },
  {
    soldier: "藥妝 30 分、家電 40 分、剩下機動，照表操課！",
    capybara: "你們去逛，我找個有插座的位子幫自己充電。",
    camera: "商店街的燈光好有氛圍，給我五分鐘拍夜景。",
    shopper: "滿五千日圓就能退稅，我的清單已經列好了！",
    accountant: "退稅記得同一間合併結帳，我幫大家算。",
    explorer: "堀江那邊的古著巷，我想自己去晃晃。",
    taxi: "逛完叫一台大車回飯店，戰利品太重了。",
    nanny: "分頭的話，每 30 分鐘在群組報平安喔！",
  },
];

/* ==================================================================
 * 4. Mock 引擎（之後替換成 WebSocket / LLM API 的位置）
 * ================================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const money = (n) => `NT$${n.toLocaleString("en-US")}`;

function couponCode() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let x = "";
  for (let i = 0; i < 4; i += 1) x += cs[Math.floor(Math.random() * cs.length)];
  return `QU-${x}`;
}

function randomCode() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i += 1) s += cs[Math.floor(Math.random() * cs.length)];
  return `OSK-${s}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function buildPlayers(name, size, isHost = true) {
  const me = { id: "me", name: name || "趣友", color: PERSIMMON, isUser: true, isHost };
  const mocks = MOCK_POOL.slice(0, Math.max(1, size - 1)).map((m, i) => ({ ...m, isUser: false, isHost: !isHost && i === 0 }));
  return isHost ? [me, ...mocks] : [mocks[0], me, ...mocks.slice(1)];
}

function pickMockAnswer(mock, roundIdx) {
  const opts = ROUNDS[roundIdx].options;
  const line = mock.dLines?.[roundIdx];
  if (line && Math.random() < 0.4) return { choice: "D", custom: line };
  const fit = (k) => (opts[k].w[mock.type] || 0) + (opts[k].w[mock.alt] || 0) * 0.6;
  const best = ["A", "B", "C"].sort((a, b) => fit(b) - fit(a))[0];
  if (fit(best) > 0 && Math.random() < 0.78) return { choice: best, custom: "" };
  return { choice: ["A", "B", "C"][Math.floor(Math.random() * 3)], custom: "" };
}

/** Mock AI：從選項 D 的自訂文字抓關鍵字，判定偏向哪些人格 */
function classifyCustom(text = "") {
  return Object.entries(KEYWORD_RULES)
    .map(([key, re]) => {
      const m = text.match(re);
      return m ? { key, word: m[0] } : null;
    })
    .filter(Boolean);
}

function answerWeights(roundIdx, ans) {
  if (!ans || ans.choice === "AFK") return { w: {}, d: {} };
  if (ans.choice === "D") {
    const hits = classifyCustom(ans.custom);
    if (!hits.length) return { w: { explorer: 2 }, d: { explore: 2 } };
    const w = {};
    const d = {};
    hits.forEach((h) => {
      w[h.key] = (w[h.key] || 0) + 3;
      Object.entries(PERSONA_DIMS[h.key]).forEach(([k, v]) => { d[k] = (d[k] || 0) + v; });
    });
    return { w, d };
  }
  const opt = ROUNDS[roundIdx].options[ans.choice];
  return { w: opt.w, d: opt.d };
}

/** 人格判定：快測雛形（+2.5 起手分）＋ 4 回合權重，最高分勝出 */
function computeProfile(answers, seedPersona) {
  const score = Object.fromEntries(PERSONA_ORDER.map((k) => [k, 0]));
  const dims = Object.fromEntries(DIMS.map((d) => [d.key, 0]));
  if (seedPersona) {
    score[seedPersona] += 2.5;
    Object.entries(PERSONA_DIMS[seedPersona]).forEach(([k, v]) => { dims[k] += v * 0.5; });
  }
  answers.forEach((a, i) => {
    const { w, d } = answerWeights(i, a);
    Object.entries(w).forEach(([k, v]) => { score[k] += v + (i + 1) * 0.001; });
    Object.entries(d).forEach(([k, v]) => { dims[k] += v; });
  });
  const ranked = [...PERSONA_ORDER].sort((a, b) => score[b] - score[a]);
  const persona = score[ranked[0]] > 0 ? ranked[0] : "capybara";
  const total = PERSONA_ORDER.reduce((s, k) => s + score[k], 0) || 1;
  const mix = ranked.slice(0, 3).filter((k) => score[k] > 0).map((k) => ({ key: k, pct: Math.round((score[k] / total) * 100) }));
  return { persona, score, dims, mix };
}

function sameChoice(a, b) {
  if (!a || !b || a.choice === "AFK" || b.choice === "AFK") return false;
  if (a.choice === "D" && b.choice === "D") {
    const keys = new Set(classifyCustom(a.custom).map((h) => h.key));
    return classifyCustom(b.custom).some((h) => keys.has(h.key));
  }
  return a.choice === b.choice;
}

const dimVec = (m) => DIMS.map((d) => m.dims[d.key]);
function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  a.forEach((x, i) => { dot += x * b[i]; na += x * x; nb += b[i] * b[i]; });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const topDim = (m) => [...DIMS].sort((x, y) => m.dims[y.key] - m.dims[x.key])[0];

const shortOf = (roundIdx, r) => {
  if (!r || r.choice === "AFK") return "發呆";
  if (r.choice === "D") return r.custom;
  return ROUNDS[roundIdx].options[r.choice].short;
};

function dimDistance(a, b) {
  return Math.sqrt(DIMS.reduce((s, d) => s + ((a[d.key] || 0) - (b[d.key] || 0)) ** 2, 0));
}

/** 預算錨定 × Round 3 晚餐選擇的即時反饋 */
function budgetFeedback(budgetKey, results) {
  const me = results.find((r) => r.player.isUser);
  if (!me || !["A", "B", "C"].includes(me.choice)) return null;
  const price = ROUNDS[2].options[me.choice].price;
  const b = BUDGETS.find((x) => x.key === budgetKey) || BUDGETS[1];
  if (b.key === "thrifty" && price > b.mealCap) {
    return { tone: "warn", text: "超預算了", sub: `一餐 ${money(price)}，你設的是「${b.name}」。` };
  }
  if (b.key === "standard" && price > b.mealCap) {
    return { tone: "warn", text: "小小超支，但值得", sub: `一餐 ${money(price)}，明天吃串炸平衡回來。` };
  }
  if (b.key === "luxury" && price <= 600) {
    return { tone: "luxe", text: "預算還有一大半沒用", sub: `一餐只花 ${money(price)}，可以再加點和牛。` };
  }
  return { tone: "ok", text: "預算剛好", sub: `一餐 ${money(price)}，落在「${b.name}」裡。` };
}

/** 大提示：只點出最極端的分歧，或意外驚人的共識 */
function buildHint(roundIdx, results, ctx) {
  const R = ROUNDS[roundIdx];
  const active = results.filter((r) => r.choice !== "AFK");
  const letters = new Set(active.map((r) => r.choice));
  let headline;
  let sub;
  let worst = null;

  if (active.length >= 2 && letters.size === 1 && !letters.has("D")) {
    headline = `全隊都選「${shortOf(roundIdx, active[0])}」`;
    sub = "這種默契可以直接組戰隊出道。";
  } else {
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const dist = dimDistance(answerWeights(roundIdx, active[i]).d, answerWeights(roundIdx, active[j]).d);
        if (!worst || dist > worst.dist) worst = { a: active[i], b: active[j], dist };
      }
    }
    if (worst && worst.dist > 0) {
      headline = `${worst.a.player.name} vs ${worst.b.player.name} 差最多`;
      sub = `一個要「${shortOf(roundIdx, worst.a)}」，一個想「${shortOf(roundIdx, worst.b)}」。${R.advice}`;
    } else {
      headline = "全隊節奏一致";
      sub = "這一站可以放心一起行動。";
    }
  }

  const rows = [];

  // 誰跟你選一樣 —— 這是多人遊戲最直接的回饋，比分數本身更有感
  const mates = whoMatchedMe(results);
  if (mates.length) {
    rows.push({
      tone: "ok",
      text: `${mates.map((m) => m.name).join("、")} 跟你選一樣`,
      sub: mates.length >= results.length - 1 ? "全隊同步，默契拉滿。" : "默契 +1。",
    });
  } else if (results.length > 1) {
    rows.push({ tone: "warn", text: "只有你這樣選", sub: "分頭行動也是旅行的一部分。" });
  }

  // 玩家自己打字的時候，一定要讓他看到 TripMate 真的讀懂了。
  // hits 本來就有算，只是以前沒有顯示出來，等於承諾了卻沒兌現。
  const mine = results.find((r) => r.player.isUser);
  if (mine?.choice === "D") {
    const words = [...new Set((mine.hits || []).map((h) => h.word))];
    if (words.length) {
      const traits = [...new Set((mine.hits || []).map((h) => PERSONAS[h.key]?.short).filter(Boolean))];
      rows.push({
        tone: "ok",
        text: `你說「${mine.custom}」，抓到${words.map((w) => `「${w}」`).join("")}`,
        sub: traits.length ? `很${traits.join("、")}，排行程會往這方向找。` : "排行程會考慮進去。",
      });
    } else {
      rows.push({
        tone: "warn",
        text: `你說「${mine.custom}」，記下來了`,
        sub: "沒抓到明確關鍵字，但會列入參考。",
      });
    }
  }

  if (roundIdx === 1 && ctx.lagged) {
    rows.push({ tone: "warn", text: "剛才卡住的那幾秒，整理券被搶完了。" });
  }
  if (roundIdx === 1 && ctx.won) {
    rows.push({ tone: "ok", text: "2 秒就搶到整理券，去趣 eSIM 在人潮裡也滿速。" });
  }
  if (roundIdx === 2) {
    const fb = budgetFeedback(ctx.budget, results);
    if (fb) rows.push(fb.tone === "ok" ? { tone: "ok", text: fb.text, sub: fb.sub } : { tone: fb.tone, text: fb.text, sub: fb.sub });
  }

  // 角色招牌動作：先演「最合拍」的一對（優先挑有你在的），再演「差最多」的一對。
  // 動作一律由隊友發動、你當對象，這樣你看到的是隊友對你的反應。
  const front = (a, b) => (a.isUser ? { a: b, b: a } : { a, b });
  let match = null;
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (!sameChoice(active[i], active[j])) continue;
      const withMe = active[i].player.isUser || active[j].player.isUser;
      if (!match || (withMe && !match.withMe)) match = { a: active[i].player, b: active[j].player, withMe };
    }
  }
  const duels = [];
  if (match) duels.push({ mode: "agree", ...front(match.a, match.b) });
  if (worst && worst.dist > 0) duels.push({ mode: "conflict", ...front(worst.a.player, worst.b.player) });
  return { headline, sub, rows, duels };
}

function pairReason(pair, good) {
  if (good) {
    const r = pair.a.answers.findIndex((a, i) => sameChoice(a, pair.b.answers[i]));
    if (r >= 0) return `第 ${r + 1} 站都選了「${shortOf(r, pair.a.answers[r])}」，偏好雷達也最接近。`;
    return "偏好雷達最接近，一起行動最省心。";
  }
  const ta = topDim(pair.a);
  const tb = topDim(pair.b);
  return ta.key === tb.key ? "節奏落差最大，建議把分流時段排開。" : `一個想${ta.verb}、一個想${tb.verb}，分流時段最適合他們。`;
}

/* ---------- AI 黃金比例行程（Mock） ---------- */
const NIGHT_GROUPS = {
  haul: { key: "haul", icon: "🛍️", name: "藥妝＋Bic Camera 掃貨組", desc: "免稅滿額一次到位" },
  photo: { key: "photo", icon: "📸", name: "美國村出片組", desc: "三角公園霓虹夜拍" },
  alley: { key: "alley", icon: "🧭", name: "堀江古著巷弄組", desc: "古著店＋隱密小酒館" },
  camp: { key: "camp", icon: "☕", name: "星巴克駐紮組", desc: "顧戰利品、充電、等人來領" },
};
const NIGHT_OF = { shopper: "haul", accountant: "haul", soldier: "haul", camera: "photo", explorer: "alley" };

function buildPlan(members, days = 5) {
  const map = new Map();
  members.forEach((m) => {
    const key = m.answers[3]?.choice === "C" ? "camp" : NIGHT_OF[m.persona] || "camp";
    const g = NIGHT_GROUPS[key];
    if (!map.has(key)) map.set(key, { ...g, members: [] });
    map.get(key).members.push(m.player);
  });
  const groups = [...map.values()];
  const dNight = Math.min(3, days);
  const dShop = Math.max(2, days - 1);
  return {
    collective: [
      "Day 2 上午　USJ 入園・冬季雪景大合照",
      `Day ${dNight} 傍晚　道頓堀固力果跑跑人・夜景大合照`,
      `Day ${dShop} 20:45　飯店大廳・戰利品發表會`,
    ],
    splitTitle: `Day ${dShop} 夜間　心齋橋商圈自由探索 2 小時`,
    groups,
  };
}

/* 遊戲進行中的即時默契：跟結算用同一套「選一樣 + 偏好接近」的算法，
   只是吃到目前為止的回合。有了它，玩家每選一次就看得到後果，
   而不是四站都選完才知道自己做了什麼。 */
function liveVibe(players, history) {
  if (!history.length) return null;
  const rows = players.map((p) => ({
    p,
    answers: history.map((h) => h.results.find((r) => r.player.id === p.id)),
  }));
  const pairs = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const agree = history.filter((_, r) => sameChoice(rows[i].answers[r], rows[j].answers[r])).length / history.length;
      pairs.push(agree);
    }
  }
  if (!pairs.length) return null;
  return clamp(Math.round(35 + 65 * mean(pairs)), 12, 99);
}

/* 這一回合誰跟你選一樣 —— 社交回饋，比分數本身更有感 */
function whoMatchedMe(results) {
  const me = results.find((r) => r.player.isUser);
  if (!me) return [];
  return results.filter((r) => !r.player.isUser && sameChoice(r, me)).map((r) => r.player);
}

function analyzeTeam(players, history, seeds, days = 5) {
  const members = players.map((p) => {
    const answers = history.map((h) => h.results.find((r) => r.player.id === p.id));
    return { player: p, answers, ...computeProfile(answers, seeds[p.id]) };
  });

  const pairs = [];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      const agree = history.length ? history.filter((_, r) => sameChoice(a.answers[r], b.answers[r])).length / history.length : 0;
      pairs.push({ a, b, agree, cos: cosine(dimVec(a), dimVec(b)) });
    }
  }
  const vibe = clamp(Math.round(35 + 65 * (0.45 * mean(pairs.map((p) => p.agree)) + 0.55 * mean(pairs.map((p) => p.cos)))), 12, 99);
  const ranked = [...pairs].sort((x, y) => y.cos + y.agree - (x.cos + x.agree));

  const teamDims = Object.fromEntries(DIMS.map((d) => [d.key, members.reduce((s, m) => s + m.dims[d.key], 0)]));
  const dimTotal = Object.values(teamDims).reduce((s, v) => s + v, 0) || 1;
  const prefs = DIMS.map((d) => ({ ...d, pct: Math.round((teamDims[d.key] / dimTotal) * 100) })).sort((x, y) => y.pct - x.pct);

  const vi = vibe >= 80
    ? { label: "靈魂同步戰隊", desc: "節奏超合拍，同樂時段放心排滿。" }
    : vibe >= 60
      ? { label: "互補型冒險團", desc: "偏好有落差，適度分流更盡興。" }
      : { label: "分流保友情團", desc: "節奏落差明顯，記得排分流時段。" };

  return {
    members,
    vibe,
    vibeInfo: vi,
    bestPair: ranked[0] || null,
    splitPair: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    prefs,
    splitPct: clamp(Math.round(18 + (100 - vibe) * 0.4), 15, 45),
    plan: buildPlan(members, days),
    maxDim: Math.max(1, ...members.flatMap((m) => DIMS.map((d) => m.dims[d.key]))),
  };
}

/* ==================================================================
 * 5. 共用元件
 * ================================================================== */
function Card({ className = "", children, ...rest }) {
  return (
    <div className={`rounded-3xl border-[3px] border-[#1F2350] bg-white shadow-[5px_5px_0_#1F2350] ${className}`} {...rest}>
      {children}
    </div>
  );
}

// sound：這顆按鈕要發的音效名稱，傳 null 就完全靜音
function Btn({ variant = "primary", size = "md", className = "", disabled, sound = "tap", onClick, children, ...rest }) {
  const tone = {
    primary: "bg-[#FF6B35] text-white",
    sun: "bg-[#FFC93C] text-[#1F2350]",
    ghost: "bg-white text-[#1F2350]",
    ink: "bg-[#1F2350] text-white",
  }[variant];
  const pad = size === "sm" ? "px-3 py-2 text-sm" : "px-5 py-3 text-base";
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96, y: 2 }}
      onClick={(e) => {
        if (sound) sfx(sound);
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border-[3px] border-[#1F2350] font-bold shadow-[4px_4px_0_#1F2350] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${tone} ${pad} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* 次要說明摺起來：資訊還留著，但不會一進畫面就整面壓上來 */
function Fold({ title, icon, defaultOpen = false, tone = "#FFF8EE", className = "", bodyClass = "opacity-80", children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`overflow-hidden rounded-2xl border-2 border-[#1F2350] ${className}`} style={{ background: tone }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { sfx("tap"); setOpen((o) => !o); }}
        className="flex w-full items-start gap-1.5 px-3 py-2 text-left"
      >
        {icon && <span className="shrink-0 leading-snug">{icon}</span>}
        <span className="min-w-0 flex-1 text-xs font-black leading-relaxed">{title}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="shrink-0 text-[11px] leading-snug opacity-45">▶</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className={`px-3 pb-3 text-xs leading-relaxed ${bodyClass}`}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* 逐字顯示。點一下整段跳出來；同一段看過第二次就直接全顯，demo 時不卡。 */
const typedOnce = new Set();
function Typewriter({ text, id, speed = 42, start = true, onDone }) {
  const instant = typedOnce.has(id);
  const [n, setN] = useState(instant ? text.length : 0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (typedOnce.has(id)) { setN(text.length); doneRef.current?.(); return undefined; }
    if (!start) { setN(0); return undefined; }
    setN(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i % 3 === 0) sfx("blip");
      if (i >= text.length) {
        clearInterval(t);
        typedOnce.add(id);
        doneRef.current?.();
      }
    }, speed);
    return () => clearInterval(t);
  }, [text, id, speed, start]);

  const done = n >= text.length;
  return (
    <>
      <span>{text.slice(0, n)}</span>
      {/* 還沒打出來的字用透明的佔位，高度才不會一直跳，但也看不到接下來要講什麼 */}
      {!done && <span className="opacity-0" aria-hidden="true">{text.slice(n)}</span>}
    </>
  );
}

function Chip({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border-2 border-[#1F2350] bg-white px-2.5 py-0.5 text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

function Avatar({ p, size = 40 }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full border-[3px] border-[#1F2350] font-black text-white"
      style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.42) }}
    >
      {p.isUser ? "我" : p.name.slice(-1)}
    </div>
  );
}

function ThinkingDots({ small }) {
  const s = small ? 3 : 6;
  return (
    <span className="inline-flex items-center gap-[2px] py-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block rounded-full bg-[#1F2350]"
          style={{ width: s, height: s }}
          animate={{ y: [0, -3, 0], opacity: [0.35, 1, 0.35] }}
          transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

function CountUp({ to, duration = 1.2 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return undefined;
    const controls = animate(0, to, { duration, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => controls.stop();
  }, [inView, to, duration]);
  return <span ref={ref}>{v}</span>;
}

const BURST_COLORS = ["#FF6B35", "#FFC93C", "#6CC08B", "#7CC6FE", "#FF9EBB", "#A98BFF"];
function Burst({ show }) {
  const bits = useMemo(
    () => Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 260,
      y: -70 - Math.random() * 110,
      r: Math.random() * 540,
      c: BURST_COLORS[i % BURST_COLORS.length],
    })),
    [],
  );
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      {bits.map((b) => (
        <motion.span
          key={b.id}
          className="absolute h-3 w-1.5 rounded-sm"
          style={{ background: b.c }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 150], opacity: [1, 1, 0], rotate: b.r }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

/* ==================================================================
 * 6. 去趣 IP 角色 ＋ 8 款人格造型
 * ------------------------------------------------------------------
 * 造型規格來自 chictripPersonas.ts（Gemini 版人格 IP）：
 *   eyeShape 決定眼型、accessory 決定配件、accentColor 當點綴色，
 *   每個人格另有一招「共識動作」與一招「衝突動作」。
 * 人格的判定邏輯（PERSONAS / QUIZ_MAP / ROUNDS 權重）完全沒動，只換長相。
 * 對照：特種兵→speed_runner、水豚→chill_capybara、打卡機→photo_hunter、
 *       購物狂→shopping_spree、精算師→cfo_budget、探險家→secret_spotter、
 *       保母→peace_maker。計程車星人在那份沒有，用同一套規則補上；
 *       味蕾老饕（foodie_guru）這個專案沒有對應人格，所以先不用。
 * ================================================================== */
const PERSONA_IP = {
  soldier:    { roleId: "speed_runner",   eyeShape: "focused", accessory: "headband",         accent: "#FF4D4F", agree: "超響亮擊掌",       conflict: "急速滑步離場" },
  capybara:   { roleId: "chill_capybara", eyeShape: "sleepy",  accessory: "iced_coffee",      accent: "#87D068", agree: "一起吐放空泡泡",   conflict: "化成一灘黃水" },
  camera:     { roleId: "photo_hunter",   eyeShape: "sparkle", accessory: "sunglasses_strap", accent: "#FF6B6B", agree: "取景框框比心",     conflict: "鏡頭戳人" },
  shopper:    { roleId: "shopping_spree", eyeShape: "heart",   accessory: "beanie_bags",      accent: "#EB2F96", agree: "提袋開箱大歡呼",   conflict: "購物紙袋無情衝撞" },
  accountant: { roleId: "cfo_budget",     eyeShape: "glasses", accessory: "round_glasses",    accent: "#13C2C2", agree: "蓋章批准報銷",     conflict: "甩出厚帳單打臉" },
  explorer:   { roleId: "secret_spotter", eyeShape: "shades",  accessory: "bucket_hat",       accent: "#722ED1", agree: "悄悄遞出私房地圖", conflict: "拉下鐵捲門自閉" },
  taxi:       { roleId: "taxi_vip",       eyeShape: "smug",    accessory: "taxi_light",       accent: "#F5A800", agree: "招手全員上車",     conflict: "狂按喇叭催上車", blush: "#FF7A6B" },
  nanny:      { roleId: "peace_maker",    eyeShape: "smiling", accessory: "peace_pin",        accent: "#FADB14", agree: "強行牽手大合照",   conflict: "原地猛烈揮白旗", blush: "#FF7A6B" },
};

/* 配件：A 是該人格的點綴色。front 畫在臉的前面，back 畫在身體後面。 */
const GEAR = {
  soldier: {
    front: (A) => (
      <g>
        {/* 運動頭帶 + 飄帶 */}
        <path d="M48 88 Q100 66 152 88" stroke={A} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M54 84 Q100 66 146 84" stroke="#fff" strokeOpacity=".45" strokeWidth="2" fill="none" />
        <path d="M147 84 L178 68 L170 90 Z" fill={A} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M147 90 L180 100 L166 106 Z" fill={A} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        {/* 哨子 */}
        <path d="M66 128 Q100 158 134 128" stroke={A} strokeWidth="3.5" fill="none" />
        <rect x="89" y="142" width="20" height="11" rx="4" fill="#D9DEE5" stroke={INK} strokeWidth="2.5" />
        <circle cx="109" cy="150" r="6.5" fill="#D9DEE5" stroke={INK} strokeWidth="2.5" />
        {/* 碼錶 */}
        <rect x="31" y="126" width="22" height="11" rx="3" fill={INK} />
        <circle cx="42" cy="131.5" r="8" fill="#7CF29A" stroke={INK} strokeWidth="2.5" />
        <path d="M42 131.5 L42 127 M42 131.5 L45 133.5" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      </g>
    ),
  },
  capybara: {
    front: (A) => (
      <g>
        {/* 頸枕 */}
        <path d="M60 134 Q100 172 140 134" stroke="#7EC8E3" strokeWidth="15" fill="none" strokeLinecap="round" />
        <path d="M64 136 Q100 166 136 136" stroke="#C4E9F6" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray="2 7" />
        {/* 頭頂一顆柚子 */}
        <circle cx="100" cy="33" r="10" fill="#FFA62B" stroke={INK} strokeWidth="3" />
        <path d="M100 23 Q108 13 117 17 Q110 25 100 23 Z" fill={A} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        {/* 冰咖啡 */}
        <path d="M151.8 120 L172.2 120 L170 150 L154 150 Z" fill="#8B5A2B" />
        <rect x="155" y="123" width="7" height="7" rx="1.5" fill="#fff" fillOpacity=".8" transform="rotate(12 158 126)" />
        <rect x="163.5" y="130" width="6" height="6" rx="1.5" fill="#fff" fillOpacity=".7" />
        <path d="M150 106 L174 106 L170 150 L154 150 Z" fill="#EAF7FE" fillOpacity=".35" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M165 106 L171 84" stroke={A} strokeWidth="4" strokeLinecap="round" />
        <path d="M146 106 H178" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <ellipse cx="155" cy="135" rx="8" ry="9" fill={BODY} stroke={INK} strokeWidth="3.5" />
      </g>
    ),
  },
  camera: {
    front: (A) => (
      <g>
        {/* 推到頭上的墨鏡 */}
        <g transform="rotate(-6 100 68)">
          <rect x="68" y="59" width="28" height="15" rx="7" fill={INK} />
          <rect x="104" y="59" width="28" height="15" rx="7" fill={INK} />
          <path d="M96 65 L104 65" stroke={INK} strokeWidth="3" />
          <path d="M73 63 L80 63 M109 63 L116 63" stroke={A} strokeWidth="2.5" strokeLinecap="round" />
        </g>
        {/* 相機背帶 + 拍立得 */}
        <path d="M52 96 Q58 128 76 134 M148 96 Q142 128 124 134" stroke={A} strokeWidth="4" fill="none" strokeLinecap="round" />
        <rect x="70" y="128" width="60" height="42" rx="9" fill="#F7F3EA" stroke={INK} strokeWidth="3" />
        <rect x="75" y="133" width="4" height="12" fill="#FF6B35" />
        <rect x="79" y="133" width="4" height="12" fill="#FFC93C" />
        <rect x="83" y="133" width="4" height="12" fill="#6CC08B" />
        <rect x="87" y="133" width="4" height="12" fill="#7CC6FE" />
        <circle cx="102" cy="150" r="13" fill={INK} />
        <circle cx="102" cy="150" r="7" fill="#5B7FFF" />
        <circle cx="99" cy="147" r="2.2" fill="#fff" />
        <rect x="116" y="133" width="10" height="7" rx="1.5" fill="#FFE27A" stroke={INK} strokeWidth="1.5" />
        {/* 閃亮星星 */}
        <path d="M152 70 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill={A} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      </g>
    ),
  },
  shopper: {
    front: (A) => (
      <g>
        {/* 毛帽（把提把整個罩住） */}
        <path d="M56 80 Q54 26 100 24 Q146 26 144 80 Z" fill={A} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M80 34 Q77 56 80 72 M100 28 V72 M120 34 Q123 56 120 72" stroke="#fff" strokeOpacity=".3" strokeWidth="3" fill="none" />
        <rect x="50" y="68" width="100" height="16" rx="8" fill={A} stroke={INK} strokeWidth="3.5" />
        <rect x="52" y="70" width="96" height="12" rx="6" fill="#000" fillOpacity=".16" />
        {[60, 70, 80, 90, 100, 110, 120, 130, 140].map((x) => (
          <path key={x} d={`M${x} 71 V81`} stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
        ))}
        <circle cx="100" cy="20" r="10" fill="#fff" stroke={INK} strokeWidth="3" />
        {/* 兩手提袋 */}
        <path d="M22 138 Q31 118 40 138" stroke={INK} strokeWidth="3" fill="none" />
        <path d="M16 138 L46 138 L50 178 L12 178 Z" fill={A} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <text x="31" y="160" fontSize="7" fontWeight="900" textAnchor="middle" fill="#fff">TAX</text>
        <text x="31" y="169" fontSize="7" fontWeight="900" textAnchor="middle" fill="#fff">FREE</text>
        <rect x="138" y="150" width="18" height="24" rx="2" fill="#FFC93C" stroke={INK} strokeWidth="2.5" />
        <path d="M160 136 Q169 116 178 136" stroke={INK} strokeWidth="3" fill="none" />
        <path d="M154 136 L184 136 L188 178 L150 178 Z" fill="#6CC08B" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <text x="169" y="163" fontSize="9" fontWeight="900" textAnchor="middle" fill="#fff">SALE</text>
      </g>
    ),
  },
  accountant: {
    front: (A) => (
      <g>
        {/* 圓框眼鏡（點綴色） */}
        <circle cx="82" cy="104" r="13" fill="#ffffff44" stroke={A} strokeWidth="3.5" />
        <circle cx="118" cy="104" r="13" fill="#ffffff44" stroke={A} strokeWidth="3.5" />
        <path d="M95 103 L105 103" stroke={A} strokeWidth="3" />
        <path d="M69 101 L53 96 M131 101 L147 96" stroke={A} strokeWidth="3" strokeLinecap="round" />
        {/* 計算機 */}
        <rect x="76" y="128" width="48" height="44" rx="7" fill="#E9D8B4" stroke={INK} strokeWidth="3" />
        <rect x="81" y="133" width="38" height="11" rx="2" fill="#B8D8A8" stroke={INK} strokeWidth="1.5" />
        <text x="116" y="142" fontSize="8" fontWeight="900" textAnchor="end" fill={INK}>405</text>
        {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => (
          <rect key={`${r}-${c}`} x={82 + c * 9.5} y={148 + r * 7.5} width="7" height="5" rx="1.5" fill={c === 3 ? A : INK} />
        )))}
        {/* 折價券 */}
        <g transform="rotate(12 168 118)">
          <rect x="152" y="108" width="34" height="20" rx="3" fill="#FFE27A" stroke={INK} strokeWidth="2.5" />
          <path d="M161 108 L161 128" stroke={INK} strokeWidth="1.5" strokeDasharray="2 2" />
          <text x="174" y="122" fontSize="8" fontWeight="900" textAnchor="middle" fill="#E8453C">10%</text>
          <rect x="165" y="103" width="10" height="7" rx="1.5" fill={INK} />
        </g>
      </g>
    ),
  },
  explorer: {
    front: (A) => (
      <g>
        {/* 漁夫帽 */}
        <path d="M62 76 Q62 30 100 28 Q138 30 138 76 Z" fill={A} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M63 62 Q100 54 137 62 L138 72 Q100 64 62 72 Z" fill="#000" fillOpacity=".28" />
        <ellipse cx="100" cy="77" rx="58" ry="10" fill={A} stroke={INK} strokeWidth="4" />
        <ellipse cx="100" cy="77" rx="49" ry="5" fill="none" stroke="#fff" strokeOpacity=".45" strokeDasharray="4 4" />
        {/* 望遠鏡 */}
        <path d="M60 124 Q100 146 140 124" stroke="#8B5A2B" strokeWidth="3" fill="none" />
        <rect x="84" y="136" width="14" height="22" rx="5" fill="#4A3B2F" stroke={INK} strokeWidth="2.5" />
        <rect x="102" y="136" width="14" height="22" rx="5" fill="#4A3B2F" stroke={INK} strokeWidth="2.5" />
        <rect x="96" y="142" width="8" height="7" fill="#6B5646" stroke={INK} strokeWidth="2" />
        <ellipse cx="91" cy="158" rx="6" ry="3" fill="#7CC6FE" stroke={INK} strokeWidth="2" />
        <ellipse cx="109" cy="158" rx="6" ry="3" fill="#7CC6FE" stroke={INK} strokeWidth="2" />
        {/* 私房地圖手冊 */}
        <g transform="rotate(-8 163 132)">
          <rect x="148" y="114" width="30" height="36" rx="3" fill="#A0652E" stroke={INK} strokeWidth="3" />
          <rect x="171" y="114" width="4" height="36" fill="#6B3E1A" />
          <path d="M154 126 L166 126 M154 132 L164 132" stroke="#F3DDB8" strokeWidth="2" strokeLinecap="round" />
          <circle cx="160" cy="141" r="4" fill="none" stroke="#F3DDB8" strokeWidth="1.8" />
        </g>
      </g>
    ),
  },
  taxi: {
    front: (A) => (
      <g>
        <motion.g animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}>
          <path d="M60 10 L54 4 M140 10 L146 4 M100 6 L100 0" stroke={A} strokeWidth="3" strokeLinecap="round" />
          <path d="M72 12 L128 12 L135 30 L65 30 Z" fill="#FFD21F" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <text x="100" y="26" fontSize="12" fontWeight="900" textAnchor="middle" fill={INK} letterSpacing="1">TAXI</text>
        </motion.g>
        {/* 胸前 VIP 徽章 */}
        <rect x="108" y="138" width="24" height="13" rx="4" fill={A} stroke={INK} strokeWidth="2.5" />
        <text x="120" y="148" fontSize="8" fontWeight="900" textAnchor="middle" fill={INK}>VIP</text>
        {/* 叫車手機 */}
        <g transform="rotate(10 160 128)">
          <rect x="150" y="110" width="20" height="34" rx="4" fill={INK} />
          <rect x="152.5" y="114" width="15" height="24" rx="2" fill="#7FD3FF" />
          <rect x="155" y="124" width="10" height="5" rx="1.5" fill="#FFD21F" />
        </g>
      </g>
    ),
  },
  nanny: {
    back: () => (
      <g>
        <rect x="30" y="58" width="140" height="108" rx="34" fill="#4E9F7D" stroke={INK} strokeWidth="4" />
        <rect x="146" y="38" width="16" height="26" rx="3" fill="#fff" stroke={INK} strokeWidth="2.5" />
        <rect x="151" y="34" width="6" height="5" rx="1" fill={INK} />
        <rect x="149.5" y="44" width="9" height="5" fill="#7CF29A" />
        <rect x="149.5" y="50" width="9" height="5" fill="#7CF29A" />
        <rect x="149.5" y="56" width="9" height="5" fill="#7CF29A" />
      </g>
    ),
    front: (A) => (
      <g>
        <path d="M56 82 L58 152" stroke="#3A7A5F" strokeWidth="6" strokeLinecap="round" />
        <path d="M144 82 L142 152" stroke="#3A7A5F" strokeWidth="6" strokeLinecap="round" />
        {/* 和平徽章 */}
        <circle cx="120" cy="146" r="10" fill="#fff" stroke={A} strokeWidth="3.5" />
        <g stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round">
          <circle cx="120" cy="146" r="6" />
          <path d="M120 140 V152 M120 146 L115.8 150.2 M120 146 L124.2 150.2" />
        </g>
        {/* 急救包 */}
        <path d="M30 128 Q38 118 46 128" stroke={INK} strokeWidth="3" fill="none" />
        <rect x="20" y="126" width="36" height="28" rx="5" fill="#fff" stroke={INK} strokeWidth="3" />
        <rect x="35" y="130" width="6" height="20" rx="1" fill="#E8453C" />
        <rect x="28" y="137" width="20" height="6" rx="1" fill="#E8453C" />
      </g>
    ),
  },
};

function GearLayer({ content, delay }) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.3, y: -26 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 260, damping: 15, delay }}
    >
      {content}
    </motion.g>
  );
}

/* 趣趣的表情：只換嘴型、眼睛和手的角度，沒有新增任何圖檔。
   face 預設 "idle"，所以原本用到 Mascot 的地方長相完全不變。 */
const FACE = {
  idle:     { mouth: "M92 118 Q100 126 108 118", eye: "open",   arm: 0 },
  talk:     { mouth: "M90 117 Q100 130 110 117", eye: "open",   arm: -14 },
  happy:    { mouth: "M87 115 Q100 133 113 115", eye: "closed", arm: -26 },
  think:    { mouth: "M94 123 L106 121",          eye: "up",     arm: 0 },
  surprise: { mouth: "round",                     eye: "wide",   arm: -34 },
  worry:    { mouth: "M91 124 Q95.5 118 100 124 Q104.5 130 109 124", eye: "open", arm: 8 },
};

function Eyes({ kind }) {
  if (kind === "closed") {
    return (
      <>
        <path d="M75 106 Q82 97 89 106" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M111 106 Q118 97 125 106" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      </>
    );
  }
  const r = kind === "wide" ? { rx: 7.5, ry: 10 } : { rx: 6, ry: 8 };
  const dy = kind === "up" ? -2.5 : 0;
  return (
    <>
      <ellipse cx="82" cy={104 + dy} {...r} fill={INK} />
      <circle cx="84" cy={101 + dy} r="2" fill="#fff" />
      <ellipse cx="118" cy={104 + dy} {...r} fill={INK} />
      <circle cx="120" cy={101 + dy} r="2" fill="#fff" />
    </>
  );
}

/* ---------- 人格版的臉：眼型照 eyeShape，表情疊在上面 ----------
   表情：idle / talk / happy / mad / shock / worry（think、surprise 會轉成對應的那一個） */
const MOUTH_RED = "#8A2E22";
const PERSONA_FACE_ALIAS = { think: "idle", surprise: "shock" };
const PERSONA_ARM = { idle: 0, talk: -14, happy: -26, shock: -34, mad: 10, worry: 8 };

const heartPath = (cx, cy, s) =>
  `M${cx} ${cy + 4.5 * s} C${cx - 6 * s} ${cy} ${cx - 6.5 * s} ${cy - 4.5 * s} ${cx - 3.6 * s} ${cy - 6.4 * s} C${cx - 1.7 * s} ${cy - 7.6 * s} ${cx} ${cy - 6.2 * s} ${cx} ${cy - 4.8 * s} C${cx} ${cy - 6.2 * s} ${cx + 1.7 * s} ${cy - 7.6 * s} ${cx + 3.6 * s} ${cy - 6.4 * s} C${cx + 6.5 * s} ${cy - 4.5 * s} ${cx + 6 * s} ${cy} ${cx} ${cy + 4.5 * s} Z`;

function PersonaFace({ eye, face, accent }) {
  const f = PERSONA_FACE_ALIAS[face] || face || "idle";
  const line = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" };
  const shades = eye === "shades";

  let eyes;
  if (f === "happy" && !shades && eye !== "heart") {
    eyes = (
      <>
        <path d="M74 107 Q82 97 90 107" {...line} />
        <path d="M110 107 Q118 97 126 107" {...line} />
      </>
    );
  } else if (f === "shock" && !shades) {
    eyes = (
      <>
        <ellipse cx="82" cy="103" rx="9" ry="11" fill="#fff" stroke={INK} strokeWidth="3" />
        <circle cx="82" cy="104" r="3.5" fill={INK} />
        <ellipse cx="118" cy="103" rx="9" ry="11" fill="#fff" stroke={INK} strokeWidth="3" />
        <circle cx="118" cy="104" r="3.5" fill={INK} />
      </>
    );
  } else {
    switch (eye) {
      case "sparkle":
        eyes = [82, 118].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="104" rx="7.5" ry="9.5" fill={INK} />
            <circle cx={x + 2.5} cy="100" r="3.2" fill="#fff" />
            <circle cx={x - 2.2} cy="108" r="1.6" fill="#fff" />
          </g>
        ));
        break;
      case "focused":
        eyes = [82, 118].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="105" rx="5.5" ry="6.5" fill={INK} />
            <circle cx={x + 1.8} cy="102.5" r="1.8" fill="#fff" />
          </g>
        ));
        break;
      case "sleepy":
        eyes = (
          <>
            <path d="M73 104 Q82 111 91 104" {...line} />
            <path d="M109 104 Q118 111 127 104" {...line} />
          </>
        );
        break;
      case "glasses":
        eyes = (
          <>
            <circle cx="82" cy="104" r="4.5" fill={INK} />
            <circle cx="118" cy="104" r="4.5" fill={INK} />
          </>
        );
        break;
      case "shades":
        eyes = (
          <g transform={f === "shock" ? "translate(0 4)" : undefined}>
            <path d="M64 95 H98 V103 Q98 114 88 114 H74 Q64 114 64 103 Z" fill="#14161F" />
            <path d="M102 95 H136 V103 Q136 114 126 114 H112 Q102 114 102 103 Z" fill="#14161F" />
            <path d="M97 97 H103" stroke="#14161F" strokeWidth="3" />
            <path d="M69 99 H77 M107 99 H115" stroke="#fff" strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        );
        break;
      case "heart":
        eyes = (
          <>
            <path d={heartPath(82, 105, f === "happy" ? 1.9 : 1.6)} fill={accent} stroke={INK} strokeWidth="2" />
            <path d={heartPath(118, 105, f === "happy" ? 1.9 : 1.6)} fill={accent} stroke={INK} strokeWidth="2" />
          </>
        );
        break;
      case "smug":
        eyes = [82, 118].map((x) => (
          <g key={x}>
            <path d={`M${x - 9} 102 L${x + 9} 102 Q${x + 8} 112 ${x} 112 Q${x - 8} 112 ${x - 9} 102 Z`} fill={INK} />
            <path d={`M${x - 10} 101 L${x + 10} 100`} {...line} strokeWidth="3.5" />
          </g>
        ));
        break;
      case "smiling":
      default:
        eyes = (
          <>
            <path d="M74 107 Q82 98 90 107" {...line} />
            <path d="M110 107 Q118 98 126 107" {...line} />
          </>
        );
    }
  }

  // 眉毛：特種兵天生殺氣眉；生氣、擔心另外加
  let brows = null;
  if (f === "mad" || (eye === "focused" && f !== "worry" && f !== "happy")) {
    brows = (
      <>
        <path d="M69 88 L93 95" {...line} strokeWidth="4.5" />
        <path d="M131 88 L107 95" {...line} strokeWidth="4.5" />
      </>
    );
  } else if (f === "worry") {
    brows = (
      <>
        <path d="M71 92 L91 86" {...line} strokeWidth="3.5" />
        <path d="M129 92 L109 86" {...line} strokeWidth="3.5" />
      </>
    );
  }

  const IDLE_MOUTH = {
    sparkle: <path d="M89 117 Q100 131 111 117 Z" fill={MOUTH_RED} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
    focused: (
      <g>
        <rect x="88" y="115" width="24" height="10" rx="3" fill="#fff" stroke={INK} strokeWidth="3" />
        <path d="M100 115 V125" stroke={INK} strokeWidth="1.8" />
      </g>
    ),
    sleepy: <ellipse cx="100" cy="122" rx="3.5" ry="3" fill={INK} />,
    glasses: <path d="M93 121 Q100 126 107 121" {...line} strokeWidth="3.5" />,
    shades: <path d="M91 122 Q102 126 111 117" {...line} strokeWidth="3.5" />,
    heart: <path d="M89 117 Q100 131 111 117 Z" fill={MOUTH_RED} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
    smug: <path d="M91 122 Q101 125 110 118" {...line} strokeWidth="3.5" />,
    smiling: <path d="M88 116 Q100 130 112 116" {...line} />,
  };
  const mouth = {
    talk: <path d="M90 117 Q100 131 110 117 Z" fill={MOUTH_RED} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
    happy: <path d="M86 115 Q100 137 114 115 Z" fill={MOUTH_RED} stroke={INK} strokeWidth="3" strokeLinejoin="round" />,
    shock: <ellipse cx="100" cy="125" rx="6" ry="8" fill={INK} />,
    mad: <path d="M89 127 Q100 116 111 127" {...line} />,
    worry: <path d="M91 124 Q95.5 118 100 124 Q104.5 130 109 124" {...line} strokeWidth="3.5" />,
  }[f] || IDLE_MOUTH[eye] || IDLE_MOUTH.smiling;

  return (
    <g>
      {eyes}
      {brows}
      {mouth}
      {eye === "sleepy" && (f === "idle" || f === "talk") && (
        <g fill={INK} fillOpacity=".55" fontWeight="900" fontFamily="sans-serif">
          <text x="146" y="74" fontSize="12">z</text>
          <text x="155" y="62" fontSize="16">Z</text>
        </g>
      )}
      {f === "mad" && (
        <g stroke="#E53935" strokeWidth="3.5" fill="none" strokeLinecap="round">
          <path d="M141 64 Q147 64 147 58 M155 58 Q155 64 161 64 M161 72 Q155 72 155 78 M147 78 Q147 72 141 72" />
        </g>
      )}
      {(f === "shock" || f === "worry") && (
        <path d="M150 88 C150 95 145 98 145 102 C145 106 148 108 151 108 C154 108 157 106 157 102 C157 98 152 95 150 88 Z" fill="#9EDCFF" stroke={INK} strokeWidth="2" />
      )}
    </g>
  );
}

function Mascot({ persona = null, size = 160, bg = true, delay = 0, float = true, face = "idle" }) {
  const P = persona ? PERSONAS[persona] : null;
  const gear = persona ? GEAR[persona] : null;
  const ip = persona ? PERSONA_IP[persona] : null;
  const F = FACE[face] || FACE.idle;
  const arm = ip ? (PERSONA_ARM[PERSONA_FACE_ALIAS[face] || face] ?? 0) : F.arm;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="overflow-visible" role="img" aria-label={P ? `去趣・${P.name}` : "去趣"}>
      {bg && <circle cx="100" cy="110" r="86" fill={P ? P.soft : "#FFE0B8"} />}
      <motion.g animate={float ? { y: [0, -4, 0] } : undefined} transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}>
        <AnimatePresence>{gear?.back && <GearLayer key={`b-${persona}`} content={gear.back(ip.accent)} delay={delay} />}</AnimatePresence>
        <circle cx="72" cy="172" r="8" fill={INK} />
        <circle cx="72" cy="172" r="3" fill={PAGE} />
        <circle cx="128" cy="172" r="8" fill={INK} />
        <circle cx="128" cy="172" r="3" fill={PAGE} />
        <rect x="78" y="42" width="44" height="30" rx="11" fill="none" stroke={INK} strokeWidth="6" />
        {/* 用 SVG 自己的 rotate(角度 支點x 支點y)，支點明確，手不會飛出去 */}
        <g transform={`rotate(${arm} 42 120)`}>
          <ellipse cx="42" cy="130" rx="10" ry="15" fill={BODY} stroke={INK} strokeWidth="4" />
        </g>
        <g transform={`rotate(${-arm} 158 120)`}>
          <ellipse cx="158" cy="130" rx="10" ry="15" fill={BODY} stroke={INK} strokeWidth="4" />
        </g>
        <rect x="44" y="62" width="112" height="106" rx="44" fill={BODY} stroke={INK} strokeWidth="5" />
        <path d="M64 152 Q100 164 136 152" stroke="#F29A2E" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
        <ellipse cx="68" cy="120" rx="8" ry="5" fill={ip ? ip.blush || ip.accent : "#FF7A6B"} opacity={ip ? 0.6 : 0.55} />
        <ellipse cx="132" cy="120" rx="8" ry="5" fill={ip ? ip.blush || ip.accent : "#FF7A6B"} opacity={ip ? 0.6 : 0.55} />
        {ip ? (
          <PersonaFace eye={ip.eyeShape} face={face} accent={ip.accent} />
        ) : (
          <>
            <Eyes kind={F.eye} />
            {F.mouth === "round"
              ? <ellipse cx="100" cy="123" rx="5.5" ry="7" fill={INK} />
              : <path d={F.mouth} stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />}
          </>
        )}
        <AnimatePresence>{gear?.front && <GearLayer key={`f-${persona}`} content={gear.front(ip.accent)} delay={delay} />}</AnimatePresence>
      </motion.g>
    </svg>
  );
}

/* ==================================================================
 * 7. SETUP：人格快測 → 預算／網路 → 隊伍預備
 * ================================================================== */
function ChoiceTile({ data, active, onClick }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      animate={{ y: active ? -3 : 0 }}
      aria-pressed={active}
      className={`w-full rounded-2xl border-[3px] border-[#1F2350] p-4 text-left transition-[background-color,box-shadow] duration-150 ${active ? "bg-[#FFC93C] shadow-[5px_5px_0_#1F2350]" : "bg-white shadow-[2px_2px_0_#1F2350]"}`}
    >
      <div className="text-2xl">{data.icon}</div>
      <div className="mt-1 text-[15px] font-black leading-snug">{data.label}</div>
      <div className="mt-0.5 text-xs opacity-60">{data.sub}</div>
    </motion.button>
  );
}

function Field({ icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-black">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      {children}
    </div>
  );
}

function StepBtn({ onClick, children, label }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-[3px] border-[#1F2350] bg-white shadow-[2px_2px_0_#1F2350]"
    >
      {children}
    </motion.button>
  );
}

function SetupScreen({ onStart, toast }) {
  const [step, setStep] = useState(0); // 0 快測 / 1 預算網路 / 2 隊伍預備
  const [nickname, setNickname] = useState("");
  const [quiz, setQuiz] = useState({});
  const [qIdx, setQIdx] = useState(0);
  const [budget, setBudget] = useState("standard");
  // 網路方案改在第 1 站結束時由趣趣當面問，SETUP 不再佔一個畫面
  const [size, setSize] = useState(4);
  const [destKey, setDestKey] = useState(TRIP.destKey);
  const [date, setDate] = useState(TRIP.date);
  const [days, setDays] = useState(TRIP.days);
  const [newCode] = useState(() => randomCode());
  const [joined, setJoined] = useState(0);
  const [roomMode, setRoomMode] = useState(null); // null | create | join
  const [coupon] = useState(() => couponCode());
  const [joinInput, setJoinInput] = useState("");
  const [joinedCode, setJoinedCode] = useState(null);

  const seedPersona = useMemo(() => {
    const k = [quiz.q1, quiz.q2, quiz.q3].join("-");
    return QUIZ_MAP[k] || null;
  }, [quiz]);

  // 人格一算出來就配一段「揭曉」音，優惠碼解鎖再補一聲金幣
  useEffect(() => {
    if (!seedPersona) return undefined;
    sfx("success");
    const t = setTimeout(() => sfx("coin"), 620);
    return () => clearTimeout(t);
  }, [seedPersona]);

  const isHost = roomMode === "create";
  const code = isHost ? newCode : joinedCode || "";
  const destName = DESTINATIONS.find((d) => d.key === destKey)?.name || TRIP.dest;
  const answeredAll = QUIZ.every((q) => quiz[q.id]);
  const players = useMemo(() => buildPlayers(nickname.trim(), size, isHost), [nickname, size, isHost]);
  const mocks = players.filter((p) => !p.isUser);
  const inRoom = isHost || Boolean(joinedCode);
  const allIn = joined >= mocks.length;

  useEffect(() => {
    if (step !== 2 || !inRoom || allIn) return undefined;
    const t = setTimeout(() => setJoined((c) => c + 1), 600 + Math.random() * 500);
    return () => clearTimeout(t);
  }, [step, joined, allIn, inRoom]);

  const doJoin = () => {
    const c = joinInput.trim().toUpperCase();
    if (c.replace(/[^A-Z0-9]/g, "").length < 4) {
      toast("房間代碼至少要 4 碼，例如 OSK-7Q2F");
      return;
    }
    setJoinedCode(c);
    setSize(4);   // 人數由房主設定
    setDays(TRIP.days);
    setDate(TRIP.date);
    setDestKey(TRIP.destKey);
    setJoined(1); // 房主小明已在房間內
  };

  const pick = (qid, key) => {
    sfx("select");
    setQuiz((s) => ({ ...s, [qid]: key }));
    if (qIdx < QUIZ.length - 1) setTimeout(() => setQIdx((i) => i + 1), 260);
  };

  // 答完第 3 題，把人格結果捲到眼前——不要指望使用者自己往下滑
  const revealRef = useRef(null);
  useEffect(() => {
    if (step !== 0 || !answeredAll || !seedPersona) return undefined;
    const t = setTimeout(() => {
      revealRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 420);
    return () => clearTimeout(t);
  }, [step, answeredAll, seedPersona]);

  const q = QUIZ[qIdx];

  return (
    <>
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.22 }}
        className="space-y-4 pb-10"
      >
        {/* ---------- Step 1：3 題人格快測 ---------- */}
        {step === 0 && (
          <>
            {/* 標題壓扁成一條：第一屏就要看得到 Q1，不然沒人會往下捲 */}
            <Card className="relative flex items-center gap-3 overflow-hidden px-3 py-2.5" style={{ background: "#FFE0B8" }}>
              <Mascot persona={seedPersona} size={64} bg={false} float={false} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black opacity-60">Step 1／3　旅遊人格快測</div>
                <h1 className="tm-display text-[22px] leading-tight">3 題，先看看你是哪種旅人</h1>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center gap-1.5">
                {QUIZ.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setQIdx(i)}
                    aria-label={`第 ${i + 1} 題`}
                    className={`h-2.5 flex-1 rounded-full border-2 border-[#1F2350] ${quiz[item.id] ? "bg-[#6CC08B]" : i === qIdx ? "bg-[#FF6B35]" : "bg-white"}`}
                  />
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={q.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }}>
                  <div className="text-xs font-bold opacity-50">Q{qIdx + 1}</div>
                  <h2 className="tm-display text-xl leading-snug">{q.ask}</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <ChoiceTile data={q.a} active={quiz[q.id] === q.a.key} onClick={() => pick(q.id, q.a.key)} />
                    <ChoiceTile data={q.b} active={quiz[q.id] === q.b.key} onClick={() => pick(q.id, q.b.key)} />
                  </div>
                </motion.div>
              </AnimatePresence>
            </Card>

            <AnimatePresence>
              {answeredAll && seedPersona && (
                <motion.div ref={revealRef} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="flex items-center gap-3 p-3" style={{ background: PERSONAS[seedPersona].soft }}>
                    <Mascot persona={seedPersona} size={82} bg={false} float={false} delay={0.1} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-black opacity-60">你的初始人格雛形</div>
                      <div className="tm-display text-xl leading-tight" style={{ color: PERSONAS[seedPersona].color }}>
                        {PERSONAS[seedPersona].emoji} {PERSONAS[seedPersona].name}
                      </div>
                      <div className="text-xs font-bold opacity-70">稱號：{PERSONAS[seedPersona].title}</div>
                    </div>
                  </Card>

                  <Card className="mt-3 space-y-2 p-3">
                    <label htmlFor="nick" className="block text-sm font-black">你的冒險暱稱</label>
                    <input id="nick" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={8} placeholder="例如：阿趣（最多 8 字）" className={INPUT} />
                  </Card>
                  {/* 快測一結束就先送優惠代碼：這時候還沒排行程，只講「一起買有折扣」，不推方案 */}
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                    <Card className="mt-3 overflow-hidden">
                      <div className="flex items-center gap-2 border-b-[3px] border-dashed border-[#1F2350] bg-[#FFF3A6] px-3 py-2">
                        <Ticket size={16} />
                        <span className="text-sm font-black">解鎖：去趣 eSIM 優惠碼</span>
                        <span className="ml-auto rounded-md bg-[#FF6B35] px-1.5 py-0.5 text-[10px] font-black text-white">85 折</span>
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="tm-num flex-1 rounded-xl border-[3px] border-dashed border-[#1F2350] bg-white px-3 py-2 text-center text-xl font-black tracking-[0.2em]">
                            {coupon}
                          </span>
                          <Btn size="sm" variant="ghost" onClick={async () => toast((await copyText(coupon)) ? "優惠碼已複製" : `複製失敗，代碼是 ${coupon}`)}>
                            <Copy size={16} />
                          </Btn>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed opacity-70">
                          去趣 eSIM 全館 85 折，每天 {money(22)} 起。先收著，行程排完會自動帶入。
                        </p>
                      </div>
                    </Card>
                  </motion.div>
                  {/* 真正的下一步按鈕釘在螢幕底部，這裡留空白讓它不會蓋到優惠碼 */}
                  <div className="h-16" />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* ---------- Step 2：預算錨定 + 行前網路 ---------- */}
        {step === 1 && (
          <>
            <button type="button" onClick={() => { sfx("back"); setStep(0); }} className="inline-flex items-center gap-1 text-sm font-bold opacity-70">
              <ChevronLeft size={18} /> 返回快測
            </button>
            <Card className="p-4">
              <Chip><Wallet size={13} /> Step 2／3　預算錨定</Chip>
              <h2 className="tm-display mt-2 text-2xl">這趟大阪，你的預算級別？</h2>
              <p className="text-xs opacity-60">5 天 4 夜、不含機票，含吃住交通與購物。</p>
              <div className="mt-3 space-y-2">
                {BUDGETS.map((b) => (
                  <motion.button
                    key={b.key}
                    type="button"
                    onClick={() => setBudget(b.key)}
                    whileTap={{ scale: 0.98 }}
                    animate={{ y: budget === b.key ? -2 : 0 }}
                    aria-pressed={budget === b.key}
                    className={`flex w-full items-center gap-3 rounded-2xl border-[3px] border-[#1F2350] p-3 text-left ${budget === b.key ? "bg-[#FFC93C] shadow-[4px_4px_0_#1F2350]" : "bg-white shadow-[2px_2px_0_#1F2350]"}`}
                  >
                    <span className="text-2xl">{b.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-black">{b.name}<span className="ml-1 text-xs font-bold opacity-60">{b.range}</span></span>
                      <span className="block text-xs opacity-70">{b.desc}</span>
                    </span>
                    {budget === b.key && <Check size={18} strokeWidth={3} />}
                  </motion.button>
                ))}
              </div>
            </Card>


            <Btn className="w-full" onClick={() => setStep(2)}>下一步：隊伍預備</Btn>
          </>
        )}

        {/* ---------- Step 3：建立 / 加入房間 ---------- */}
        {step === 2 && (
          <>
            <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-sm font-bold opacity-70">
              <ChevronLeft size={18} /> 返回預算設定
            </button>

            {/* 3-a 還沒選模式：建立房間 or 加入房間 */}
            {!inRoom && (
              <>
                <Card className="p-4 text-center" style={{ background: "#FFE0B8" }}>
                  <Chip><Users size={13} /> Step 3／3　開房或加入</Chip>
                  <h2 className="tm-display mt-2 text-2xl leading-snug">你要自己開一間，<br />還是加入朋友的房間？</h2>
                  <p className="mt-1 text-sm opacity-70">房主設定行程與人數，其他人輸入代碼就能進來。</p>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setRoomMode("create"); setJoined(0); }}
                    className={`rounded-2xl border-[3px] border-[#1F2350] p-4 text-left ${roomMode === "create" ? "bg-[#FFC93C] shadow-[4px_4px_0_#1F2350]" : "bg-white shadow-[2px_2px_0_#1F2350]"}`}
                  >
                    <Plus size={22} />
                    <div className="mt-1 font-black">建立房間</div>
                    <div className="text-xs opacity-60">當房主，產生代碼邀朋友</div>
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setRoomMode("join")}
                    className={`rounded-2xl border-[3px] border-[#1F2350] p-4 text-left ${roomMode === "join" ? "bg-[#7CC6FE] shadow-[4px_4px_0_#1F2350]" : "bg-white shadow-[2px_2px_0_#1F2350]"}`}
                  >
                    <LogIn size={22} />
                    <div className="mt-1 font-black">加入房間</div>
                    <div className="text-xs opacity-60">輸入朋友給的代碼</div>
                  </motion.button>
                </div>

                {roomMode === "join" && (
                  <Card className="space-y-3 p-4">
                    <label htmlFor="joincode" className="block text-sm font-black">房間代碼</label>
                    <input
                      id="joincode"
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && doJoin()}
                      placeholder="OSK-7Q2F"
                      maxLength={10}
                      className={`${INPUT} tm-num text-center text-2xl tracking-[0.25em]`}
                    />
                    <p className="text-xs leading-relaxed opacity-60">
                      Prototype 中輸入任意 4 碼以上都會進入示範房間。
                    </p>
                    <Btn className="w-full" onClick={doJoin}><LogIn size={18} /> 加入房間</Btn>
                  </Card>
                )}
              </>
            )}

            {/* 3-b 已在房間內 */}
            {inRoom && (
              <>
                <Card className="p-4 text-center" style={{ background: isHost ? "#FFE0B8" : "#DDF1FA" }}>
                  <Chip>{isHost ? <><Users size={13} /> 你是房主</> : <><LogIn size={13} /> 已加入 小明 的房間</>}</Chip>
                  <div className="tm-num mt-3 flex justify-center gap-1">
                    {code.split("").map((ch, i) => (
                      <motion.span
                        key={`${ch}-${i}`}
                        initial={{ y: -16, opacity: 0, rotate: -16 }}
                        animate={{ y: 0, opacity: 1, rotate: 0 }}
                        transition={{ delay: i * 0.05, type: "spring", stiffness: 380, damping: 18 }}
                        className={ch === "-" ? "self-center px-0.5 text-2xl font-black" : "grid h-11 w-9 place-items-center rounded-lg border-[3px] border-[#1F2350] bg-white text-2xl font-black"}
                      >
                        {ch}
                      </motion.span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    <Chip>{destName}</Chip>
                    <Chip><CalendarDays size={12} /> {fmtDate(date)}</Chip>
                    <Chip>{tripLabel(days)}</Chip>
                  </div>
                  <div className="mt-3 flex justify-center gap-2">
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={async () => toast((await copyText(`加入去趣房間 ${code}：https://tripmate.example/join/${code}`)) ? "已複製邀請連結" : "複製失敗，請手動複製代碼")}
                    >
                      <Copy size={16} /> 複製邀請連結
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setRoomMode(null); setJoinedCode(null); setJoined(0); }}>
                      換一間
                    </Btn>
                  </div>
                  {!isHost && <p className="mt-2 text-xs opacity-60">行程與人數由房主小明設定，你只要準備好就行。</p>}
                </Card>

                {isHost ? (
                  <Card className="space-y-3 p-4">
                    <div className="flex items-center gap-1.5 text-sm font-black"><MapPin size={15} /> 房主設定（隊友會同步看到）</div>
                    <Field icon={<MapPin size={16} />} label="目的地">
                      <select value={destKey} onChange={(e) => setDestKey(e.target.value)} className={`${INPUT} text-base`}>
                        {DESTINATIONS.map((d) => (
                          <option key={d.key} value={d.key} disabled={!d.ready}>
                            {d.emoji} {d.name}（{d.note}）
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field icon={<CalendarDays size={16} />} label="出發日期">
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} min-w-0 px-2.5 text-sm`} />
                      </Field>
                      <Field icon={<Clock size={16} />} label="旅行天數">
                        <div className="flex items-center gap-1.5">
                          <StepBtn label="減少天數" onClick={() => setDays((d) => Math.max(3, d - 1))}><Minus size={16} /></StepBtn>
                          <span className="tm-num flex-1 whitespace-nowrap text-center text-[13px] font-black leading-tight">{tripLabel(days)}</span>
                          <StepBtn label="增加天數" onClick={() => setDays((d) => Math.min(7, d + 1))}><Plus size={16} /></StepBtn>
                        </div>
                      </Field>
                    </div>
                    <p className="text-[11px] leading-relaxed opacity-55">天數會決定之後排行程的 Day 數；目前只有大阪有完整的 4 站劇本。</p>
                  </Card>
                ) : (
                  <Card className="p-3 text-xs leading-relaxed">
                    <span className="font-black">房主小明的設定：</span>{destName}・{fmtDate(date)} 出發・{tripLabel(days)}・{size} 人。要改的話請他調整。
                  </Card>
                )}

                <Card className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-black">隊伍人數</span>
                    {isHost ? (
                      <div className="flex items-center gap-2">
                        <Btn size="sm" variant="ghost" onClick={() => setSize((s) => Math.max(2, s - 1))} aria-label="減少人數"><Minus size={16} /></Btn>
                        <span className="tm-num w-6 text-center text-xl font-black">{size}</span>
                        <Btn size="sm" variant="ghost" onClick={() => setSize((s) => Math.min(6, s + 1))} aria-label="增加人數"><Plus size={16} /></Btn>
                      </div>
                    ) : (
                      <span className="tm-num text-sm font-bold opacity-60">房主已設定 {size} 人</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {players.map((p) => {
                      const visible = p.isUser || mocks.indexOf(p) < joined;
                      return visible ? (
                        <motion.div
                          key={p.id}
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 360, damping: 20 }}
                          className="flex items-center gap-2 rounded-2xl border-[3px] border-[#1F2350] bg-white p-2"
                        >
                          <Avatar p={p} size={32} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{p.name}{p.isUser && "（你）"}</div>
                            <div className="text-[10px] opacity-60">{p.isHost ? "房主" : "已加入"}</div>
                          </div>
                        </motion.div>
                      ) : (
                        <div key={p.id} className="flex items-center gap-2 rounded-2xl border-[3px] border-dashed border-[#1F2350]/30 p-2 text-xs opacity-60">
                          <ThinkingDots small /> 等待加入
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Btn
                  className="w-full"
                  disabled={!allIn}
                  onClick={() => onStart({
                    nickname: nickname.trim() || "趣友",
                    players, size, budget, network: null, seedPersona: seedPersona || "capybara", code, isHost,
                    dest: destName, destKey, date, days, coupon,
                  })}
                >
                  {!allIn ? "等待隊友加入中" : isHost ? "出發！進入大阪大地圖" : "我準備好了，出發"}
                </Btn>
              </>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>

    {/* 快測答完就把「下一步」釘在螢幕底部：測試時很多人不會往下捲去找按鈕 */}
    {step === 0 && answeredAll && seedPersona && (
      <motion.div
        initial={{ y: 70 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-[#1F2350] bg-[#FFE8D1]/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="mx-auto max-w-md">
          <Btn className="w-full" onClick={() => setStep(1)}>下一步：設定預算</Btn>
        </div>
      </motion.div>
    )}
    </>
  );
}

/* ==================================================================
 * 8. GAME：Gather Town 風大地圖
 * ================================================================== */
const FOLLOW_OFFSET = [
  [0, 0], [18, 10], [-18, 10], [26, -8], [-26, -8], [0, 20],
];

/* 回合之間的站點轉場：蓋住畫面 → 換掉底下的題目 → 拉開
   （朋友回饋「中間可以穿插動畫」，順便讓換題不那麼突然） */
/* 出發開場：從快測直接跳進第 1 題太生硬，這裡補一段「旅程開始」的儀式感 */
function TripOpening({ session, onDone }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const node = MAP_NODES[0];

  useEffect(() => {
    sfx("takeoff");
    const a = setTimeout(() => sfx("arrive"), 1500);
    const b = setTimeout(() => doneRef.current?.(), 3200);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[70] overflow-hidden"
      onClick={() => doneRef.current?.()}
      role="button"
      tabIndex={0}
      aria-label="跳過開場"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") doneRef.current?.(); }}
    >
      <motion.div
        className="absolute -inset-x-10 inset-y-0 flex flex-col items-center justify-center gap-3 px-12"
        style={{
          background: INK,
          backgroundImage: "radial-gradient(#FFFFFF1F 1.4px, transparent 1.5px)",
          backgroundSize: "20px 20px",
        }}
        initial={{ x: "112%", skewX: -7 }}
        animate={{ x: "0%", skewX: 0 }}
        exit={{ x: "-112%", skewX: 7 }}
        transition={{ type: "tween", ease: [0.7, 0, 0.2, 1], duration: 0.55 }}
      >
        {/* 飛機從左下飛到右上，帶出目的地 */}
        <motion.div
          className="text-5xl"
          initial={{ x: -110, y: 70, opacity: 0, rotate: -20 }}
          animate={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 170, damping: 16, delay: 0.35 }}
        >
          ✈️
        </motion.div>

        <motion.div
          className="flex flex-col items-center gap-1 text-center"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.3 }}
        >
          <span className="rounded-full border-2 border-[#FFC93C] px-3 py-0.5 text-[11px] font-bold tracking-[0.25em] text-[#FFC93C]">
            旅程開始
          </span>
          <span className="tm-display text-[34px] leading-tight text-white">{session.dest}</span>
          <span className="tm-num text-sm font-bold text-white/60">
            {fmtDate(session.date)} 出發 · {tripLabel(session.days)}
          </span>
        </motion.div>

        {/* 隊友一個個入場 */}
        <div className="mt-1 flex gap-2">
          {session.players.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ scale: 0, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.85 + i * 0.11 }}
            >
              <Avatar p={p} size={38} />
            </motion.div>
          ))}
        </div>

        {/* 第 1 站在後半段才出現，接住下一個畫面 */}
        <motion.div
          className="mt-4 flex items-center gap-2.5 rounded-2xl border-[3px] border-[#FFC93C]/50 px-4 py-2.5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.35 }}
        >
          <span className="text-3xl">{node.emoji}</span>
          <span className="text-left leading-tight">
            <span className="block text-[10.5px] font-bold tracking-widest text-[#FFC93C]">第 1 站 · 共 {ROUNDS.length} 站</span>
            <span className="tm-display block text-lg text-white">{node.name}</span>
            <span className="block text-[11px] font-bold text-white/50">現在氣溫 {node.temp}</span>
          </span>
        </motion.div>

        <motion.span
          className="absolute bottom-10 text-[11px] font-bold text-white/35"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
        >
          點一下跳過
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

function StationTransition({ node, roundNo, total, last, onMid, onDone }) {
  const midRef = useRef(onMid);
  const doneRef = useRef(onDone);
  midRef.current = onMid;
  doneRef.current = onDone;

  useEffect(() => {
    sfx("swoosh");
    const a = setTimeout(() => { sfx(last ? "fanfare" : "arrive"); midRef.current?.(); }, 640);
    const b = setTimeout(() => doneRef.current?.(), 2000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [last]);

  return (
    <motion.div className="fixed inset-0 z-[70] overflow-hidden" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
      <motion.div
        className="absolute -inset-x-10 inset-y-0 flex flex-col items-center justify-center gap-3 px-10"
        style={{
          background: INK,
          backgroundImage: `radial-gradient(#FFFFFF1F 1.4px, transparent 1.5px)`,
          backgroundSize: "20px 20px",
        }}
        initial={{ x: "112%", skewX: -7 }}
        animate={{ x: "0%", skewX: 0 }}
        exit={{ x: "-112%", skewX: 7 }}
        transition={{ type: "tween", ease: [0.7, 0, 0.2, 1], duration: 0.55 }}
      >
        <motion.div
          initial={{ scale: 0, rotate: -35 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.42 }}
          className="grid h-24 w-24 place-items-center rounded-[28px] border-[4px] border-[#1F2350] bg-[#FFC93C] text-5xl shadow-[6px_6px_0_#FF6B35]"
        >
          {last ? "🏁" : node.emoji}
        </motion.div>

        <motion.div
          className="flex flex-col items-center gap-1 text-center"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.58, duration: 0.3 }}
        >
          <span className="rounded-full border-2 border-[#FFC93C] px-3 py-0.5 text-xs font-bold tracking-widest text-[#FFC93C]">
            {last ? "四站全部走完" : `第 ${roundNo} 站 / ${total}`}
          </span>
          <span className="tm-display text-[30px] leading-tight text-white">{last ? "回飯店結算" : node.name}</span>
          <span className="text-sm font-bold text-white/60">{last ? "來看看你們是什麼組合" : `現在氣溫 ${node.temp}`}</span>
        </motion.div>

        <motion.div
          className="mt-1 flex gap-1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full ${i < roundNo - 1 ? "w-6 bg-[#FF6B35]" : "w-3 bg-white/25"}`}
            />
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function GameMap({ nodeIdx, players, banner, onClose }) {
  return (
    <Card className="relative overflow-hidden p-0">
      {onClose && (
        <button
          type="button"
          onClick={() => { sfx("tap"); onClose(); }}
          aria-label="收起地圖"
          className="absolute right-2 top-2 z-20 rounded-full border-2 border-[#1F2350] bg-white/90 px-2 py-0.5 text-[10px] font-black"
        >
          收起 ▴
        </button>
      )}
      <div
        className="relative h-52"
        style={{
          background: "linear-gradient(#DCEFDC, #CDE7F5)",
          backgroundImage:
            "linear-gradient(rgba(31,35,80,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(31,35,80,.06) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        {/* 路徑 */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {MAP_NODES.slice(0, -1).map((n, i) => {
            const next = MAP_NODES[i + 1];
            const done = i < nodeIdx;
            return (
              <line
                key={n.key}
                x1={n.x} y1={n.y} x2={next.x} y2={next.y}
                stroke={done ? "#FF6B35" : `${INK}33`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={done ? "none" : "6 6"}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* 節點 */}
        {MAP_NODES.map((n, i) => {
          const visited = i < nodeIdx;
          const here = i === nodeIdx;
          return (
            <div key={n.key} className="absolute" style={{ left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)" }}>
              <div className="relative">
                <motion.div
                  animate={here ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={here ? { repeat: Infinity, duration: 1.6 } : { duration: 0.2 }}
                  className={`grid h-11 w-11 place-items-center rounded-2xl border-[3px] border-[#1F2350] text-xl shadow-[2px_2px_0_#1F2350] ${here ? "bg-[#FFC93C]" : visited ? "bg-white" : "bg-white/70"}`}
                >
                  <span className={visited && !here ? "opacity-40" : ""}>{n.emoji}</span>
                </motion.div>
                <AnimatePresence>
                  {visited && (
                    <motion.span
                      initial={{ scale: 0, rotate: -60 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#6CC08B]"
                    >
                      <Check size={12} strokeWidth={4} />
                    </motion.span>
                  )}
                </AnimatePresence>
                <div className="absolute left-1/2 top-[46px] w-24 -translate-x-1/2 text-center text-[10px] font-bold leading-tight">
                  {n.name}
                </div>
              </div>
            </div>
          );
        })}

        {/* 隊伍小人：隊長先動，隊友依序跟上 */}
        {players.map((p, i) => {
          const node = MAP_NODES[Math.min(nodeIdx, MAP_NODES.length - 1)];
          const [ox, oy] = FOLLOW_OFFSET[i % FOLLOW_OFFSET.length];
          return (
            <motion.div
              key={p.id}
              className="absolute z-10"
              style={{ transform: "translate(-50%,-50%)" }}
              initial={false}
              animate={{ left: `${node.x}%`, top: `${node.y}%` }}
              transition={{ type: "spring", stiffness: 90, damping: 14, delay: i * 0.14 }}
            >
              <motion.div
                style={{ marginLeft: ox, marginTop: oy + 26 }}
                animate={{ y: [0, -3, 0] }}
                transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.18 }}
              >
                <Avatar p={p} size={26} />
              </motion.div>
            </motion.div>
          );
        })}

        {/* 抵達橫幅 */}
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <AnimatePresence>
            {banner && (
              <motion.div
                initial={{ y: -18, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -14, opacity: 0 }}
                className="rounded-full border-[3px] border-[#1F2350] bg-white px-3 py-1 text-xs font-black shadow-[3px_3px_0_#1F2350]"
              >
                {banner}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 探索進度 */}
        <div className="absolute bottom-2 left-2 rounded-full border-2 border-[#1F2350] bg-white/90 px-2 py-0.5 text-[10px] font-black">
          探索進度 {Math.min(nodeIdx, MAP_NODES.length - 1)}／{MAP_NODES.length - 1}
        </div>
      </div>
    </Card>
  );
}

/* ---------- 假網路卡頓（選非去趣 eSIM 才會觸發） ---------- */
const LAG_STEPS = [
  "正在載入整理券預約頁⋯⋯",
  "訊號不穩，重新嘗試連線⋯⋯",
  "頁面載入完成：整理券已全數發完 😵",
];
// 選了去趣 eSIM 的人走這條。同一個瞬間、同樣的緊張，但結局是贏的——
// 不然最可能買單的人，反而從頭到尾沒被說服過。
const FAST_STEPS = [
  "正在載入整理券預約頁⋯⋯",
  "頁面秒開，正在送出預約⋯⋯",
  "預約成功：下午 2:30 的整理券到手 🎉",
];

/* 訊號格會一直閃，讓這 6 秒看起來真的在掙扎 */
function SignalBars({ dead }) {
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
      {[5, 8, 11, 14].map((h, i) => (
        <motion.span
          key={h}
          className="w-[3px] rounded-[1px]"
          style={{ height: h, background: i === 0 ? "#E8453C" : "#1F2350" }}
          animate={dead
            ? { opacity: i === 0 ? 0.85 : 0.15 }
            : { opacity: i === 0 ? [0.9, 0.2, 0.9, 0.5, 0.9] : [0.15, 0.15, 0.35, 0.15, 0.15] }}
          transition={dead ? { duration: 0.3 } : { repeat: Infinity, duration: 1.2 + i * 0.25, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function LagModal({ network, onDone }) {
  const win = network === "esim";
  const STEPS = win ? FAST_STEPS : LAG_STEPS;
  const [step, setStep] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (step >= STEPS.length - 1) { sfx(win ? "fanfare" : "fail"); return undefined; }
    sfx(win ? "dial" : (step === 0 ? "dial" : "glitch"));
    // 順的那條不需要重試音；卡的那條每 550ms 補一聲，不然這 6 秒耳朵是空的
    const beat = win ? null : setInterval(() => sfx("retry"), 550);
    const t = setTimeout(() => setStep((s) => s + 1), win ? 900 : 1800);
    return () => { if (beat) clearInterval(beat); clearTimeout(t); };
  }, [step, win, STEPS.length]);

  const last = step === STEPS.length - 1;
  const net = NETWORKS.find((n) => n.key === network);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-[#1F2350]/80 px-5"
    >
      <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-sm">
        <Card className="p-5 text-center">
          <div className={`flex items-center justify-center gap-2 text-sm font-black ${win ? "text-[#1F7A55]" : "text-[#E8453C]"}`}>
            {win
              ? <><Wifi size={16} /> 5G　訊號滿格　{net?.name}</>
              : <><SignalBars dead={last} /> 3G　訊號 {last ? "0" : "1"} 格　{net?.name}</>}
          </div>
          {/* 轉圈會時快時慢、偶爾抖一下，看起來才像卡住而不是在讀取 */}
          {last && win ? (
            <motion.div className="mx-auto mt-4 w-fit" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
              <div className="grid h-14 w-14 place-items-center rounded-full border-[4px] border-[#1F2350] bg-[#6CC08B]">
                <Check size={30} strokeWidth={4} />
              </div>
            </motion.div>
          ) : (
            /* 卡的那條：轉圈時快時慢、偶爾抖一下，看起來才像卡住而不是在讀取 */
            <motion.div
              className="mx-auto mt-4 w-fit"
              animate={last ? { rotate: 0, scale: 0.9, opacity: 0.35 } : win ? { rotate: 360 } : { rotate: [0, 190, 210, 360], x: [0, 0, -2, 2, 0] }}
              transition={last ? { duration: 0.3 } : win ? { repeat: Infinity, duration: 0.6, ease: "linear" } : { repeat: Infinity, duration: 1.6, ease: "linear", times: [0, 0.45, 0.62, 1] }}
            >
              <Loader size={54} strokeWidth={3} color={last ? "#E8453C" : INK} />
            </motion.div>
          )}
          <AnimatePresence mode="wait">
            <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-4 text-[15px] font-bold leading-relaxed">
              {STEPS[step]}
            </motion.p>
          </AnimatePresence>
          <div className="mt-3 h-3 overflow-hidden rounded-full border-[3px] border-[#1F2350] bg-white">
            <motion.div
              className={`h-full ${win ? "bg-[#2F9E62]" : "bg-[#E8453C]"}`}
              animate={{ width: (win ? ["45%", "80%", "100%"] : ["8%", "37%", "100%"])[step] || "8%" }}
              transition={{ duration: win ? 0.5 : (last ? 0.4 : 1.5), ease: last ? "easeOut" : "easeInOut" }}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed opacity-60">
            {win
              ? "上萬人同時連線，你 2 秒就進去了。"
              : "共用熱點和漫遊降速就是這樣。這 6 秒，別人已經搶到了。"}
          </p>
          <Btn className="mt-4 w-full" disabled={!last} onClick={() => doneRef.current()}>
            {last
              ? (win ? <><Wifi size={18} /> 太順了，繼續遊戲</> : <><WifiOff size={18} /> 好吧⋯⋯繼續遊戲</>)
              : "連線中，請稍候"}
          </Btn>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ---------- 趣趣問網路方案（第 1 站結束、去 USJ 之前） ---------- */
function NetworkAsk({ days, onPick }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2350]/80 px-5 py-6"
    >
      <motion.div initial={{ scale: 0.88, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 280, damping: 22 }} className="w-full max-w-sm">
        <div className="flex justify-center">
          <Mascot size={92} bg={false} float={false} face="think" />
        </div>
        <div className="relative rounded-3xl border-[3px] border-[#1F2350] bg-white p-4 shadow-[5px_5px_0_#FF6B35]">
          <span className="absolute -top-3 left-4 rounded-lg border-[3px] border-[#1F2350] bg-[#FF6B35] px-2 py-0.5 text-xs font-black text-white">趣趣</span>
          <p className="mt-1 text-[16px] leading-relaxed">
            對了，明天一早要衝 USJ 搶整理券⋯⋯<br />
            你這趟打算怎麼上網？
          </p>
          <p className="mt-1.5 text-[11px] font-bold leading-relaxed opacity-55">
            這個選擇會真的影響接下來的遊戲。選到會卡的方案，就是會卡。
          </p>
          <div className="mt-3 space-y-2">
            {NETWORKS.map((nw, i) => (
              <motion.button
                key={nw.key}
                type="button"
                onClick={() => { sfx("select"); onPick(nw.key); }}
                whileTap={{ scale: 0.98 }}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                className="flex w-full items-center gap-2.5 rounded-2xl border-[3px] border-[#1F2350] bg-white p-2.5 text-left shadow-[2px_2px_0_#1F2350]"
              >
                <span className="text-xl">{nw.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-black leading-snug">{nw.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug opacity-65">
                    {nw.tag && (
                      <span className="mr-1 whitespace-nowrap rounded-md bg-[#FF6B35] px-1.5 py-0.5 text-[10px] font-black text-white">{nw.tag}</span>
                    )}
                    {nw.desc}
                  </span>
                </span>
                <span className="tm-num shrink-0 text-right text-[11px] font-black leading-tight">
                  {nw.price ? `${money(nw.price)}／日` : "免費"}
                  <span className="block font-bold opacity-50">{days} 天 {money(nw.price * days)}</span>
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- 大提示（4 秒自動關閉） ---------- */
const HINT_MS = 4000;

function HintModal({ roundIdx, results, hint, seed, onClose }) {
  // 有兩段角色動作時多留一點時間，兩段都看得完
  const total = HINT_MS + Math.max(0, (hint.duels?.length || 0) - 1) * DUEL_MS;
  const [remain, setRemain] = useState(total);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    sfx("success");
    const started = Date.now();
    const id = setInterval(() => {
      const left = total - (Date.now() - started);
      if (left <= 0) {
        clearInterval(id);
        closeRef.current();
      } else setRemain(left);
    }, 80);
    return () => clearInterval(id);
  }, [total]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-[#1F2350]/75 px-5"
      onClick={() => closeRef.current()}
    >
      <motion.div
        initial={{ scale: 0.85, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="relative max-h-[calc(100dvh-32px)] overflow-y-auto p-4 sm:p-5">
          <button type="button" onClick={() => closeRef.current()} aria-label="關閉提示" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full border-2 border-[#1F2350] bg-white">
            <X size={16} strokeWidth={3} />
          </button>

          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#FFC93C]"><Radio size={16} /></div>
            <div>
              <div className="text-sm font-black">去趣 TripMate・大提示</div>
              <div className="text-[11px] opacity-60">第 {roundIdx + 1} 站　{ROUNDS[roundIdx].title}</div>
            </div>
          </div>

          {hint.duels?.length > 0 && <DuelReel duels={hint.duels} seed={seed} />}

          <motion.h3
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.1 }}
            className="tm-display mt-3 text-[22px] leading-snug"
          >
            {hint.headline}
          </motion.h3>
          <p className="mt-1 text-sm leading-relaxed">{hint.sub}</p>

          {hint.rows.map((row) => (
            <div
              key={row.text}
              className={`mt-3 rounded-2xl border-2 border-[#1F2350] p-3 text-sm leading-relaxed ${
                row.tone === "warn" ? "bg-[#FFE1D3]" : row.tone === "luxe" ? "bg-[#F6ECCB]" : "bg-[#E3F5EA]"
              }`}
            >
              <div className="font-black">{row.text}</div>
              {row.sub && <div className="mt-0.5 text-xs opacity-75">{row.sub}</div>}
            </div>
          ))}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {results.map((r) => (
              <span key={r.player.id} className="inline-flex items-center gap-1 rounded-full border-2 border-[#1F2350] bg-white px-1.5 py-0.5 text-[11px] font-bold">
                <Avatar p={r.player} size={18} />
                <span className="rounded px-1 text-white" style={{ background: CHOICE_COLOR[r.choice] }}>{r.choice === "AFK" ? "–" : r.choice}</span>
                <span className="max-w-[92px] truncate">{shortOf(roundIdx, r)}</span>
              </span>
            ))}
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#1F2350]/15">
            <motion.div className="h-full bg-[#FF6B35]" animate={{ width: `${(remain / total) * 100}%` }} transition={{ duration: 0.1, ease: "linear" }} />
          </div>
          <div className="mt-1 text-center text-[11px] opacity-50">{Math.ceil(remain / 1000)} 秒後自動前往下一站（點畫面可直接關閉）</div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ==================================================================
 * 8.5 視覺小說場景：4 站各一張背景（純 SVG，不載圖檔）
 * ------------------------------------------------------------------
 * viewBox 1200×900、preserveAspectRatio slice：
 *   手機直式只看得到中間 x 370–830，桌機 16:9 看得到全寬，
 *   所以重點都放在中間那一條，兩側是給大螢幕的延伸。
 * 動態（雪、雨、霓虹閃爍）用 SVG 自己的 <animate>，系統設定「減少動態」時整組關掉。
 * ================================================================== */
const seededRandom = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function Snowfall({ seed, count, x0, x1, y0, y1, anim }) {
  const flakes = useMemo(() => {
    const r = seededRandom(seed);
    return Array.from({ length: count }, () => ({ x: x0 + r() * (x1 - x0), y: y0 + r() * (y1 - y0), s: 2 + r() * 4, d: 5 + r() * 6, b: r() * 8, drift: (r() - 0.5) * 50 }));
  }, [seed, count, x0, x1, y0, y1]);
  return (
    <g fill="#fff">
      {flakes.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r={f.s} opacity=".85">
          {anim && <animate attributeName="cy" values={`${y0 - 10};${y1 + 10}`} dur={`${f.d}s`} begin={`-${f.b}s`} repeatCount="indefinite" />}
          {anim && <animate attributeName="cx" values={`${f.x};${f.x + f.drift};${f.x}`} dur={`${f.d}s`} begin={`-${f.b}s`} repeatCount="indefinite" />}
        </circle>
      ))}
    </g>
  );
}

function SceneRoom({ anim }) {
  const city = useMemo(() => {
    const r = seededRandom(11);
    const far = [];
    for (let x = 320; x < 880; x += 26 + r() * 16) far.push({ x, w: 24 + r() * 18, h: 70 + r() * 110 });
    const near = [];
    for (let x = 320; x < 880; x += 34 + r() * 20) {
      const h = 40 + r() * 90;
      const lit = Array.from({ length: 6 }, () => ({ dx: 5 + r() * 22, dy: 8 + r() * (h - 16), on: r() > 0.45 }));
      near.push({ x, w: 30 + r() * 20, h, lit });
    }
    return { far, near };
  }, []);
  return (
    <>
      <defs>
        <linearGradient id="vnRoomWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F7E9DA" /><stop offset="1" stopColor="#EBD2BC" /></linearGradient>
        <linearGradient id="vnRoomSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8EA8D8" /><stop offset=".58" stopColor="#F2BFB3" /><stop offset="1" stopColor="#FFE3B4" /></linearGradient>
        <radialGradient id="vnFrost"><stop offset="0" stopColor="#fff" stopOpacity=".75" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        <radialGradient id="vnLamp"><stop offset="0" stopColor="#FFE7A8" stopOpacity=".8" /><stop offset="1" stopColor="#FFE7A8" stopOpacity="0" /></radialGradient>
        <clipPath id="vnRoomWin"><rect x="330" y="120" width="540" height="430" rx="16" /></clipPath>
      </defs>
      <rect width="1200" height="900" fill="url(#vnRoomWall)" />
      {Array.from({ length: 26 }, (_, i) => <path key={i} d={`M${i * 48} 0 V690`} stroke="#B98F6E" strokeOpacity=".07" strokeWidth="3" />)}
      {/* 牆上小畫（大螢幕才看得到） */}
      <rect x="96" y="200" width="130" height="100" rx="6" fill="#FFF8EE" stroke="#6B4F3A" strokeWidth="8" />
      <path d="M108 288 L150 236 L176 266 L196 246 L214 288 Z" fill="#9CC5A1" />
      <circle cx="196" cy="226" r="9" fill="#FFB547" />

      {/* 窗外：清晨的大阪 */}
      <g clipPath="url(#vnRoomWin)">
        <rect x="330" y="120" width="540" height="430" fill="url(#vnRoomSky)" />
        <circle cx="600" cy="520" r="140" fill="#FFF1C9" opacity=".35" />
        <circle cx="600" cy="520" r="62" fill="#FFF4D8" opacity=".95" />
        {city.far.map((b, i) => <rect key={`f${i}`} x={b.x} y={550 - b.h} width={b.w} height={b.h} fill="#A9B3DA" />)}
        <path d="M712 552 L722 300 L732 552 Z" fill="#7F8BBE" />
        <rect x="706" y="330" width="32" height="15" rx="3" fill="#7F8BBE" />
        <path d="M722 300 V270" stroke="#7F8BBE" strokeWidth="3" />
        {city.near.map((b, i) => (
          <g key={`n${i}`}>
            <rect x={b.x} y={552 - b.h} width={b.w} height={b.h} fill="#7682B6" />
            {b.lit.filter((l) => l.on).map((l, j) => <rect key={j} x={b.x + Math.min(l.dx, b.w - 8)} y={552 - b.h + l.dy} width="5" height="6" fill="#FFE7A3" />)}
          </g>
        ))}
        <Snowfall seed={3} count={34} x0={330} x1={870} y0={110} y1={560} anim={anim} />
        <circle cx="336" cy="548" r="90" fill="url(#vnFrost)" />
        <circle cx="866" cy="548" r="90" fill="url(#vnFrost)" />
        <circle cx="336" cy="126" r="60" fill="url(#vnFrost)" />
        <circle cx="866" cy="126" r="60" fill="url(#vnFrost)" />
      </g>
      <rect x="330" y="120" width="540" height="430" rx="16" fill="none" stroke="#6B4F3A" strokeWidth="18" />
      <path d="M600 120 V550 M330 335 H870" stroke="#6B4F3A" strokeWidth="10" />
      <rect x="306" y="548" width="588" height="24" rx="6" fill="#FBF1E4" stroke="#6B4F3A" strokeWidth="5" />

      {/* 窗台：熱咖啡 + 07:00 鬧鐘 */}
      <g>
        <rect x="408" y="512" width="38" height="36" rx="7" fill="#fff" stroke="#6B4F3A" strokeWidth="4" />
        <path d="M446 520 Q462 522 460 534 Q458 544 446 542" stroke="#6B4F3A" strokeWidth="4" fill="none" />
        {[418, 430].map((x, i) => (
          <path key={x} d={`M${x} 504 Q${x - 6} 492 ${x} 482 Q${x + 6} 472 ${x} 462`} stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".8">
            {anim && <animate attributeName="opacity" values=".1;.85;.1" dur="2.6s" begin={`${i * 0.9}s`} repeatCount="indefinite" />}
          </path>
        ))}
        <rect x="712" y="508" width="84" height="40" rx="9" fill="#1F2350" />
        <text x="754" y="537" fontSize="24" fontWeight="900" textAnchor="middle" fill="#FF6B6B" fontFamily="ui-monospace,Menlo,monospace">07:00</text>
      </g>

      {/* 窗簾 */}
      <rect x="208" y="78" width="784" height="14" rx="7" fill="#6B4F3A" />
      <path d="M226 90 Q262 360 232 650 L334 650 Q358 360 340 90 Z" fill="#E58C6A" stroke="#B8664A" strokeWidth="4" />
      <path d="M262 100 Q286 360 262 640 M302 100 Q318 360 300 640" stroke="#C9714F" strokeWidth="4" fill="none" />
      <path d="M974 90 Q938 360 968 650 L866 650 Q842 360 860 90 Z" fill="#E58C6A" stroke="#B8664A" strokeWidth="4" />
      <path d="M938 100 Q914 360 938 640 M898 100 Q882 360 900 640" stroke="#C9714F" strokeWidth="4" fill="none" />

      {/* 地板 + 床 + 床頭櫃 */}
      <rect x="0" y="682" width="1200" height="16" fill="#F4E3CF" />
      <rect x="0" y="698" width="1200" height="202" fill="#CFAE8C" />
      {[740, 790, 850].map((y) => <path key={y} d={`M0 ${y} H1200`} stroke="#B8956F" strokeWidth="3" />)}
      <path d="M-40 650 Q140 600 470 652 L540 900 L-40 900 Z" fill="#FFFFFF" stroke="#D8C8B8" strokeWidth="5" />
      <path d="M-40 720 Q160 680 490 730" stroke="#BFD7EA" strokeWidth="18" fill="none" />
      <ellipse cx="110" cy="636" rx="120" ry="40" fill="#F7F2EA" stroke="#D8C8B8" strokeWidth="4" />
      <circle cx="1000" cy="520" r="150" fill="url(#vnLamp)" />
      <rect x="930" y="590" width="150" height="110" rx="8" fill="#B88A63" stroke="#6B4F3A" strokeWidth="5" />
      <path d="M970 590 L1040 590 L1022 530 L988 530 Z" fill="#FFE7A8" stroke="#6B4F3A" strokeWidth="4" />
    </>
  );
}

function ScenePark({ anim }) {
  const crowd = useMemo(() => {
    const r = seededRandom(21);
    const tones = ["#5B6BA8", "#E07A5F", "#3D405B", "#81B29A", "#C06C84", "#6C5B7B", "#F2A65A", "#4D908E"];
    return Array.from({ length: 58 }, () => {
      const y = 600 + r() * 270;
      const s = 0.55 + ((y - 600) / 270) * 0.95;
      return { x: -20 + r() * 1240, y, s, c: tones[Math.floor(r() * tones.length)], hat: r() > 0.6 ? tones[Math.floor(r() * tones.length)] : null, phone: r() > 0.55, side: r() > 0.5 ? 1 : -1, b: r() * 2 };
    }).sort((a, b) => a.y - b.y);
  }, []);
  const flags = ["#FF6B35", "#FFC93C", "#6CC08B", "#3E8EDE", "#EB2F96", "#7C5CE0"];
  return (
    <>
      <defs>
        <linearGradient id="vnParkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9EC6EE" /><stop offset="1" stopColor="#EAF3FB" /></linearGradient>
        <linearGradient id="vnParkGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EFE6D8" /><stop offset="1" stopColor="#D9CBB6" /></linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#vnParkSky)" />
      <circle cx="880" cy="170" r="48" fill="#FFF9E2" opacity=".9" />
      {[[260, 170, 1], [700, 120, 0.8], [1040, 240, 1.1]].map(([x, y, s], i) => (
        <g key={i} fill="#fff" opacity=".9">
          {anim && <animateTransform attributeName="transform" type="translate" values="0 0;40 0;0 0" dur={`${18 + i * 6}s`} repeatCount="indefinite" />}
          <ellipse cx={x} cy={y} rx={70 * s} ry={22 * s} />
          <ellipse cx={x + 40 * s} cy={y - 14 * s} rx={46 * s} ry={24 * s} />
          <ellipse cx={x - 36 * s} cy={y - 8 * s} rx={36 * s} ry={18 * s} />
        </g>
      ))}
      {/* 遠景：城堡 + 雲霄飛車 */}
      <g fill="#B9C4E4">
        <rect x="660" y="390" width="200" height="140" />
        <rect x="632" y="350" width="44" height="180" />
        <rect x="842" y="340" width="46" height="190" />
        <rect x="742" y="290" width="40" height="120" />
      </g>
      <g fill="#8D9ACA">
        <path d="M628 352 L654 286 L680 352 Z" />
        <path d="M838 342 L865 268 L892 342 Z" />
        <path d="M738 292 L762 206 L786 292 Z" />
      </g>
      <path d="M762 206 V186 L780 192 L762 198" fill="#FF6B6B" stroke="#8D9ACA" strokeWidth="2" />
      {[[700, 440], [760, 440], [820, 440], [654, 400], [865, 390]].map(([x, y], i) => <path key={i} d={`M${x - 8} ${y + 22} V${y + 8} Q${x} ${y - 4} ${x + 8} ${y + 8} V${y + 22} Z`} fill="#6E7BAE" />)}
      <g stroke="#8193C4" strokeWidth="9" fill="none" strokeLinecap="round">
        <path d="M120 540 Q210 250 300 420 Q330 470 380 470" />
        <circle cx="440" cy="380" r="86" />
      </g>
      <g stroke="#A3B2DA" strokeWidth="4">
        {[150, 190, 230, 270, 310, 360, 400, 440, 480, 520].map((x) => <path key={x} d={`M${x} 560 V${x < 340 ? 360 + Math.abs(x - 215) * 0.9 : 300 + Math.abs(x - 440) * 0.8}`} />)}
      </g>

      {/* 入園門 */}
      <rect x="0" y="560" width="1200" height="340" fill="url(#vnParkGround)" />
      {Array.from({ length: 13 }, (_, i) => <path key={i} d={`M${600 + (i - 6) * 40} 565 L${600 + (i - 6) * 210} 900`} stroke="#C9B89E" strokeWidth="2" />)}
      {[620, 670, 740, 830].map((y) => <path key={y} d={`M0 ${y} H1200`} stroke="#C9B89E" strokeWidth="2" />)}
      <g stroke="#3B3F6B" strokeWidth="6" strokeLinejoin="round">
        <rect x="416" y="330" width="56" height="292" rx="6" fill="#F6E7C8" />
        <rect x="728" y="330" width="56" height="292" rx="6" fill="#F6E7C8" />
        <rect x="404" y="314" width="80" height="26" rx="6" fill="#FFC93C" />
        <rect x="716" y="314" width="80" height="26" rx="6" fill="#FFC93C" />
        <path d="M404 352 Q600 240 796 352 L796 392 Q600 282 404 392 Z" fill="#E8453C" />
      </g>
      <text x="600" y="330" fontSize="28" fontWeight="900" textAnchor="middle" fill="#fff" letterSpacing="3">入園口 ENTRANCE</text>
      <path d="M472 420 Q600 470 728 420" stroke="#3B3F6B" strokeWidth="3" fill="none" />
      {Array.from({ length: 9 }, (_, i) => {
        const t = (i + 0.5) / 9;
        const x = 472 + t * 256;
        const y = 420 + Math.sin(t * Math.PI) * 38;
        return <path key={i} d={`M${x - 11} ${y} L${x + 11} ${y} L${x} ${y + 24} Z`} fill={flags[i % flags.length]} stroke="#3B3F6B" strokeWidth="2" />;
      })}

      {/* 人潮：每個人都在低頭滑手機 */}
      {crowd.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}>
          <rect x="-17" y="-48" width="34" height="56" rx="15" fill={p.c} />
          <circle cx="0" cy="-60" r="13" fill="#F2D3B5" />
          {p.hat && <path d="M-14 -62 Q0 -82 14 -62 Z" fill={p.hat} />}
          {p.phone && (
            <rect x={p.side * 12 - 5} y="-44" width="10" height="15" rx="2" fill="#9BE7FF" stroke="#3B3F6B" strokeWidth="1.5">
              {anim && <animate attributeName="opacity" values="1;.45;1" dur="1.4s" begin={`${p.b}s`} repeatCount="indefinite" />}
            </rect>
          )}
        </g>
      ))}
      <Snowfall seed={9} count={30} x0={0} x1={1200} y0={0} y1={900} anim={anim} />
    </>
  );
}

const NEON = [
  { x: 450, y: 362, w: 300, h: 62, color: "#7CF29A", text: "道頓堀", size: 40, flicker: false },
  { x: 372, y: 168, w: 58, h: 252, color: "#FF4FA3", vtext: "たこ焼", flicker: true },
  { x: 772, y: 190, w: 58, h: 230, color: "#FFD23F", vtext: "串カツ", flicker: false },
  { x: 232, y: 240, w: 52, h: 236, color: "#3DE2FF", vtext: "ラーメン", flicker: false },
  { x: 884, y: 150, w: 60, h: 220, color: "#FF6B35", vtext: "居酒屋", flicker: true },
  { x: 472, y: 252, w: 150, h: 46, color: "#3DE2FF", text: "お好み焼", size: 26, flicker: false },
];

function SceneCanal({ anim }) {
  const wins = useMemo(() => {
    const r = seededRandom(31);
    return Array.from({ length: 90 }, () => ({ x: r() * 1200, y: 120 + r() * 440, on: r() > 0.55 }));
  }, []);
  const rain = useMemo(() => {
    const r = seededRandom(41);
    return Array.from({ length: 110 }, () => ({ x: -260 + r() * 1500, y: r() * 900, l: 26 + r() * 30 }));
  }, []);
  const umbrellas = [[330, "#E0508F"], [470, "#3E8EDE"], [640, "#FFC93C"], [760, "#6CC08B"], [930, "#FF6B35"]];
  return (
    <>
      <defs>
        <linearGradient id="vnCanalSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15122A" /><stop offset=".62" stopColor="#3B2558" /></linearGradient>
        <linearGradient id="vnCanalWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1A2142" /><stop offset="1" stopColor="#0A0E20" /></linearGradient>
        <filter id="vnGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="vnBlur" x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <rect width="1200" height="900" fill="url(#vnCanalSky)" />
      <ellipse cx="600" cy="540" rx="560" ry="140" fill="#FF4FA3" opacity=".12" />
      <rect x="-40" y="110" width="270" height="520" fill="#1C1833" />
      <rect x="196" y="200" width="226" height="430" fill="#241F42" />
      <rect x="420" y="320" width="360" height="300" fill="#2A2450" />
      <rect x="778" y="150" width="236" height="480" fill="#221D3E" />
      <rect x="990" y="90" width="260" height="540" fill="#1A1731" />
      {wins.map((w, i) => <rect key={i} x={w.x} y={w.y} width="7" height="9" fill={w.on ? "#FFD98A" : "#3B3566"} opacity={w.on ? 0.55 : 0.6} />)}

      {/* 霓虹招牌 */}
      {NEON.map((n, i) => (
        <g key={i} filter="url(#vnGlow)">
          {anim && n.flicker && <animate attributeName="opacity" values="1;1;.35;1;1;.2;1;1" dur={`${3 + i}s`} repeatCount="indefinite" />}
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="9" fill="#120F24" stroke={n.color} strokeWidth="5" />
          {n.text && <text x={n.x + n.w / 2} y={n.y + n.h / 2 + n.size * 0.36} fontSize={n.size} fontWeight="900" textAnchor="middle" fill={n.color}>{n.text}</text>}
          {n.vtext && Array.from(n.vtext).map((ch, j, arr) => (
            <text key={j} x={n.x + n.w / 2} y={n.y + ((j + 0.5) * n.h) / arr.length + 13} fontSize="34" fontWeight="900" textAnchor="middle" fill={n.color}>{ch}</text>
          ))}
        </g>
      ))}

      {/* 運河倒影 */}
      <rect x="0" y="622" width="1200" height="278" fill="url(#vnCanalWater)" />
      {NEON.map((n, i) => (
        <rect key={i} x={n.x + n.w * 0.15} y="640" width={n.w * 0.7} height="230" fill={n.color} opacity=".3" filter="url(#vnBlur)">
          {anim && <animate attributeName="opacity" values=".18;.34;.22;.3;.18" dur={`${2.4 + i * 0.4}s`} repeatCount="indefinite" />}
        </rect>
      ))}
      {[680, 720, 770, 830].map((y, i) => <path key={y} d={`M0 ${y} Q300 ${y - 6} 600 ${y} T1200 ${y}`} stroke="#fff" strokeOpacity={0.06 + i * 0.02} strokeWidth="2" fill="none" />)}

      {/* 橋 + 撐傘的人 */}
      <path d="M-20 600 Q600 560 1220 600 L1220 628 Q600 588 -20 628 Z" fill="#0F0D20" />
      <path d="M-20 556 Q600 516 1220 556" stroke="#0F0D20" strokeWidth="9" fill="none" />
      {Array.from({ length: 31 }, (_, i) => {
        const x = -20 + i * 41;
        const t = (x + 20) / 1240;
        const top = 556 - Math.sin(t * Math.PI) * 40;
        return <path key={i} d={`M${x} ${top} V${top + 46}`} stroke="#0F0D20" strokeWidth="5" />;
      })}
      {umbrellas.map(([x, c], i) => {
        const t = (x + 20) / 1240;
        const base = 590 - Math.sin(t * Math.PI) * 40;
        return (
          <g key={i}>
            <rect x={x - 10} y={base - 52} width="20" height="48" rx="8" fill="#0F0D20" />
            <path d={`M${x - 34} ${base - 60} Q${x} ${base - 104} ${x + 34} ${base - 60} Z`} fill={c} />
            <path d={`M${x} ${base - 92} V${base - 40}`} stroke="#0F0D20" strokeWidth="3" />
          </g>
        );
      })}

      {/* 雨 */}
      <g stroke="#CFE3FF" strokeWidth="2" strokeLinecap="round" opacity=".45">
        {anim && <animateTransform attributeName="transform" type="translate" values="0 0;-225 900" dur="0.85s" repeatCount="indefinite" />}
        {[0, 1].map((k) => (
          <g key={k} transform={k ? "translate(225 -900)" : undefined}>
            {rain.map((d, i) => <path key={i} d={`M${d.x} ${d.y} l${-d.l * 0.25} ${d.l}`} />)}
          </g>
        ))}
      </g>
    </>
  );
}

const ARCADE_SHOPS = [
  { label: "藥妝", sign: "#2F9E62", glow: "#FFF3C4" },
  { label: "TAX FREE", sign: "#E8453C", glow: "#FFE1D3" },
  { label: "古着", sign: "#8B5A2B", glow: "#FDE7C8" },
  { label: "SALE", sign: "#EB2F96", glow: "#FFD6EA" },
  { label: "家電", sign: "#3E8EDE", glow: "#DDF1FA" },
  { label: "抹茶", sign: "#4D908E", glow: "#E3F5EA" },
];

function SceneArcade({ anim }) {
  const VX = 600;
  const lerp = (a, b, t) => a + (b - a) * t;
  const cuts = [0, 0.3, 0.52, 0.67, 0.78, 0.86, 0.92];
  // 左牆：上緣 (0,110)→(530,345)，下緣 (0,880)→(530,515)；右牆鏡射
  const shops = cuts.slice(0, -1).map((t0, i) => {
    const t1 = cuts[i + 1];
    const tl = [lerp(0, 530, t0), lerp(110, 345, t0)];
    const tr = [lerp(0, 530, t1), lerp(110, 345, t1)];
    const br = [lerp(0, 530, t1), lerp(880, 515, t1)];
    const bl = [lerp(0, 530, t0), lerp(880, 515, t0)];
    return { tl, tr, br, bl, h: bl[1] - tl[1], ...ARCADE_SHOPS[i % ARCADE_SHOPS.length] };
  });
  const people = useMemo(() => {
    const r = seededRandom(51);
    const tones = ["#2B2340", "#3D3355", "#4A3D63"];
    const bags = ["#EB2F96", "#FFC93C", "#6CC08B", "#3E8EDE", "#fff"];
    return Array.from({ length: 22 }, () => {
      const y = 540 + r() * 330;
      const d = (y - 520) / 380;
      return { x: lerp(VX - 70, VX + 70, r()) + (r() - 0.5) * 900 * d, y, s: 0.35 + d * 1.2, c: tones[Math.floor(r() * 3)], bag: bags[Math.floor(r() * bags.length)], side: r() > 0.5 ? 1 : -1 };
    }).sort((a, b) => a.y - b.y);
  }, []);
  const quad = (p, mirror) => p.map(([x, y]) => `${mirror ? 1200 - x : x},${y}`).join(" ");
  const slopeTop = (Math.atan2(345 - 110, 530) * 180) / Math.PI;
  return (
    <>
      <defs>
        <radialGradient id="vnArcadeEnd"><stop offset="0" stopColor="#FFF1C9" /><stop offset="1" stopColor="#FFF1C9" stopOpacity="0" /></radialGradient>
        <linearGradient id="vnArcadeFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7A6670" /><stop offset="1" stopColor="#4C3E4C" /></linearGradient>
      </defs>
      <rect width="1200" height="900" fill="#2B2340" />
      {/* 玻璃頂棚 */}
      <path d={`M0 0 H1200 L${VX + 70} 330 H${VX - 70} Z`} fill="#3A3060" />
      {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${i * 150} 0 L${VX - 70 + i * 17.5} 330`} stroke="#5A4E86" strokeWidth="3" />)}
      {[40, 110, 175, 230, 275, 305].map((y) => {
        const t = y / 330;
        return <path key={y} d={`M${lerp(0, VX - 70, t)} ${y} Q${VX} ${y + 18 * (1 - t)} ${lerp(1200, VX + 70, t)} ${y}`} stroke="#6B5E9A" strokeWidth={6 * (1 - t) + 1.5} fill="none" />;
      })}
      {[0, 1].map((side) => [0.08, 0.24, 0.4, 0.55, 0.68, 0.8].map((t, i) => {
        const x = side ? lerp(860, VX + 40, t) : lerp(340, VX - 40, t);
        const y = lerp(30, 315, t);
        return (
          <circle key={`${side}-${i}`} cx={x} cy={y} r={11 * (1 - t) + 3} fill="#FFE3A0">
            {anim && <animate attributeName="opacity" values="1;.7;1" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />}
          </circle>
        );
      }))}
      {/* 盡頭的光 */}
      <rect x={VX - 70} y="330" width="140" height="190" fill="#FFE9B8" />
      <circle cx={VX} cy="430" r="190" fill="url(#vnArcadeEnd)" opacity=".7" />

      {/* 兩側店面 */}
      {[false, true].map((mirror) => (
        <g key={String(mirror)}>
          <polygon points={quad([[0, 90], [530, 340], [530, 520], [0, 900]], mirror)} fill="#43375F" />
          {shops.map((s, i) => {
            const band = 0.2;
            const sb = [s.tl, s.tr, [s.tr[0], s.tr[1] + (s.br[1] - s.tr[1]) * band], [s.tl[0], s.tl[1] + s.h * band]];
            const win = [[s.tl[0] + 4, s.tl[1] + s.h * 0.3], [s.tr[0] - 2, s.tr[1] + (s.br[1] - s.tr[1]) * 0.3], [s.br[0] - 2, s.br[1] - 6], [s.bl[0] + 4, s.bl[1] - 6]];
            const cx = (s.tl[0] + s.tr[0]) / 2;
            const cy = (s.tl[1] + s.tr[1]) / 2 + s.h * band * 0.5;
            const label = mirror ? ARCADE_SHOPS[(i + 3) % ARCADE_SHOPS.length] : s;
            // 字級同時受高度與店面寬度限制，英文字大約半個中文字寬
            const em = Array.from(label.label).reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 0.62 : 1), 0);
            const fs = Math.max(7, Math.min(s.h * 0.085, ((s.tr[0] - s.tl[0]) * 0.82) / em));
            return (
              <g key={i}>
                <polygon points={quad([s.tl, s.tr, s.br, s.bl], mirror)} fill="#2F2647" stroke="#1F1A33" strokeWidth="3" />
                <polygon points={quad(win, mirror)} fill={label.glow} opacity=".92" />
                {[0.45, 0.6, 0.75].map((k) => {
                  const y0 = lerp(win[0][1], win[3][1], k);
                  const y1 = lerp(win[1][1], win[2][1], k);
                  return <path key={k} d={`M${mirror ? 1200 - win[0][0] : win[0][0]} ${y0} L${mirror ? 1200 - win[1][0] : win[1][0]} ${y1}`} stroke={label.sign} strokeOpacity=".45" strokeWidth={Math.max(1.5, s.h * 0.012)} />;
                })}
                <polygon points={quad(sb, mirror)} fill={label.sign} />
                <text
                  transform={`translate(${mirror ? 1200 - cx : cx} ${cy + fs * 0.35}) skewY(${mirror ? -slopeTop : slopeTop})`}
                  fontSize={fs}
                  fontWeight="900"
                  textAnchor="middle"
                  fill="#fff"
                >
                  {label.label}
                </text>
              </g>
            );
          })}
        </g>
      ))}

      {/* 地板 */}
      <polygon points={`0,900 530,520 ${VX + 70},520 1200,900`} fill="url(#vnArcadeFloor)" />
      {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${VX - 70 + i * 14} 520 L${-300 + i * 180} 900`} stroke="#8D7A84" strokeOpacity=".5" strokeWidth="2" />)}
      {[540, 568, 606, 660, 740, 850].map((y) => <path key={y} d={`M0 ${y} H1200`} stroke="#8D7A84" strokeOpacity=".4" strokeWidth="2" />)}
      <ellipse cx={VX} cy="700" rx="260" ry="90" fill="#FFE3A0" opacity=".12" />

      {/* 閉店倒數的吊牌 */}
      <path d="M548 92 L560 158 M652 92 L640 158" stroke="#1F1A33" strokeWidth="3" />
      <rect x="512" y="150" width="176" height="62" rx="10" fill="#FFF3A6" stroke="#1F2350" strokeWidth="5" />
      <text x="600" y="176" fontSize="17" fontWeight="900" textAnchor="middle" fill="#1F2350">心齋橋筋商店街</text>
      <text x="600" y="201" fontSize="17" fontWeight="900" textAnchor="middle" fill="#E8453C">營業至 20:30</text>

      {/* 逛街人潮 */}
      {people.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`} opacity=".92">
          <rect x="-14" y="-46" width="28" height="50" rx="12" fill={p.c} />
          <circle cx="0" cy="-56" r="11" fill={p.c} />
          <rect x={p.side * 14 - 6} y="-22" width="13" height="16" rx="2" fill={p.bag} />
        </g>
      ))}
      {anim && Array.from({ length: 14 }, (_, i) => (
        <circle key={i} cx={200 + ((i * 67) % 800)} cy="600" r="3" fill="#FFE3A0" opacity="0">
          <animate attributeName="cy" values="640;360" dur={`${5 + (i % 4)}s`} begin={`${i * 0.6}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;.8;0" dur={`${5 + (i % 4)}s`} begin={`${i * 0.6}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </>
  );
}

const SCENES = { room: SceneRoom, park: ScenePark, canal: SceneCanal, arcade: SceneArcade };

function SceneBackdrop({ kind }) {
  const reduce = useReducedMotion();
  const Scene = SCENES[kind] || SceneRoom;
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ scale: 1.08, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 1.1, ease: "easeOut" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" className="h-full w-full" style={{ display: "block" }}>
        <Scene anim={!reduce} />
      </svg>
    </motion.div>
  );
}

/* ==================================================================
 * 8.6 角色招牌動作（共識／衝突），揭曉時演給大家看
 * ------------------------------------------------------------------
 * 舞台固定 300×170：左邊是發動動作的人，右邊是對象。
 * 用 CSS keyframes 做，所以每段動畫都是「掛上去就自己播」，換 key 就重播。
 * ================================================================== */
const VN_CSS = `
@keyframes ct-jab{0%,100%{transform:translateX(0)}18%{transform:translateX(30px) rotate(7deg)}34%{transform:translateX(0)}52%{transform:translateX(30px) rotate(7deg)}68%{transform:translateX(0)}}
@keyframes ct-recoil{0%,100%{transform:translateX(0)}20%,54%{transform:translateX(12px) rotate(9deg)}36%,70%{transform:translateX(0)}}
@keyframes ct-flash{0%,100%{opacity:0;transform:scale(.3)}18%,52%{opacity:1;transform:scale(1.15)}34%,68%{opacity:0;transform:scale(.6)}}
@keyframes ct-slide-off{0%{transform:translateX(0)}18%{transform:translateX(14px) skewX(12deg)}100%{transform:translateX(-280px) skewX(-22deg)}}
@keyframes ct-speedlines{0%{opacity:0;transform:translateX(30px)}25%{opacity:1}100%{opacity:0;transform:translateX(-90px)}}
@keyframes ct-melt{0%{transform:scale(1,1)}25%{transform:scale(1.06,.9)}45%{transform:scale(.95,1.04)}100%{transform:translateY(8px) scale(1.75,.14)}}
@keyframes ct-puddle{0%,40%{opacity:0;transform:scaleX(.2)}100%{opacity:1;transform:scaleX(1)}}
@keyframes ct-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px) rotate(-4deg)}75%{transform:translateX(5px) rotate(4deg)}}
@keyframes ct-tremble{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-1px)}}
@keyframes ct-flip-menu{0%{opacity:0;transform:translate(0,30px) rotate(0)}15%{opacity:1}45%{transform:translate(40px,-40px) rotate(200deg)}100%{opacity:1;transform:translate(80px,40px) rotate(400deg)}}
@keyframes ct-pop{0%{opacity:0;transform:scale(.2)}50%{opacity:1;transform:scale(1.25)}70%{transform:scale(.95)}100%{opacity:1;transform:scale(1)}}
@keyframes ct-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
@keyframes ct-windup{0%,100%{transform:translateX(0) rotate(0)}20%{transform:translateX(-10px) rotate(-10deg)}35%{transform:translateX(14px) rotate(8deg)}60%{transform:translateX(0) rotate(0)}}
@keyframes ct-throw{0%{opacity:0;transform:translate(0,0) rotate(0)}10%{opacity:1}55%{transform:translate(105px,-8px) rotate(-25deg)}70%{transform:translate(100px,4px) rotate(-10deg)}100%{opacity:0;transform:translate(110px,60px) rotate(-60deg)}}
@keyframes ct-knockback{0%,45%{transform:translateX(0) rotate(0)}58%{transform:translateX(26px) rotate(20deg)}100%{transform:translateX(18px) rotate(12deg)}}
@keyframes ct-shutter{0%{transform:translateY(-102%)}60%{transform:translateY(0)}72%{transform:translateY(-7%)}84%,100%{transform:translateY(0)}}
@keyframes ct-charge{0%{transform:translateX(0)}28%{transform:translateX(-16px) rotate(-6deg)}52%{transform:translateX(64px) rotate(6deg)}70%,100%{transform:translateX(44px) rotate(0)}}
@keyframes ct-bounced{0%,48%{transform:translate(0,0) rotate(0)}68%{transform:translate(26px,-38px) rotate(45deg)}100%{transform:translate(30px,4px) rotate(80deg)}}
@keyframes ct-impact{0%{opacity:0;transform:scale(.3)}35%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(1.5)}}
@keyframes ct-wave{0%{transform:rotate(-28deg)}100%{transform:rotate(22deg)}}
@keyframes ct-lean-in-l{0%{transform:translateX(0)}40%,100%{transform:translateX(30px) rotate(8deg)}}
@keyframes ct-lean-in-r{0%{transform:translateX(0)}40%,100%{transform:translateX(-30px) rotate(-8deg)}}
@keyframes ct-tap-l{0%,100%{transform:translateX(0)}40%{transform:translateX(44px) rotate(14deg)}55%{transform:translateX(30px) rotate(4deg)}}
@keyframes ct-tap-r{0%,100%{transform:translateX(0)}40%{transform:translateX(-44px) rotate(-14deg)}55%{transform:translateX(-30px) rotate(-4deg)}}
@keyframes ct-frame{0%{opacity:0;transform:scale(1.5)}40%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}
@keyframes ct-float-heart{0%{opacity:0;transform:translateY(12px) scale(.4)}45%{opacity:1;transform:translateY(-6px) scale(1.2)}100%{opacity:0;transform:translateY(-36px) scale(1)}}
@keyframes ct-bubble{0%{opacity:0;transform:translateY(0) scale(.3)}20%{opacity:.95}100%{opacity:0;transform:translateY(-95px) scale(1.25)}}
@keyframes ct-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes ct-hop{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.08,.9)}40%{transform:translateY(-28px) scale(.95,1.06)}70%{transform:translateY(0) scale(1.06,.94)}}
@keyframes ct-stamp{0%{opacity:0;transform:translateY(-90px) scale(1.5) rotate(-20deg)}45%{opacity:1}60%{transform:translateY(0) scale(.9) rotate(-12deg)}70%{transform:scale(1.08) rotate(-12deg)}100%{opacity:1;transform:scale(1) rotate(-12deg)}}
@keyframes ct-nod{0%,100%{transform:rotate(0)}30%{transform:rotate(-8deg)}60%{transform:rotate(6deg)}}
@keyframes ct-pass{0%{opacity:0;transform:translateX(0) rotate(-12deg)}15%{opacity:1}70%,100%{opacity:1;transform:translateX(72px) rotate(6deg)}}
@keyframes ct-confetti{0%{opacity:1;transform:translateY(-10px) rotate(0)}100%{opacity:0;transform:translateY(170px) rotate(620deg)}}
@keyframes ct-together-l{0%{transform:translateX(0)}45%,100%{transform:translateX(38px)}}
@keyframes ct-together-r{0%{transform:translateX(0)}45%,100%{transform:translateX(-38px)}}
@keyframes ct-camera-flash{0%,58%{opacity:0}62%{opacity:.95}100%{opacity:0}}
@keyframes ct-drive-in{0%{transform:translateX(260px)}70%{transform:translateX(-8px)}85%{transform:translateX(3px)}100%{transform:translateX(0)}}
@media (prefers-reduced-motion: reduce){.ct-anim{animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;

const ACT_STAR = (cx, cy, outer, inner, n) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

function ActBurst({ size = 48, text, color = "#FFC93C" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <polygon points={ACT_STAR(24, 24, 23, 11, 8)} fill="#FFF6B3" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {text && <text x="24" y="29" fontSize="13" fontWeight="900" textAnchor="middle" fill="#D7263D">{text}</text>}
    </svg>
  );
}

function ActTag({ text, color = INK }) {
  return (
    <div className="whitespace-nowrap rounded-xl border-2 bg-white px-2 py-0.5 text-[13px] font-black" style={{ borderColor: color, color }}>
      {text}
    </div>
  );
}

function ActFx({ style, children }) {
  return <div className="ct-anim pointer-events-none absolute" style={style}>{children}</div>;
}

// 舞台座標速查：左邊角色 x 28–128，右邊角色 x 172–272，中線 x 150，地面 y 156
const PERSONA_ACTIONS = {
  /* 打卡機：取景框框比心／鏡頭戳人 */
  camera: {
    conflict: {
      actor: "ct-jab 1.6s ease-in-out both", partner: "ct-recoil 1.6s ease-in-out both",
      fx: () => <ActFx style={{ left: 126, top: 74, animation: "ct-flash 1.6s ease-in-out both" }}><ActBurst text="喀!" /></ActFx>,
    },
    agree: {
      actor: "ct-lean-in-l 1.8s ease-out both", partner: "ct-lean-in-r 1.8s ease-out both",
      fx: (A) => (
        <>
          <ActFx style={{ left: 62, top: 22, animation: "ct-frame .7s .3s ease-out both" }}>
            <svg width="176" height="140" viewBox="0 0 176 140">
              <path d="M4 26 V4 H26 M150 4 H172 V26 M172 114 V136 H150 M26 136 H4 V114" stroke={A} strokeWidth="5" fill="none" strokeLinecap="round" />
              <circle cx="160" cy="14" r="4" fill="#E53935" />
            </svg>
          </ActFx>
          <ActFx style={{ left: 133, top: 30, animation: "ct-float-heart 1.1s .6s ease-out infinite both" }}>
            <svg width="34" height="34" viewBox="0 0 200 200"><path d={heartPath(100, 110, 11)} fill={A} /></svg>
          </ActFx>
        </>
      ),
    },
  },
  /* 特種兵：超響亮擊掌／急速滑步離場 */
  soldier: {
    conflict: {
      actor: "ct-slide-off 1.3s .25s cubic-bezier(.6,0,.9,.4) both", partner: "ct-shake .5s ease-in-out 3 both",
      fx: (A) => (
        <>
          <ActFx style={{ left: 40, top: 80, animation: "ct-speedlines 1s .45s ease-out both" }}>
            <svg width="110" height="60" viewBox="0 0 110 60"><path d="M10 10 H90 M0 26 H100 M20 42 H110 M30 56 H80" stroke={A} strokeWidth="3" strokeLinecap="round" /></svg>
          </ActFx>
          <ActFx style={{ left: 200, top: 26, animation: "ct-pop .4s .9s ease-out both" }}><ActTag text="欸？人呢" /></ActFx>
        </>
      ),
    },
    agree: {
      actor: "ct-tap-l 1.2s ease-in-out both", partner: "ct-tap-r 1.2s ease-in-out both",
      fx: () => <ActFx style={{ left: 122, top: 60, animation: "ct-impact .9s .4s ease-out both" }}><ActBurst size={56} text="啪!" /></ActFx>,
    },
  },
  /* 水豚：一起吐放空泡泡／化成一灘黃水 */
  capybara: {
    conflict: {
      actor: "ct-melt 1.6s .1s ease-in both", actorOrigin: "50% 95%", partner: "ct-shake .5s ease-in-out 2 both",
      fx: () => (
        <ActFx style={{ left: 8, top: 136, animation: "ct-puddle 1.6s .1s ease-in both" }}>
          <svg width="140" height="26" viewBox="0 0 140 26">
            <path d="M8 14 Q20 2 50 6 Q70 0 100 5 Q132 4 134 14 Q130 24 96 22 Q70 26 40 22 Q4 24 8 14 Z" fill={BODY} stroke={INK} strokeWidth="2.5" />
            <ellipse cx="46" cy="11" rx="10" ry="2.5" fill="#fff" fillOpacity=".6" />
          </svg>
        </ActFx>
      ),
    },
    agree: {
      actor: "ct-bob 1.8s ease-in-out infinite", partner: "ct-bob 1.8s .3s ease-in-out infinite",
      fx: (A) => (
        <>
          {[[72, 0], [84, 0.5], [76, 1], [216, 0.25], [228, 0.75], [220, 1.2]].map(([x, d], i) => (
            <ActFx key={i} style={{ left: x, top: 92, animation: `ct-bubble 1.6s ${d}s ease-out infinite both` }}>
              <div className="rounded-full border-2 bg-white/70" style={{ width: 12 + (i % 3) * 4, height: 12 + (i % 3) * 4, borderColor: A }} />
            </ActFx>
          ))}
        </>
      ),
    },
  },
  /* 購物狂：提袋開箱大歡呼／購物紙袋無情衝撞 */
  shopper: {
    conflict: {
      actor: "ct-charge 1.4s ease-in-out both", partner: "ct-bounced 1.4s ease-out both",
      fx: (A) => <ActFx style={{ left: 150, top: 64, animation: "ct-impact .7s .6s ease-out both" }}><ActBurst size={56} text="砰!" color={A} /></ActFx>,
    },
    agree: {
      actor: "ct-hop .8s ease-out infinite", partner: "ct-hop .8s .2s ease-out infinite",
      fx: (A) => (
        <>
          {Array.from({ length: 16 }, (_, i) => (
            <ActFx key={i} style={{ left: 12 + ((i * 53) % 276), top: -10, animation: `ct-confetti ${1.2 + (i % 3) * 0.25}s ${(i * 0.09).toFixed(2)}s linear infinite both` }}>
              <div style={{ width: 6, height: 11, borderRadius: 2, background: [A, "#3E8EDE", "#FFC93C", "#6CC08B"][i % 4] }} />
            </ActFx>
          ))}
        </>
      ),
    },
  },
  /* 精算師：蓋章批准報銷／甩出厚帳單打臉 */
  accountant: {
    conflict: {
      actor: "ct-windup 1s ease-in-out both", partner: "ct-knockback 1.6s ease-out both",
      fx: () => (
        <ActFx style={{ left: 104, top: 64, animation: "ct-throw 1.3s .25s ease-in both" }}>
          <svg width="40" height="66" viewBox="0 0 40 66">
            <path d="M2 2 H38 V58 L33 64 L28 58 L23 64 L18 58 L13 64 L8 58 L2 64 Z" fill="#fff" stroke="#94A3B8" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 12 H32 M8 19 H28 M8 26 H32 M8 33 H24 M8 40 H32" stroke="#94A3B8" strokeWidth="1.5" />
            <text x="20" y="53" fontSize="9" fontWeight="900" fill="#D7263D" textAnchor="middle">¥¥¥</text>
          </svg>
        </ActFx>
      ),
    },
    agree: {
      actor: "ct-nod .9s ease-in-out 2 both", partner: "ct-hop .7s 1s ease-out both",
      fx: () => (
        <>
          <ActFx style={{ left: 118, top: 44, animation: "ct-pop .4s ease-out both" }}>
            <svg width="64" height="84" viewBox="0 0 64 84">
              <rect x="1" y="1" width="62" height="82" rx="4" fill="#fff" stroke="#CBD5E1" strokeWidth="2" />
              <text x="32" y="16" fontSize="9" fontWeight="800" fill="#334155" textAnchor="middle">報銷單</text>
              <path d="M9 26 H55 M9 34 H48 M9 42 H55 M9 50 H40" stroke="#CBD5E1" strokeWidth="2" />
            </svg>
          </ActFx>
          <ActFx style={{ left: 128, top: 86, animation: "ct-stamp .9s .45s ease-in both" }}>
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" fill="#fff" fillOpacity=".4" stroke="#D7263D" strokeWidth="3" />
              <circle cx="22" cy="22" r="15" fill="none" stroke="#D7263D" strokeWidth="1.2" />
              <text x="22" y="27" fontSize="12" fontWeight="900" fill="#D7263D" textAnchor="middle">核准</text>
            </svg>
          </ActFx>
        </>
      ),
    },
  },
  /* 探險家：悄悄遞出私房地圖／拉下鐵捲門自閉 */
  explorer: {
    conflict: {
      partner: "ct-shake .5s 1s ease-in-out 2 both",
      fx: (A) => (
        <div className="pointer-events-none absolute overflow-hidden" style={{ left: 18, top: 0, width: 122, height: 160 }}>
          <div className="ct-anim absolute inset-0" style={{ animation: "ct-shutter 1s .2s ease-in both" }}>
            <svg width="122" height="160" viewBox="0 0 122 160">
              <rect width="122" height="160" fill="#9AA5B1" />
              {Array.from({ length: 16 }, (_, i) => <path key={i} d={`M0 ${i * 10 + 9} H122`} stroke="#6B7785" strokeWidth="2" />)}
              <rect x="0" y="152" width="122" height="8" fill="#4B5563" />
              <rect x="51" y="150" width="20" height="6" rx="2" fill="#D1D5DB" />
              <rect x="22" y="60" width="78" height="26" rx="3" fill="#fff" stroke={A} strokeWidth="2" />
              <text x="61" y="78" fontSize="12" fontWeight="900" fill={A} textAnchor="middle">本日公休</text>
            </svg>
          </div>
        </div>
      ),
    },
    agree: {
      actor: "ct-lean-in-l 1.8s ease-out both", partner: "ct-lean-in-r 1.8s .6s ease-out both",
      fx: (A) => (
        <>
          <ActFx style={{ left: 26, top: 14, animation: "ct-pop .4s .1s ease-out both" }}><ActTag text="噓…內行的" color={A} /></ActFx>
          <ActFx style={{ left: 98, top: 92, animation: "ct-pass 1.4s .3s ease-out both" }}>
            <svg width="50" height="36" viewBox="0 0 50 36">
              <path d="M1 3 L17 1 L33 3 L49 1 V33 L33 35 L17 33 L1 35 Z" fill="#F5E6C8" stroke="#B08850" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M17 1 V33 M33 3 V35" stroke="#B08850" strokeWidth="1" />
              <path d="M6 28 Q14 14 24 22 T42 10" stroke="#E53935" strokeWidth="1.6" strokeDasharray="3 2" fill="none" />
              <path d="M42 4 C45 4 46.5 6 46.5 8 C46.5 11 42 15 42 15 C42 15 37.5 11 37.5 8 C37.5 6 39 4 42 4 Z" fill="#E53935" />
            </svg>
          </ActFx>
        </>
      ),
    },
  },
  /* 計程車星人：招手全員上車／狂按喇叭催上車 */
  taxi: {
    conflict: {
      actor: "ct-tremble .12s linear infinite", partner: "ct-recoil 1.6s ease-in-out both",
      fx: (A) => (
        <>
          <ActFx style={{ left: 108, top: 36, animation: "ct-flash 1.2s ease-in-out infinite both" }}><ActBurst size={50} text="叭!" color={A} /></ActFx>
          <ActFx style={{ left: 142, top: 86, animation: "ct-flash 1.2s .6s ease-in-out infinite both" }}><ActBurst size={42} text="叭!" color={A} /></ActFx>
        </>
      ),
    },
    agree: {
      actor: "ct-hop .7s .9s ease-out 2 both", partner: "ct-hop .7s 1s ease-out 2 both",
      under: () => (
        <ActFx style={{ left: 66, top: 84, animation: "ct-drive-in 1s ease-out both" }}>
          <svg width="170" height="66" viewBox="0 0 170 66">
            <path d="M10 44 Q12 26 34 24 L52 8 H112 L134 24 Q160 26 162 44 V52 H10 Z" fill="#FFD21F" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d="M58 14 H84 V26 H46 Z M90 14 H108 L124 26 H90 Z" fill="#9EDCFF" stroke={INK} strokeWidth="2" />
            <rect x="70" y="0" width="30" height="10" rx="2" fill="#fff" stroke={INK} strokeWidth="2" />
            <text x="85" y="8.5" fontSize="7" fontWeight="900" textAnchor="middle" fill={INK}>TAXI</text>
            <circle cx="42" cy="54" r="10" fill={INK} /><circle cx="42" cy="54" r="4" fill="#ccc" />
            <circle cx="130" cy="54" r="10" fill={INK} /><circle cx="130" cy="54" r="4" fill="#ccc" />
          </svg>
        </ActFx>
      ),
      fx: (A) => <ActFx style={{ left: 116, top: 12, animation: "ct-pop .4s 1s ease-out both" }}><ActTag text="上車！" color={A} /></ActFx>,
    },
  },
  /* 保母：強行牽手大合照／原地猛烈揮白旗 */
  nanny: {
    conflict: {
      actor: "ct-tremble .12s linear infinite", partner: "ct-shake .45s ease-in-out infinite",
      fx: () => (
        <ActFx style={{ left: 104, top: 10, transformOrigin: "4px 62px", animation: "ct-wave .18s ease-in-out infinite alternate" }}>
          <svg width="50" height="64" viewBox="0 0 50 64">
            <path d="M4 4 V62" stroke="#8B5E34" strokeWidth="3" strokeLinecap="round" />
            <path d="M5 5 Q18 0 28 6 T48 6 V30 Q38 36 28 30 T5 30 Z" fill="#fff" stroke="#94A3B8" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </ActFx>
      ),
    },
    agree: {
      actor: "ct-together-l 1.8s ease-out both", partner: "ct-together-r 1.8s ease-out both",
      fx: () => (
        <>
          <ActFx style={{ left: 116, top: 14, animation: "ct-pop .4s 1.15s ease-out both" }}><ActTag text="Cheese!" color="#3E8EDE" /></ActFx>
          <ActFx style={{ inset: 0, background: "#fff", animation: "ct-camera-flash 1.8s ease-out both" }}><span /></ActFx>
        </>
      ),
    },
  },
};

/* actor／partner 傳人格 key（soldier、capybara⋯） */
function PersonaActionStage({ actor, partner, mode, caption }) {
  const spec = (PERSONA_ACTIONS[actor] || PERSONA_ACTIONS.nanny)[mode];
  const A = PERSONA_IP[actor]?.accent || PERSIMMON;
  const actorFace = mode === "agree" ? "happy" : "mad";
  const partnerFace = mode === "agree" ? "happy" : "shock";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role="img"
        aria-label={caption}
        className="relative overflow-hidden rounded-2xl border-[3px] border-[#1F2350]"
        style={{
          width: 300, height: 170,
          background: mode === "agree" ? "linear-gradient(180deg,#FFF6D6 0%,#E3F5EA 100%)" : "linear-gradient(180deg,#FFE1D3 0%,#FFF6D6 100%)",
        }}
      >
        <div className="absolute inset-x-0 bottom-[14px] h-[2px] bg-[#1F2350]/15" />
        {spec.under?.(A)}
        <div className="ct-anim absolute" style={{ left: 28, bottom: 8, width: 100, height: 100, animation: spec.actor, transformOrigin: spec.actorOrigin || "50% 100%" }}>
          <Mascot persona={actor} size={100} bg={false} float={false} face={actorFace} />
        </div>
        <div className="ct-anim absolute" style={{ right: 28, bottom: 8, width: 100, height: 100, animation: spec.partner, transformOrigin: "50% 100%" }}>
          <Mascot persona={partner} size={100} bg={false} float={false} face={partnerFace} />
        </div>
        {spec.fx(A)}
      </div>
      {caption && <div className={`text-center text-[13px] font-black ${mode === "agree" ? "text-[#1F7A55]" : "text-[#B8440E]"}`}>{caption}</div>}
    </div>
  );
}

/* 揭曉時依序演：先「最合拍」再「差最多」 */
const DUEL_MS = 2400;
function DuelReel({ duels, seed }) {
  const [i, setI] = useState(0);
  const d = duels[i];
  useEffect(() => {
    if (!duels[i]) return undefined;
    const s = setTimeout(() => sfx(duels[i].mode === "agree" ? "cheer" : "bonk"), 260);
    const t = i < duels.length - 1 ? setTimeout(() => setI((x) => x + 1), DUEL_MS) : null;
    return () => { clearTimeout(s); if (t) clearTimeout(t); };
  }, [i, duels]);
  if (!d) return null;
  const nameOf = (p) => (p.isUser ? "你" : p.name);
  const actorKey = personaOf(d.a, seed);
  return (
    <div className="mt-3 flex flex-col items-center">
      {duels.length > 1 && (
        <div className="mb-1.5 flex gap-1">
          {duels.map((x, k) => (
            <span key={k} className={`rounded-full border-2 border-[#1F2350] px-2 py-0.5 text-[10px] font-black ${k === i ? (x.mode === "agree" ? "bg-[#6CC08B]" : "bg-[#FF8C6B]") : "bg-white opacity-50"}`}>
              {x.mode === "agree" ? "最合拍" : "差最多"}
            </span>
          ))}
        </div>
      )}
      <PersonaActionStage
        key={i}
        actor={actorKey}
        partner={personaOf(d.b, seed)}
        mode={d.mode}
        caption={`${nameOf(d.a)} ${d.mode === "agree" ? "♥" : "✕"} ${nameOf(d.b)}・${PERSONA_IP[actorKey][d.mode]}`}
      />
    </div>
  );
}

/* ==================================================================
 * 8.7 視覺小說舞台（取代原本的 RoundCard）
 * ------------------------------------------------------------------
 * 每站的節奏：旁白（ROUNDS.scene）→ 趣趣發問（ROUNDS.line）→ 1～2 位隊友搭話（CHATTER）
 *            → 選項浮出 → 選了之後你的台詞出現在對話框 → 就這麼辦。
 * 點畫面／按 Enter 推進；LOG 看前面講過什麼、AUTO 自動播、SKIP 直接跳到選項。
 * 點舞台上的隊友，可以看他是哪一型人格。
 * ================================================================== */
const personaOf = (p, seed) => (p?.isUser ? seed : p?.type) || "capybara";
const GUIDE_TO_PERSONA_FACE = { think: "idle", surprise: "shock", happy: "happy", worry: "worry" };
let vnAutoPref = false; // AUTO 開了就一路開著，換站不重設

function vnSpeaker(beat) {
  if (!beat || beat.kind === "narration") return { name: "", color: null };
  if (beat.kind === "guide") return { name: "趣趣", color: PERSIMMON };
  return { name: beat.who.name, color: beat.who.color, sub: PERSONAS[beat.who.type]?.short };
}

function stageSlots(n) {
  const width = { 1: 62, 2: 52, 3: 46, 4: 38, 5: 33 }[n] || 30;
  return Array.from({ length: n }, (_, i) => ({ left: 50 + (((i + 0.5) / n) * 100 - 50) * 0.94, width }));
}

function VibePill({ value, prev }) {
  const has = typeof value === "number";
  const delta = has && typeof prev === "number" ? value - prev : 0;
  const col = !has ? "#CBD5E1" : value >= 70 ? "#6CC08B" : value >= 45 ? "#FFC93C" : "#FF8C6B";
  return (
    <div className="flex items-center gap-1.5 rounded-full border-[3px] border-[#1F2350] bg-white/90 py-0.5 pl-0.5 pr-2.5 shadow-[3px_3px_0_#1F2350] backdrop-blur-sm" aria-label={has ? `團隊默契 ${value}` : "團隊默契：答完第一站才會出現"}>
      <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#1F2350]" style={{ background: `conic-gradient(${col} ${has ? value * 3.6 : 0}deg, #F1E6D8 0)` }}>
        <span className="grid h-5 w-5 place-items-center rounded-full bg-white"><Heart size={11} strokeWidth={3} fill={col} /></span>
      </span>
      <span className="leading-none">
        <span className="block text-[9px] font-black opacity-55">默契</span>
        <span className="tm-num text-[15px] font-black">{has ? <CountUp key={value} to={value} duration={0.7} /> : "—"}</span>
      </span>
      <AnimatePresence>
        {delta !== 0 && (
          <motion.span
            key={`${value}-${delta}`}
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className={`tm-num text-[11px] font-black ${delta > 0 ? "text-[#1F7A55]" : "text-[#B8440E]"}`}
          >
            {delta > 0 ? `▲${delta}` : `▼${-delta}`}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function VNStage({ roundIdx, players, profile, onSubmit, ready = true, vibe, vibePrev, onOpenMap, log = [], onLog }) {
  const round = ROUNDS[roundIdx];
  const node = MAP_NODES[round.node];
  const me = players.find((p) => p.isUser);
  const mates = useMemo(() => players.filter((p) => !p.isUser), [players]);
  const seed = profile.seedPersona;

  const beats = useMemo(() => {
    const list = [
      { kind: "narration", text: round.scene },
      { kind: "guide", text: round.line },
    ];
    // 每站換不同的隊友搭話，4 站下來大家都有台詞
    const talkers = [];
    for (let k = 0; k < Math.min(2, mates.length); k += 1) {
      const m = mates[(roundIdx * 2 + k) % mates.length];
      if (!talkers.includes(m)) talkers.push(m);
    }
    talkers.forEach((m) => {
      const text = CHATTER[roundIdx]?.[m.type];
      if (text) list.push({ kind: "mate", who: m, text });
    });
    return list;
  }, [round, mates, roundIdx]);

  const [bi, setBi] = useState(0);
  const [typed, setTyped] = useState(false);
  const [mode, setMode] = useState("talk"); // talk 劇情中／choose 選答案
  const [auto, setAuto] = useState(vnAutoPref);
  const [sel, setSel] = useState(null);
  const [custom, setCustom] = useState("");
  const [answered, setAnswered] = useState([]);
  const [peek, setPeek] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [chapter, setChapter] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef(null);
  const logEndRef = useRef(null);

  const beat = beats[bi];
  const beatId = `vn-r${roundIdx}-b${bi}`;

  // 章節標題：轉場拉開之後浮出來一下
  useEffect(() => {
    if (!ready) return undefined;
    setChapter(true);
    const t = setTimeout(() => setChapter(false), 2200);
    return () => clearTimeout(t);
  }, [ready]);

  // 講過的話都記進 LOG
  useEffect(() => {
    if (!ready || mode !== "talk" || !beat) return;
    onLog?.({ id: beatId, ...vnSpeaker(beat), text: beat.text });
  }, [ready, mode, beatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const goChoose = useCallback(() => {
    beats.forEach((b, i) => {
      const id = `vn-r${roundIdx}-b${i}`;
      typedOnce.add(id);
      onLog?.({ id, ...vnSpeaker(b), text: b.text });
    });
    setTyped(true);
    setMode("choose");
    sfx("pop");
  }, [beats, roundIdx, onLog]);

  const advance = useCallback(() => {
    if (!ready || mode !== "talk") return;
    if (!typed) {
      typedOnce.add(beatId);
      setTyped(true);
      return;
    }
    if (bi < beats.length - 1) {
      sfx("tap");
      setTyped(false);
      setBi((i) => i + 1);
    } else {
      goChoose();
    }
  }, [ready, mode, typed, beatId, bi, beats.length, goChoose]);

  useEffect(() => {
    if (!auto || !typed || mode !== "talk" || !ready || logOpen) return undefined;
    const t = setTimeout(advance, 1600);
    return () => clearTimeout(t);
  }, [auto, typed, mode, ready, logOpen, advance]);

  // 選項出現之後，隊友才開始陸續作答（盲選：只看得到「選好了」）
  useEffect(() => {
    if (mode !== "choose") return undefined;
    const timers = mates.map((m, i) => setTimeout(() => setAnswered((a) => [...a, m.id]), 900 + i * 800 + Math.random() * 700));
    return () => timers.forEach(clearTimeout);
  }, [mode, mates]);

  useEffect(() => {
    if (!peek) return undefined;
    const t = setTimeout(() => setPeek(null), 4000);
    return () => clearTimeout(t);
  }, [peek]);

  useEffect(() => {
    if (logOpen) logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logOpen]);

  const valid = sel === "D" ? custom.trim().length > 0 : Boolean(sel);
  const netWarn = profile.network !== "esim" && round.options[sel]?.needNet;
  const picked = sel && sel !== "D" ? round.options[sel] : null;

  const submit = () => {
    if (!valid || sent) return;
    setSent(true);
    const mine = { choice: sel, custom: sel === "D" ? custom.trim() : "" };
    const results = players.map((p) => {
      const a = p.isUser ? mine : pickMockAnswer(p, roundIdx);
      return { player: p, choice: a.choice, custom: a.custom || "", hits: a.choice === "D" ? classifyCustom(a.custom) : [] };
    });
    onLog?.({ id: `vn-r${roundIdx}-me`, name: me?.name || "你", color: me?.color, text: sel === "D" ? custom.trim() : picked.text });
    onSubmit(results, { needNet: Boolean(round.options[sel]?.needNet) });
  };

  const pickOption = (k) => {
    sfx("select");
    setSel(k);
    if (k === "D") setTimeout(() => inputRef.current?.focus(), 80);
  };

  const onKey = (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (mode === "talk") advance();
    }
  };

  // 舞台上每個人的表情
  const speakingId = mode === "talk" && beat?.kind === "mate" ? beat.who.id : null;
  const faceFor = (p) => {
    if (mode === "talk") {
      if (speakingId === p.id) return typed ? "happy" : "talk";
      if (beat?.kind === "guide") return GUIDE_TO_PERSONA_FACE[round.face] || "idle";
      return "idle";
    }
    return answered.includes(p.id) ? "happy" : "idle";
  };

  // 對話框的名牌與頭像
  let plate = null;
  let portrait = null;
  if (mode === "talk") {
    const sp = vnSpeaker(beat);
    if (sp.name) plate = sp;
    if (beat?.kind === "guide") portrait = { persona: null, face: typed ? round.face : "talk", bg: "#FFE0B8" };
  } else if (sel) {
    plate = { name: me?.name || "你", color: me?.color || PERSIMMON, sub: PERSONAS[seed]?.short };
    portrait = { persona: seed, face: "happy", bg: PERSONAS[seed]?.soft || "#FFE0B8" };
  } else {
    plate = { name: "趣趣", color: PERSIMMON };
    portrait = { persona: null, face: round.face, bg: "#FFE0B8" };
  }

  const slots = stageSlots(mates.length);
  const narration = mode === "talk" && beat?.kind === "narration";

  return (
    <div
      className="relative h-[calc(100dvh-84px)] min-h-[560px] w-full select-none overflow-hidden rounded-[26px] border-[3px] border-[#1F2350] bg-[#1F2350] shadow-[5px_5px_0_#1F2350] outline-none md:aspect-video md:h-auto md:min-h-0"
      onClick={() => { setPeek(null); if (mode === "talk") advance(); }}
      onKeyDown={onKey}
      tabIndex={0}
      role="group"
      aria-label={`第 ${roundIdx + 1} 站：${node.name}`}
    >
      <SceneBackdrop kind={round.bg} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#1F2350]/55 to-transparent" />

      {/* ---- 上方 HUD：站點牌 + 默契 + 地圖 ---- */}
      <div className="absolute inset-x-2.5 top-2.5 z-30 flex items-start justify-between gap-2 md:inset-x-4 md:top-4">
        <div className="flex min-w-0 items-center gap-2 rounded-2xl border-[3px] border-[#1F2350] bg-white/90 py-1 pl-1 pr-3 shadow-[3px_3px_0_#1F2350] backdrop-blur-sm">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 border-[#1F2350] bg-[#FFC93C] text-xl">{node.emoji}</span>
          <span className="min-w-0 leading-tight">
            <span className="tm-num block truncate text-[10px] font-black opacity-60">第 {roundIdx + 1} 站｜{round.clock}｜{node.temp}</span>
            <span className="tm-display block truncate text-[15px]">{node.name}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <VibePill value={vibe} prev={vibePrev} />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); sfx("tap"); onOpenMap?.(); }}
            aria-label="打開大地圖"
            className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#1F2350] bg-white/90 text-lg shadow-[3px_3px_0_#1F2350]"
          >
            🗺️
          </button>
        </div>
      </div>

      {/* ---- 章節標題 ---- */}
      <AnimatePresence>
        {chapter && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[78px] z-20 flex justify-center md:top-[96px]"
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
          >
            <div className="rounded-2xl border-[3px] border-[#1F2350] bg-[#1F2350]/85 px-5 py-2 text-center text-white shadow-[4px_4px_0_#FF6B35] backdrop-blur-sm">
              <div className="text-[10px] font-black tracking-[0.3em] text-[#FFC93C]">STAGE {roundIdx + 1}</div>
              <div className="tm-display text-[22px] leading-tight">{round.title}</div>
              <div className="text-[11px] font-bold opacity-70">{round.subtitle}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- 立繪：隊友站在場景裡 ---- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[146px] top-[30%] z-10 md:bottom-[92px] md:top-[22%]">
        {mates.map((p, i) => {
          const slot = slots[i];
          const speaking = speakingId === p.id;
          const dim = speakingId && !speaking;
          const k = personaOf(p, seed);
          const P = PERSONAS[k];
          return (
            <motion.div
              key={p.id}
              className="absolute bottom-0"
              style={{ left: `${slot.left}%`, width: `${slot.width}%`, maxWidth: 250, x: "-50%", zIndex: speaking ? 5 : 1 }}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: speaking ? -10 : 0, opacity: 1, scale: speaking ? 1.06 : 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: speaking ? 0 : 0.15 + i * 0.08 }}
            >
              <button
                type="button"
                className="pointer-events-auto block w-full"
                aria-label={`${p.name}：${P.name}`}
                onClick={(e) => { e.stopPropagation(); sfx("pop"); setPeek((x) => (x === p.id ? null : p.id)); }}
              >
                <div className="aspect-square w-full" style={{ filter: dim ? "brightness(.68) saturate(.8)" : narration ? "brightness(.88)" : "none", transition: "filter .25s" }}>
                  <Mascot persona={k} size="100%" bg={false} face={faceFor(p)} delay={0.25 + i * 0.08} />
                </div>
              </button>
              {/* 名牌／作答狀態 */}
              <div className="absolute left-1/2 top-[2%] -translate-x-1/2">
                {mode === "choose" ? (
                  answered.includes(p.id) ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-[#1F2350] bg-[#6CC08B] px-2 py-0.5 text-[10px] font-black">
                      <Check size={10} strokeWidth={4} /> {p.name} 選好了
                    </motion.span>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-[#1F2350] bg-white px-2 py-0.5 text-[10px] font-black">
                      {p.name} <ThinkingDots small />
                    </span>
                  )
                ) : (
                  <span
                    className={`whitespace-nowrap rounded-full border-2 border-[#1F2350] px-2 py-0.5 text-[10px] font-black transition-opacity ${speaking ? "text-white" : "bg-white/85 opacity-80"}`}
                    style={speaking ? { background: p.color } : undefined}
                  >
                    {p.name}
                  </span>
                )}
              </div>
              {/* 點角色：看他是哪一型 */}
              <AnimatePresence>
                {peek === p.id && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="pointer-events-auto absolute bottom-[86%] left-1/2 z-40 w-[200px] -translate-x-1/2 rounded-2xl border-[3px] border-[#1F2350] bg-white p-2.5 text-left shadow-[4px_4px_0_#1F2350]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[10px] font-black opacity-55">{p.name} 是</div>
                    <div className="tm-display text-[16px] leading-tight" style={{ color: P.color }}>{P.emoji} {P.name}</div>
                    <p className="mt-1 text-[11.5px] leading-snug">「{P.quote}」</p>
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-bold">
                      <span className="rounded-md bg-[#E3F5EA] px-1.5 py-0.5">🤝 {PERSONA_IP[k].agree}</span>
                      <span className="rounded-md bg-[#FFE1D3] px-1.5 py-0.5">💥 {PERSONA_IP[k].conflict}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* ---- 選項：浮在畫面上 ---- */}
      <AnimatePresence>
        {mode === "choose" && (
          <motion.div key="scrim" className="pointer-events-none absolute inset-0 z-20 bg-[#1F2350]/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        )}
        {mode === "choose" && (
          <motion.div
            key="choices"
            className="absolute inset-x-3 top-[74px] z-30 flex flex-col gap-2 md:inset-x-auto md:right-8 md:top-[20%] md:w-[44%]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {["A", "B", "C"].map((k, i) => {
              const opt = round.options[k];
              const active = sel === k;
              return (
                <motion.button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  disabled={sent}
                  onClick={(e) => { e.stopPropagation(); pickOption(k); }}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0, scale: active ? 1.02 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ delay: i * 0.07, type: "spring", stiffness: 300, damping: 22 }}
                  className={`flex w-full items-center gap-2.5 rounded-full border-[3px] border-[#1F2350] py-2 pl-2 pr-4 text-left backdrop-blur-sm transition-[background-color,box-shadow] ${active ? "bg-[#FFC93C] shadow-[4px_4px_0_#1F2350]" : "bg-white/90 shadow-[2px_2px_0_#1F2350]"}`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-[#1F2350] text-[12px] font-black text-white" style={{ background: CHOICE_COLOR[k] }}>{k}</span>
                  <span className="flex-1 text-[15px] font-black leading-snug">{opt.short}</span>
                  {opt.price && <span className="tm-num shrink-0 rounded-md bg-[#FF6B35] px-1.5 py-0.5 text-[10.5px] font-bold text-white">{money(opt.price)}</span>}
                  {active && <Check size={16} strokeWidth={3.5} className="shrink-0" />}
                </motion.button>
              );
            })}
            <motion.button
              type="button"
              aria-pressed={sel === "D"}
              disabled={sent}
              onClick={(e) => { e.stopPropagation(); pickOption("D"); }}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.21, type: "spring", stiffness: 300, damping: 22 }}
              className={`flex w-full items-center gap-2.5 rounded-full border-[3px] py-2 pl-2 pr-4 text-left backdrop-blur-sm ${sel === "D" ? "border-solid border-[#1F2350] bg-[#ECE5FF] shadow-[4px_4px_0_#1F2350]" : "border-dashed border-[#1F2350] bg-white/75"}`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-[#1F2350] text-[12px] font-black text-white" style={{ background: CHOICE_COLOR.D }}>✎</span>
              <span className="flex-1 text-[15px] font-black leading-snug">自己說一句（TripMate 會讀）</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- 對話框 ---- */}
      <div
        className="absolute inset-x-2.5 bottom-2.5 z-30 md:inset-x-6 md:bottom-5"
        onClick={(e) => { e.stopPropagation(); setPeek(null); if (mode === "talk") advance(); }}
      >
        <AnimatePresence mode="wait">
          {plate && (
            <motion.div
              key={plate.name}
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={`absolute -top-4 z-10 flex items-baseline gap-1.5 rounded-xl border-[3px] border-[#1F2350] px-3 py-0.5 text-white shadow-[2px_2px_0_#1F2350] ${portrait ? "left-[86px] md:left-[96px]" : "left-3"}`}
              style={{ background: plate.color }}
            >
              <span className="tm-display text-[15px] leading-tight">{plate.name}</span>
              {plate.sub && <span className="text-[10px] font-bold opacity-85">{plate.sub}</span>}
            </motion.div>
          )}
        </AnimatePresence>
        {portrait && (
          <div className="absolute -top-7 left-2 z-10 h-[74px] w-[74px] overflow-hidden rounded-2xl border-[3px] border-[#1F2350] shadow-[3px_3px_0_#1F2350] md:h-[82px] md:w-[82px]" style={{ background: portrait.bg }}>
            <div className="-ml-[9px] -mt-[2px]">
              <Mascot persona={portrait.persona} size={94} bg={false} float={false} face={portrait.face} />
            </div>
          </div>
        )}
        <div className={`relative rounded-[22px] border-[3px] border-[#1F2350] bg-white/95 pb-2 pr-4 pt-5 shadow-[4px_4px_0_#1F2350] backdrop-blur md:pr-6 ${portrait ? "pl-[92px] md:pl-[104px]" : "pl-4 md:pl-6"}`}>
          <div className="min-h-[4.9em] text-[15.5px] leading-relaxed md:min-h-[3.6em] md:text-[17px]">
            {mode === "talk" && beat && (
              <p className={narration ? "tm-hand text-[16.5px] text-[#1F2350]/85 md:text-[18px]" : ""}>
                {typed
                  ? beat.text
                  : <Typewriter key={beatId} id={beatId} text={beat.text} start={ready} onDone={() => setTyped(true)} />}
              </p>
            )}
            {mode === "choose" && !sel && <p>{round.line}</p>}
            {mode === "choose" && picked && (
              <motion.p key={sel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{picked.text}</motion.p>
            )}
            {mode === "choose" && sel === "D" && (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  value={custom}
                  maxLength={20}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder={round.placeholder}
                  aria-label="自訂選項，限 20 字"
                  className="w-full min-w-0 rounded-lg border-2 border-[#1F2350] bg-white px-2.5 py-1.5 text-base outline-none focus:ring-4 focus:ring-[#A98BFF]/50"
                />
                <span className="tm-num shrink-0 text-xs font-bold opacity-60">{Array.from(custom).length}/20</span>
              </div>
            )}
            {netWarn && (
              <div className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#FFE1D3] px-2 py-1 text-[11.5px] font-bold text-[#B8440E]">
                <Signal size={12} className="shrink-0" />
                這個選項要即時上網，你選的是「{NETWORKS.find((n) => n.key === profile.network)?.name}」⋯⋯
              </div>
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5">
            <span className={`min-w-0 truncate whitespace-nowrap text-[10.5px] font-bold opacity-45 ${mode === "choose" && sel ? "hidden sm:inline" : ""}`}>
              {mode === "talk" ? (typed ? "點一下繼續" : "點一下顯示全文") : sel ? (valid ? "確定的話就按右邊" : "先說一句你的版本") : "從上面選一個"}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {[
                { key: "log", label: "LOG", on: logOpen, act: () => setLogOpen(true) },
                { key: "auto", label: "AUTO", on: auto, act: () => setAuto((a) => { vnAutoPref = !a; return !a; }) },
                ...(mode === "talk" ? [{ key: "skip", label: "SKIP", on: false, act: goChoose }] : []),
              ].map((b) => (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={b.key === "auto" ? auto : undefined}
                  onClick={(e) => { e.stopPropagation(); sfx("tap"); b.act(); }}
                  className={`rounded-full border-2 border-[#1F2350] px-2 py-0.5 text-[10px] font-black tracking-wider ${b.on ? "bg-[#1F2350] text-white" : "bg-white"}`}
                >
                  {b.label}
                </button>
              ))}
              {mode === "choose" && sel && (
                <Btn size="sm" className="ml-1 shrink-0 whitespace-nowrap" disabled={!valid || sent} onClick={(e) => { e.stopPropagation(); submit(); }}>
                  就這麼辦 ▶
                </Btn>
              )}
            </span>
            {mode === "talk" && typed && (
              <motion.span className="text-[#FF6B35]" animate={{ y: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 1.1 }} aria-hidden="true">▼</motion.span>
            )}
          </div>
        </div>
      </div>

      {/* ---- LOG ---- */}
      <AnimatePresence>
        {logOpen && (
          <motion.div
            className="absolute inset-0 z-50 flex flex-col bg-[#1F2350]/93 p-4 text-white backdrop-blur md:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="tm-display text-xl">對話紀錄</span>
              <span className="text-[11px] font-bold opacity-50">{log.length} 則</span>
              <button type="button" onClick={() => { sfx("back"); setLogOpen(false); }} aria-label="關閉對話紀錄" className="ml-auto grid h-9 w-9 place-items-center rounded-full border-2 border-white/60">
                <X size={16} strokeWidth={3} />
              </button>
            </div>
            <div className="tm-noscroll mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {log.map((e) => (
                <div key={e.id}>
                  <span className="inline-block rounded-md px-1.5 py-0.5 text-[10.5px] font-black" style={{ background: e.color || "#FFFFFF26" }}>{e.name || "旁白"}</span>
                  <p className={`mt-1 text-[14px] leading-relaxed opacity-90 ${e.name ? "" : "tm-hand"}`}>{e.text}</p>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ==================================================================
 * 9. SUMMARY：人格結算 + 雙欄常駐導購
 * ================================================================== */
function Radar({ members, max, focus }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const C = 150;
  const R = 100;
  const N = DIMS.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
  };
  const toPath = (vals) => `${vals.map((v, i) => {
    const [x, y] = pt(i, v);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ")} Z`;
  const zero = toPath(DIMS.map(() => 0));

  return (
    <div ref={ref} className="mx-auto w-full max-w-[280px]">
      <svg viewBox="0 0 300 300" className="h-auto w-full overflow-visible" role="img" aria-label="全隊偏好雷達圖">
        {[0.25, 0.5, 0.75, 1].map((l) => (
          <path key={l} d={toPath(DIMS.map(() => l))} fill={l === 1 ? "#FFF8EE" : "none"} stroke={`${INK}26`} strokeWidth={l === 1 ? 2.5 : 1.5} />
        ))}
        {DIMS.map((d, i) => {
          const [x, y] = pt(i, 1);
          return <line key={d.key} x1={C} y1={C} x2={x} y2={y} stroke={`${INK}26`} strokeWidth="1.5" />;
        })}
        {members.map((m, idx) => {
          const vals = DIMS.map((d) => clamp(m.dims[d.key] / max, 0.08, 1));
          const dim = focus && focus !== m.player.id;
          return (
            <motion.path
              key={m.player.id}
              initial={{ d: zero, opacity: 0 }}
              animate={inView ? { d: toPath(vals), opacity: 1 } : { d: zero, opacity: 0 }}
              transition={{ duration: 0.9, delay: idx * 0.12, ease: "easeOut" }}
              fill={m.player.color}
              fillOpacity={dim ? 0.03 : 0.16}
              stroke={m.player.color}
              strokeOpacity={dim ? 0.2 : 1}
              strokeWidth={focus === m.player.id ? 3.5 : 2.2}
              strokeLinejoin="round"
            />
          );
        })}
        {DIMS.map((d, i) => {
          const [x, y] = pt(i, 1.22);
          return (
            <text key={d.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700" fill={INK}>
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function PersonaCard({ member, seedPersona }) {
  const P = PERSONAS[member.persona];
  const [burst, setBurst] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBurst(false), 1500);
    return () => clearTimeout(t);
  }, []);
  const changed = seedPersona && seedPersona !== member.persona;

  return (
    <Card className="overflow-hidden">
      <div className="relative flex flex-col items-center px-4 pb-4 pt-4 text-center" style={{ background: P.soft }}>
        <Burst show={burst} />
        <Chip>你的最終旅遊人格</Chip>
        <motion.div initial={{ scale: 0.5, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 170, damping: 13 }}>
          <Mascot persona={member.persona} size={148} bg={false} delay={0.5} />
        </motion.div>
        <h2 className="tm-display text-[30px] leading-tight" style={{ color: P.color }}>{P.name}</h2>
        <div className="text-sm font-bold opacity-70">稱號：{P.title}</div>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">{P.gear.map((g) => <Chip key={g}>{g}</Chip>)}</div>
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          <Chip className="!bg-[#E3F5EA]">🤝 共識技：{PERSONA_IP[member.persona].agree}</Chip>
          <Chip className="!bg-[#FFE1D3]">💥 衝突技：{PERSONA_IP[member.persona].conflict}</Chip>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {changed && (
          <div className="rounded-2xl border-2 border-dashed border-[#1F2350] bg-[#FFF8EE] p-2.5 text-xs font-bold">
            快測時你是「{PERSONAS[seedPersona].name}」，4 站玩下來變成「{P.name}」——旅途會改變一個人。
          </div>
        )}
        <p className="text-[15px] leading-relaxed">{P.trait}</p>
        <div className="relative rounded-2xl border-[3px] border-[#1F2350] px-4 py-3">
          <span className="absolute -top-3 left-4 rounded-md px-1.5 text-xs font-black text-white" style={{ background: P.color }}>口頭禪</span>
          <p className="tm-display text-lg">「{P.quote}」</p>
        </div>
        <div className="space-y-1.5">
          {member.mix.map((x) => (
            <div key={x.key} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 font-bold">{PERSONAS[x.key].emoji} {PERSONAS[x.key].short}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-[#1F2350] bg-white">
                <motion.div className="h-full" style={{ background: PERSONAS[x.key].color }} initial={{ width: 0 }} animate={{ width: `${x.pct}%` }} transition={{ delay: 0.8, duration: 0.8 }} />
              </div>
              <span className="tm-num w-9 text-right text-xs font-black">{x.pct}%</span>
            </div>
          ))}
        </div>
        <div className="rounded-2xl bg-[#FFF3A6] p-3 text-sm leading-relaxed">
          <span className="font-black">TripMate 短評：</span>{fill(P.roast, { name: "你" })}
        </div>
      </div>
    </Card>
  );
}

function StickyNote({ groups }) {
  return (
    <motion.div
      initial={{ rotate: -5, y: 16, opacity: 0 }}
      animate={{ rotate: -1.5, y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 160, damping: 14 }}
      className="tm-hand relative bg-[#FFF3A6] px-5 pb-4 pt-7 text-[17px] leading-relaxed text-[#3A2E12] shadow-[3px_6px_0_rgba(31,35,80,.18)]"
    >
      <div className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-3 bg-[#FF9EBB]/75" />
      <div className="mb-1 text-lg font-bold">去趣小提醒</div>
      <p>
        2 月的大阪晚上只有 4 度，
        {groups > 1 ? `你們今晚還會分成 ${groups} 組逛心齋橋。` : "人潮一多很容易走散。"}
        地下街訊號不穩，手機記得保持暢通。
      </p>
      <div className="mt-2 text-right">— 去趣</div>
    </motion.div>
  );
}

function SummaryScreen({ session, history, analysis, onRestart, onPlan, toast }) {
  const [focus, setFocus] = useState(null);
  const A = analysis;
  const me = A.members.find((m) => m.player.isUser);
  const P = PERSONAS[me.persona];
  const n = session.players.length;
  const url = `${SHARE_BASE}${session.code}`;
  const top = A.prefs[0]?.pct || 1;

  const copyLine = async () => {
    const text = `【去趣 TripMate｜${session.dest} ${tripLabel(session.days)}結算】\n我是「${P.emoji} ${P.name}」${P.title}\n隊伍節奏合拍指數 ${A.vibe}%（${A.vibeInfo.label}）\n去趣 eSIM 全館 85 折，行程排完會依實際行程推薦方案\n${url}`;
    const ok = await copyText(text);
    toast(ok ? "結算連結已複製，貼到群組讓大家看看自己的人格" : `複製失敗，請手動複製：${url}`);
  };

  /* 結算頁分成三步：手機上一屏一件事，不用一直往下滑 */
  const STEPS = [
    { key: "me", label: "你的人格" },
    { key: "team", label: "隊伍分析" },
    { key: "plan", label: "行程建議" },
  ];
  const [step, setStep] = useState(0);
  const lastStep = step === STEPS.length - 1;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  return (
    <div className="pb-28">
      <div className="mb-3">
        <h1 className="tm-display text-[28px] leading-tight">{session.dest.replace("日本", "")}冒險結算</h1>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Chip>{tripLabel(session.days)}</Chip>
          <Chip>{n} 人</Chip>
          <Chip>{BUDGETS.find((b) => b.key === session.budget)?.icon} {BUDGETS.find((b) => b.key === session.budget)?.name}</Chip>
        </div>
      </div>

      {/* 三步進度 */}
      <div className="mb-4 flex gap-1.5">
        {STEPS.map((st, i) => (
          <button
            key={st.key}
            type="button"
            onClick={() => { sfx("tap"); setStep(i); }}
            aria-current={i === step}
            className={`flex-1 rounded-xl border-[3px] border-[#1F2350] px-1 py-2 text-center transition-colors ${
              i === step ? "bg-[#1F2350] text-white shadow-[3px_3px_0_#FF6B35]" : i < step ? "bg-[#E3F5EA]" : "bg-white"
            }`}
          >
            <span className="block text-[12px] font-black leading-tight">{st.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={STEPS[step].key}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
          className="space-y-4"
        >
          {step === 0 && (
            <>
              <PersonaCard member={me} seedPersona={session.seedPersona} />
              {/* 隊友改成橫向一排：直的疊起來會讓這一頁長到沒人捲得完 */}
              <div className="text-sm font-black">隊友是哪一型？</div>
              <div className="tm-noscroll -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                {A.members.filter((m) => !m.player.isUser).map((m, i) => {
                  const TP = PERSONAS[m.persona];
                  return (
                    <Card key={m.player.id} className="w-[146px] shrink-0 overflow-hidden text-center">
                      <div style={{ background: TP.soft }}>
                        <Mascot persona={m.persona} size={84} bg={false} float={false} delay={0.15 + i * 0.1} />
                      </div>
                      <div className="p-2">
                        <div className="flex items-center justify-center gap-1">
                          <Avatar p={m.player} size={18} />
                          <span className="truncate text-xs font-bold">{m.player.name}</span>
                        </div>
                        <div className="tm-display text-[15px] leading-tight" style={{ color: TP.color }}>{TP.name}</div>
                        <div className="mt-1 rounded-lg bg-[#FFF8EE] px-1.5 py-1 text-left text-[10.5px] leading-snug">
                          {fill(TP.roast, { name: m.player.name })}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {step === 1 && (
            <>
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-[3px] border-[#1F2350]" style={{ background: `conic-gradient(${PERSIMMON} ${A.vibe * 3.6}deg, #FFE1D3 0)` }}>
              <div className="grid h-[70px] w-[70px] place-items-center rounded-full border-[3px] border-[#1F2350] bg-white">
                <div className="text-center leading-none">
                  <div className="tm-num text-2xl font-black"><CountUp to={A.vibe} /><span className="text-sm">%</span></div>
                  <div className="mt-0.5 text-[9px] font-bold opacity-60">節奏合拍</div>
                </div>
              </div>
            </div>
            <div>
              <div className="tm-display text-xl leading-tight">{A.vibeInfo.label}</div>
              <p className="mt-1 text-sm leading-relaxed opacity-80">{A.vibeInfo.desc}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:items-center">
            <Radar members={A.members} max={A.maxDim} focus={focus} />
            <div className="space-y-2">
              {A.prefs.map((p, i) => (
                <div key={p.key} className="flex items-center gap-2 text-sm">
                  <span className="w-16 shrink-0 font-bold">{p.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-[#1F2350] bg-white">
                    <motion.div
                      className="h-full"
                      style={{ background: i === 0 ? PERSIMMON : i === 1 ? "#FFC93C" : "#7CC6FE" }}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${(p.pct / top) * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.7, delay: i * 0.06 }}
                    />
                  </div>
                  <span className="tm-num w-9 text-right text-xs font-black">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {A.members.map((m) => (
              <button
                key={m.player.id}
                type="button"
                onClick={() => setFocus((f) => (f === m.player.id ? null : m.player.id))}
                aria-pressed={focus === m.player.id}
                className={`inline-flex items-center gap-1 rounded-full border-2 border-[#1F2350] px-2.5 py-1 text-xs font-bold ${focus === m.player.id ? "bg-[#FFC93C]" : "bg-white"}`}
              >
                <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.player.color }} />
                {m.player.isUser ? `${m.player.name}（你）` : m.player.name}
              </button>
            ))}
          </div>

          {A.bestPair && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-[#1F2350] bg-[#E3F5EA] p-3">
                <div className="text-xs font-black text-[#1F7A55]">最合拍組合</div>
                <div className="mt-0.5 font-bold">{A.bestPair.a.player.name} × {A.bestPair.b.player.name}</div>
                <div className="text-xs leading-relaxed opacity-75">{pairReason(A.bestPair, true)}</div>
              </div>
              {A.splitPair && (
                <div className="rounded-2xl border-2 border-[#1F2350] bg-[#FFE1D3] p-3">
                  <div className="text-xs font-black text-[#B8440E]">最需要分流</div>
                  <div className="mt-0.5 font-bold">{A.splitPair.a.player.name} × {A.splitPair.b.player.name}</div>
                  <div className="text-xs leading-relaxed opacity-75">{pairReason(A.splitPair, false)}</div>
                </div>
              )}
            </div>
          )}
        </Card>
            </>
          )}

          {step === 2 && (
            <>
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm font-black">
            <span>集體同樂 {100 - A.splitPct}%</span>
            <span>分流探險 {A.splitPct}%</span>
          </div>
          <div className="mt-2 flex h-4 overflow-hidden rounded-full border-[3px] border-[#1F2350]">
            <motion.div className="h-full bg-[#6CC08B]" initial={{ width: "50%" }} whileInView={{ width: `${100 - A.splitPct}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} />
            <div className="h-full flex-1 bg-[#A98BFF]" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border-2 border-[#1F2350] bg-[#E3F5EA] p-3">
              <div className="text-[11px] font-black text-[#1F7A55]">集體同樂時段</div>
              <ul className="mt-1 space-y-1 text-xs font-bold leading-snug">
                {A.plan.collective.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-[#1F2350] bg-[#F3EEFF] p-3">
              <div className="text-[11px] font-black text-[#5B3FC4]">建議分流時段</div>
              <div className="mt-1 text-xs font-bold">{A.plan.splitTitle}</div>
              <div className="mt-2 space-y-1.5">
                {A.plan.groups.map((g) => (
                  <div key={g.key} className="rounded-xl border-2 border-[#1F2350]/20 bg-white p-2">
                    <div className="text-xs font-bold">{g.icon} {g.name}</div>
                    <div className="text-[10px] opacity-60">{g.desc}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.members.map((p) => (
                        <span key={p.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: p.color }}>
                          {p.isUser ? `${p.name}（你）` : p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

              <StickyNote groups={A.plan.groups.length} />
              <Fold tone="#FFF3A6" title="下一步的排行程是怎麼玩的？">
                AI 照你的人格推薦景點，右滑存進行程、左滑跳過。全隊看同一份，即時同步。
              </Fold>
              <CouponReminder session={session} toast={toast} />
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="ghost" onClick={onRestart}><RotateCcw size={18} /> 再玩一次</Btn>
                <Btn variant="ink" onClick={copyLine}><Share2 size={18} /> 分享結算</Btn>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 底部固定：永遠看得到下一步要做什麼 */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-[#1F2350] bg-[#FFE8D1]/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          {step > 0 && (
            <Btn variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} className="shrink-0">
              <ChevronLeft size={16} /> 上一步
            </Btn>
          )}
          {lastStep ? (
            <Btn className="flex-1" onClick={onPlan}><Sparkles size={18} /> 開始排行程</Btn>
          ) : (
            <Btn className="flex-1" onClick={() => setStep((s) => s + 1)}>
              {step === 0 ? "看隊伍分析" : "看行程建議"} →
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
 * 10. 自由排行程：景點資料 + Mock AI 推薦／排程引擎
 * ================================================================== */
const TAG_LIST = ["美食", "購物", "拍照", "放空", "探索", "文化", "夜生活", "親子", "溫泉", "動漫"];
const TAG_COLOR = {
  美食: "#FF6B35", 購物: "#E0508F", 拍照: "#7C5CE0", 放空: "#3E8EDE", 探索: "#2F9E62",
  文化: "#9A7400", 夜生活: "#5B3FC4", 親子: "#E8853C", 溫泉: "#2A83AD", 動漫: "#C93C7E",
};
const DIM_TAG = { food: "美食", shop: "購物", photo: "拍照", chill: "放空", explore: "探索" };
const KEYWORD_TAG = [
  [/吃|食|拉麵|燒肉|壽司|丼|甜點|咖啡|章魚燒/, "美食"],
  [/買|逛|藥妝|outlet|購物|電器/i, "購物"],
  [/拍|照|夜景|網美|打卡|底片/, "拍照"],
  [/放空|休息|躺|公園|慢|發呆/, "放空"],
  [/巷|探索|散步|在地|亂走|市場/, "探索"],
  [/神社|寺|城|歷史|文化|美術|建築/, "文化"],
  [/居酒屋|酒|夜|燈/, "夜生活"],
  [/小孩|親子|水族|樂園|動物/, "親子"],
  [/溫泉|泡湯|湯屋/, "溫泉"],
  [/動漫|電玩|模型|扭蛋|宅/, "動漫"],
];

/** 景點庫：lat/lng 用於後台估算交通時間 */
const POIS = [
  { id: "usj", name: "日本環球影城 USJ", emoji: "🎢", area: "此花區", lat: 34.6654, lng: 135.4323, tags: ["拍照", "親子", "動漫"], minutes: 420, price: "NT$2,600", cost: 2600, rating: 4.6, reviewCount: 12840, blurb: "冬季限定雪景與哈利波特城堡，設施跟出片率都滿檔。" },
  { id: "kuromon", name: "黑門市場", emoji: "🦀", area: "日本橋", lat: 34.6656, lng: 135.5062, tags: ["美食", "探索"], minutes: 90, price: "NT$600", cost: 600, rating: 4.2, reviewCount: 5310, blurb: "現烤海膽、鮪魚生魚片，站著吃就是最道地的吃法。" },
  { id: "dotonbori", name: "道頓堀・固力果看板", emoji: "🏃", area: "難波", lat: 34.6687, lng: 135.5013, tags: ["拍照", "夜生活", "美食"], minutes: 120, price: "免費", cost: 0, rating: 4.5, reviewCount: 21470, blurb: "霓虹倒影加上跑跑人合照，晚上 8 點人最多也最好拍。" },
  { id: "shinsaibashi", name: "心齋橋筋商店街", emoji: "🛍️", area: "心齋橋", lat: 34.6723, lng: 135.5010, tags: ["購物"], minutes: 150, price: "看你自己", cost: 1500, rating: 4.3, reviewCount: 9860, blurb: "藥妝、電器、服飾一條龍，退稅櫃檯 20:00 前記得排。" },
  { id: "umeda-sky", name: "梅田藍天大廈 空中庭園", emoji: "🌃", area: "梅田", lat: 34.7052, lng: 135.4901, tags: ["拍照", "夜生活"], minutes: 90, price: "NT$350", cost: 350, rating: 4.6, reviewCount: 7420, blurb: "360 度夜景，日落前 40 分鐘上去最美，冬天風很大。" },
  { id: "osaka-castle", name: "大阪城公園", emoji: "🏯", area: "中央區", lat: 34.6873, lng: 135.5262, tags: ["文化", "拍照", "放空"], minutes: 150, price: "NT$130", cost: 130, rating: 4.5, reviewCount: 15230, blurb: "護城河與天守閣，冬天早上光線斜射時最好拍。" },
  { id: "shinsekai", name: "通天閣・新世界串炸", emoji: "🍢", area: "新世界", lat: 34.6525, lng: 135.5063, tags: ["美食", "文化"], minutes: 120, price: "NT$500", cost: 500, rating: 4.1, reviewCount: 6180, blurb: "昭和味十足的街區，串炸醬汁只能沾一次是鐵則。" },
  { id: "shitennoji", name: "四天王寺", emoji: "⛩️", area: "天王寺", lat: 34.6542, lng: 135.5166, tags: ["文化", "放空"], minutes: 75, price: "NT$70", cost: 70, rating: 4.3, reviewCount: 2940, blurb: "日本最古老的官寺之一，冬天早上安靜到只聽得到鴿子。" },
  { id: "nakanoshima", name: "中之島公園・中央公會堂", emoji: "🏛️", area: "北區", lat: 34.6937, lng: 135.5019, tags: ["文化", "放空", "拍照"], minutes: 90, price: "免費", cost: 0, rating: 4.4, reviewCount: 1870, blurb: "紅磚建築配河岸散步，咖啡店坐一下午也不會被催。" },
  { id: "amemura", name: "美國村・堀江古著街", emoji: "🧢", area: "西心齋橋", lat: 34.6720, lng: 135.4976, tags: ["購物", "拍照", "探索"], minutes: 150, price: "NT$800", cost: 800, rating: 4.2, reviewCount: 3360, blurb: "古著、選物店與塗鴉牆，三角公園旁的霓虹超好拍。" },
  { id: "solaniwa", name: "空庭溫泉 OSAKA BAY TOWER", emoji: "♨️", area: "港區", lat: 34.6685, lng: 135.4602, tags: ["溫泉", "放空"], minutes: 180, price: "NT$600", cost: 600, rating: 4.5, reviewCount: 4120, blurb: "安土桃山風的大型溫泉設施，走到腳廢那天最該來。" },
  { id: "kaiyukan", name: "海遊館", emoji: "🐋", area: "港區", lat: 34.6547, lng: 135.4289, tags: ["親子", "拍照"], minutes: 150, price: "NT$570", cost: 570, rating: 4.4, reviewCount: 11350, blurb: "鯨鯊的巨型水槽，傍晚人潮較少，出口就是摩天輪。" },
  { id: "tenjinbashi", name: "天神橋筋商店街", emoji: "🥟", area: "北區", lat: 34.7060, lng: 135.5120, tags: ["美食", "購物", "探索"], minutes: 120, price: "NT$400", cost: 400, rating: 4.3, reviewCount: 4580, blurb: "日本最長商店街，庶民價的章魚燒與喫茶店都在這。" },
  { id: "namba-yasaka", name: "難波八阪神社 獅子殿", emoji: "🦁", area: "難波", lat: 34.6606, lng: 135.4974, tags: ["拍照", "文化"], minutes: 40, price: "免費", cost: 0, rating: 4.4, reviewCount: 3210, blurb: "巨大獅子頭舞台，5 分鐘就能拍到全隊最有梗的合照。" },
  { id: "denden", name: "日本橋電電町", emoji: "🎮", area: "日本橋", lat: 34.6614, lng: 135.5063, tags: ["動漫", "購物"], minutes: 120, price: "NT$800", cost: 800, rating: 4.2, reviewCount: 2760, blurb: "扭蛋、模型與電玩店密集，宅度比秋葉原更好逛。" },
  { id: "uranamba", name: "裏難波居酒屋巡禮", emoji: "🍶", area: "難波", lat: 34.6640, lng: 135.5030, tags: ["夜生活", "美食", "探索"], minutes: 150, price: "NT$900", cost: 900, rating: 4.5, reviewCount: 1930, blurb: "在地人的小巷居酒屋區，一間喝一杯再換下一間。" },
  { id: "sumiyoshi", name: "住吉大社", emoji: "🌉", area: "住吉區", lat: 34.6122, lng: 135.4930, tags: ["文化", "放空"], minutes: 90, price: "免費", cost: 0, rating: 4.5, reviewCount: 5640, blurb: "朱紅太鼓橋是招牌畫面，路面電車一日券可以順遊。" },
  { id: "banpaku", name: "萬博紀念公園・太陽之塔", emoji: "🗼", area: "吹田市", lat: 34.8073, lng: 135.5300, tags: ["文化", "探索", "親子"], minutes: 210, price: "NT$180", cost: 180, rating: 4.4, reviewCount: 6890, blurb: "太陽之塔本人比照片更有壓迫感，旁邊就是大型購物中心。" },
  { id: "rinku", name: "臨空城 Outlet", emoji: "🧳", area: "泉佐野", lat: 34.4098, lng: 135.2960, tags: ["購物"], minutes: 180, price: "看你自己", cost: 2000, rating: 4.0, reviewCount: 3450, blurb: "關西機場前一站，回程當天補貨的最後機會。" },
  { id: "kissaten", name: "昭和喫茶店巡禮", emoji: "☕", area: "本町・心齋橋", lat: 34.6790, lng: 135.4990, tags: ["放空", "美食", "拍照"], minutes: 90, price: "NT$300", cost: 300, rating: 4.6, reviewCount: 1520, blurb: "布丁、melon soda 與絨布沙發，拍起來自帶底片感。" },
  { id: "sennichimae", name: "千日前 迴轉壽司＋宵夜", emoji: "🍣", area: "千日前", lat: 34.6650, lng: 135.5035, tags: ["美食"], minutes: 75, price: "NT$450", cost: 450, rating: 4.1, reviewCount: 2380, blurb: "宵夜場也在營業，人均不到 500 就能吃得很飽。" },
  { id: "tsuruhashi", name: "鶴橋商店街", emoji: "🥩", area: "生野區", lat: 34.6650, lng: 135.5310, tags: ["美食", "探索"], minutes: 120, price: "NT$700", cost: 700, rating: 4.4, reviewCount: 2150, blurb: "韓國城的炭火燒肉香，從車站一路飄到巷底。" },
];
const POI_BY_ID = Object.fromEntries(POIS.map((p) => [p.id, p]));

/**
 * 網友評論（Mock）：[暱稱, 旅遊人格, 星等, 評論]
 * 之所以標記人格，是為了算出「和你同類型的旅人給幾分」——
 * 前面 4 站遊戲已經知道使用者是哪一型，這裡就能給客製化的分數，而不是一個大眾平均。
 */
const REVIEWS = {
  usj: [
    ["阿寬", "soldier", 5, "開園前 40 分鐘到，整理券一路順到中午，行程表照跑沒延誤。"],
    ["Mia", "camera", 5, "冬季雪景加城堡燈光，隨便拍都是桌布，記得留傍晚那個時段。"],
    ["小資女 K", "accountant", 3, "票加園內餐飲一人快三千，玩得開心但錢包有感。"],
  ],
  kuromon: [
    ["吃貨老陳", "accountant", 4, "海膽現開一份三百有找，比名店划算太多。"],
    ["Yuki", "explorer", 5, "早上九點前來最好逛，攤販會跟你聊天推薦隱藏吃法。"],
    ["慢慢走", "capybara", 4, "人多的時候有點擠，但站著吃一輪很過癮。"],
  ],
  dotonbori: [
    ["拍立得阿哲", "camera", 5, "晚上八點霓虹全開，水面倒影超好拍，記得帶穩定器。"],
    ["大食客", "shopper", 4, "章魚燒排隊三十分鐘，順手買了一堆伴手禮。"],
    ["夜貓子 J", "explorer", 5, "拍完往裏難波走，巷子裡的居酒屋比大街便宜。"],
  ],
  shinsaibashi: [
    ["掃貨王", "shopper", 5, "藥妝退稅一次搞定，記得 20:00 前排退稅櫃檯。"],
    ["精算阿凱", "accountant", 4, "比價過再買，同款藥妝差價快兩成。"],
    ["腿痠人", "taxi", 3, "從頭逛到尾腳會廢，建議分段休息。"],
  ],
  "umeda-sky": [
    ["夜景控", "camera", 5, "日落前四十分鐘上去，能一次拍到夕陽跟夜景。"],
    ["情侶檔小林", "explorer", 4, "頂樓風很大，冬天要戴手套，但視野真的無敵。"],
    ["懶得動", "capybara", 4, "電梯直達不用走路，看完在樓下喝咖啡剛好。"],
  ],
  "osaka-castle": [
    ["歷史迷", "explorer", 5, "護城河繞一圈比進天守閣還有味道，早上人少。"],
    ["跟拍魂", "camera", 4, "斜射光打在石牆上很有層次，建議九點前到。"],
    ["帶小孩的媽", "nanny", 4, "園區腹地大，推車好推，但廁所要走一段。"],
  ],
  shinsekai: [
    ["串炸魂", "accountant", 4, "一人五百吃到飽足，醬汁只能沾一次是真的。"],
    ["昭和控", "explorer", 5, "整條街的招牌比通天閣本身更好看。"],
    ["拍照小百合", "camera", 4, "霓虹很好拍，但人潮多要等空檔。"],
  ],
  shitennoji: [
    ["靜靜走", "capybara", 5, "早上安靜到只有鴿子，坐在迴廊發呆很療癒。"],
    ["寺廟巡禮", "explorer", 4, "腹地比想像小，一小時綽綽有餘。"],
  ],
  nakanoshima: [
    ["建築系學生", "explorer", 5, "紅磚公會堂外觀免費看就很值，內部導覽要預約。"],
    ["咖啡放空", "capybara", 5, "河岸長椅坐一下午沒人趕，冬天太陽剛好。"],
    ["省錢達人", "accountant", 4, "整段散步幾乎零花費，是行程裡的喘息點。"],
  ],
  amemura: [
    ["古著獵人", "shopper", 5, "三角公園附近幾間選物店挖到不少台灣沒有的款。"],
    ["街拍仔", "camera", 5, "塗鴉牆加霓虹，晚上拍起來很有個性。"],
    ["路痴", "nanny", 3, "巷子多容易走散，建議先約好集合點。"],
  ],
  solaniwa: [
    ["泡湯教主", "capybara", 5, "走到腳廢那天來最對，泡完整個人重開機。"],
    ["懶人移動", "taxi", 4, "有接駁車不用走路，這點加很多分。"],
    ["精打細算", "accountant", 4, "六百塊泡三小時還附浴衣，算下來不貴。"],
  ],
  kaiyukan: [
    ["親子出遊", "nanny", 5, "動線單向好帶小孩，鯨鯊水槽小朋友看到尖叫。"],
    ["水下攝影", "camera", 4, "光線暗要開大光圈，傍晚人少比較好拍。"],
    ["時間控", "soldier", 4, "抓兩個半小時剛好，出口摩天輪可以順便排。"],
  ],
  tenjinbashi: [
    ["庶民美食", "accountant", 5, "章魚燒六顆兩百有找，比觀光區便宜一半。"],
    ["走路王", "explorer", 4, "整條商店街走完要一小時，沿路都有東西吃。"],
    ["邊走邊買", "shopper", 4, "雜貨店很多，容易失手買一堆。"],
  ],
  "namba-yasaka": [
    ["合照擔當", "camera", 5, "五分鐘拍完全隊最有梗的照片，CP 值超高。"],
    ["順路族", "soldier", 4, "離難波站走路七分鐘，塞在行程空檔剛好。"],
    ["免費控", "accountant", 5, "完全免費又好拍，沒有不來的理由。"],
  ],
  denden: [
    ["模型宅", "shopper", 5, "扭蛋樓層可以耗一小時，日幣現金記得備著。"],
    ["電玩魂", "explorer", 4, "比秋葉原好逛，店員也比較願意聊。"],
    ["陪逛的人", "capybara", 3, "不是同好的話會有點無聊，附近有咖啡廳可以等。"],
  ],
  uranamba: [
    ["居酒屋巡禮", "explorer", 5, "一間喝一杯換下一間，在地人比觀光客多。"],
    ["宵夜場", "shopper", 4, "串燒配生啤一人九百上下，氣氛很好。"],
    ["顧場的人", "nanny", 4, "巷子窄，人多時記得注意隊友有沒有跟上。"],
  ],
  sumiyoshi: [
    ["太鼓橋", "camera", 5, "朱紅橋逆光拍剪影很漂亮，遊客也不多。"],
    ["路面電車迷", "explorer", 5, "搭阪堺電車過來本身就是行程的一部分。"],
    ["慢活派", "capybara", 4, "腹地大但很安靜，適合放空一小時。"],
  ],
  banpaku: [
    ["太陽之塔", "explorer", 5, "本人比照片有壓迫感，內部參觀要提前預約。"],
    ["帶長輩", "nanny", 4, "園區很大要走不少路，長輩建議租代步車。"],
    ["順便購物", "shopper", 4, "旁邊 EXPOCITY 可以逛到閉館，一天很好殺。"],
  ],
  rinku: [
    ["回程補貨", "shopper", 5, "離關西機場一站，最後一天補貨剛剛好。"],
    ["刷卡回饋", "accountant", 4, "折扣看運氣，刷對卡才划算。"],
    ["時間緊", "soldier", 3, "要留兩小時以上，不然逛不完又趕飛機。"],
  ],
  kissaten: [
    ["底片感", "camera", 5, "布丁配絨布沙發，拍起來自帶顆粒感，濾鏡都不用開。"],
    ["發呆組", "capybara", 5, "店員不會催，一杯咖啡坐兩小時很自在。"],
    ["甜點控", "accountant", 4, "一份三百上下，觀光區裡算合理。"],
  ],
  sennichimae: [
    ["宵夜魂", "accountant", 4, "人均不到五百吃很飽，半夜還開著。"],
    ["快速補血", "soldier", 4, "迴轉壽司出餐快，趕行程時很好用。"],
  ],
  tsuruhashi: [
    ["燒肉控", "shopper", 5, "一出站就聞到炭火味，肉質比市區便宜又好。"],
    ["巷弄探險", "explorer", 5, "市場巷子彎來彎去，走著走著就迷路但很有趣。"],
    ["顧胃的人", "nanny", 4, "油煙重，衣服會有味道，外套記得挑好洗的。"],
  ],
};

function poiReviews(id) {
  return (REVIEWS[id] || []).map(([name, persona, stars, text]) => ({ name, persona, stars, text }));
}

/** 客製化評分：把「和你同人格的網友」給的分數，跟全站平均混合 */
function personaRating(poi, persona) {
  const rs = poiReviews(poi.id);
  const match = persona ? rs.filter((r) => r.persona === persona) : [];
  if (!match.length) return { value: poi.rating, matched: 0 };
  const avg = match.reduce((s, r) => s + r.stars, 0) / match.length;
  return { value: Math.round((poi.rating * 0.4 + avg * 0.6) * 10) / 10, matched: match.length };
}

/** 預算相符度：用 Step 2 選的級別去比對每人平均花費 */
function budgetFit(poi, budgetKey) {
  const b = BUDGETS.find((x) => x.key === budgetKey) || BUDGETS[1];
  const cost = poi.cost ?? 0;
  if (cost === 0) return { ok: true, text: "免費景點，預算無壓力" };
  if (b.key === "thrifty") {
    return cost <= 700
      ? { ok: true, text: `一人約 ${money(cost)}，符合小資節奏` }
      : { ok: false, text: `一人約 ${money(cost)}，對「${b.name}」來說偏貴` };
  }
  if (b.key === "standard") {
    return cost <= 1600
      ? { ok: true, text: `一人約 ${money(cost)}，落在標準預算裡` }
      : { ok: false, text: `一人約 ${money(cost)}，會吃掉當天不少預算` };
  }
  return { ok: true, text: `一人約 ${money(cost)}，你的預算完全沒問題` };
}



const SLOT_MINUTES = { 上午: 210, 下午: 240, 晚上: 210, 全日: 660 };
const ALL_DAY_SLOT = "全日";
/** USJ 這種一進去就是一整天的行程，不該被塞進某個半天 */
const isAllDay = (poi) => Boolean(poi) && poi.minutes >= 360;

/** 該天是不是被全日行程佔走了 */
function allDayItemOf(board, day) {
  return board.find((i) => i.slot === ALL_DAY_SLOT && i.day === day) || null;
}

/** 這天實際要顯示的時段：被全日行程佔掉就只剩「全日」 */
function slotsForDay(dayDef, board) {
  return allDayItemOf(board, dayDef.day) ? [ALL_DAY_SLOT] : dayDef.slots;
}

function buildPlanDays(days = 5) {
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    if (day === 1) return { day, label: `Day ${day}`, note: "抵達", slots: ["下午", "晚上"] };
    if (day === days) return { day, label: `Day ${day}`, note: "賦歸", slots: ["上午"] };
    return { day, label: `Day ${day}`, note: "全天", slots: ["上午", "下午", "晚上"] };
  });
}

/** 依照遊戲中的選擇，預排最少量的共同行程（AI 之後只做最小幅度調整） */
function seedPlanFrom(history, days = 5) {
  const mine = (r) => history[r]?.results.find((x) => x.player.isUser)?.choice;
  const dFood = Math.min(3, days);
  const dShop = Math.max(2, days - 1);
  const seed = [
    { poiId: "usj", day: 2, slot: ALL_DAY_SLOT },
    { poiId: mine(0) === "B" ? "kissaten" : "kuromon", day: dFood, slot: "上午" },
    { poiId: "dotonbori", day: dFood, slot: "晚上" },
    { poiId: "shinsaibashi", day: dShop, slot: "晚上" },
  ];
  if (mine(2) === "C") seed.push({ poiId: "solaniwa", day: dShop, slot: "下午" });
  return seed.filter((s) => s.day >= 1 && s.day <= days);
}

const SLOT_TAGS = {
  上午: ["文化", "探索", "親子"],
  下午: ["購物", "拍照", "放空", "溫泉", "親子"],
  晚上: ["夜生活", "美食", "購物"],
};

/**
 * 完整行程預排：以劇本決定的重點行程為錨點，再把剩下的每個時段都填滿。
 * 挑選標準＝離同一天已排的地點近、時段屬性對得上、不會硬塞超長行程。
 */
function seedFullPlan(history, days = 5, ctx = null) {
  let placed = seedPlanFrom(history, days).map((x) => ({ ...x }));
  // 天數少的時候錨點可能跟全日行程撞到同一天：全日的優先，其他挪走重排
  const allDayDays = new Set(placed.filter((x) => x.slot === ALL_DAY_SLOT).map((x) => x.day));
  placed = placed.filter((x) => x.slot === ALL_DAY_SLOT || !allDayDays.has(x.day));
  const used = new Set(placed.map((x) => x.poiId));
  const weights = initTagWeights(ctx?.member || null, []);
  buildPlanDays(days).forEach((d) => {
   if (placed.some((x) => x.day === d.day && x.slot === ALL_DAY_SLOT)) return; // 這天已被全日行程佔滿
   d.slots.forEach((slot) => {
    if (placed.some((x) => x.day === d.day && x.slot === slot)) return;
    const sameDay = placed.filter((x) => x.day === d.day).map((x) => POI_BY_ID[x.poiId]).filter(Boolean);
    const cap = SLOT_MINUTES[slot] || 210;
    const cand = POIS
      .filter((poi) => !used.has(poi.id) && !isAllDay(poi)) // 全日行程不拿來填半天時段
      .map((poi) => {
        const near = sameDay.length ? Math.min(...sameDay.map((q) => travelMinutes(q, poi))) : 15;
        const slotFit = poi.tags.some((t) => (SLOT_TAGS[slot] || []).includes(t)) ? -15 : 0;
        const nightMismatch = slot !== "晚上" && poi.tags.includes("夜生活") ? 25 : 0;
        const tooLong = poi.minutes > cap ? 30 : 0;
        // 地理連貫仍是主要考量，但客製化分數要夠份量，否則不同人格排出來會一模一樣
        return { poi, cost: Math.min(near, 70) + slotFit + nightMismatch + tooLong - scorePoi(poi, weights, ctx) * 4 };
      })
      .sort((a, b) => a.cost - b.cost);
    const pick = cand[0]?.poi;
    if (!pick) return;
    used.add(pick.id);
    placed.push({ poiId: pick.id, day: d.day, slot });
   });
  });
  return placed;
}

/* ---------- 後台交通估算 ---------- */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 大阪市區大眾運輸的粗估：起步 8 分 + 每公里 3.6 分，取 5 分為單位 */
function travelMinutes(a, b) {
  if (!a || !b || a.id === b.id) return 0;
  return Math.max(5, Math.round((8 + haversineKm(a, b) * 3.6) / 5) * 5);
}

const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ""}` : `${m} 分鐘`);

/** 單一時段的可行性分析 */
function slotReport(items, slot) {
  const pois = items.map((i) => POI_BY_ID[i.poiId]).filter(Boolean);
  const cap = SLOT_MINUTES[slot] || 210;
  let stay = 0;
  let travel = 0;
  const hops = [];
  pois.forEach((p, i) => {
    stay += p.minutes;
    if (i) {
      const t = travelMinutes(pois[i - 1], p);
      travel += t;
      hops.push({ from: pois[i - 1], to: p, minutes: t });
    }
  });
  const total = stay + travel;
  // 全日行程、或單一主行程本身就比時段長，那是它的本質，不算排太滿
  const soloLong = pois.length === 1 && (slot === ALL_DAY_SLOT || pois[0].minutes > cap);
  const issues = [];
  hops.filter((h) => h.minutes >= 35).forEach((h) => issues.push({
    level: "warn", kind: "far", poi: h.to,
    text: `「${h.from.name}」到「${h.to.name}」交通約 ${h.minutes} 分鐘，光是移動就吃掉大半個${slot}。`,
  }));
  if (total > cap && !soloLong) {
    issues.push({
      level: "warn", kind: "over", poi: pois[pois.length - 1],
      text: `這個${slot}排了 ${fmtDur(total)}（含交通 ${travel} 分），但${slot}大約只有 ${fmtDur(cap)}。`,
    });
  } else if (pois.length > 1 && total > cap * 0.88) {
    issues.push({ level: "tight", kind: "tight", poi: null, text: `已經排到 ${fmtDur(total)}，接近${slot}的上限，中間幾乎沒有喘息時間。` });
  }
  return { pois, hops, stay, travel, total, cap, issues, soloLong };
}

const hasWarn = (rep) => rep.issues.some((i) => i.level === "warn");

/** 幫某個地點找一個排得下的時段 */
function suggestSlot(board, poi, days, exceptKey) {
  const options = [];
  buildPlanDays(days).forEach((d) => d.slots.forEach((slot) => {
    if (allDayItemOf(board, d.day)) return; // 這天已被全日行程佔滿
    const key = `${d.day}-${slot}`;
    if (key === exceptKey) return;
    const items = board.filter((i) => i.day === d.day && i.slot === slot);
    const rep = slotReport([...items, { poiId: poi.id }], slot);
    if (!hasWarn(rep)) options.push({ day: d.day, slot, spare: rep.cap - rep.total, travel: rep.travel });
  }));
  options.sort((a, b) => b.spare - a.spare || a.travel - b.travel);
  return options[0] || null;
}

/** AI 編排：滑完卡後決定哪些放得進去、哪些要換時段、哪些先不要 */
function arrangePicks(board, picked, day, slot, days) {
  const working = board.map((i) => ({ poiId: i.poiId, day: i.day, slot: i.slot, by: i.by, uid: i.uid }));
  return picked.map((poi) => {
    if (allDayItemOf(working, day)) {
      const alt0 = suggestSlot(working, poi, days, null);
      const occupied = POI_BY_ID[allDayItemOf(working, day).poiId]?.name;
      if (alt0) {
        working.push({ poiId: poi.id, day: alt0.day, slot: alt0.slot });
        return { poi, action: "move", day: alt0.day, slot: alt0.slot,
          reason: `Day ${day} 整天都給了「${occupied}」，排不進別的行程，幫你放到 Day ${alt0.day} ${alt0.slot}。` };
      }
      return { poi, action: "hold", day, slot,
        reason: `Day ${day} 整天都給了「${occupied}」，其他天也排不下了，這次先跳過。` };
    }
    const items = working.filter((i) => i.day === day && i.slot === slot);
    const rep = slotReport([...items, { poiId: poi.id }], slot);
    if (!hasWarn(rep)) {
      working.push({ poiId: poi.id, day, slot });
      const near = items.length ? Math.min(...items.map((i) => travelMinutes(POI_BY_ID[i.poiId], poi))) : 0;
      return {
        poi, action: "keep", day, slot,
        reason: items.length
          ? `和同時段的行程只差約 ${near} 分鐘車程，排得進去，這個${slot}會用掉 ${fmtDur(rep.total)}。`
          : `這個${slot}還是空的，放進去剛好用 ${fmtDur(rep.total)}。`,
      };
    }
    const blocker = rep.issues.find((i) => i.level === "warn");

    // 這個時段原本就只有 AI 預排的行程 → 直接換掉它，比搬到別天更貼近使用者的意圖
    const aiItems = items.filter((i) => i.by === "ai");
    if (aiItems.length && aiItems.length === items.length) {
      const repSwap = slotReport([{ poiId: poi.id }], slot);
      if (!hasWarn(repSwap)) {
        aiItems.forEach((it) => {
          const idx = working.indexOf(it);
          if (idx >= 0) working.splice(idx, 1);
        });
        working.push({ poiId: poi.id, day, slot });
        return {
          poi, action: "swap", day, slot, replaces: aiItems.map((i) => i.uid),
          reason: `這個${slot}原本是 AI 預排的「${aiItems.map((i) => POI_BY_ID[i.poiId]?.name).join("」「")}」，幫你換成這個，其他時段都不動。`,
        };
      }
    }

    const alt = suggestSlot(working, poi, days, `${day}-${slot}`);
    if (alt) {
      working.push({ poiId: poi.id, day: alt.day, slot: alt.slot });
      return {
        poi, action: "move", day: alt.day, slot: alt.slot,
        reason: `${blocker.text.replace("這個", `Day ${day} 的`)}建議改放 Day ${alt.day} ${alt.slot}，那邊還有約 ${fmtDur(Math.max(0, alt.spare))}的空檔。`,
      };
    }
    return { poi, action: "hold", day, slot, reason: `${blocker.text.replace("這個", `Day ${day} 的`)}這幾天的時段都塞不下，建議這次先跳過，下一趟再排。` };
  });
}

/** 最短移動順序（就近串接） */
function bestOrder(items) {
  if (items.length < 3) return items;
  const rest = [...items];
  const out = [rest.shift()];
  while (rest.length) {
    const last = POI_BY_ID[out[out.length - 1].poiId];
    rest.sort((a, b) => travelMinutes(last, POI_BY_ID[a.poiId]) - travelMinutes(last, POI_BY_ID[b.poiId]));
    out.push(rest.shift());
  }
  return out;
}

/* ---------- Mock AI 推薦 ---------- */
function initTagWeights(member, prefTags) {
  const w = Object.fromEntries(TAG_LIST.map((t) => [t, 1]));
  DIMS.forEach((d) => {
    const t = DIM_TAG[d.key];
    if (t) w[t] += (member?.dims[d.key] || 0) * 0.3;
  });
  prefTags.forEach((t) => { w[t] += 3; });
  return w;
}

function tagsFromKeyword(text = "") {
  return KEYWORD_TAG.filter(([re]) => re.test(text)).map(([, t]) => t);
}

/**
 * 排序分數 = 標籤偏好 +（同類旅人的評分 - 4）×1.5 + 預算相符度
 * ctx 是遊戲跑完就已經知道的事：使用者人格、預算級別。沒有 ctx 時退回純標籤分數。
 */
function scorePoi(poi, w, ctx) {
  const tagScore = poi.tags.reduce((acc, t) => acc + (w[t] || 0), 0) / poi.tags.length;
  if (!ctx) return tagScore;
  const pr = personaRating(poi, ctx.persona).value;
  const fit = budgetFit(poi, ctx.budget).ok ? 0.6 : -1.4;
  return tagScore + (pr - 4) * 1.5 + fit;
}

function recommend(weights, exclude, n, ctx) {
  return POIS.filter((p) => !exclude.has(p.id))
    .map((p) => ({ p, s: scorePoi(p, weights, ctx) + Math.random() * 0.8 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.p);
}

/** 這張卡為什麼推給你：優先講最有說服力的那個理由 */
function reasonFor(poi, weights, member, likedTags, ctx) {
  const best = [...poi.tags].sort((a, b) => (weights[b] || 0) - (weights[a] || 0))[0];
  const pr = ctx ? personaRating(poi, ctx.persona) : { matched: 0 };
  if (pr.matched && pr.value >= 4.5 && member) {
    return `和你同為「${PERSONAS[member.persona].name}」的網友給了 ${pr.value}★，${best}類又正好對你的味。`;
  }
  if (likedTags.includes(best)) return `你剛剛右滑了「${best}」類型，AI 再幫你找了一個（網友平均 ${poi.rating}★）。`;
  if (member) return `你是「${PERSONAS[member.persona].name}」，${best}類的地點通常最對味（網友平均 ${poi.rating}★）。`;
  return `${best}類的熱門選擇，網友平均 ${poi.rating}★。`;
}

/** 這張卡的客製化標籤：只放真的成立的幾個 */
function fitChips(poi, member, ctx, likedTags = []) {
  const chips = [];
  const pr = personaRating(poi, ctx?.persona);
  if (pr.matched) chips.push({ text: `同類旅人 ${pr.value}★`, tone: pr.value >= 4.5 ? "good" : "warn" });
  const bf = budgetFit(poi, ctx?.budget);
  chips.push({ text: bf.text, tone: bf.ok ? "good" : "warn" });
  const hit = poi.tags.find((t) => likedTags.includes(t));
  if (hit) chips.push({ text: `你右滑過的「${hit}」`, tone: "good" });
  else if (member) {
    const own = poi.tags.find((t) => t === DIM_TAG[topDim(member).key]);
    if (own) chips.push({ text: `隊伍最想要的「${own}」`, tone: "good" });
  }
  return chips.slice(0, 3);
}

function weightDelta(before, after) {
  const diff = TAG_LIST.map((t) => ({ t, d: (after[t] || 0) - (before[t] || 0) }));
  const up = [...diff].sort((a, b) => b.d - a.d)[0];
  const down = [...diff].sort((a, b) => a.d - b.d)[0];
  return { up: up && up.d > 0.4 ? up.t : null, down: down && down.d < -0.4 ? down.t : null };
}

const timeAgo = (at, now) => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 12) return "剛剛";
  if (s < 60) return `${s} 秒前`;
  return `${Math.floor(s / 60)} 分前`;
};

/* ---------- 評分與評論的呈現 ---------- */
function Stars({ value, size = 13 }) {
  const pct = clamp((value / 5) * 100, 0, 100);
  return (
    <span className="relative inline-block whitespace-nowrap leading-none" style={{ fontSize: size, letterSpacing: "1px" }} aria-label={`${value} 顆星`}>
      <span className="text-[#1F2350]/20">★★★★★</span>
      <span className="absolute left-0 top-0 overflow-hidden text-[#FFB300]" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
}

function RatingRow({ poi, persona }) {
  const pr = personaRating(poi, persona);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <Stars value={poi.rating} />
        <span className="tm-num text-sm font-black">{poi.rating}</span>
        <span className="text-[11px] font-bold opacity-50">({poi.reviewCount.toLocaleString("en-US")} 則)</span>
      </span>
      {pr.matched > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border-2 border-[#1F2350] bg-[#FFF3A6] px-2 py-0.5 text-[11px] font-black">
          像你這樣的旅人 <span className="tm-num">{pr.value}★</span>
        </span>
      )}
    </div>
  );
}

function ReviewStrip({ poi, persona }) {
  const list = poiReviews(poi.id);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length < 2) return undefined;
    const t = setInterval(() => setI((v) => (v + 1) % list.length), 4200);
    return () => clearInterval(t);
  }, [list.length]);
  if (!list.length) return null;
  const r = list[i % list.length];
  const mine = persona && r.persona === persona;
  const P = PERSONAS[r.persona];

  return (
    <div className="mt-2 rounded-2xl border-2 border-[#1F2350]/20 bg-[#FFF8EE] p-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[#1F2350] text-[11px] font-black text-white" style={{ background: P.color }}>
          {r.name.slice(0, 1)}
        </span>
        <span className="truncate text-[11px] font-black">{r.name}</span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: P.color }}>{P.short}</span>
        {mine && <span className="shrink-0 rounded-full bg-[#2F9E62] px-1.5 py-0.5 text-[9px] font-black text-white">和你同型</span>}
        <span className="ml-auto shrink-0"><Stars value={r.stars} size={11} /></span>
      </div>
      <p className="text-[11.5px] leading-relaxed">「{r.text}」</p>
      {list.length > 1 && (
        <div className="mt-1.5 flex items-center gap-1">
          {list.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={`看第 ${k + 1} 則評論`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setI(k)}
              className={`h-1.5 rounded-full transition-all ${k === i % list.length ? "w-5 bg-[#1F2350]" : "w-1.5 bg-[#1F2350]/25"}`}
            />
          ))}
          <span className="ml-auto text-[10px] font-bold opacity-45">{list.length} 則網友評論</span>
        </div>
      )}
    </div>
  );
}

/* ---------- 滑卡推薦（右滑加入 / 左滑跳過） ---------- */
const CARDS_PER_ROUND = 4;
const MAX_ROUNDS = 4;

function SwipeCard({ poi, reason, chips = [], persona, x, top, depth, onDragEnd }) {
  const rotate = useTransform(x, [-240, 0, 240], [-14, 0, 14]);
  const opacity = useTransform(x, [-460, -250, 0, 250, 460], [0, 1, 1, 1, 0]);
  const likeOp = useTransform(x, [40, 150], [0, 1]);
  const nopeOp = useTransform(x, [-150, -40], [1, 0]);
  const c = TAG_COLOR[poi.tags[0]] || PERSIMMON;

  const inner = (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative grid h-32 shrink-0 place-items-center text-6xl" style={{ background: `linear-gradient(135deg, ${c}33, ${c}77)` }}>
        <span>{poi.emoji}</span>
        {top && (
          <>
            <motion.span style={{ opacity: likeOp }} className="absolute left-3 top-3 -rotate-12 rounded-xl border-[3px] border-[#2F9E62] bg-white/90 px-2 py-0.5 text-base font-black text-[#2F9E62]">
              加入行程
            </motion.span>
            <motion.span style={{ opacity: nopeOp }} className="absolute right-3 top-3 rotate-12 rounded-xl border-[3px] border-[#E8453C] bg-white/90 px-2 py-0.5 text-base font-black text-[#E8453C]">
              跳過
            </motion.span>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="tm-display text-[21px] leading-tight">{poi.name}</div>
        <div className="text-xs font-bold opacity-60">{poi.area}・建議 {fmtDur(poi.minutes)}・{poi.price}</div>
        <RatingRow poi={poi} persona={persona} />
        <div className="mt-2 flex flex-wrap gap-1">
          {poi.tags.map((t) => (
            <span key={t} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: TAG_COLOR[t] }}>{t}</span>
          ))}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed">{poi.blurb}</p>
        <ReviewStrip poi={poi} persona={persona} />
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {chips.map((ch) => (
              <span
                key={ch.text}
                className={`inline-flex items-center gap-0.5 rounded-full border-2 px-2 py-0.5 text-[10.5px] font-bold ${ch.tone === "good" ? "border-[#2F9E62] bg-[#E3F5EA] text-[#1F7A55]" : "border-[#E8853C] bg-[#FFE7CC] text-[#B8440E]"}`}
              >
                {ch.text}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2">
          <div className="rounded-2xl bg-[#ECE5FF] p-2.5 text-[11px] font-bold leading-relaxed">AI 推薦理由：{reason}</div>
        </div>
      </div>
    </Card>
  );

  if (!top) {
    return (
      <div className="absolute inset-0" style={{ transform: `scale(${1 - depth * 0.05}) translateY(${depth * 12}px)`, zIndex: 10 - depth, opacity: 1 - depth * 0.25 }}>
        {inner}
      </div>
    );
  }
  return (
    <motion.div
      className="absolute inset-0 z-20 cursor-grab touch-pan-y active:cursor-grabbing"
      style={{ x, rotate, opacity }}
      drag="x"
      dragElastic={0.7}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={onDragEnd}
    >
      {inner}
    </motion.div>
  );
}

function SwipeDeck({ member, budget, day, slot, excludeIds, autoStart = false, onDone, onClose }) {
  const [stage, setStage] = useState("pref");
  const [prefTags, setPrefTags] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [weights, setWeights] = useState(null);
  const [roundStartW, setRoundStartW] = useState(null);
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState([]);
  const [roundPicked, setRoundPicked] = useState([]);
  const [likedTags, setLikedTags] = useState([]);
  const [note, setNote] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const x = useMotionValue(0);
  const seen = useRef(new Set(excludeIds));
  const busy = useRef(false);
  const ctx = useMemo(() => ({ persona: member?.persona, budget }), [member, budget]);

  const toggleTag = (t) => setPrefTags((s) => (s.includes(t) ? s.filter((k) => k !== t) : s.length >= 3 ? s : [...s, t]));

  const startSwiping = useCallback((tags0) => {
    const tags = Array.isArray(tags0) ? tags0 : [...new Set([...prefTags, ...tagsFromKeyword(keyword)])];
    const w = initTagWeights(member, tags);
    const q = recommend(w, seen.current, CARDS_PER_ROUND, ctx);
    q.forEach((p) => seen.current.add(p.id));
    setWeights(w);
    setRoundStartW({ ...w });
    setQueue(q);
    setIdx(0);
    setRoundPicked([]);
    if (!q.length) { setExhausted(true); setStage("round"); return; }
    setStage("swipe");
  }, [prefTags, keyword, member, ctx]);

  // autoStart：直接用人格帶出來的權重開滑，跳過挑標籤那一步。
  // 玩家剛用四站回答過偏好了，再問一次標籤是多餘的摩擦。
  const bootRef = useRef(false);
  useEffect(() => {
    if (!autoStart || bootRef.current) return;
    bootRef.current = true;
    startSwiping([]);
  }, [autoStart, startSwiping]);

  const commit = (like) => {
    const poi = queue[idx];
    if (!poi) return;
    const w = { ...weights };
    poi.tags.forEach((t) => { w[t] = Math.max(0.2, (w[t] || 1) + (like ? 1.3 : -0.9)); });
    setWeights(w);
    if (like) {
      setPicked((p) => [...p, poi]);
      setRoundPicked((p) => [...p, poi]);
      setLikedTags((t) => [...new Set([...t, ...poi.tags])]);
    }
    x.set(0);
    busy.current = false;
    if (idx + 1 >= queue.length) {
      setNote(weightDelta(roundStartW, w));
      setStage("round");
    } else {
      setIdx((i) => i + 1);
    }
  };

  const decide = (like) => {
    if (busy.current) return;
    busy.current = true;
    sfx(like ? "like" : "nope");
    animate(x, like ? 480 : -480, { duration: 0.3, ease: "easeIn" }).then(() => commit(like));
  };

  const handleDragEnd = (_e, info) => {
    if (busy.current) return;
    const far = Math.abs(info.offset.x) > 110;
    const fast = Math.abs(info.velocity.x) > 520;
    if (far || fast) decide(info.offset.x > 0 || info.velocity.x > 0);
    else animate(x, 0, { type: "spring", stiffness: 420, damping: 32 });
  };

  const nextRound = () => {
    const q = recommend(weights, seen.current, CARDS_PER_ROUND, ctx);
    q.forEach((p) => seen.current.add(p.id));
    setQueue(q);
    setIdx(0);
    setRoundPicked([]);
    setRoundStartW({ ...weights });
    setRound((r) => r + 1);
    setNote(null);
    if (!q.length) { setExhausted(true); setStage("round"); return; }
    setStage("swipe");
  };

  const current = queue[idx];
  const lastRound = round >= MAX_ROUNDS - 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-[#1F2350]/80 px-4 py-6">
      <motion.div initial={{ y: 30, scale: 0.95 }} animate={{ y: 0, scale: 1 }} className="mx-auto w-full max-w-md">
        <div className="mb-3 flex items-center justify-between text-white">
          <div>
            <div className="tm-display text-xl">AI 幫你找　Day {day} {slot}</div>
            <div className="text-xs opacity-80">右滑加入、左滑跳過；每輪 4 張，最多 4 輪</div>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉推薦" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-white">
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        {stage === "pref" && (
          <Card className="p-4">
            <div className="tm-display text-[22px] leading-snug">有沒有特別想去的方向？</div>
            <p className="mt-1 text-sm opacity-70">選 1～3 個，也可以略過。</p>
            {member && (
              <div className="mt-2 rounded-2xl bg-[#ECE5FF] p-2.5 text-[11px] font-bold leading-relaxed">
                已套用你的「{PERSONAS[member.persona].name}」和「{(BUDGETS.find((b) => b.key === budget) || BUDGETS[1]).name}」預算。
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {TAG_LIST.map((t) => {
                const on = prefTags.includes(t);
                return (
                  <motion.button
                    key={t}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => toggleTag(t)}
                    aria-pressed={on}
                    className={`rounded-full border-[3px] border-[#1F2350] px-3 py-1.5 text-sm font-bold ${on ? "text-white shadow-[3px_3px_0_#1F2350]" : "bg-white"}`}
                    style={on ? { background: TAG_COLOR[t] } : undefined}
                  >
                    {t}
                  </motion.button>
                );
              })}
            </div>
            <div className="mt-4">
              <label htmlFor="kw" className="text-sm font-black">或直接告訴 AI（選填）</label>
              <input id="kw" value={keyword} maxLength={14} onChange={(e) => setKeyword(e.target.value)} placeholder="例如：想找有底片感的老咖啡店" className={`${INPUT} mt-1.5`} />
            </div>
            <Btn className="mt-4 w-full" onClick={() => startSwiping()}><Sparkles size={18} /> 開始看 AI 推薦</Btn>
          </Card>
        )}

        {stage === "swipe" && current && (
          <>
            <div className="mb-2 flex items-center justify-between text-white">
              <span className="text-xs font-bold">第 {round + 1} 輪 / 共 {MAX_ROUNDS} 輪</span>
              <div className="flex gap-1">
                {Array.from({ length: CARDS_PER_ROUND }).map((_, i) => (
                  <span key={i} className={`h-2 w-6 rounded-full border-2 border-white ${i < idx ? "bg-white" : i === idx ? "bg-[#FFC93C]" : ""}`} />
                ))}
              </div>
            </div>
            <div className="relative h-[520px]">
              {queue.slice(idx, idx + 3).map((p, i) => (
                <SwipeCard
                  key={p.id}
                  poi={p}
                  depth={i}
                  top={i === 0}
                  x={x}
                  persona={member?.persona}
                  onDragEnd={handleDragEnd}
                  reason={reasonFor(p, weights, member, likedTags, ctx)}
                  chips={fitChips(p, member, ctx, likedTags)}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-center gap-4">
              <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => decide(false)} aria-label="左滑跳過" className="grid h-14 w-14 place-items-center rounded-full border-[3px] border-[#1F2350] bg-white shadow-[4px_4px_0_#1F2350]">
                <X size={26} strokeWidth={3} className="text-[#E8453C]" />
              </motion.button>
              <div className="text-center text-xs font-bold text-white/90">
                已加入 {picked.length} 個<br />
                <span className="opacity-70">可以直接拖曳卡片</span>
              </div>
              <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => decide(true)} aria-label="右滑加入行程" className="grid h-14 w-14 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#FFC93C] shadow-[4px_4px_0_#1F2350]">
                <Heart size={26} strokeWidth={3} className="text-[#2F9E62]" />
              </motion.button>
            </div>
          </>
        )}

        {stage === "round" && (
          <Card className="p-4">
            <div className="tm-display text-[22px]">{exhausted ? "沒有新景點可以推了" : `第 ${round + 1} 輪結束`}</div>
            {!exhausted && (
              <div className="mt-2 rounded-2xl border-2 border-[#1F2350] bg-[#ECE5FF] p-3 text-sm leading-relaxed">
                <div className="font-black">AI 已依你的滑動調整推薦</div>
                <div className="mt-1">
                  {note?.up && <>更多「{note.up}」類型</>}
                  {note?.up && note?.down && "，"}
                  {note?.down && <>少推「{note.down}」類型</>}
                  {!note?.up && !note?.down && "這輪沒有明顯偏好，先維持原本的方向"}
                  。
                </div>
              </div>
            )}
            <div className="mt-3 text-sm font-black">目前加入 {picked.length} 個</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {picked.length ? picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full border-2 border-[#1F2350] bg-white px-2 py-0.5 text-xs font-bold">{p.emoji} {p.name}</span>
              )) : <span className="text-xs opacity-60">這輪都跳過了，下一輪換個方向試試。</span>}
            </div>
            <div className="mt-4 grid gap-2">
              {!lastRound && !exhausted && <Btn variant="ghost" className="w-full" onClick={nextRound}><RefreshCw size={18} /> 再滑一輪（還有 {MAX_ROUNDS - round - 1} 輪）</Btn>}
              {lastRound && !exhausted && <div className="rounded-2xl bg-[#FFF3A6] p-2.5 text-center text-xs font-bold">4 輪滑完囉！交給 AI 排進行程，之後隨時可以再開。</div>}
              {exhausted && <div className="rounded-2xl bg-[#FFF3A6] p-2.5 text-center text-xs font-bold">AI 的口袋名單被你們排光了，先存檔，之後再補新景點。</div>}
              <Btn className="w-full" disabled={!picked.length} onClick={() => onDone(picked)}>
                <Sparkles size={18} /> 交給 AI 排進行程（{picked.length} 個）
              </Btn>
              {!picked.length && <button type="button" onClick={onClose} className="text-center text-xs font-bold underline opacity-60">這次都不加，直接離開</button>}
            </div>
          </Card>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ---------- AI 編排結果確認 ---------- */
function ArrangeReview({ plan, day, slot, onApply, onForceAll, onClose }) {
  const [insist, setInsist] = useState({});
  const keep = plan.filter((p) => p.action === "keep");
  const swapped = plan.filter((p) => p.action === "swap");
  const moved = plan.filter((p) => p.action === "move");
  const held = plan.filter((p) => p.action === "hold");

  const apply = () => {
    const entries = plan
      .map((p) => {
        if (insist[p.poi.id]) return { poi: p.poi, day, slot, forced: true };
        if (p.action === "hold") return null;
        return { poi: p.poi, day: p.day, slot: p.slot, moved: p.action === "move", replaces: p.replaces };
      })
      .filter(Boolean);
    onApply(entries);
  };

  const Row = ({ item }) => {
    const on = insist[item.poi.id];
    const badge = item.action === "keep"
      ? { text: `放進 Day ${day} ${slot}`, bg: "#E3F5EA", color: "#1F7A55" }
      : item.action === "swap"
        ? { text: `換掉 Day ${day} ${slot} 原本的`, bg: "#DDF1FA", color: "#2A83AD" }
        : item.action === "move"
        ? { text: `改放 Day ${item.day} ${item.slot}`, bg: "#FFF3A6", color: "#8A6D00" }
        : { text: "建議先不要排", bg: "#FFE1D3", color: "#B8440E" };
    return (
      <div className="rounded-2xl border-2 border-[#1F2350] p-3" style={{ background: badge.bg }}>
        <div className="flex items-center gap-2">
          <span className="text-xl">{item.poi.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-black">
            {item.poi.name}
            <span className="tm-num ml-1 text-[11px] font-bold opacity-60">★{item.poi.rating}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black" style={{ color: badge.color }}>{badge.text}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed">{item.reason}</p>
        {item.action !== "keep" && item.action !== "swap" && (
          <label className="mt-2 flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={Boolean(on)} onChange={(e) => setInsist((s) => ({ ...s, [item.poi.id]: e.target.checked }))} className="h-4 w-4 accent-[#FF6B35]" />
            我還是要放在 Day {day} {slot}（AI 會在看板上繼續提醒）
          </label>
        )}
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-[#1F2350]/80 px-4 py-6">
      <motion.div initial={{ y: 26, scale: 0.96 }} animate={{ y: 0, scale: 1 }} className="mx-auto w-full max-w-md">
        <Card className="p-4">
          <div className="flex items-start gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#FFC93C]"><Sparkles size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="tm-display text-xl leading-tight">AI 幫你排好了</div>
              <p className="text-xs leading-relaxed opacity-70">
                以 Day {day} {slot} 為主，扣掉交通與停留時間後，{keep.length} 個放得進去
                {swapped.length ? `，${swapped.length} 個直接換掉原本 AI 預排的` : ""}
                {moved.length ? `，${moved.length} 個換到更順的時段` : ""}
                {held.length ? `，${held.length} 個建議先緩緩` : ""}。
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="關閉" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[#1F2350]"><X size={15} strokeWidth={3} /></button>
          </div>

          <div className="mt-3 space-y-2">
            {plan.map((p) => <Row key={p.poi.id} item={p} />)}
          </div>

          <div className="mt-4 grid gap-2">
            <Btn className="w-full" onClick={apply}><Check size={18} /> 就照 AI 的排法</Btn>
            <Btn variant="ghost" className="w-full" onClick={onForceAll}>全部都塞進 Day {day} {slot}</Btn>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed opacity-55">
交通以大阪大眾運輸估算，每個時段抓 3.5～4 小時。
          </p>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ---------- AI 提醒（排序不合理時跳出） ---------- */
function AiAlert({ data, onClose }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-[#1F2350]/75 px-5" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.86, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#FFE1D3]"><Radio size={16} /></div>
            <div className="tm-display text-lg">{data.title}</div>
          </div>
          <p className="mt-3 text-sm leading-relaxed">{data.body}</p>
          {data.tip && <div className="mt-2 rounded-2xl bg-[#FFF3A6] p-3 text-xs font-bold leading-relaxed">{data.tip}</div>}
          <div className="mt-4 grid gap-2">
            {data.primary && <Btn className="w-full" onClick={() => { data.primary.run(); onClose(); }}><Sparkles size={18} /> {data.primary.label}</Btn>}
            <Btn variant="ghost" className="w-full" onClick={onClose}>{data.secondaryLabel || "我知道了，先這樣"}</Btn>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ---------- 行程卡（可拖曳排序） ---------- */
function PlanItem({ item, author, index, count, travelIn, onRemove, onMove, now, persona, readOnly }) {
  const poi = POI_BY_ID[item.poiId];
  const controls = useDragControls();
  const topReview = poi ? (poiReviews(poi.id).find((r) => r.persona === persona) || poiReviews(poi.id)[0]) : null;
  if (!poi) return null;
  const fresh = now - item.at < 9000;
  const farHop = travelIn >= 35;

  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} className="list-none">
      {index > 0 && (
        <div className={`mb-1.5 ml-4 flex items-center gap-1 text-[11px] font-bold ${farHop ? "text-[#B8440E]" : "opacity-55"}`}>
          交通約 {travelIn} 分鐘{farHop && "（有點遠）"}
        </div>
      )}
      <motion.div
        layout
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, x: -20, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className={`relative mb-2 flex gap-2 rounded-2xl border-2 bg-white p-2.5 ${fresh ? "border-[#FF6B35] shadow-[0_0_0_4px_rgba(255,107,53,.18)]" : "border-[#1F2350]/25"}`}
      >
        {readOnly ? (
          <span className="grid w-6 shrink-0 place-items-center"><Lock size={13} className="opacity-25" /></span>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => controls.start(e)}
            aria-label="拖曳調整順序"
            className="flex w-6 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-[3px] rounded-lg active:cursor-grabbing"
          >
            {[0, 1, 2].map((i) => <span key={i} className="block h-[3px] w-4 rounded-full bg-[#1F2350]/35" />)}
          </button>
        )}
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl" style={{ background: `${TAG_COLOR[poi.tags[0]]}2A` }}>{poi.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black">{poi.name}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] opacity-60">
            <span>{poi.area}</span>
            <span>{fmtDur(poi.minutes)}</span>
            <span className="inline-flex items-center gap-0.5">
              <Stars value={poi.rating} size={10} />
              <span className="tm-num font-black">{poi.rating}</span>
            </span>
          </div>
          {topReview && <div className="mt-0.5 truncate text-[10.5px] italic opacity-55">「{topReview.text}」— {topReview.name}</div>}
          <div className="mt-1 flex items-center gap-1">
            {author.ai ? (
              <span className="rounded-full bg-[#1F2350] px-1.5 py-0.5 text-[10px] font-bold text-white">去趣 AI 預排</span>
            ) : (
              <>
                <Avatar p={author} size={16} />
                <span className="text-[10px] font-bold opacity-60">{author.isUser ? "你加入的" : `${author.name} 加入的`}</span>
              </>
            )}
            {fresh && !author.ai && <span className="ml-auto rounded-full bg-[#FF6B35] px-1.5 py-0.5 text-[9px] font-black text-white">NEW</span>}
          </div>
        </div>
        {!readOnly && <div className="flex shrink-0 flex-col gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="往前移" className="grid h-6 w-6 place-items-center rounded-md border-2 border-[#1F2350]/25 bg-white text-[10px] font-black disabled:opacity-25">▲</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="往後移" className="grid h-6 w-6 place-items-center rounded-md border-2 border-[#1F2350]/25 bg-white text-[10px] font-black disabled:opacity-25">▼</button>
          <button type="button" onClick={onRemove} aria-label={`移除 ${poi.name}`} className="grid h-6 w-6 place-items-center rounded-md border-2 border-[#1F2350]/25 bg-white"><Trash2 size={12} /></button>
        </div>}
      </motion.div>
    </Reorder.Item>
  );
}

/* ---------- 時段卡 ---------- */
function SlotCard({ day, slot, items, authorOf, now, persona, readOnly, onOpenDeck, onReorder, onRemove, onFix, onTidy }) {
  const allDay = slot === ALL_DAY_SLOT;
  const rep = slotReport(items, slot);
  const pct = clamp(Math.round((rep.total / rep.cap) * 100), 0, 130);
  const warn = rep.issues.find((i) => i.level === "warn");
  const tight = rep.issues.find((i) => i.level === "tight");

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-black">
          <Clock size={15} /> {allDay ? "整天" : slot}
          <span className="truncate text-[11px] font-bold opacity-50">
            {!items.length ? "還沒排" : allDay ? `這天就是它了（約 ${fmtDur(rep.total)}）` : rep.soloLong ? `整段都給了這個行程（約 ${fmtDur(rep.total)}）` : `${fmtDur(rep.total)}／${fmtDur(rep.cap)}（含交通 ${rep.travel} 分）`}
          </span>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {!readOnly && !allDay && items.length > 2 && <Btn size="sm" variant="ghost" onClick={onTidy}><RefreshCw size={14} /> 順路排</Btn>}
          {!readOnly && !allDay && <Btn size="sm" variant="sun" onClick={onOpenDeck}><Sparkles size={15} /> AI 推薦</Btn>}
          {readOnly && <span className="inline-flex items-center gap-1 rounded-full bg-[#1F2350]/10 px-2 py-1 text-[10px] font-bold"><Lock size={11} /> 已定版</span>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-[#1F2350]/10">
          <motion.div
            className="h-full"
            style={{ background: warn ? "#E8453C" : tight ? "#FFC93C" : rep.soloLong ? "#3E8EDE" : "#6CC08B" }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, pct)}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      <AnimatePresence>
        {warn && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-2 rounded-2xl border-2 border-dashed border-[#E8453C] bg-[#FFE1D3] p-2.5">
              <div className="text-xs font-black text-[#B8440E]">AI 提醒：這樣排可能不太合理</div>
              <p className="mt-0.5 text-xs leading-relaxed">{warn.text}</p>
              {warn.poi && (
                <Btn size="sm" className="mt-2" onClick={() => onFix(warn)}><Sparkles size={14} /> 讓 AI 幫我調</Btn>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!warn && tight && (
        <div className="mb-2 rounded-2xl bg-[#FFF3A6] p-2 text-[11px] font-bold leading-relaxed">{tight.text}</div>
      )}

      <Reorder.Group axis="y" values={items} onReorder={readOnly ? () => {} : onReorder} className="m-0 list-none p-0">
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <PlanItem
              key={item.uid}
              item={item}
              index={i}
              count={items.length}
              readOnly={readOnly}
              author={authorOf(item.by)}
              now={now}
              persona={persona}
              travelIn={i ? travelMinutes(POI_BY_ID[items[i - 1].poiId], POI_BY_ID[item.poiId]) : 0}
              onRemove={() => onRemove(item.uid)}
              onMove={(dir) => {
                const next = [...items];
                const j = i + dir;
                if (j < 0 || j >= next.length) return;
                [next[i], next[j]] = [next[j], next[i]];
                onReorder(next);
              }}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {allDay && items.length > 0 && (
        <div className="mt-1 rounded-2xl bg-[#DDF1FA] p-2.5 text-[11px] font-bold leading-relaxed">
          這是整天行程，這天不再排其他時段。想改成半天就先刪掉它。
        </div>
      )}
      {!items.length && (
        <button type="button" onClick={onOpenDeck} className="w-full rounded-2xl border-2 border-dashed border-[#1F2350]/40 py-4 text-sm font-bold opacity-60">
          這個時段被清空了，點「AI 推薦」補一個
        </button>
      )}
    </Card>
  );
}

/* ==================================================================
 * 10.5 行程導出 + 依行程推薦的 eSIM 方案
 *   導購節奏：快測拿優惠碼 → 玩遊戲踩痛點 → 排完行程導出圖片
 *            → 依「實際排出來的行程」算用量 → 推薦統一方案 → 個人可加價升級
 * ================================================================== */
/**
 * 去趣 eSIM 日本方案
 * 規格、電信商、天數、商品說明照官網商品頁與方案整理。
 *
 * 價格：去趣常態全館 85 折。「每日 500MB＝NT$22（原價 26）」與
 * 「吃到飽＝NT$81 起（原價 95）」是官方標價，中間級距為等比推估。
 */
const SITE_DISCOUNT = 0.85; // 去趣官網常態全館 85 折

const ESIM_CARRIERS = [
  {
    key: "softbank", name: "SoftBank", line: "原生", speed: "最高 5G",
    fit: "都市基地台密度高，主要城市、熱門商圈、主題樂園最穩，適合一路拍照上傳",
    caveat: "Android 手機無法開熱點分享，只有 iPhone 可以",
    androidNoHotspot: true,
  },
  {
    key: "unlimited", name: "不限電信商", line: "多電信漫遊", speed: "最高 5G",
    fit: "自動切換 Docomo／KDDI／Rakuten 當地最強訊號，跨區域行程不用煩惱",
    caveat: "漫遊線路會繞道海外伺服器，開地圖或滑 IG 可能慢 1～2 秒",
  },
  {
    key: "docomo", name: "Docomo(IIJ)", line: "原生", speed: "4G",
    fit: "郊區涵蓋四家最高，行程有山區、近郊或深度景點時最保險",
    caveat: "市區熱門景點偶爾會卡頓，速度為 4G",
  },
];
const CARRIER_BY_KEY = Object.fromEntries(ESIM_CARRIERS.map((c) => [c.key, c]));

// 官網可選天數：2、4、6 天沒有販售
const ESIM_DAY_OPTIONS = [1, 3, 5, 7, 10, 15, 20, 30];

const ESIM_PLANS = [
  { key: "m500", tier: 0, icon: "🌱", name: "每日 500MB", gb: 0.5, listPerDay: 26,
    cap: "用完降速，仍可文字通訊", good: "只用通訊軟體報平安", bad: "開地圖、傳照片很快見底" },
  { key: "g1", tier: 1, icon: "🍃", name: "每日 1GB", gb: 1, listPerDay: 35,
    cap: "用完降速，仍可文字通訊", good: "通訊、查資料、偶爾導航", bad: "整天邊走邊導航不太夠" },
  { key: "g2", tier: 2, icon: "📶", name: "每日 2GB", gb: 2, listPerDay: 48,
    cap: "用完降速，仍可文字通訊", good: "整天導航、社群、傳照片都夠", bad: "看影片、長時間直播會超" },
  { key: "unlimited", tier: 3, icon: "⚡", name: "吃到飽不降速", gb: 99, listPerDay: 95,
    cap: "不限流量、全程不降速", good: "不想算流量", bad: "用量不大有點超規格" },
];

/** 售價＝原價打 85 折（去趣常態優惠） */
const salePerDay = (plan) => Math.round(plan.listPerDay * SITE_DISCOUNT);

/** 官網只賣特定天數，行程天數要對應到買得到的那一檔 */
function billableDays(days) {
  return ESIM_DAY_OPTIONS.find((d) => d >= days) || ESIM_DAY_OPTIONS[ESIM_DAY_OPTIONS.length - 1];
}

/** 依行程的市區／郊區分布推薦電信商——這是去趣「可挑線路」的價值所在 */
const OSAKA_CENTER = { lat: 34.6687, lng: 135.5013 }; // 難波
function suggestCarrier(board) {
  const pois = board.map((i) => POI_BY_ID[i.poiId]).filter(Boolean);
  if (!pois.length) return { key: "unlimited", why: "行程還沒排，先選會自動切換訊號的多電信漫遊。" };
  const outskirts = pois.filter((p) => haversineKm(OSAKA_CENTER, p) > 10);
  const ratio = outskirts.length / pois.length;
  if (outskirts.length >= 2 && ratio >= 0.25) {
    return { key: "docomo", why: `行程有 ${outskirts.length} 個郊區景點（${outskirts.map((p) => p.name).join("、")}），Docomo 的郊區涵蓋最高。` };
  }
  if (outskirts.length > 0) {
    return { key: "unlimited", why: `有 ${outskirts.map((p) => p.name).join("、")} 在郊區，多電信漫遊會自動切最強訊號。` };
  }
  return { key: "softbank", why: "行程都在市區，SoftBank 的都市基地台密度最高。" };
}

const PLAN_BY_KEY = Object.fromEntries(ESIM_PLANS.map((p) => [p.key, p]));


/** 依「實際排出來的行程」估算網路需求，而不是憑空客製化 */
function tripNetworkNeeds(board, session, analysis) {
  const pois = board.map((i) => POI_BY_ID[i.poiId]).filter(Boolean);
  const days = session.days || 5;
  const count = (t) => pois.filter((p) => p.tags.includes(t)).length;
  const photo = count("拍照");
  const night = count("夜生活");
  const explore = count("探索");
  const shop = count("購物");
  const groups = analysis?.plan?.groups?.length || 1;

  // 隨景點數增加的用量，取「每天平均幾個」才不會因為天數少就被高估。
  // 基準 0.6GB：多數人晚上回飯店連 Wi-Fi，白天才吃行動網路；導航其實很省，
  // 真正吃流量的是照片和限動上傳。官網最高只賣 3GB／日，估算級距也照這個現實抓。
  const perDay = (n, w) => (n / days) * w;
  const gbPerDay = Math.max(0.4, Math.round((
    0.6                                   // 通訊、查資料、社群的基本盤
    + perDay(photo, 0.3)                  // 照片和限動上傳最吃流量
    + perDay(explore, 0.15)               // 鑽巷弄整段路都在導航
    + perDay(night, 0.12)                 // 夜間找路、叫車、查營業時間
    + perDay(shop, 0.1)                   // 比價、查退稅、傳照片問朋友
    + (groups > 1 ? 0.4 : 0)              // 分流時各自定位、互傳位置，每天都在發生
  ) * 10) / 10);

  const drivers = [];
  if (photo) drivers.push({ text: `${photo} 個拍照點，照片和限動會一直上傳` });
  if (groups > 1) drivers.push({ text: `分流時段分成 ${groups} 組，每個人都要能各自定位` });
  if (explore) drivers.push({ text: `${explore} 個要靠導航鑽巷弄的行程` });
  if (night) drivers.push({ text: `${night} 個夜間行程，地下街和人潮處訊號最不穩` });
  if (shop) drivers.push({ text: `${shop} 個購物點，比價和退稅查詢都吃網路` });

  // 抓一點餘裕：估 1.2GB 就建議買 2GB，免得下午就降速；超過 2.2GB 直接建議吃到飽
  const recommended = gbPerDay >= 2.2 ? "unlimited" : gbPerDay >= 1.2 ? "g2" : gbPerDay >= 0.7 ? "g1" : "m500";
  return {
    gbPerDay, drivers: drivers.slice(0, 4), recommended, days, spots: pois.length,
    // 分流是整個導購最有說服力的一句話：它具體、有畫面、而且是算出來的
    groups,
    splitTitle: analysis?.plan?.splitTitle || "",
    groupNames: (analysis?.plan?.groups || []).map((g) => ({ icon: g.icon, name: g.name, members: g.members })),
  };
}

/**
 * 比對「現在的行程」和「定版時的行程」差在哪，以及已買的方案是否還夠用。
 * 這是讓使用者能確定「最後行程」與「eSIM 夠不夠」的關鍵。
 */
function comparePlan(locked, board, session, analysis) {
  if (!locked) return null;
  const key = (i) => `${i.poiId}@${i.day}-${i.slot}`;
  const beforeSet = new Set(locked.items.map(key));
  const afterSet = new Set(board.map(key));
  const added = board.filter((i) => !beforeSet.has(key(i))).map((i) => POI_BY_ID[i.poiId]).filter(Boolean);
  const removed = locked.items.filter((i) => !afterSet.has(key(i))).map((i) => POI_BY_ID[i.poiId]).filter(Boolean);
  const needs = tripNetworkNeeds(board, session, analysis);
  const changed = added.length > 0 || removed.length > 0;

  // 已買方案是否還夠用（吃到飽永遠夠）
  const bought = locked.purchase ? PLAN_BY_KEY[locked.purchase.planKey] : null;
  const overBought = Boolean(bought) && bought.key !== "unlimited" && needs.gbPerDay > bought.gb;

  return {
    changed, added, removed,
    wasGb: locked.gbPerDay, nowGb: needs.gbPerDay,
    wasSpots: locked.spots, nowSpots: needs.spots,
    bought, overBought, needs,
  };
}

/** Mock 隊友各自的網路偏好：demo「每個人需求不一樣」 */
const MATE_PLAN_BIAS = { soldier: "unlimited", camera: "unlimited", shopper: "g2", capybara: "g1", accountant: "m500", explorer: "g2", taxi: "g2", nanny: "g2" };

/* ---------- 行程導出成圖片（純 Canvas，不依賴外部套件） ---------- */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const chars = Array.from(text);
  const lines = [];
  let line = "";
  chars.forEach((ch) => {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  });
  if (line) lines.push(line);
  return lines;
}

/** 畫出一張可以存進相簿的行程圖；環境不支援 canvas 時回傳 null */
/* 把趣趣直接用 canvas 畫出來（跟 Mascot 的 SVG 同一組座標，viewBox 200×200）。
   這樣不用把 SVG 轉圖，渲染是同步的。 */
function drawMascot(ctx, x, y, size) {
  const u = size / 200;
  const X = (v) => x + v * u;
  const Y = (v) => y + v * u;
  const S = (v) => v * u;
  const ell = (cx, cy, rx, ry, fill, stroke, lw) => {
    ctx.beginPath();
    ctx.ellipse(X(cx), Y(cy), S(rx), S(ry), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = S(lw); ctx.stroke(); }
  };

  // 提把
  ctx.beginPath();
  roundRectPath(ctx, X(78), Y(42), S(44), S(30), S(11));
  ctx.strokeStyle = INK; ctx.lineWidth = S(6); ctx.stroke();
  // 手
  ell(42, 130, 10, 15, BODY, INK, 4);
  ell(158, 130, 10, 15, BODY, INK, 4);
  // 身體
  ctx.beginPath();
  roundRectPath(ctx, X(44), Y(62), S(112), S(106), S(44));
  ctx.fillStyle = BODY; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = S(5); ctx.stroke();
  // 輪子
  [72, 128].forEach((cx) => {
    ell(cx, 172, 8, 8, INK);
    ell(cx, 172, 3, 3, PAGE);
  });
  // 束帶
  ctx.beginPath();
  ctx.moveTo(X(64), Y(152));
  ctx.quadraticCurveTo(X(100), Y(164), X(136), Y(152));
  ctx.strokeStyle = "#F29A2E"; ctx.lineWidth = S(4); ctx.lineCap = "round";
  ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
  // 腮紅
  ctx.globalAlpha = 0.55;
  ell(68, 120, 8, 5, "#FF7A6B");
  ell(132, 120, 8, 5, "#FF7A6B");
  ctx.globalAlpha = 1;
  // 笑瞇眼（限動用開心的表情）
  [[75, 89], [111, 125]].forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(X(a), Y(106));
    ctx.quadraticCurveTo(X((a + b) / 2), Y(97), X(b), Y(106));
    ctx.strokeStyle = INK; ctx.lineWidth = S(4); ctx.stroke();
  });
  // 笑開的嘴
  ctx.beginPath();
  ctx.moveTo(X(87), Y(115));
  ctx.quadraticCurveTo(X(100), Y(133), X(113), Y(115));
  ctx.strokeStyle = INK; ctx.lineWidth = S(4); ctx.stroke();
  ctx.lineCap = "butt";
}

/* IG 限動用的 9:16 圖。行程圖是長捲軸，丟到限動會被裁爛，所以另外畫一張。
   內容以「我的旅遊人格」為主——那才是有人會想貼的東西，行程只當佐證。 */
function renderStoryImage({ session, board, analysis }) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  const dpr = 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return null;

  const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const me = analysis?.members?.find((m) => m.player.isUser);
  const P = me ? PERSONAS[me.persona] : PERSONAS.capybara;

  // 背景：品牌米底 + 點陣
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(31,35,80,.07)";
  for (let y = 24; y < H; y += 26) {
    for (let x = 24; x < W; x += 26) {
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 人格色的暈開底
  const g = ctx.createRadialGradient(W / 2, 640, 80, W / 2, 640, 620);
  g.addColorStop(0, `${P.soft}`);
  g.addColorStop(1, "rgba(255,232,209,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 200, W, 900);

  ctx.textAlign = "center";

  // 品牌（避開 IG 頂部的頭像列）
  ctx.fillStyle = INK;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText("去趣 TripMate", W / 2, 330);

  // 趣趣
  drawMascot(ctx, W / 2 - 150, 380, 300);

  // 人格
  ctx.fillStyle = "rgba(31,35,80,.6)";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("我的旅遊人格是", W / 2, 760);

  ctx.fillStyle = P.color;
  ctx.font = `900 88px ${FONT}`;
  ctx.fillText(`${P.emoji} ${P.name}`, W / 2, 866);

  ctx.fillStyle = INK;
  ctx.font = `700 33px ${FONT}`;
  const quoteLines = wrapText(ctx, `「${P.quote}」`, W - 160);
  quoteLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, 932 + i * 42));

  // 分隔
  ctx.strokeStyle = "rgba(31,35,80,.25)";
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 12]);
  ctx.beginPath(); ctx.moveTo(140, 1000); ctx.lineTo(W - 140, 1000); ctx.stroke();
  ctx.setLineDash([]);

  // 行程
  ctx.fillStyle = INK;
  ctx.font = `900 72px ${FONT}`;
  ctx.fillText(session.dest, W / 2, 1090);
  ctx.fillStyle = "rgba(31,35,80,.62)";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(`${tripLabel(session.days || 5)}　·　${session.players.length} 人　·　${board.length} 個地點`, W / 2, 1146);

  // 精選三個地點（評分最高的）
  const tops = board
    .map((i) => POI_BY_ID[i.poiId])
    .filter(Boolean)
    .sort((a, b) => b.rating - a.rating)
    .filter((poi, i, arr) => arr.findIndex((x) => x.id === poi.id) === i)
    .slice(0, 3);
  let cy = 1232;
  tops.forEach((poi) => {
    const label = `${poi.emoji} ${poi.name}`;
    ctx.font = `900 38px ${FONT}`;
    const w = ctx.measureText(label).width + 68;
    ctx.beginPath();
    roundRectPath(ctx, (W - w) / 2, cy - 44, w, 76, 38);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(label, W / 2, cy + 6);
    cy += 88;
  });

  // 邀請卡：IG 限動上下各約 250px 會被介面蓋掉，所以收在 1630 以內
  ctx.beginPath();
  roundRectPath(ctx, 140, 1478, W - 280, 146, 40);
  ctx.fillStyle = INK; ctx.fill();
  ctx.fillStyle = "#FFC93C";
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText("也想測測看？房間代碼", W / 2, 1534);
  ctx.fillStyle = "#fff";
  ctx.font = `900 58px ${FONT}`;
  ctx.fillText(session.code || "OSK-XXXX", W / 2, 1596);

  ctx.textAlign = "left";
  return canvas.toDataURL("image/png");
}

function renderItineraryImage({ session, board, analysis }) {
  // 沒有 DOM / canvas 的環境（SSR、測試）直接放棄，由呼叫端顯示提示
  if (typeof document === "undefined" || !document.createElement) return null;
  const W = 1080;
  const PAD = 56;
  const days = buildPlanDays(session.days || 5);
  const itemsOf = (d, slot) => board.filter((i) => i.day === d && i.slot === slot).sort((a, b) => a.order - b.order);

  // 先算高度
  let h = 300; // header
  days.forEach((d) => {
    h += 74;
    slotsForDay(d, board).forEach((slot) => {
      h += 44 + itemsOf(d.day, slot).length * 72;
    });
    h += 28;
  });
  h += 210 + 164; // footer（優惠碼）＋ 邀請卡

  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const ink = INK;

  // 背景
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = "rgba(31,35,80,.07)";
  for (let y = 18; y < h; y += 18) {
    for (let x = 18; x < W; x += 18) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Header
  ctx.fillStyle = PERSIMMON;
  roundRectPath(ctx, PAD, 52, 84, 84, 20);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `900 46px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("趣", PAD + 20, 96);

  ctx.fillStyle = ink;
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText("去趣 TripMate", PAD + 106, 80);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = "rgba(31,35,80,.65)";
  ctx.fillText("AI 幫你們排好的行程", PAD + 106, 116);

  ctx.fillStyle = ink;
  ctx.font = `900 60px ${FONT}`;
  ctx.fillText(`${session.dest} ${tripLabel(session.days)}`, PAD, 190);

  ctx.font = `700 26px ${FONT}`;
  ctx.fillStyle = "rgba(31,35,80,.7)";
  const who = session.players.map((p) => p.name).join("、");
  ctx.fillText(`${fmtDate(session.date)} 出發　·　${session.players.length} 人：${who}`, PAD, 236);

  if (analysis) {
    ctx.fillText(`節奏合拍指數 ${analysis.vibe}%　·　${analysis.vibeInfo.label}`, PAD, 272);
  }

  // 每一天
  let y = 316;
  days.forEach((d) => {
    const cardTop = y;
    let inner = 74;
    slotsForDay(d, board).forEach((slot) => { inner += 44 + itemsOf(d.day, slot).length * 72; });

    ctx.fillStyle = "#fff";
    roundRectPath(ctx, PAD, cardTop, W - PAD * 2, inner, 28);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = `900 36px ${FONT}`;
    ctx.fillText(`${d.label}`, PAD + 32, cardTop + 44);
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = "rgba(31,35,80,.55)";
    ctx.fillText(d.note, PAD + 32 + ctx.measureText(`${d.label}`).width + 90, cardTop + 44);

    y = cardTop + 78;
    slotsForDay(d, board).forEach((slot) => {
      ctx.fillStyle = slot === ALL_DAY_SLOT ? "#7CC6FE" : "#FFC93C";
      roundRectPath(ctx, PAD + 32, y - 14, 92, 34, 12);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = `900 22px ${FONT}`;
      ctx.fillText(slot, PAD + 46, y + 4);

      const list = itemsOf(d.day, slot);
      if (!list.length) {
        ctx.font = `700 24px ${FONT}`;
        ctx.fillStyle = "rgba(31,35,80,.4)";
        ctx.fillText("自由活動", PAD + 150, y + 4);
      }
      y += 44;
      list.forEach((it) => {
        const poi = POI_BY_ID[it.poiId];
        if (!poi) return;
        ctx.font = `400 34px ${FONT}`;
        ctx.fillText(poi.emoji, PAD + 150, y + 8);
        ctx.fillStyle = ink;
        ctx.font = `900 30px ${FONT}`;
        ctx.fillText(poi.name, PAD + 200, y + 4);
        ctx.font = `700 22px ${FONT}`;
        ctx.fillStyle = "rgba(31,35,80,.55)";
        ctx.fillText(`${poi.area}　${fmtDur(poi.minutes)}　★${poi.rating}`, PAD + 200, y + 36);
        y += 72;
      });
    });
    y = cardTop + inner + 28;
  });

  // Footer：優惠碼
  ctx.fillStyle = "#FFF3A6";
  roundRectPath(ctx, PAD, y, W - PAD * 2, 140, 24);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ink;
  ctx.font = `900 32px ${FONT}`;
  ctx.fillText(`去趣 eSIM 優惠碼　${session.coupon || "QU-XXXX"}　全館 85 折`, PAD + 32, y + 52);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = "rgba(31,35,80,.7)";
  const foot = wrapText(ctx, "出發前記得開通 eSIM，分頭行動時才找得到彼此。", W - PAD * 2 - 64);
  foot.forEach((ln, i) => ctx.fillText(ln, PAD + 32, y + 96 + i * 32));
  y += 164;

  // 邀請卡：這張圖被轉傳出去的時候，順便把人帶進房間
  ctx.fillStyle = ink;
  roundRectPath(ctx, PAD, y, W - PAD * 2, 128, 24);
  ctx.fill();
  ctx.fillStyle = "#FFC93C";
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText("也想一起排？在去趣 TripMate 輸入房間代碼", PAD + 32, y + 46);
  ctx.fillStyle = "#fff";
  ctx.font = `900 46px ${FONT}`;
  ctx.fillText(session.code || "OSK-XXXX", PAD + 32, y + 98);
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.font = `700 22px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${session.players.length} 人已在房間裡`, W - PAD - 32, y + 98);
  ctx.textAlign = "left";

  return canvas.toDataURL("image/png");
}

function ExportSheet({ session, board, analysis, onClose, onSeePlans, toast }) {
  // 兩種尺寸：行程圖是長捲軸（給 LINE 群看細節），限動圖是 9:16（給 IG 貼）
  const [kind, setKind] = useState("plan");
  const [urls, setUrls] = useState({ plan: null, story: null });
  const [failed, setFailed] = useState(false);
  const url = urls[kind];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
        const plan = renderItineraryImage({ session, board, analysis });
        const story = renderStoryImage({ session, board, analysis });
        if (!alive) return;
        if (plan || story) setUrls({ plan, story });
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [session, board, analysis]);

  const fileName = kind === "story" ? `去趣-${session.dest}限動.png` : `去趣-${session.dest}行程.png`;

  const save = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("圖片已下載，手機上也可以長按圖片存到相簿");
  };

  // 手機瀏覽器的原生分享面板裡就有 Instagram；桌機沒有這個 API，退回下載。
  const shareImage = async () => {
    if (!url) return;
    sfx("tap");
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          text: kind === "story"
            ? `我的旅遊人格出爐了！${session.dest} ${tripLabel(session.days || 5)} #去趣TripMate`
            : `我們的${session.dest}行程排好了 #去趣TripMate`,
        });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // 使用者自己取消，不用報錯
    }
    save();
    toast(kind === "story" ? "已下載，打開 IG 限動選這張就可以貼了" : "已下載，可以直接傳到 LINE 群");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-[#1F2350]/80 px-4 py-6">
      <motion.div initial={{ y: 26, scale: 0.96 }} animate={{ y: 0, scale: 1 }} className="mx-auto w-full max-w-md">
        <Card className="p-4">
          <div className="flex items-start gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#FFC93C]"><ImageDown size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="tm-display text-xl leading-tight">行程出爐，存一張帶著走</div>
              <p className="text-xs leading-relaxed opacity-70">
                {kind === "story" ? "9:16 直式，貼 IG 限動剛剛好。" : "存進相簿，沒網路也看得到。"}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="關閉" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[#1F2350]"><X size={15} strokeWidth={3} /></button>
          </div>

          {/* 尺寸切換 */}
          <div className="mt-3 flex gap-1.5">
            {[
              { key: "plan", label: "行程圖", note: "傳 LINE 群" },
              { key: "story", label: "IG 限動", note: "9:16 直式" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { sfx("tap"); setKind(t.key); }}
                aria-pressed={kind === t.key}
                className={`flex-1 rounded-xl border-[3px] border-[#1F2350] px-2 py-1.5 text-center ${kind === t.key ? "bg-[#1F2350] text-white shadow-[3px_3px_0_#FF6B35]" : "bg-white"}`}
              >
                <span className="block text-xs font-black">{t.label}</span>
                <span className="block text-[10px] font-bold opacity-60">{t.note}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 max-h-[46vh] overflow-y-auto rounded-2xl border-2 border-[#1F2350]/20 bg-[#FFF8EE] p-2">
            {url ? (
              <img src={url} alt={kind === "story" ? "限動圖片預覽" : "行程圖片預覽"} className={`rounded-xl ${kind === "story" ? "mx-auto w-2/3" : "w-full"}`} />
            ) : failed ? (
              <div className="p-6 text-center text-sm font-bold opacity-60">這個環境不支援產生圖片，請改用截圖保存。</div>
            ) : (
              <div className="grid place-items-center gap-2 p-8 text-sm font-bold opacity-60">
                <ThinkingDots /> 正在畫你們的行程⋯⋯
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-2">
            <Btn className="w-full" disabled={!url} onClick={shareImage}>
              <Share2 size={18} /> {kind === "story" ? "分享到 IG 限動" : "分享到 LINE 群組"}
            </Btn>
            <Btn variant="ghost" className="w-full" disabled={!url} onClick={save}>
              <Download size={18} /> 只要存到相簿
            </Btn>
            <Btn variant="sun" className="w-full" onClick={onSeePlans}>
              <Wifi size={18} /> 下一步：看這份行程需要多少網路
            </Btn>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

/* ---------- 依行程推薦的方案 + 個人加價升級 ---------- */
function NetworkPlanSheet({ session, board, analysis, locked, onPurchase, onClose, onExport, toast }) {
  const needs = useMemo(() => tripNetworkNeeds(board, session, analysis), [board, session, analysis]);
  const base = PLAN_BY_KEY[needs.recommended];
  const days = session.days || 5;

  // 我只決定「我自己的」方案；隊友在他們自己的手機上選，這裡只看得到結果
  const bought = locked?.purchase || null;
  // 定版被解除＝行程正在變動，這時候算出來的方案只是暫時的
  const drifting = Boolean(locked?.unlockedAt);
  const drift = useMemo(
    () => (drifting ? comparePlan(locked, board, session, analysis) : null),
    [drifting, locked, board, session, analysis],
  );
  const [myPick, setMyPick] = useState(bought?.planKey || base.key);
  const carrierPick = useMemo(() => suggestCarrier(board), [board]);
  const [carrier, setCarrier] = useState(bought?.carrier || carrierPick.key);
  const [mates, setMates] = useState(() => Object.fromEntries(
    session.players.filter((p) => !p.isUser).map((p) => [p.id, null]), // null = 還沒選
  ));
  const [done, setDone] = useState(Boolean(bought));
  const [agreed, setAgreed] = useState(Boolean(bought)); // 買過就等於確認過
  const [showAllTerms, setShowAllTerms] = useState(false);
  // 這張單原本一路捲到底，把「說服 / 選擇 / 結帳」三件事混在一起。
  // 切成兩步之後，每一屏只問一個問題。
  const [buyStep, setBuyStep] = useState(0);
  const [burst, setBurst] = useState(false);
  const me = session.players.find((p) => p.isUser);

  // Mock 即時同步：隊友陸續在自己的介面上選好
  useEffect(() => {
    const pending = session.players.filter((p) => !p.isUser);
    const timers = pending.map((p, i) => setTimeout(() => {
      setMates((st) => ({ ...st, [p.id]: MATE_PLAN_BIAS[p.type] || base.key }));
    }, 900 + i * 1100 + Math.random() * 700));
    return () => timers.forEach(clearTimeout);
  }, [session.players, base.key]);

  const picks = { ...mates, [me.id]: myPick };
  const decided = session.players.filter((p) => picks[p.id]);
  const waiting = session.players.length - decided.length;

  const groupUnit = salePerDay(base);
  // 官網只賣 1/3/5/7/10… 天，行程天數要進位到買得到的那一檔
  const payDays = billableDays(days);
  // 85 折是去趣的常態全館優惠，不管誰選哪個方案都適用；選貴的自己多付，選便宜的自己省下
  const unitOf = (key) => salePerDay(PLAN_BY_KEY[key]);
  const priceOf = (key) => unitOf(key) * payDays;
  const myPrice = priceOf(myPick);
  const mySaved = PLAN_BY_KEY[myPick].listPerDay * payDays - myPrice;
  const total = decided.reduce((acc, p) => acc + priceOf(picks[p.id]), 0);
  const listTotal = decided.reduce((acc, p) => acc + PLAN_BY_KEY[picks[p.id]].listPerDay * payDays, 0);
  const saved = listTotal - total;

  const share = async () => {
    const lines = [
      `【去趣 TripMate】${session.dest} ${tripLabel(days)} 行程排好了！`,
      `全隊 ${needs.spots} 個行程，AI 算出每人每天大約用 ${needs.gbPerDay}GB`,
      `AI 推薦的方案：${base.name}　${money(groupUnit)}／日（原價 ${money(base.listPerDay)}，全館 85 折）`,
      `優惠碼 ${session.coupon || "QU-XXXX"}，每個人打開連結選自己要的方案，一人一張不用共用熱點`,
      `${SHARE_BASE}${session.code}`,
    ].join("\n");
    toast((await copyText(lines)) ? "連結已複製，隊友點開就能選自己的方案" : "複製失敗，請手動複製");
  };

  const buy = () => {
    setDone(true);
    setBurst(true);
    sfx("fanfare");
    setTimeout(() => setBurst(false), 1500);
    onPurchase?.({ planKey: myPick, carrier, payDays, price: myPrice, at: Date.now() });
    toast(`已確認：${PLAN_BY_KEY[myPick].name}（${CARRIER_BY_KEY[carrier].name}），${money(myPrice)}`);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-[#1F2350]/80 px-4 py-6">
      <motion.div initial={{ y: 26, scale: 0.96 }} animate={{ y: 0, scale: 1 }} className="mx-auto w-full max-w-md">
        <Card className="relative p-4 pb-24">
          <Burst show={burst} />
          <div className="flex items-start gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#1F2350] bg-[#7CC6FE]"><Gauge size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="tm-display text-xl leading-tight">這份行程需要多少網路？</div>
              {locked && !locked.unlockedAt && (
                <div className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-[#E3F5EA] px-2 py-0.5 text-[10px] font-black text-[#1F7A55]">
                  <Lock size={10} /> 依 {new Date(locked.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 定版的行程計算
                </div>
              )}
              {drifting && (
                <div className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-[#FFE1D3] px-2 py-0.5 text-[10px] font-black text-[#B8440E]">
                  <Unlock size={10} /> 行程還在調整中，下面的數字會跟著變
                </div>
              )}
              <p className="text-xs leading-relaxed opacity-70">照你們排出來的 <span className="font-black">{needs.spots} 個行程</span>估算，全館 85 折</p>
            </div>
            <button type="button" onClick={onClose} aria-label="關閉" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[#1F2350]"><X size={15} strokeWidth={3} /></button>
          </div>

          {drifting && bought && drift && (
            <div className={`mt-3 rounded-2xl border-[3px] border-[#1F2350] p-3 ${drift.overBought ? "bg-[#FFE1D3]" : "bg-[#FFF3A6]"}`}>
              <div className="text-[11px] font-black">
                {drift.overBought ? "⚠️ 改完行程後，你買的方案可能不夠用" : "ℹ️ 行程改過了，你買的方案還夠用"}
              </div>
              <div className="mt-1 text-[10.5px] font-bold leading-relaxed">
                你買的是「{PLAN_BY_KEY[bought.planKey].name}」，是照 {drift.wasGb}GB／日 算的；
                現在的行程估算 <span className="tm-num">{drift.nowGb}</span>GB／日
                {drift.added.length > 0 && `（新增 ${drift.added.length} 個地點`}
                {drift.added.length > 0 && drift.removed.length > 0 && "、"}
                {drift.removed.length > 0 && `${drift.added.length === 0 ? "（" : ""}刪除 ${drift.removed.length} 個`}
                {(drift.added.length > 0 || drift.removed.length > 0) && "）"}。
                {drift.overBought
                  ? "建議回行程頁重新定版後，在這裡加購或換更大的方案。"
                  : "回行程頁重新定版就可以確定下來。"}
              </div>
            </div>
          )}

          {/* ========== 第 1 步：你需要多少、要買哪個 ========== */}
          {!done && buyStep === 0 && (
          <>
          {/* 分流當主標：這是唯一「屬於他們這一團」的理由，比 GB 數字有畫面 */}
          {needs.groups > 1 && (
            <div className="mt-3 rounded-2xl border-[3px] border-[#1F2350] bg-[#F3EEFF] p-3">
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-[#5B3FC4] px-1.5 py-0.5 text-[10px] font-black text-white">你們的行程算出來的</span>
              </div>
              <div className="tm-display mt-1 text-[22px] leading-tight">
                你們會分成 {needs.groups} 組行動
              </div>
              {needs.splitTitle && <div className="mt-0.5 text-xs font-bold opacity-65">{needs.splitTitle}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {needs.groupNames.map((g) => (
                  <span key={g.name} className="inline-flex items-center gap-1 rounded-xl border-2 border-[#1F2350]/25 bg-white px-2 py-1">
                    <span className="text-xs font-bold">{g.icon} {g.name}</span>
                    <span className="flex -space-x-1.5">
                      {(g.members || []).map((mb) => <Avatar key={mb.id} p={mb} size={16} />)}
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[13px] font-black leading-relaxed">
                一分開，<span className="text-[#5B3FC4]">熱點就分享不到了</span>。
              </p>
              <Fold className="mt-1.5" tone="#FFFFFF" title="開熱點真的不行嗎？">
                會受手機系統限制（SoftBank 方案的 Android 無法開熱點），而且一分流就有人沒網路。
              </Fold>
            </div>
          )}

          {/* 用量估算：分流之後的理性佐證 */}
          <div className="mt-3 rounded-2xl border-2 border-[#1F2350] bg-[#FFF8EE] p-3">
            <div className="flex items-end gap-2">
              <span className="tm-num text-[34px] font-black leading-none text-[#FF6B35]">{needs.gbPerDay}</span>
              <span className="pb-1 text-sm font-black">GB／人／日</span>
              <span className="pb-1 ml-auto text-[11px] font-bold opacity-55">AI 依行程估算</span>
            </div>
            <ul className="mt-2 space-y-1">
              {needs.drivers.slice(0, 1).map((d) => (
                <li key={d.text} className="text-[11.5px] leading-relaxed">· {d.text}</li>
              ))}
            </ul>
            {needs.drivers.length > 1 && (
              <Fold className="mt-2" tone="#FFFFFF" title={`還有 ${needs.drivers.length - 1} 個因素推高用量`}>
                <ul className="m-0 list-none space-y-1 p-0">
                  {needs.drivers.slice(1).map((d) => (
                    <li key={d.text} className="leading-relaxed">· {d.text}</li>
                  ))}
                </ul>
              </Fold>
            )}
          </div>


          {/* 我的方案：這支手機只決定自己的 */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-black">
              <Avatar p={me} size={20} /> 你的方案
              <span className="text-[11px] font-bold opacity-50">每個人在自己手機上選，各自結帳</span>
            </div>
            <div className="grid gap-1.5">
              {ESIM_PLANS.map((plan) => {
                const on = myPick === plan.key;
                const isBase = plan.key === base.key;
                const delta = salePerDay(plan) - salePerDay(base);
                return (
                  <button
                    key={plan.key}
                    type="button"
                    disabled={done}
                    onClick={() => setMyPick(plan.key)}
                    aria-pressed={on}
                    className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-left disabled:opacity-60 ${on ? "border-[#1F2350] bg-[#FFC93C] shadow-[2px_2px_0_#1F2350]" : "border-[#1F2350]/20 bg-white"}`}
                  >
                    <span className="text-lg">{plan.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-black leading-tight">
                        {plan.name.replace("去趣 ", "")}
                        {isBase && <span className="ml-1 rounded bg-[#2F9E62] px-1 py-0.5 text-[9px] text-white">AI 推薦</span>}
                      </span>
                      <span className="block text-[10px] leading-tight opacity-60">{plan.cap}</span>
                    </span>
                    <span className="tm-num shrink-0 text-right text-[11px] font-black leading-tight">
                      {money(unitOf(plan.key))}／日
                      {delta !== 0 && (
                        <span className={`block text-[9.5px] ${delta > 0 ? "text-[#B8440E]" : "text-[#1F7A55]"}`}>
                          {delta > 0 ? `加價 ${money(delta)}` : `省 ${money(-delta)}`}
                        </span>
                      )}
                    </span>
                    {on && <Check size={14} strokeWidth={3} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
            <Fold
              className="mt-2"
              tone="#FFFFFF"
              bodyClass=""
              title={<>想用哪家電信商？<span className="ml-1 font-bold opacity-55">目前：{CARRIER_BY_KEY[carrier].name}・同價格</span></>}
            >
              <div className="flex gap-1.5">
                {ESIM_CARRIERS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    disabled={done}
                    onClick={() => setCarrier(c.key)}
                    aria-pressed={carrier === c.key}
                    className={`relative flex-1 rounded-xl border-2 border-[#1F2350] px-2 py-1.5 text-left disabled:opacity-60 ${carrier === c.key ? "bg-[#7CC6FE]" : "bg-white"}`}
                  >
                    {c.key === carrierPick.key && (
                      <span className="absolute -top-1.5 left-1 rounded bg-[#2F9E62] px-1 text-[8.5px] font-black text-white">AI 推薦</span>
                    )}
                    <span className="block text-[11px] font-black leading-tight">{c.name}</span>
                    <span className="block text-[9.5px] leading-tight opacity-65">{c.line}・{c.speed}</span>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 rounded-lg bg-[#FFF8EE] p-2 text-[10px] leading-relaxed">
                {carrier === carrierPick.key
                  ? <><span className="font-black">為什麼推這家：</span>{carrierPick.why}</>
                  : <><span className="font-black">{CARRIER_BY_KEY[carrier].name}：</span>{CARRIER_BY_KEY[carrier].fit}</>}
                <div className="mt-1 text-[#B8440E]">⚠️ {CARRIER_BY_KEY[carrier].caveat}</div>
              </div>
            </Fold>
          </div>

          <Fold className="mt-3" tone="#FFFFFF" title="方案定價說明">
500MB（NT$22）與吃到飽（NT$81 起）為去趣官方標價，中間級距為等比推估。
          </Fold>
          </>
          )}

          {/* ========== 第 2 步：確認與結帳 ========== */}
          {!done && buyStep === 1 && (
          <>
          {/* 你選的：一行講完，取代原本散在兩處的兩個價格區塊 */}
          <div className="mt-3 rounded-2xl border-[3px] border-[#1F2350] bg-[#FFF3A6] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 text-sm font-black leading-snug">
                {PLAN_BY_KEY[myPick].icon} {PLAN_BY_KEY[myPick].name.replace("去趣 ", "")}
                <span className="font-bold opacity-60">　{CARRIER_BY_KEY[carrier].name}・{payDays} 天</span>
              </span>
              <span className="tm-num shrink-0 text-xl font-black">{money(myPrice)}</span>
            </div>
            <div className="mt-1 text-[11px] font-bold text-[#1F7A55]">85 折已折 {money(mySaved)}</div>
            {payDays > days && (
              <div className="mt-1.5 rounded-xl bg-white px-2.5 py-1.5 text-[10.5px] font-bold leading-relaxed">
                {days} 天的行程，官網最接近的是 <span className="font-black">{payDays} 天方案</span>
              </div>
            )}
          </div>

          {/* 隊友各自選的結果：唯讀 */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-black">
              <Users size={15} /> 隊友各自選的
              {waiting > 0
                ? <span className="inline-flex items-center gap-1 text-[11px] font-bold opacity-55">還有 {waiting} 人在選 <ThinkingDots small /></span>
                : <span className="text-[11px] font-bold text-[#1F7A55]">都選好了</span>}
            </div>
            <div className="space-y-1.5">
              {session.players.filter((p) => !p.isUser).map((p) => {
                const key = mates[p.id];
                const plan = key ? PLAN_BY_KEY[key] : null;
                return (
                  <div key={p.id} className="flex items-center gap-2 rounded-xl border-2 border-[#1F2350]/20 bg-white px-2.5 py-1.5">
                    <Avatar p={p} size={22} />
                    <span className="shrink-0 text-xs font-bold">{p.name}</span>
                    {plan ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-black">
                          {plan.icon} {plan.name.replace("去趣 ", "")}
                          {plan.tier > base.tier && <span className="ml-1 text-[10px] font-bold text-[#B8440E]">自己加價</span>}
                          {plan.tier < base.tier && <span className="ml-1 text-[10px] font-bold text-[#1F7A55]">選更省的</span>}
                        </span>
                        <span className="tm-num shrink-0 text-xs font-black">{money(priceOf(key))}</span>
                      </>
                    ) : (
                      <span className="flex-1 text-[11px] font-bold opacity-45">還在自己的手機上挑⋯⋯</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 條款：買之前要確認過 */}
          <div className="mt-3 rounded-2xl border-[3px] border-[#1F2350] bg-white p-3">
            <div className="text-[11px] font-black">購買前請先確認</div>
            <div className="mt-1.5 rounded-xl bg-[#FFE1D3] p-2 text-[10.5px] font-bold leading-relaxed text-[#B8440E]">
              ⚠️ 售出後不接受個人因素退換貨。
            </div>
            <ul className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed opacity-75">
              <li>· 每日用完高速額度會降速，隔天恢復。</li>
              <li>· QR Code 只能掃一次，建議出發當天再安裝。</li>
              {showAllTerms && (
                <>
                  <li>· 抵達當地連網開通當天就算第一天，算到當日（台灣時間）23:59 為第一日。</li>
                  <li>· 下單後通常 20 分鐘內 Email 收到 QR Code，遇到問題有 24 小時 LINE 中文真人客服。</li>
                  <li>· 熱點分享：SoftBank 方案 Android 無法開熱點（iPhone 可以）；KDDI 吃到飽有上限（購買天數減 1GB）。</li>
                  <li>· 不含當地門號與通話簡訊，但原門號的漫遊通話仍可使用。</li>
                </>
              )}
            </ul>
            {!showAllTerms && (
              <button type="button" onClick={() => setShowAllTerms(true)} className="mt-1 text-[10.5px] font-bold underline opacity-60">
                展開其餘 4 條
              </button>
            )}
            <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-xl border-2 border-[#1F2350] bg-[#FFF8EE] p-2">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF6B35]"
              />
              <span className="text-[11px] font-black leading-snug">
                我已閱讀並了解上述條款，特別是<span className="text-[#B8440E]">售出後不接受個人因素退換貨</span>
              </span>
            </label>
          </div>

          <Btn variant="ghost" className="mt-3 w-full" onClick={share}>
            <Copy size={18} /> 把行程和方案貼到 LINE 群組
          </Btn>
          </>
          )}

          {/* ========== 買完之後：只留確認，其他都不必再看 ========== */}
          {done && (
            <div className="mt-3 rounded-2xl border-[3px] border-[#1F2350] bg-[#E3F5EA] p-3">
              <div className="flex items-center gap-1.5 text-sm font-black text-[#1F7A55]">
                <Check size={16} strokeWidth={3} /> 你的方案已確認
              </div>
              <div className="mt-1.5 rounded-xl bg-white p-2.5 text-[11.5px] font-bold leading-relaxed">
                {PLAN_BY_KEY[myPick].icon} {PLAN_BY_KEY[myPick].name}　·　{CARRIER_BY_KEY[carrier].name}　·　{payDays} 天　·　{money(myPrice)}
                {locked && (
                  <div className="mt-1 flex items-center gap-1 text-[10.5px] font-bold opacity-65">
                    <Lock size={11} /> 依 {new Date(locked.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 定版的行程計算
                  </div>
                )}
              </div>
              <ul className="mt-2 space-y-0.5 text-[10.5px] leading-relaxed opacity-80">
                <li>· QR Code 會在 20 分鐘內寄到你的 Email，兌換期限 180 天。</li>
                <li>· 建議<span className="font-black">出發當天再在台灣掃描啟用</span>，掃了就開始算天數。</li>
              </ul>
              {/* 買完的收尾：把行程存成圖片傳出去，情緒收束 + 順便帶人進房間 */}
              <div className="mt-2.5 rounded-2xl border-[3px] border-[#1F2350] bg-white p-3">
                <div className="tm-display text-[17px] leading-tight">行程存好了，網路也備好了</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed opacity-70">
                  把這份行程傳到群組吧——圖片上有房間代碼，朋友輸入就能一起排。
                </p>
                <Btn className="mt-2 w-full" onClick={() => { onClose(); onExport?.(); }}>
                  <ImageDown size={18} /> 存成圖片傳到 LINE 群
                </Btn>
              </div>
              <Btn variant="ghost" className="mt-2 w-full" onClick={onClose}>
                <ChevronLeft size={16} /> 先回到行程
              </Btn>
            </div>
          )}
        </Card>
      </motion.div>

      {/* 固定底部：永遠看得到現在該做什麼，不用捲到底找按鈕 */}
      {!done && (
        <div
          className="fixed inset-x-0 bottom-0 z-[55] border-t-[3px] border-[#1F2350] bg-[#FFE8D1]/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="mx-auto flex max-w-md items-center gap-2">
            {buyStep > 0 && (
              <Btn variant="ghost" size="sm" className="shrink-0" onClick={() => setBuyStep(0)}>
                <ChevronLeft size={16} /> 改方案
              </Btn>
            )}
            {buyStep === 0 ? (
              <Btn className="flex-1" onClick={() => setBuyStep(1)}>
                下一步：確認 {money(myPrice)}
              </Btn>
            ) : (
              <Btn className="flex-1" disabled={!agreed} onClick={buy}>
                <Rocket size={18} /> {agreed ? `確認我的方案（${money(myPrice)}）` : "請先勾選上方條款"}
              </Btn>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ---------- 結算頁的輕量提醒（這時候還沒排行程，不推方案） ---------- */
function CouponReminder({ session, toast }) {
  const code = session.coupon || "QU-XXXX";
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b-[3px] border-dashed border-[#1F2350] bg-[#FFF3A6] px-4 py-2">
        <Ticket size={16} />
        <span className="text-sm font-black">你們的 eSIM 優惠碼還在</span>
        <span className="ml-auto tm-num rounded-md border-2 border-[#1F2350] bg-white px-2 py-0.5 text-sm font-black tracking-widest">{code}</span>
      </div>
      <div className="p-3">
        <p className="text-sm leading-relaxed">先收著，排完行程結帳時會自動帶入。</p>
        <div className="mt-2.5 flex gap-2">
          <Btn size="sm" variant="ghost" className="flex-1" onClick={async () => toast((await copyText(code)) ? "優惠碼已複製" : `複製失敗，代碼是 ${code}`)}>
            <Copy size={16} /> 複製優惠碼
          </Btn>
        </div>
        <Fold tone="#FFF8EE" className="mt-2" title="為什麼現在還不推薦方案？">
現在還太早。等行程排好，AI 會照實際景點和天數算出用量再推薦。
        </Fold>
      </div>
    </Card>
  );
}

let planIntroSeen = false;
function PlanScreen({ session, analysis, board, feed, onAdd, onRemove, onReorderSlot, onMoveItem, onBack, locked, lockVote, onProposeLock, onCancelLock, onBusyChange, onUnlock, onPurchase, toast }) {
  const days = session.days || 5;
  const planDays = useMemo(() => buildPlanDays(days), [days]);
  const [day, setDay] = useState(Math.min(2, days));
  const [deck, setDeck] = useState(null);
  // 剛進排行程的第一件事是「玩」，不是面對一張表格
  const [intro, setIntro] = useState(!planIntroSeen);
  const [review, setReview] = useState(null);
  const [alert, setAlert] = useState(null);
  const [sheet, setSheet] = useState(null); // export | plans
  const [unlockAsk, setUnlockAsk] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // 定版中＝沒有解除過，或解除後又重新定版
  const isLocked = Boolean(locked) && !locked.unlockedAt;
  const voting = Boolean(lockVote);
  // 投票期間先凍結，不然會有人邊投票邊改，投完的版本就不是大家看到的那版
  const frozen = isLocked || voting;
  // 有任何彈窗開著就通知上層暫停隊友的模擬修改
  useEffect(() => {
    onBusyChange?.(Boolean(deck || sheet || review || alert || unlockAsk));
    return () => onBusyChange?.(false);
  }, [deck, sheet, review, alert, unlockAsk, onBusyChange]);

  const diff = useMemo(
    () => (locked && locked.unlockedAt ? comparePlan(locked, board, session, analysis) : null),
    [locked, board, session, analysis],
  );
  const member = analysis?.members.find((m) => m.player.isUser);
  const dayDef = planDays.find((d) => d.day === day) || planDays[0];

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 4000);
    return () => clearInterval(t);
  }, []);

  const authorOf = (id) => session.players.find((p) => p.id === id) || { id: "ai", name: "去趣 AI", color: INK, ai: true };
  const itemsOf = (d, s) => board.filter((i) => i.day === d && i.slot === s).sort((a, b) => a.order - b.order);
  const excludeIds = board.map((i) => i.poiId);
  const seeded = board.filter((i) => i.by === "ai").length;

  // 滑完卡 → AI 後台編排 → 確認視窗
  const finishDeck = (picked) => {
    const plan = arrangePicks(board, picked, deck.day, deck.slot, days);
    setReview({ plan, day: deck.day, slot: deck.slot });
    setDeck(null);
  };

  const applyEntries = (entries) => {
    onAdd(entries);
    setReview(null);
    const movedCount = entries.filter((e) => e.moved).length;
    const forced = entries.filter((e) => e.forced).length;
    const swapCount = entries.filter((e) => e.replaces?.length).length;
    if (forced) toast(`已加入 ${entries.length} 個，其中 ${forced} 個照你的意思塞在原時段`);
    else if (swapCount) toast(`已加入 ${entries.length} 個，${swapCount} 個直接換掉原本 AI 預排的行程`);
    else if (movedCount) toast(`已加入 ${entries.length} 個，AI 把 ${movedCount} 個換到更順的時段`);
    else toast(`已加入 ${entries.length} 個地點，隊友也看到了`);
  };

  // 排序調整：變遠就跳提醒
  const handleReorder = (d, s, next) => {
    const before = slotReport(itemsOf(d, s), s);
    const after = slotReport(next, s);
    onReorderSlot(d, s, next);
    if (after.travel > before.travel + 10 || (hasWarn(after) && !hasWarn(before))) {
      const worst = after.hops.reduce((m, h) => (h.minutes > (m?.minutes || 0) ? h : m), null);
      setAlert({
        title: "這樣排會走很遠喔",
        body: worst
          ? `照這個順序，「${worst.from.name}」到「${worst.to.name}」要移動約 ${worst.minutes} 分鐘，整個${s}的交通時間變成 ${after.travel} 分鐘（原本 ${before.travel} 分）。`
          : `照這個順序，整個${s}的交通時間變成 ${after.travel} 分鐘（原本 ${before.travel} 分）。`,
        tip: "要不要讓 AI 用最短移動距離重排一次？地點不會變，只換順序。",
        primary: { label: "讓 AI 排順序", run: () => onReorderSlot(d, s, bestOrder(next)) },
        secondaryLabel: "我就是要這樣排",
      });
    }
  };

  // 時段爆掉 → 一鍵搬走最尷尬的那一個
  const handleFix = (d, s, issue) => {
    const poi = issue.poi;
    const alt = suggestSlot(board.filter((i) => !(i.day === d && i.slot === s && i.poiId === poi.id)), poi, days, `${d}-${s}`);
    const item = itemsOf(d, s).find((i) => i.poiId === poi.id);
    if (!item) return;
    if (!alt) {
      setAlert({
        title: "這幾天真的塞不下了",
        body: `「${poi.name}」需要 ${fmtDur(poi.minutes)}，但每個時段都已經排滿。`,
        tip: "建議先移除一個停留時間長的地點，或把它留到下一趟。",
        primary: { label: `直接移除「${poi.name}」`, run: () => onRemove(item.uid) },
      });
      return;
    }
    setAlert({
      title: "AI 的調整建議",
      body: `把「${poi.name}」從 Day ${d} ${s} 搬到 Day ${alt.day} ${alt.slot}，那邊還有約 ${fmtDur(Math.max(0, alt.spare))}的空檔，這個${s}就不會爆掉。`,
      tip: "其他行程都不會動，這是最小幅度的調整。",
      primary: { label: `搬到 Day ${alt.day} ${alt.slot}`, run: () => onMoveItem(item.uid, alt.day, alt.slot) },
      secondaryLabel: "先維持原樣",
    });
  };

  return (
    <div className="pb-12">
      {/* 手機上這些標籤原本要佔 3 行，合併成 2 顆，把畫面留給行程本身 */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="tm-display text-[30px] leading-tight">一起排行程</h1>
          <Btn size="sm" variant="ghost" sound="back" className="shrink-0" onClick={onBack}><ChevronLeft size={16} /> 回結算頁</Btn>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip>
            <span className="mr-0.5 inline-block h-2 w-2 rounded-full bg-[#2F9E62]" />
            同步中・{session.players.length} 人・{board.length} 個地點
          </Chip>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          {seeded > 0 && (
            <Fold
              className="border-dashed"
              title={<>{days} 天的行程都排好了，其中 {seeded} 個是 AI 預排的</>}
            >
              排序照你們的人格和預算。可以拖曳換順序、刪掉，或用「AI 推薦」換別的。
            </Fold>
          )}

          {/* 進來先滑卡：把遊戲的能量接下去，而不是直接丟一張行程表 */}
          <AnimatePresence>
            {intro && !frozen && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <Card className="p-4" style={{ background: "#FFF3A6" }}>
                  <div className="flex items-start gap-3">
                    <Mascot size={62} bg={false} float={false} face="happy" />
                    <div className="min-w-0 flex-1">
                      <div className="tm-display text-xl leading-tight">先幫你們排好 {board.length} 個地點了</div>
                      <p className="mt-1 text-sm leading-relaxed">
                        再滑幾張看看？<span className="font-black">喜歡的右滑</span>，我幫你排進去。
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Btn className="w-full" onClick={() => {
                      planIntroSeen = true; setIntro(false);
                      const spot = planDays
                        .flatMap((d) => slotsForDay(d, board).map((sl) => ({ day: d.day, slot: sl })))
                        .find((x) => x.slot !== ALL_DAY_SLOT);
                      if (spot) { setDay(spot.day); setDeck({ ...spot, auto: true }); }
                    }}>
                      <Sparkles size={18} /> 開始滑卡
                    </Btn>
                    <Btn variant="ghost" className="w-full" onClick={() => { planIntroSeen = true; setIntro(false); }}>
                      直接看行程
                    </Btn>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="tm-noscroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {planDays.map((d) => {
              const count = board.filter((i) => i.day === d.day).length;
              const bad = slotsForDay(d, board).some((s) => hasWarn(slotReport(itemsOf(d.day, s), s)));
              return (
                <button
                  key={d.day}
                  type="button"
                  onClick={() => setDay(d.day)}
                  aria-pressed={day === d.day}
                  className={`relative shrink-0 rounded-xl border-[3px] border-[#1F2350] px-3 py-1.5 text-left ${day === d.day ? "bg-[#1F2350] text-white" : "bg-white"}`}
                >
                  <div className="text-xs font-black">{d.label}</div>
                  <div className="text-[10px] font-bold opacity-70">{d.note}・{count} 個</div>
                  {bad && <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border-2 border-[#1F2350] bg-[#E8453C] text-[9px] font-black text-white">!</span>}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={day} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18 }} className="space-y-3">
              {slotsForDay(dayDef, board).map((slot) => (
                <SlotCard
                  key={`${day}-${slot}`}
                  day={day}
                  slot={slot}
                  items={itemsOf(day, slot)}
                  authorOf={authorOf}
                  now={now}
                  persona={member?.persona}
                  readOnly={frozen}
                  onOpenDeck={() => setDeck({ day, slot })}
                  onReorder={(next) => handleReorder(day, slot, next)}
                  onRemove={onRemove}
                  onFix={(issue) => handleFix(day, slot, issue)}
                  onTidy={() => {
                    const items = itemsOf(day, slot);
                    const before = slotReport(items, slot);
                    const next = bestOrder(items);
                    onReorderSlot(day, slot, next);
                    const after = slotReport(next, slot);
                    toast(after.travel < before.travel
                      ? `AI 重排順序，交通時間從 ${before.travel} 分降到 ${after.travel} 分`
                      : "目前已經是最順的順序了");
                  }}
                />
              ))}
            </motion.div>
          </AnimatePresence>

          {/* 行程要先定版，之後的導出與方案才有意義 */}
          {voting && lockVote.blockedBy ? (
            /* 有人喊停：這才是「行程要有共識」真正成立的地方 */
            <Card className="p-4" style={{ background: "#FFE1D3" }}>
              <div className="flex items-start gap-3">
                <Avatar p={lockVote.blockedBy} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="tm-display text-xl leading-tight">{lockVote.blockedBy.name} 想再改一個地方</div>
                  <p className="mt-1 text-sm leading-relaxed">
                    定版提議先退回了，談攏再算網路。
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Btn className="w-full" onClick={() => { sfx("tap"); onCancelLock(); }}>
                  好，再調整一下
                </Btn>
                <Btn variant="ghost" className="w-full" onClick={() => { sfx("tap"); onProposeLock(); }}>
                  <Lock size={16} /> 再提議一次
                </Btn>
              </div>
            </Card>
          ) : voting ? (
            <Card className="p-4" style={{ background: "#ECE5FF" }}>
              <div className="tm-display text-xl leading-tight">
                等待隊友同意　{lockVote.agreed.length}／{session.players.length}
              </div>
              <p className="mt-1 text-sm leading-relaxed">全隊同意才會定版，等待期間行程先凍結。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {session.players.map((p) => {
                  const yes = lockVote.agreed.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-1.5 rounded-xl border-2 border-[#1F2350] px-2 py-1.5 ${yes ? "bg-[#E3F5EA]" : "bg-white/60"}`}
                    >
                      <Avatar p={p} size={24} />
                      <span className="text-xs font-bold">{p.isUser ? "你" : p.name}</span>
                      {yes
                        ? <Check size={14} strokeWidth={3.5} className="text-[#1F7A55]" />
                        : <ThinkingDots small />}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => { sfx("back"); onCancelLock(); }}
                className="mt-3 w-full rounded-xl border-2 border-dashed border-[#1F2350]/40 py-2 text-xs font-bold opacity-70"
              >
                取消提議，繼續調整行程
              </button>
            </Card>
          ) : !isLocked ? (
            <Card className="p-4" style={{ background: "#FFE0B8" }}>
              <div className="tm-display text-xl leading-tight">行程排好了嗎？先定版</div>
              <p className="mt-1 text-sm leading-relaxed">定版後才能導出圖片、算網路方案。</p>
              {diff?.changed && (
                <div className="mt-3 rounded-2xl border-2 border-[#1F2350] bg-white p-3">
                  <div className="text-xs font-black">和上一版的差異</div>
                  <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed">
                    {diff.added.length > 0 && <div className="text-[#1F7A55]">＋ 新增 {diff.added.length} 個：{diff.added.map((x) => x.name).join("、")}</div>}
                    {diff.removed.length > 0 && <div className="text-[#B8440E]">− 刪除 {diff.removed.length} 個：{diff.removed.map((x) => x.name).join("、")}</div>}
                    <div className="opacity-70">用量估算 {diff.wasGb}GB／日 → <span className="font-black">{diff.nowGb}GB／日</span></div>
                  </div>
                  {diff.overBought && (
                    <div className="mt-2 rounded-xl bg-[#FFE1D3] p-2 text-[11px] font-bold leading-relaxed text-[#B8440E]">
                      ⚠️ 你買的是「{diff.bought.name}」，但改完後估算 {diff.nowGb}GB／日，可能會天天降速。
                      重新定版後記得回去看方案，需要的話可以加購。
                    </div>
                  )}
                </div>
              )}
              <Btn className="mt-3 w-full" disabled={!board.length} onClick={onProposeLock}>
                <Lock size={18} /> {locked ? "重新提議定版" : "提議定版"}
              </Btn>
              <p className="mt-1.5 text-center text-[11px] font-bold opacity-55">送出後要全隊 {session.players.length} 人都同意才會定下來</p>
            </Card>
          ) : (
            <Card className="p-4" style={{ background: "#E3F5EA" }}>
              <div className="flex items-start gap-3">
                <Lock size={22} strokeWidth={2.6} className="mt-1 shrink-0 text-[#1F7A55]" />
                <div className="min-w-0 flex-1">
                  <div className="tm-display text-xl leading-tight">行程已定版　<span className="text-xs font-black text-[#1F7A55]">全隊 {session.players.length} 人同意</span></div>
                  <p className="mt-1 text-xs leading-relaxed opacity-75">
                    {new Date(locked.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    ・{locked.spots} 個地點・每人每天約 {locked.gbPerDay}GB
                  </p>
                  {locked.purchase && (
                    <p className="mt-1 text-xs font-black text-[#1F7A55]">
                      ✓ 已購買：{PLAN_BY_KEY[locked.purchase.planKey].name}（{CARRIER_BY_KEY[locked.purchase.carrier].name}）
                      {money(locked.purchase.price)}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Btn className="w-full" onClick={() => setSheet("export")}><ImageDown size={18} /> 導出行程圖片</Btn>
                <Btn variant="ghost" className="w-full" onClick={() => setSheet("plans")}>
                  <Wifi size={18} /> {locked.purchase ? "查看已買的方案" : "看網路方案建議"}
                </Btn>
              </div>
              <button
                type="button"
                onClick={() => { sfx("unlock"); return locked.purchase ? setUnlockAsk(true) : onUnlock(); }}
                className="mt-2 w-full rounded-xl border-2 border-dashed border-[#1F2350]/40 py-2 text-xs font-bold opacity-70"
              >
                <Unlock size={13} className="mr-1 inline" /> 解除定版來修改行程
              </button>
            </Card>
          )}
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-black">
              <Radio size={15} /> 隊伍動態
              <span className="ml-auto text-[10px] font-bold opacity-50">所有人同一份行程</span>
            </div>
            <div className="tm-noscroll max-h-[320px] space-y-2 overflow-y-auto">
              <AnimatePresence initial={false}>
                {feed.map((e) => {
                  const a = authorOf(e.by);
                  return (
                    <motion.div key={e.id} layout initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex gap-2 rounded-xl bg-[#FFF8EE] p-2">
                      {a.ai ? (
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1F2350] text-[10px] font-black text-white">AI</span>
                      ) : (
                        <Avatar p={a} size={24} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs leading-snug">{e.text}</div>
                        <div className="text-[10px] opacity-50">{timeAgo(e.at, now)}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {!feed.length && <div className="p-3 text-center text-xs opacity-50">還沒有人動過行程</div>}
            </div>
          </Card>

          <Fold tone="#FFFFFF" title="怎麼玩？（不看也能玩）">
            <p>· 拖曳握把或 ▲▼ 換順序，垃圾桶刪掉。</p>
            <p>· 點「AI 推薦」換地點，右滑加入、左滑跳過。</p>
            <p>· 滿意就按「定版」，才能導出圖片、算網路。</p>
          </Fold>
        </div>
      </div>

      <AnimatePresence>
        {deck && (
          <SwipeDeck
            key={`${deck.day}-${deck.slot}`}
            member={member}
            budget={session.budget}
            day={deck.day}
            slot={deck.slot}
            excludeIds={excludeIds}
            autoStart={deck.auto}
            onClose={() => setDeck(null)}
            onDone={finishDeck}
          />
        )}
        {review && (
          <ArrangeReview
            key="review"
            plan={review.plan}
            day={review.day}
            slot={review.slot}
            onClose={() => setReview(null)}
            onApply={applyEntries}
            onForceAll={() => applyEntries(review.plan.map((p) => ({ poi: p.poi, day: review.day, slot: review.slot, forced: true })))}
          />
        )}
        {alert && <AiAlert key="alert" data={alert} onClose={() => setAlert(null)} />}
        {unlockAsk && (
          <AiAlert
            key="unlock"
            data={{
              title: "已經買好網路了，確定要改行程？",
              body: `你買的「${PLAN_BY_KEY[locked.purchase.planKey].name}」是照 ${locked.gbPerDay}GB／日 算的，改完要回來重新定版。`,
              tip: "eSIM 售出後不接受個人因素退換貨。",
              primary: { label: "我知道，解除定版", run: onUnlock },
              secondaryLabel: "先不要改",
            }}
            onClose={() => setUnlockAsk(false)}
          />
        )}
        {sheet === "export" && (
          <ExportSheet
            key="export"
            session={session}
            board={board}
            analysis={analysis}
            toast={toast}
            onClose={() => setSheet(null)}
            onSeePlans={() => setSheet("plans")}
          />
        )}
        {sheet === "plans" && (
          <NetworkPlanSheet
            key="plans"
            session={session}
            board={board}
            analysis={analysis}
            locked={locked}
            onPurchase={onPurchase}
            toast={toast}
            onClose={() => setSheet(null)}
            onExport={() => setTimeout(() => setSheet("export"), 260)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ==================================================================
 * 11. App：SETUP → GAME → SUMMARY → PLAN
 * ================================================================== */
export default function App() {
  const [phase, setPhase] = useState("SETUP");
  const [session, setSession] = useState(null);
  const [roundIdx, setRoundIdx] = useState(0);
  const [nodeIdx, setNodeIdx] = useState(0);
  const [history, setHistory] = useState([]);
  const [modal, setModal] = useState(null);
  const [transition, setTransition] = useState(null);
  const [opening, setOpening] = useState(null);
  const [banner, setBanner] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [vnLog, setVnLog] = useState([]); // 視覺小說的 LOG：整趟講過的話
  const [sfxOn, setSfxOn] = useState(true);
  const [bgmOn, setBgmOn] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [board, setBoard] = useState([]);
  const [feed, setFeed] = useState([]);
  // 定版快照：行程定下來之後才算網路方案，否則「買的夠不夠用」永遠沒有答案
  const [locked, setLocked] = useState(null);
  // 定版提議：行程是大家的，所以要全隊同意才鎖得起來
  const [lockVote, setLockVote] = useState(null);
  // 使用者正開著滑卡／方案單／對話框時，隊友也先別動，不然會在背後抽換
  const [planBusy, setPlanBusy] = useState(false);
  const lockTriesRef = useRef(0);
  const pendingRef = useRef(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  const toast = useCallback((msg) => setToastMsg({ msg, id: Date.now() }), []);

  useEffect(() => {
    if (!toastMsg) return undefined;
    const t = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => {
    if (!banner) return undefined;
    const t = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [phase, roundIdx]);

  // 答題的 4 回合換成比較急的曲子，其餘畫面回到平穩的版本
  useEffect(() => {
    AudioEngine.setMood(phase === "GAME" ? "game" : "calm");
  }, [phase]);

  const pushLog = useCallback((entry) => {
    setVnLog((l) => (l.some((x) => x.id === entry.id) ? l : [...l, entry]));
  }, []);

  const pushFeed = useCallback((by, text) => {
    setFeed((f) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, by, text, at: Date.now() }, ...f].slice(0, 30));
  }, []);

  const start = useCallback((setup) => {
    setSession({ ...setup, lagged: false });
    setHistory([]);
    setRoundIdx(0);
    setNodeIdx(0);
    setBoard([]);
    setFeed([]);
    setLocked(null);
    setVnLog([]);
    setBanner(`出發：${MAP_NODES[0].name}，當前氣溫 ${MAP_NODES[0].temp}`);
    setPhase("GAME");
    // 開場動畫蓋在遊戲畫面上，播完才露出第 1 題
    setOpening({ ...setup });
  }, []);

  const handleSubmit = useCallback((results) => {
    // 第 2 站是網路決定勝負的一刻，每個人都要經歷，只是結局不同：
    // 選了 eSIM 的人搶到整理券，其他人看著它被搶完。
    const netMoment = roundIdx === 1;
    const lost = session.network !== "esim";
    pendingRef.current = { results };
    if (netMoment) {
      if (lost) setSession((s) => ({ ...s, lagged: true }));
      setModal({ type: "lag" });
    } else {
      setModal({ type: "hint", results, hint: buildHint(roundIdx, results, { lagged: session.lagged, budget: session.budget }) });
    }
  }, [roundIdx, session]);

  const afterLag = useCallback(() => {
    const { results } = pendingRef.current;
    setModal({
      type: "hint",
      results,
      hint: buildHint(roundIdx, results, { lagged: session.network !== "esim", won: session.network === "esim", budget: session.budget }),
    });
  }, [roundIdx, session]);

  const goNextStation = useCallback(() => {
    const nextNode = Math.min(nodeIdx + 1, MAP_NODES.length - 1);
    const last = roundIdx >= ROUNDS.length - 1;
    // 轉場蓋住畫面的那 0.6 秒，才把底下的回合換掉，換題就不會閃一下
    setTransition({
      node: MAP_NODES[nextNode],
      roundNo: roundIdx + 2,
      total: ROUNDS.length,
      last,
      onMid: () => {
        setNodeIdx(nextNode);
        setMapOpen(false);
        setBanner(`已抵達：${MAP_NODES[nextNode].name}，當前氣溫 ${MAP_NODES[nextNode].temp}`);
        if (!last) setRoundIdx((i) => i + 1);
      },
      onDone: () => {
        setTransition(null);
        if (last) setPhase("SUMMARY");
      },
    });
  }, [roundIdx, nodeIdx]);

  const closeHint = useCallback(() => {
    const { results } = pendingRef.current || {};
    setModal(null);
    if (!results) return;
    setHistory((h) => [...h.slice(0, roundIdx), { results }]);
    // 網路方案在第 1 站結束時才問：下一站就是搶整理券，
    // 這樣「選錯會卡」的後果是來自剛做的選擇，而不是六個畫面前的一題。
    if (roundIdx === 0 && !session?.network) {
      setTimeout(() => setModal({ type: "network" }), 260);
      return;
    }
    goNextStation();
  }, [roundIdx, session, goNextStation]);

  const pickNetwork = useCallback((key) => {
    setSession((st) => ({ ...st, network: key }));
    pushFeed("ai", `你選了「${NETWORKS.find((x) => x.key === key)?.name}」，明天 USJ 就知道差在哪了。`);
    setModal(null);
    setTimeout(goNextStation, 200);
  }, [pushFeed, goNextStation]);

  const restart = useCallback(() => {
    setPhase("SETUP");
    setSession(null);
    setHistory([]);
    setRoundIdx(0);
    setNodeIdx(0);
    setModal(null);
    setTransition(null);
    setOpening(null);
    setLockVote(null);
    setMapOpen(false);
    setBoard([]);
    setFeed([]);
    setLocked(null);
    setVnLog([]);
    pendingRef.current = null;
  }, []);

  // 即時默契：每答完一站重算一次，遊戲中就看得到自己選擇的後果
  const vibeNow = useMemo(() => (session ? liveVibe(session.players, history) : null), [session, history]);
  const vibePrevRef = useRef(null);
  const vibePrev = vibePrevRef.current;
  useEffect(() => { vibePrevRef.current = vibeNow; }, [vibeNow]);

  const analysis = useMemo(() => {
    if (!session || history.length < ROUNDS.length) return null;
    const seeds = Object.fromEntries(session.players.map((p) => [p.id, p.isUser ? session.seedPersona : p.type]));
    return analyzeTeam(session.players, history, seeds, session.days);
  }, [session, history]);

  /* ---------- 共享行程看板 ---------- */
  const goPlan = useCallback(() => {  // eslint-disable-line react-hooks/exhaustive-deps
    if (!boardRef.current.length && session) {
      const at = Date.now();
      const me = analysis?.members.find((m) => m.player.isUser);
      const seed = seedFullPlan(history, session.days, { persona: me?.persona, budget: session.budget, member: me });
      const counter = {};
      setBoard(seed.map((x, i) => {
        const key = `${x.day}-${x.slot}`;
        counter[key] = (counter[key] || 0);
        const order = counter[key];
        counter[key] += 1;
        return { ...x, uid: `seed-${i}`, by: "ai", at, order };
      }));
      setFeed([{ id: "seed", by: "ai", text: `依照你們 4 站的選擇，生成了完整行程共 ${seed.length} 個地點，每個時段都排好了。`, at }]);
    }
    setPhase("PLAN");
  }, [history, session, analysis]);

  const addPlanEntries = useCallback((entries, by = "me") => {
    if (!entries.length) return;
    const at = Date.now();
    const replaced = new Set(entries.flatMap((e) => e.replaces || []));
    const replacedNames = boardRef.current.filter((i) => replaced.has(i.uid)).map((i) => POI_BY_ID[i.poiId]?.name);
    setBoard((b) => {
      const next = b.filter((i) => !replaced.has(i.uid));
      entries.forEach((e, i) => {
        const order = next.filter((x) => x.day === e.day && x.slot === e.slot).length;
        next.push({ uid: `${at}-${i}-${e.poi.id}`, poiId: e.poi.id, day: e.day, slot: e.slot, by, at: at + i, order });
      });
      return next;
    });
    const who = by === "me" ? "你" : (session?.players.find((p) => p.id === by)?.name || "隊友");
    const first = entries[0];
    pushFeed(by, entries.length === 1
      ? `${who}把「${first.poi.name}」加進 Day ${first.day} ${first.slot}`
      : `${who}一次加了 ${entries.length} 個地點：${entries.map((e) => e.poi.name).join("、")}`);
    if (replacedNames.length) {
      pushFeed("ai", `AI 把原本預排的「${replacedNames.join("」「")}」換成了新選的地點。`);
    }
    const moved = entries.filter((e) => e.moved);
    if (moved.length) {
      pushFeed("ai", `AI 把 ${moved.map((e) => `「${e.poi.name}」移到 Day ${e.day} ${e.slot}`).join("、")}，理由是交通時間排不下。`);
    }
  }, [pushFeed, session]);

  const removePlanItem = useCallback((uid, by = "me") => {
    const item = boardRef.current.find((i) => i.uid === uid);
    setBoard((b) => b.filter((i) => i.uid !== uid));
    if (!item) return;
    const who = by === "me" ? "你" : (session?.players.find((p) => p.id === by)?.name || "隊友");
    pushFeed(by, `${who}把「${POI_BY_ID[item.poiId]?.name}」從 Day ${item.day} ${item.slot} 移除`);
  }, [pushFeed, session]);

  /* ---------- 行程定版 ---------- */
  const lockPlan = useCallback(() => {
    if (!session) return;
    const needs = tripNetworkNeeds(boardRef.current, session, analysis);
    setLocked((prev) => ({
      at: Date.now(),
      items: boardRef.current.map((i) => ({ poiId: i.poiId, day: i.day, slot: i.slot })),
      gbPerDay: needs.gbPerDay,
      spots: needs.spots,
      purchase: prev?.purchase || null, // 已買過就沿用，只是行程重新定版
    }));
    sfx("lock");
    pushFeed("ai", `行程已定版：${needs.spots} 個地點，每人每天約 ${needs.gbPerDay}GB。`);
    toast("全隊都同意了，行程已定版");
  }, [session, analysis, pushFeed, toast]);

  const proposeLock = useCallback(() => {
    if (!session || !boardRef.current.length) return;
    lockTriesRef.current += 1;
    setLockVote({ at: Date.now(), by: "me", agreed: ["me"], round: lockTriesRef.current });
    pushFeed("me", "你提議把這份行程定版，等大家點同意。");
    toast("已送出定版提議，行程先凍結");
  }, [session, pushFeed, toast]);

  const cancelLock = useCallback(() => {
    setLockVote(null);
    pushFeed("me", "你取消了定版提議，行程可以繼續改。");
    toast("已取消定版提議");
  }, [pushFeed, toast]);

  // 隊友陸續按同意（Mock）。用 voteAt 當這一輪投票的識別，重開一輪才會重跑
  const voteAt = lockVote?.at || 0;
  useEffect(() => {
    if (!voteAt || !session) return undefined;
    const mates = session.players.filter((p) => !p.isUser);
    if (!mates.length) return undefined;
    // 第一次提議有機會被退回：有人想再改。沒有這個，「要有共識」只是個儀式。
    const holdout = (lockVote.round || 1) === 1 && Math.random() < 0.55
      ? mates[Math.floor(Math.random() * mates.length)]
      : null;
    let acc = 900;
    const timers = [];
    mates.forEach((m) => {
      acc += 600 + Math.random() * 1000;
      if (holdout && m.id === holdout.id) {
        const at = acc;
        timers.push(setTimeout(() => {
          sfx("warn");
          setLockVote((v) => (v && v.at === voteAt ? { ...v, blockedBy: m } : v));
          pushFeed(m.id, `${m.name}：等等，我想再改一個地方`);
          toast(`${m.name} 想再調整一下，定版先暫停`);
        }, at));
        return;
      }
      timers.push(setTimeout(() => {
        sfx("select");
        setLockVote((v) => (v && v.at === voteAt && !v.blockedBy && !v.agreed.includes(m.id)
          ? { ...v, agreed: [...v.agreed, m.id] }
          : v));
        pushFeed(m.id, `${m.name} 同意定版`);
      }, acc));
    });
    return () => timers.forEach(clearTimeout);
  }, [voteAt, session, pushFeed, toast]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 全員到齊才真的鎖定
  useEffect(() => {
    if (!lockVote || !session || lockVote.blockedBy) return undefined;
    if (lockVote.agreed.length < session.players.length) return undefined;
    const t = setTimeout(() => { lockPlan(); setLockVote(null); }, 700);
    return () => clearTimeout(t);
  }, [lockVote, session, lockPlan]);

  const unlockPlan = useCallback(() => {
    setLocked((prev) => (prev ? { ...prev, unlockedAt: Date.now() } : prev));
    setLockVote(null);
    toast("已解除定版，可以繼續調整行程");
  }, [toast]);

  const recordPurchase = useCallback((purchase) => {
    setLocked((prev) => (prev ? { ...prev, purchase } : prev));
  }, []);

  const reorderSlot = useCallback((day, slot, ordered) => {
    setBoard((b) => b.map((i) => {
      if (i.day !== day || i.slot !== slot) return i;
      const idx = ordered.findIndex((o) => o.uid === i.uid);
      return idx >= 0 ? { ...i, order: idx } : i;
    }));
  }, []);

  const moveItem = useCallback((uid, day, slot) => {
    const item = boardRef.current.find((i) => i.uid === uid);
    if (!item) return;
    const order = boardRef.current.filter((i) => i.day === day && i.slot === slot).length;
    setBoard((b) => b.map((i) => (i.uid === uid ? { ...i, day, slot, order, at: Date.now() } : i)));
    pushFeed("ai", `AI 把「${POI_BY_ID[item.poiId]?.name}」從 Day ${item.day} ${item.slot} 調到 Day ${day} ${slot}`);
    toast(`已搬到 Day ${day} ${slot}`);
  }, [pushFeed, toast]);

  const handleUserAdd = useCallback((entries) => {
    addPlanEntries(entries, "me");
    const mates = session?.players.filter((p) => !p.isUser) || [];
    if (mates.length) {
      const mate = mates[Math.floor(Math.random() * mates.length)];
      setTimeout(() => pushFeed(mate.id, `${mate.name} 看到你的修改，按了個讚`), 2600);
    }
  }, [addPlanEntries, pushFeed, session]);

  // 隊友的即時修改（Mock WebSocket 廣播）
  // 定版中或正在投票時必須停手，否則「定下來的行程」根本定不住，
  // 已經算好的網路用量也會對不上。
  const planFrozen = (Boolean(locked) && !locked.unlockedAt) || Boolean(lockVote) || planBusy;
  useEffect(() => {
    if (phase !== "PLAN" || !session || planFrozen) return undefined;
    const mates = session.players.filter((p) => !p.isUser);
    if (!mates.length) return undefined;
    const planDays = buildPlanDays(session.days);
    const id = setInterval(() => {
      const mate = mates[Math.floor(Math.random() * mates.length)];
      const current = boardRef.current;
      const theirs = current.filter((i) => i.by === mate.id);
      if (theirs.length && Math.random() < 0.3) {
        const victim = theirs[Math.floor(Math.random() * theirs.length)];
        removePlanItem(victim.uid, mate.id);
        return;
      }
      const used = new Set(current.map((i) => i.poiId));
      const [poi] = recommend(initTagWeights(null, []), used, 1);
      if (!poi) return;
      // 隊友也會挑排得下的時段
      const alt = suggestSlot(current, poi, session.days, null);
      const fallbackDay = planDays[Math.min(1, planDays.length - 1)];
      const target = alt || { day: fallbackDay.day, slot: fallbackDay.slots[0] };
      addPlanEntries([{ poi, day: target.day, slot: target.slot }], mate.id);
      toast(`${mate.name} 把「${poi.name}」加進 Day ${target.day} ${target.slot}`);
    }, 12000);
    return () => clearInterval(id);
  }, [phase, session, planFrozen, addPlanEntries, removePlanItem, toast]);

  const wide = phase === "SUMMARY" || phase === "PLAN";

  return (
    <MotionConfig reducedMotion="user">
      <style>{GLOBAL_CSS + VN_CSS}</style>
      <div
        className="tm-root min-h-[100dvh] text-[#1F2350]"
        style={{
          backgroundColor: PAGE,
          backgroundImage: `radial-gradient(${INK}14 1.2px, transparent 1.3px)`,
          backgroundSize: "18px 18px",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div className={`mx-auto w-full px-4 ${wide || phase === "GAME" ? "max-w-5xl" : "max-w-md"}`}>
          {/* 手機只有 390px 寬，所以整列強制不換行，次要資訊在窄螢幕先收起來 */}
          <header className="flex flex-nowrap items-center justify-between gap-2 py-3">
            <div className="flex shrink-0 items-center gap-2">
              <span className="tm-display grid h-10 w-10 -rotate-6 place-items-center rounded-xl border-[3px] border-[#1F2350] bg-[#FF6B35] text-xl text-white shadow-[2px_2px_0_#1F2350]">趣</span>
              <span className="leading-none">
                <span className="tm-display block text-lg">去趣</span>
                <span className={`text-[11px] font-bold opacity-60 ${wide ? "hidden sm:block" : "block"}`}>TripMate</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <button
                type="button"
                aria-label={sfxOn ? "關閉音效" : "開啟音效"}
                aria-pressed={sfxOn}
                onClick={() => { const v = !sfxOn; setSfxOn(v); AudioEngine.setSfx(v); }}
                className={`grid h-7 w-7 place-items-center rounded-full border-2 border-[#1F2350] ${sfxOn ? "bg-[#1F2350] text-white" : "bg-white text-[#1F2350]/45"}`}
              >
                {sfxOn ? <Volume2 size={13} strokeWidth={2.6} /> : <VolumeX size={13} strokeWidth={2.6} />}
              </button>
              <button
                type="button"
                aria-label={bgmOn ? "關閉背景音樂" : "開啟背景音樂"}
                aria-pressed={bgmOn}
                onClick={() => { const v = !bgmOn; setBgmOn(v); AudioEngine.setBgm(v); if (v) sfx("pop"); }}
                className={`grid h-7 w-7 place-items-center rounded-full border-2 border-[#1F2350] ${bgmOn ? "bg-[#FF6B35] text-white" : "bg-white text-[#1F2350]/45"}`}
              >
                <Music size={13} strokeWidth={2.6} />
              </button>
              {wide && (
                <div className="flex shrink-0 overflow-hidden rounded-full border-2 border-[#1F2350]">
                  <button type="button" onClick={() => { sfx("tap"); setPhase("SUMMARY"); }} className={`px-2.5 py-1 text-[11px] font-bold ${phase === "SUMMARY" ? "bg-[#1F2350] text-white" : "bg-white"}`}>結算</button>
                  <button type="button" onClick={() => { sfx("tap"); goPlan(); }} className={`px-2.5 py-1 text-[11px] font-bold ${phase === "PLAN" ? "bg-[#1F2350] text-white" : "bg-white"}`}>排行程</button>
                </div>
              )}
              {session && phase !== "SETUP" && (
                <>
                  {/* 排行程／結算頁的橫向空間已經被分頁鈕吃掉，房號在窄螢幕先收起來 */}
                  {wide ? (
                    <span className="hidden sm:contents"><Chip className="tm-num shrink-0">房間 {session.code}</Chip></span>
                  ) : (
                    <Chip className="tm-num shrink-0">房間 {session.code}</Chip>
                  )}
                  {session.network && (
                    <Chip className="shrink-0">{session.network === "esim" ? <Wifi size={12} /> : <WifiOff size={12} />} {session.network === "esim" ? "5G" : "3G"}</Chip>
                  )}
                </>
              )}
            </div>
          </header>

          {phase === "SETUP" && <SetupScreen onStart={start} toast={toast} />}

          {phase === "GAME" && session && (
            <div className="pb-4">
              {/* 換站時整個舞台換掉（轉場動畫蓋住的那 0.6 秒），背景、立繪、對白一起重來 */}
              <VNStage
                key={roundIdx}
                roundIdx={roundIdx}
                players={session.players}
                profile={session}
                onSubmit={handleSubmit}
                ready={!opening && !transition}
                vibe={vibeNow}
                vibePrev={vibePrev}
                onOpenMap={() => setMapOpen(true)}
                log={vnLog}
                onLog={pushLog}
              />
            </div>
          )}

          {phase === "SUMMARY" && session && analysis && (
            <SummaryScreen session={session} history={history} analysis={analysis} onRestart={restart} onPlan={goPlan} toast={toast} />
          )}

          {phase === "PLAN" && session && (
            <PlanScreen
              session={session}
              analysis={analysis}
              board={board}
              feed={feed}
              onAdd={handleUserAdd}
              onRemove={(uid) => removePlanItem(uid, "me")}
              onReorderSlot={reorderSlot}
              onMoveItem={moveItem}
              onBack={() => setPhase("SUMMARY")}
              locked={locked}
              lockVote={lockVote}
              onProposeLock={proposeLock}
              onCancelLock={cancelLock}
              onBusyChange={setPlanBusy}
              onUnlock={unlockPlan}
              onPurchase={recordPurchase}
              toast={toast}
            />
          )}
        </div>

        <AnimatePresence>
          {modal?.type === "lag" && <LagModal key="lag" network={session.network} onDone={afterLag} />}
          {modal?.type === "hint" && <HintModal key="hint" roundIdx={roundIdx} results={modal.results} hint={modal.hint} seed={session.seedPersona} onClose={closeHint} />}
          {modal?.type === "network" && <NetworkAsk key="network" days={session.days || 5} onPick={pickNetwork} />}
        </AnimatePresence>

        {/* 大地圖：從舞台右上角打開 */}
        <AnimatePresence>
          {phase === "GAME" && session && mapOpen && (
            <motion.div
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[55] grid place-items-center bg-[#1F2350]/70 px-4"
              onClick={() => setMapOpen(false)}
            >
              <motion.div initial={{ scale: 0.9, y: 16 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <GameMap nodeIdx={nodeIdx} players={session.players} banner={banner} onClose={() => setMapOpen(false)} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {opening && <TripOpening key="opening" session={opening} onDone={() => setOpening(null)} />}
        </AnimatePresence>

        <AnimatePresence>
          {transition && (
            <StationTransition
              key={`tr-${transition.roundNo}`}
              node={transition.node}
              roundNo={transition.roundNo}
              total={transition.total}
              last={transition.last}
              onMid={transition.onMid}
              onDone={transition.onDone}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toastMsg && (
            <motion.div
              key={toastMsg.id}
              role="status"
              initial={{ y: 30, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="fixed inset-x-0 z-[60] mx-auto w-fit max-w-[92vw] rounded-2xl border-[3px] border-[#1F2350] bg-[#1F2350] px-4 py-2.5 text-center text-sm font-bold text-white shadow-[4px_4px_0_#FF6B35]"
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 96px)" }}
            >
              {toastMsg.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

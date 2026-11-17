export function playAlertSound(kind: 'reminder' | 'called'): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const tones =
      kind === 'called'
        ? [
            { freq: 880, start: 0, dur: 0.16 },
            { freq: 1174, start: 0.2, dur: 0.16 },
            { freq: 880, start: 0.42, dur: 0.22 },
          ]
        : [
            { freq: 659, start: 0, dur: 0.15 },
            { freq: 880, start: 0.18, dur: 0.22 },
          ];

    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'called' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.02);
    }
  } catch {
    // Audio playback blocked by autoplay policy before user gesture
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'called' ? [250, 120, 250, 120, 350] : [200, 100, 200]);
    }
  } catch {
    // Vibration not supported
  }
}

export function showBrowserNotification(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // Notification API unavailable
  }
}

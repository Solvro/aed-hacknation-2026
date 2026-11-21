"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** Lektor oparty o Web Speech API, czyta komunikaty jak prawdziwe AED. */
export function useSpeech(enabled: boolean) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => "speechSynthesis" in window,
    () => false,
  );

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "pl-PL";
      const voice = synth.getVoices().find((v) => v.lang.startsWith("pl"));
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      synth.speak(utterance);
    },
    [enabled, supported],
  );

  useEffect(() => {
    if (!enabled && supported) window.speechSynthesis.cancel();
  }, [enabled, supported]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  return { speak, supported };
}

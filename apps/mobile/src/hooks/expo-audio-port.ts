import { Audio } from 'expo-av';

import type { AudioPort, PermissionOutcome, RecordedAudio } from './audio-port.js';

/**
 * The expo-av implementation.
 *
 * ⚠️ NOT EXERCISED ON A DEVICE YET. The state machine above it is unit-tested
 * against the fake port; this adapter needs a real phone, a real microphone, and
 * a real child before it can be trusted.
 *
 * Recording settings are deliberately modest: a child's utterance is a few
 * seconds of speech, and higher fidelity costs upload time on a slow connection
 * for accuracy nobody gains.
 */
export interface ExpoAudioPortOptions {
  /**
   * Deletes a local file.
   *
   * Injected rather than imported so that DELETING A CHILD'S RECORDING never
   * depends on an optional package resolving. When it is absent the recording
   * still leaves the device on upload; what is lost is the belt-and-braces
   * cleanup of the cache copy, and that is a gap worth being explicit about
   * rather than a silent no-op hidden behind an import.
   */
  readonly deleteFile?: (uri: string) => Promise<void>;
}

export const createExpoAudioPort = (options: ExpoAudioPortOptions = {}): AudioPort => {
  let recording: Audio.Recording | undefined;
  let sound: Audio.Sound | undefined;

  return {
    requestPermission: async (): Promise<PermissionOutcome> => {
      const { granted } = await Audio.requestPermissionsAsync();
      return granted ? 'granted' : 'denied';
    },

    startRecording: async (): Promise<void> => {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const created = new Audio.Recording();
      await created.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
      await created.startAsync();
      recording = created;
    },

    stopRecording: async (): Promise<RecordedAudio | undefined> => {
      const current = recording;
      recording = undefined;
      if (!current) return undefined;

      await current.stopAndUnloadAsync();
      // The compiler types this as `string | null`; the lint rule’s view of the
      // module disagrees. Trusting the stricter of the two.
      const uri: string | null = current.getURI();
      if (uri === null) return undefined;

      const status = await current.getStatusAsync();
      return {
        uri,
        mimeType: uri.endsWith('.wav') ? 'audio/wav' : 'audio/mp4',
        // A typeof guard rather than `??`: the shipped typings and the lint
        // rule disagree about whether this can be absent.
        durationMs: typeof status.durationMillis === 'number' ? status.durationMillis : 0,
      };
    },

    discard: async (uri: string): Promise<void> => {
      // Best effort, and never fatal. A file that will not delete must not break
      // the child's turn — but it must be TRIED on every path, because a child's
      // voice sitting in a cache directory is the data the server refuses to keep.
      try {
        await options.deleteFile?.(uri);
      } catch {
        // Nothing useful to do, and nothing worth showing a child.
      }
    },

    play: async (source): Promise<void> => {
      await sound?.unloadAsync();
      const { sound: created } = await Audio.Sound.createAsync(
        { uri: source.uri, ...(source.headers ? { headers: source.headers } : {}) },
        { shouldPlay: true },
      );
      sound = created;
    },

    stopPlayback: async (): Promise<void> => {
      await sound?.stopAsync();
      await sound?.unloadAsync();
      sound = undefined;
    },
  };
};

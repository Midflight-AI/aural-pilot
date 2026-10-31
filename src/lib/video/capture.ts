import { VideoUploadQueue } from "./transport";

export const VIDEO_MIME = "video/webm;codecs=vp8,opus";
export function canCaptureVideo(): boolean {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(VIDEO_MIME) &&
    typeof indexedDB !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Owns only camera tracks. The existing audio recorder owns the shared mixed stream. */
export class WebcamCapture {
  private recorder: MediaRecorder;
  private startMs = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private maximumTimer: ReturnType<typeof setTimeout> | undefined;
  private stopTask: Promise<void> | undefined;
  private interrupted = false;
  constructor(
    readonly camera: MediaStream,
    mixedAudio: MediaStream,
    private queue: VideoUploadQueue,
    private onInterrupted: () => void,
    private onUploadError: () => void,
    private onUploadRecovered: () => void = () => {},
  ) {
    const videoTrack = camera.getVideoTracks()[0];
    const audioTrack = mixedAudio.getAudioTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live" || !audioTrack || audioTrack.readyState !== "live") throw new Error("tracks_unavailable");
    this.recorder = new MediaRecorder(new MediaStream([videoTrack, audioTrack]), {
      mimeType: VIDEO_MIME, videoBitsPerSecond: 1_250_000, audioBitsPerSecond: 96_000,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) void this.queue.append(event.data, performance.now() - this.startMs)
        .then(() => this.queue.drain()).then(() => { if (!this.stopTask) this.onUploadRecovered(); }).catch(() => this.onUploadError());
    };
    this.recorder.onerror = () => this.interrupt();
    this.recorder.onstop = () => { if (!this.stopTask) this.interrupt(); };
    videoTrack.addEventListener("ended", this.interrupt);
    audioTrack.addEventListener("ended", this.interrupt);
  }
  start(): void {
    this.startMs = performance.now();
    this.recorder.start(5000);
    this.timer = setInterval(() => { void this.queue.retry().then(() => { if (!this.stopTask) this.onUploadRecovered(); }).catch(() => this.onUploadError()); }, 5000);
    this.maximumTimer = setTimeout(this.interrupt, 30 * 60_000);
  }
  interrupt = (): void => {
    if (this.stopTask) return;
    this.interrupted = true;
    this.onInterrupted(); // Caller must stop the voice conversation immediately.
    void this.stop(true).catch(() => this.onUploadError());
  };
  stop(partial = false): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.interrupted ||= partial;
    clearInterval(this.timer);
    clearTimeout(this.maximumTimer);
    this.stopTask = (async () => {
      if (this.recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          this.recorder.addEventListener("stop", () => resolve(), { once: true });
          this.recorder.stop();
        });
      }
      // stop fires after final dataavailable; queue.seal waits for its durable write.
      await this.queue.seal(this.interrupted);
      await this.queue.retry();
    })().finally(() => {
      this.camera.getTracks().forEach(track => track.stop());
    });
    return this.stopTask;
  }
}

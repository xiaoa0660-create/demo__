'use client';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, LoaderCircle, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { api, useApp } from './app-provider';

export function VoiceRecorder({
  ensureSession,
  onTranscript,
  disabled = false,
}: {
  ensureSession: () => Promise<string>;
  onTranscript: (item: { id: string; text: string }) => void;
  disabled?: boolean;
}) {
  const { data, setRecording } = useApp();
  const [state, setState] = useState<
    'idle' | 'requesting' | 'recording' | 'paused' | 'stopped' | 'uploading'
  >('idle');
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const chunks = useRef<Blob[]>([]);
  const active = useRef(true);
  const startedAt = useRef(0);
  const total = useRef(0);
  const sessionId = useRef('');
  const key = useRef('');
  const max = data?.capabilities.max_audio_seconds || 300;
  const stop = () => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      if (recorder.current.state === 'recording')
        total.current += performance.now() - startedAt.current;
      recorder.current.stop();
    }
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (recorder.current?.state !== 'inactive') recorder.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(frame.current);
      void audioContext.current?.close().catch(() => {});
      setRecording(false);
    };
  }, [setRecording]);
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      const duration = total.current + performance.now() - startedAt.current;
      setElapsed(Math.floor(duration / 1000));
      if (duration >= max * 1000) stop();
    }, 200);
    return () => clearInterval(timer);
  }, [state, max]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && recorder.current?.state === 'recording') {
        recorder.current.pause();
        total.current += performance.now() - startedAt.current;
        setState('paused');
        setVolume(0);
        setError('切换后台可能中断录音，已暂停。返回后可以继续或结束。');
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (['recording', 'paused', 'stopped'].includes(state)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', unload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', unload);
    };
  }, [state]);
  async function start() {
    setError('');
    setState('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error('UNSUPPORTED');
      sessionId.current = await ensureSession();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!active.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const capture = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = capture;
      chunks.current = [];
      total.current = 0;
      startedAt.current = performance.now();
      setElapsed(0);
      setBlob(null);
      key.current = crypto.randomUUID();
      capture.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      capture.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(frame.current);
        void audioContext.current?.close().catch(() => {});
        setRecording(false);
        if (!active.current) return;
        setBlob(new Blob(chunks.current, { type: capture.mimeType || 'audio/webm' }));
        setElapsed(Math.floor(total.current / 1000));
        setVolume(0);
        setState('stopped');
      };
      capture.onerror = () => {
        setError('录音发生中断，可以重新录制，或改用下方文字输入。');
        stop();
      };
      capture.start(250);
      setState('recording');
      setRecording(true);
      try {
        const context = new AudioContext();
        audioContext.current = context;
        await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(media).connect(analyser);
        const values = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          if (capture.state === 'inactive') return;
          analyser.getByteFrequencyData(values);
          setVolume(
            capture.state === 'recording'
              ? values.reduce((a, b) => a + b, 0) / values.length / 128
              : 0,
          );
          frame.current = requestAnimationFrame(update);
        };
        update();
      } catch {
        /* Recording still works when an audio meter is unavailable. */
      }
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setState('idle');
      setRecording(false);
      const name = (e as Error).name;
      setError(
        name === 'NotAllowedError'
          ? '麦克风权限未开启。可以在浏览器设置中允许访问，也可以直接用下方文字输入。'
          : name === 'NotFoundError'
            ? '没有找到麦克风。可以先用文字练习。'
            : (e as Error).message === 'UNSUPPORTED'
              ? '此浏览器或连接不支持录音，请使用 HTTPS，或用下方文字练习。'
              : (e as Error).message,
      );
    }
  }
  function pause() {
    if (recorder.current?.state === 'recording') {
      recorder.current.pause();
      total.current += performance.now() - startedAt.current;
      setState('paused');
      setVolume(0);
    } else if (recorder.current?.state === 'paused') {
      startedAt.current = performance.now();
      recorder.current.resume();
      setState('recording');
    }
  }
  async function upload() {
    if (!blob) return;
    setState('uploading');
    setError('');
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append('session_id', sessionId.current);
      form.append('idempotency_key', key.current);
      form.append('duration_ms', String(Math.round(total.current)));
      const result = await api<{ id: string; text: string }>('transcribe', 'POST', form);
      onTranscript(result);
      setBlob(null);
      setState('idle');
    } catch (e) {
      setError((e as Error).message);
      setState('stopped');
    }
  }
  const isLive = state === 'recording' || state === 'paused';
  return (
    <div className={`voice-recorder ${isLive ? 'live' : ''}`}>
      {state === 'idle' || state === 'requesting' ? (
        <>
          <button
            className="recorder-button"
            aria-label="开启麦克风录音"
            disabled={disabled || state === 'requesting'}
            onClick={() => void start()}
          >
            {state === 'requesting' ? (
              <LoaderCircle className="spin" size={28} />
            ) : (
              <Mic size={29} strokeWidth={1.6} />
            )}
          </button>
          <strong>{state === 'requesting' ? '正在等待麦克风权限…' : '准备好了，就说说看'}</strong>
          <p>点击后才会请求麦克风权限 · 最长 {Math.round(max / 60)} 分钟</p>
        </>
      ) : isLive ? (
        <>
          <div className="waveform" aria-label="麦克风实时音量">
            {Array.from({ length: 23 }, (_, i) => (
              <i key={i} style={{ height: `${6 + volume * (18 + ((i * 17) % 31))}px` }} />
            ))}
          </div>
          <div className="recording-time">
            <span className={state === 'recording' ? 'live-dot' : ''} />
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
            <small>{state === 'paused' ? '已暂停' : '正在倾听'}</small>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={pause}>
              {state === 'paused' ? <Play size={16} /> : <Pause size={16} />}
              {state === 'paused' ? '继续' : '暂停'}
            </button>
            <button className="button primary" onClick={stop}>
              <Square size={14} fill="currentColor" />
              结束录音
            </button>
          </div>
        </>
      ) : (
        <>
          <AudioLines size={27} className="orange-text" />
          <strong>
            {state === 'uploading' ? '正在转写，保留你的原话…' : '声音留下了，接着看看文字'}
          </strong>
          {url && <audio controls src={url} aria-label="回听本次录音" />}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={state === 'uploading'}
              onClick={() => {
                setBlob(null);
                setState('idle');
              }}
            >
              <RotateCcw size={15} />
              重录
            </button>
            <button
              className="button primary"
              disabled={state === 'uploading'}
              onClick={() => void upload()}
            >
              {state === 'uploading' && <LoaderCircle size={16} className="spin" />}转写为文字
            </button>
          </div>
        </>
      )}
      <span className="voice-privacy">录音仅用于转写，不长期保存。请避免录入第三方隐私。</span>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

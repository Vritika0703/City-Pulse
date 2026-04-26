import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:8000/ws/city-pulse';

export function useGeminiLive() {
  const [status, setStatus] = useState('disconnected');
  const [transcripts, setTranscripts] = useState([]);
  const [userTranscripts, setUserTranscripts] = useState([]);
  const [charts, setCharts] = useState(null);
  const [feed, setFeed] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const ws = useRef(null);
  const recognition = useRef(null);
  const reconnectTimer = useRef(null);
  const processingTimeout = useRef(null);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;
    setStatus('connecting');
    try {
      const socket = new WebSocket(WS_URL);
      ws.current = socket;
      socket.onopen = () => {
        setStatus('connected');
        setIsProcessing(false);
        setError(null);
      };
      socket.onclose = () => {
        setStatus('disconnected');
        setIsRecording(false);
        setIsProcessing(false);
        reconnectTimer.current = setTimeout(() => connect(), 3000);
      };
      socket.onerror = () => setError('Connection failed. Retrying...');
      socket.onmessage = async (event) => {
        if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
          try {
            if (!audioContext.current) return;
            const buf = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
            const i16 = new Int16Array(buf);
            const f32 = new Float32Array(i16.length);
            for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;
            const audioBuf = audioContext.current.createBuffer(1, f32.length, 24000);
            audioBuf.getChannelData(0).set(f32);
            const source = audioContext.current.createBufferSource();
            source.buffer = audioBuf;
            source.connect(audioContext.current.destination);
            const playTime = Math.max(audioContext.current.currentTime, nextPlayTime.current);
            source.start(playTime);
            nextPlayTime.current = playTime + audioBuf.duration;
          } catch (e) { console.warn('Audio error', e); }
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'turn_complete') {
            setIsProcessing(false);
            if (processingTimeout.current) clearTimeout(processingTimeout.current);
          } else if (msg.type === 'transcript') {
            setTranscripts(prev => {
              const now = Date.now();
              if (prev.length > 0 && now - prev[prev.length - 1].ts < 2000) {
                const upd = [...prev];
                upd[upd.length - 1] = { text: (upd[upd.length - 1].text || '') + msg.text, ts: now };
                return upd;
              }
              return [...prev, { text: msg.text, ts: now }];
            });
          } else if (msg.type === 'user_transcript') {
            setUserTranscripts(prev => [...prev, { text: msg.text, ts: Date.now() }]);
          } else if (msg.type === 'chart_data') {
            setCharts(msg.payload);
          }
        } catch (e) { }
      };
    } catch (e) { setStatus('disconnected'); }
  }, []);

  useEffect(() => {
    connect();

    // Initial fetch for live feed
    const fetchLatest = async () => {
      try {
        const res = await fetch('https://data.cityofnewyork.us/resource/erm2-nwe9.json?$order=created_date DESC&$limit=20');
        const data = await res.json();
        setFeed(data);
      } catch (e) { console.warn('Failed to fetch live feed', e); }
    };

    fetchLatest();
    const pollInterval = setInterval(fetchLatest, 30000); // Poll every 30s

    return () => {
      if (ws.current) ws.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      clearInterval(pollInterval);
    };
  }, [connect]);

  const sendText = useCallback((text) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'text', text }));
      setIsProcessing(true);
      setCharts(null); // Clear previous chart/stats data so it doesn't show stale numbers for non-data questions
      if (processingTimeout.current) clearTimeout(processingTimeout.current);
      processingTimeout.current = setTimeout(() => setIsProcessing(false), 30000);
    }
  }, []);

  const startRecording = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech Recognition not supported in this browser');
      return;
    }
    recognition.current = new SpeechRecognition();
    recognition.current.continuous = false;
    recognition.current.onresult = (event) => {
      const text = event.results[0][0].transcript;
      sendText(text);
    };
    recognition.current.onend = () => setIsRecording(false);
    recognition.current.onerror = () => setIsRecording(false);
    recognition.current.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognition.current) recognition.current.stop();
    setIsRecording(false);
  };

  const clearHistory = () => {
    setTranscripts([]);
    setUserTranscripts([]);
    setCharts(null);
    setIsProcessing(false);
  };

  return { status, transcripts, userTranscripts, charts, feed, isRecording, error, isProcessing, sendText, startRecording, stopRecording, clearHistory };
}

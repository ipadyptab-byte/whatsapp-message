import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SessionStatusEvent {
  sessionId: string;
  status: string;
  timestamp: string;
}

interface QRCodeEvent {
  sessionId: string;
  qrCode: string;
  timestamp: string;
}

interface MessageEvent {
  sessionId: string;
  message: Record<string, unknown>;
  timestamp: string;
}

interface WebSocketEvents {
  onSessionStatus?: (event: SessionStatusEvent) => void;
  onQRCode?: (event: QRCodeEvent) => void;
  onMessage?: (event: MessageEvent) => void;
}

// Use current origin for WebSocket - handle both root and /dashboard paths
const getSocketUrl = () => {
  const baseUrl = window.location.origin;
  return baseUrl.replace(/\/dashboard$/, '');
};

export function useWebSocket(events: WebSocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const eventsRef = useRef(events);
  
  // Keep eventsRef updated
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const apiKey = sessionStorage.getItem('openwa_api_key');

    if (!apiKey) {
      console.warn('[WebSocket] No API key found, skipping connection');
      return;
    }

    const socketUrl = getSocketUrl();

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    socketRef.current = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      transports: ['polling'],
      auth: { apiKey },
      extraHeaders: { 'X-API-Key': apiKey },
      query: { apiKey },
    });

    socketRef.current.on('connect', () => {
      console.log('[WebSocket] Connected successfully');
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
    });

    socketRef.current.on('connect_error', (error) => {
      reconnectAttemptsRef.current++;
      console.warn(`[WebSocket] Connection error (attempt ${reconnectAttemptsRef.current}):`, error.message);

      if (reconnectAttemptsRef.current > 10) {
        console.error('[WebSocket] Too many connection attempts, giving up');
        socketRef.current?.disconnect();
      }
    });

    // Handle 'message' event wrapper from server {type: 'event', payload: {event, sessionId, data}}
    socketRef.current.on('message', (msg: any) => {
      console.log('[WebSocket] Message received:', msg);
      
      if (msg && msg.type === 'event' && msg.payload) {
        const { event, sessionId, data } = msg.payload;
        console.log('[WebSocket] Event:', event, 'Session:', sessionId, 'Data:', data);
        
        if (event === 'session:qr' && eventsRef.current.onQRCode) {
          eventsRef.current.onQRCode({ sessionId, qrCode: data.qrCode, timestamp: msg.timestamp });
        } else if (event === 'session:status' && eventsRef.current.onSessionStatus) {
          eventsRef.current.onSessionStatus({ sessionId, status: data.status, timestamp: msg.timestamp });
        } else if (event === 'message:received' && eventsRef.current.onMessage) {
          eventsRef.current.onMessage({ sessionId, message: data, timestamp: msg.timestamp });
        }
      }
    });

    // Also listen for direct events (for simpler cases)
    socketRef.current.on('session:qr', (data: any) => {
      console.log('[WebSocket] Direct session:qr:', data);
      if (eventsRef.current.onQRCode) {
        eventsRef.current.onQRCode({ sessionId: data.sessionId, qrCode: data.qrCode, timestamp: data.timestamp || new Date().toISOString() });
      }
    });

    socketRef.current.on('session:status', (data: any) => {
      console.log('[WebSocket] Direct session:status:', data);
      if (eventsRef.current.onSessionStatus) {
        eventsRef.current.onSessionStatus({ sessionId: data.sessionId, status: data.status, timestamp: data.timestamp || new Date().toISOString() });
      }
    });

    socketRef.current.on('error', (error) => {
      console.error('[WebSocket] Error:', error);
    });
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected };
}

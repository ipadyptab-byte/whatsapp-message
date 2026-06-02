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
  // In production, we need to go to root since Socket.IO is at /socket.io
  // But dashboard is served at /dashboard
  const baseUrl = window.location.origin;
  // Remove /dashboard from path if present to get base URL
  return baseUrl.replace(/\/dashboard$/, '');
};

export function useWebSocket(events: WebSocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    // Get API key from sessionStorage (same as api.ts)
    const apiKey = sessionStorage.getItem('openwa_api_key');

    if (!apiKey) {
      console.warn('[WebSocket] No API key found, skipping connection');
      return;
    }

    const socketUrl = getSocketUrl();
    
    // Disconnect existing socket if any
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    // Connect to /events namespace (defined in events.gateway.ts)
    socketRef.current = io(`${socketUrl}/events`, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      transports: ['polling', 'websocket'], // Try polling first, then websocket
      auth: {
        apiKey,
      },
      extraHeaders: {
        'X-API-Key': apiKey,
      },
      query: {
        apiKey,
      },
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
      
      // Stop reconnecting after too many attempts
      if (reconnectAttemptsRef.current > 10) {
        console.error('[WebSocket] Too many connection attempts, giving up');
        socketRef.current?.disconnect();
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

  // Register event handlers
  useEffect(() => {
    if (!socketRef.current) return;

    const socket = socketRef.current;

    if (events.onSessionStatus) {
      socket.on('session:status', events.onSessionStatus);
    }

    if (events.onQRCode) {
      socket.on('session:qr', events.onQRCode);
    }

    if (events.onMessage) {
      socket.on('session:message', events.onMessage);
    }

    return () => {
      socket.off('session:status');
      socket.off('session:qr');
      socket.off('session:message');
    };
  }, [events.onSessionStatus, events.onQRCode, events.onMessage]);

  return { isConnected };
}

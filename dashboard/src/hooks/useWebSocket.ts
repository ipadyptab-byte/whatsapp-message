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

// Use current origin for WebSocket (goes through nginx proxy in Docker)
// Falls back to env var or localhost for development
const SOCKET_URL = import.meta.env.VITE_WS_URL || window.location.origin;

export function useWebSocket(events: WebSocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    // Get API key from localStorage or sessionStorage (same as api.ts)
    const apiKey = localStorage.getItem('openwa_api_key') || sessionStorage.getItem('openwa_api_key');

    if (!apiKey) {
      console.warn('[WebSocket] No API key found, skipping connection');
      return;
    }

    socketRef.current = io(`${SOCKET_URL}/events`, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
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
      console.log('[WebSocket] Connected');
      setIsConnected(true);
      // Subscribe to all session events
      socketRef.current?.emit('message', {
        type: 'subscribe',
        sessionId: '*',
        events: ['*'],
      });
    });

    socketRef.current.on('disconnect', () => {
      console.log('[WebSocket] Disconnected');
      setIsConnected(false);
    });

    socketRef.current.on('connect_error', error => {
      console.warn('[WebSocket] Connection error:', error.message);
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

    // Handle direct event channels
    if (events.onSessionStatus) {
      socket.on('session:status', events.onSessionStatus);
    }

    if (events.onQRCode) {
      socket.on('session:qr', events.onQRCode);
    }

    if (events.onMessage) {
      socket.on('session:message', events.onMessage);
    }

    // Handle room-based message events
    const handleGenericMessage = (msg: {
      type?: string;
      payload?: { event?: string; sessionId?: string; data?: Record<string, unknown> };
      timestamp?: string;
    }) => {
      if (msg?.type !== 'event' || !msg.payload) return;
      const { event, sessionId, data } = msg.payload;
      const timestamp = msg.timestamp || new Date().toISOString();

      if (event === 'session.status' && events.onSessionStatus) {
        events.onSessionStatus({
          sessionId: sessionId || '',
          status: (data?.status as string) || '',
          timestamp,
        });
      } else if (event === 'session.qr' && events.onQRCode) {
        events.onQRCode({
          sessionId: sessionId || '',
          qrCode: (data?.qrCode as string) || '',
          timestamp,
        });
      } else if (event === 'message.received' && events.onMessage) {
        events.onMessage({
          sessionId: sessionId || '',
          message: data || {},
          timestamp,
        });
      }
    };

    socket.on('message', handleGenericMessage);

    return () => {
      socket.off('session:status');
      socket.off('session:qr');
      socket.off('session:message');
      socket.off('message', handleGenericMessage);
    };
  }, [events.onSessionStatus, events.onQRCode, events.onMessage]);

  return { isConnected };
}

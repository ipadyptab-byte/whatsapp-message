import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Session, SessionStatus } from './entities/session.entity';
import { CreateSessionDto, UpdateSessionDto } from './dto';
import { EngineFactory } from '../../engine/engine.factory';
import { IWhatsAppEngine, EngineStatus } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';
import { EventsGateway } from '../events/events.gateway';
import { WebhookService } from '../webhook/webhook.service';
import { HookManager } from '../../core/hooks';

interface ReconnectState {
  attempts: number;
  timer: NodeJS.Timeout | null;
  maxAttempts: number;
  baseDelay: number;
}

@Injectable()
export class SessionService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = createLogger('SessionService');

  // In-memory map of active engine instances
  private engines: Map<string, IWhatsAppEngine> = new Map();

  // Reconnection state per session
  private reconnectStates: Map<string, ReconnectState> = new Map();

  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepository: Repository<Session>,
    @InjectDataSource('data')
    private readonly dataSource: DataSource,
    private readonly engineFactory: EngineFactory,
    private readonly eventsGateway: EventsGateway,
    private readonly webhookService: WebhookService,
    private readonly hookManager: HookManager,
  ) {}

  /**
   * On backend startup, preserve connected sessions and restore their engines.
   * Sessions that were connected remain READY unless explicitly disconnected by user.
   */
  async onModuleInit(): Promise<void> {
    const allSessions = await this.sessionRepository.find();

    for (const session of allSessions) {
      // If session was READY, or was previously connected (has phone number & connected timestamp)
      if (session.status === SessionStatus.READY || (session.phone && session.connectedAt)) {
        if (session.status !== SessionStatus.READY) {
          await this.sessionRepository.update(session.id, { status: SessionStatus.READY });
          this.eventsGateway.emitSessionStatus(session.id, SessionStatus.READY);
        }

        this.logger.log(`Preserving connected status for session ${session.name} (${session.id}) and resuming engine`, {
          sessionId: session.id,
          phone: session.phone,
          action: 'startup_auto_restore',
        });

        // Auto-restore engine in the background
        this.start(session.id).catch(err => {
          this.logger.warn(`Background engine restore for session ${session.name} deferred:`, {
            sessionId: session.id,
            error: String(err),
          });
        });
      }
    }

    // Clean up only transitional setup states (INITIALIZING, QR_READY, AUTHENTICATING)
    // where phone was never linked
    const transitionalUnlinked = allSessions.filter(
      s =>
        !s.phone &&
        [SessionStatus.INITIALIZING, SessionStatus.QR_READY, SessionStatus.AUTHENTICATING].includes(s.status),
    );

    for (const s of transitionalUnlinked) {
      await this.sessionRepository.update(s.id, { status: SessionStatus.CREATED });
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Clean up all engines on shutdown
    for (const [sessionId, engine] of this.engines) {
      this.logger.log(`Destroying engine for session ${sessionId}`, {
        sessionId,
        action: 'shutdown',
      });
      await engine.destroy();
    }
    this.engines.clear();

    // Clear all reconnect timers
    for (const [, state] of this.reconnectStates) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.reconnectStates.clear();
  }

  async create(dto: CreateSessionDto): Promise<Session> {
    // Check if session with same name exists
    const existing = await this.sessionRepository.findOne({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException(`Session with name '${dto.name}' already exists`);
    }

    const session = this.sessionRepository.create({
      name: dto.name,
      config: dto.config || {},
      proxyUrl: dto.proxyUrl || null,
      proxyType: dto.proxyType || null,
      status: SessionStatus.CREATED,
    });

    const saved = await this.dataSource.transaction(async manager => {
      return await manager.save(session);
    });
    this.logger.log(`Session created: ${saved.name}`, {
      sessionId: saved.id,
      action: 'create',
    });

    // Execute hook after session created (outside transaction since hooks do external I/O)
    await this.hookManager.execute('session:created', saved, {
      sessionId: saved.id,
      source: 'SessionService',
    });

    return saved;
  }

  async findAll(): Promise<Session[]> {
    return this.sessionRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Session> {
    const session = await this.sessionRepository.findOne({ where: { id } });
    if (!session) {
      throw new NotFoundException(`Session with id '${id}' not found`);
    }
    return session;
  }

  async findByName(name: string): Promise<Session> {
    const session = await this.sessionRepository.findOne({ where: { name } });
    if (!session) {
      throw new NotFoundException(`Session with name '${name}' not found`);
    }
    return session;
  }

  async delete(id: string): Promise<void> {
    const session = await this.findOne(id);

    // Cancel any reconnection attempts
    this.cancelReconnect(id);

    // Stop engine if running
    const engine = this.engines.get(id);
    if (engine) {
      await engine.destroy();
      this.engines.delete(id);
    }

    // Execute hook BEFORE delete so plugins can access session data
    await this.hookManager.execute(
      'session:deleted',
      {
        id: session.id,
        name: session.name,
        phone: session.phone,
        pushName: session.pushName,
      },
      {
        sessionId: id,
        source: 'SessionService',
      },
    );

    await this.dataSource.transaction(async manager => {
      await manager.remove(session);
    });
    this.logger.log(`Session deleted: ${session.name}`, {
      sessionId: id,
      action: 'delete',
    });
  }

  async start(id: string): Promise<Session> {
    const session = await this.findOne(id);

    const existingEngine = this.engines.get(id);
    if (existingEngine) {
      const status = typeof existingEngine.getStatus === 'function' ? existingEngine.getStatus() : EngineStatus.READY;
      if (status === EngineStatus.READY || status === EngineStatus.INITIALIZING || status === EngineStatus.AUTHENTICATING) {
        throw new BadRequestException(`Session '${session.name}' is already started`);
      }
      // If engine exists but is not ready or failed, destroy and recreate
      try {
        await existingEngine.destroy();
      } catch (err) {
        this.logger.warn(`Could not cleanly destroy existing engine for ${session.name}:`, String(err));
      }
      this.engines.delete(id);
    }

    // Execute hook before starting
    await this.hookManager.execute(
      'session:starting',
      { sessionId: id },
      {
        sessionId: id,
        source: 'SessionService',
      },
    );

    // Initialize reconnect state
    const config = session.config as {
      maxReconnectAttempts?: number;
      reconnectBaseDelay?: number;
    } | null;
    this.reconnectStates.set(id, {
      attempts: 0,
      timer: null,
      maxAttempts: config?.maxReconnectAttempts ?? 5,
      baseDelay: config?.reconnectBaseDelay ?? 5000,
    });

    // Mark as INITIALIZING immediately so UI updates and DB reflects state
    await this.updateStatus(id, SessionStatus.INITIALIZING);

    // Asynchronously initialize engine to prevent slow devices (e.g. Raspberry Pi)
    // from timing out or returning HTTP 500
    void this.initializeEngine(id, session).catch(err => {
      this.logger.error(`Failed to initialize engine for ${session.name}:`, String(err));
      void this.updateStatus(id, SessionStatus.FAILED, false);
    });

    return (await this.findOne(id)) ?? session;
  }

  private async initializeEngine(id: string, session: Session): Promise<void> {
    this.logger.log(`Initializing engine for session: ${session.name}`, {
      sessionId: id,
      action: 'engine_init',
      proxyEnabled: !!session.proxyUrl,
    });

    const engine = this.engineFactory.create({
      sessionId: session.name,
      proxyUrl: session.proxyUrl || undefined,
      proxyType: session.proxyType || undefined,
    });
    this.engines.set(id, engine);

    try {
      await engine.initialize({
        onQRCode: (qrCode: string): void => {
        this.logger.log('QR code generated', {
          sessionId: id,
          action: 'qr_generated',
        });

        // Execute hook for QR event
        void this.hookManager.execute(
          'session:qr',
          { sessionId: id, qrCode },
          {
            sessionId: id,
            source: 'Engine',
          },
        );

        // Emit real-time QR code event to connected WebSocket clients
        this.eventsGateway.emitQRCode(id, qrCode);

        void this.updateStatus(id, SessionStatus.QR_READY);
      },
      onReady: (phone: string, pushName: string): void => {
        this.logger.log(`Session ready: ${phone}`, {
          sessionId: id,
          phone,
          pushName,
          action: 'ready',
        });

        // Execute hook for ready event
        void this.hookManager.execute(
          'session:ready',
          { phone, pushName },
          {
            sessionId: id,
            source: 'Engine',
          },
        );

        // Reset reconnect attempts on successful connection
        const reconnectState = this.reconnectStates.get(id);
        if (reconnectState) {
          reconnectState.attempts = 0;
        }

        void this.sessionRepository.update(id, {
          status: SessionStatus.READY,
          phone,
          pushName,
          connectedAt: new Date(),
          lastActiveAt: new Date(),
        });
        this.eventsGateway.emitSessionStatus(id, SessionStatus.READY);
      },
      onMessage: (message): void => {
        this.logger.debug(`Message received from ${message.from}`, {
          sessionId: id,
          messageId: message.id,
          from: message.from,
          action: 'message_received',
        });
        // Update last active timestamp
        void this.sessionRepository.update(id, { lastActiveAt: new Date() });
        // Convert IncomingMessage to plain object for dispatch
        const messageData = { ...message };

        // Execute hook for message received - plugins can modify or stop processing
        void this.hookManager
          .execute('message:received', messageData, {
            sessionId: id,
            source: 'Engine',
          })
          .then(({ continue: shouldContinue, data: finalMessage }) => {
            if (!shouldContinue) {
              // Plugin stopped processing (e.g., auto-reply handled it)
              return;
            }

            // Dispatch to webhooks with potentially modified message
            void this.webhookService.dispatch(id, 'message.received', finalMessage);
            // Emit real-time event to WebSocket clients
            this.eventsGateway.emitMessage(id, finalMessage);
          });
      },
      onDisconnected: (reason: string): void => {
        this.logger.warn(`Session disconnected: ${reason}`, {
          sessionId: id,
          reason,
          action: 'disconnected',
        });

        // Execute hook for disconnected event
        void this.hookManager.execute(
          'session:disconnected',
          { reason },
          {
            sessionId: id,
            source: 'Engine',
          },
        );

        // Keep status as READY if it was connected, do not reset status
        void this.updateStatus(id, SessionStatus.DISCONNECTED, false);

        // Attempt to reconnect in background
        this.scheduleReconnect(id, session);
      },
      onStateChanged: (engineState: EngineStatus): void => {
        const statusMap: Record<EngineStatus, SessionStatus> = {
          [EngineStatus.DISCONNECTED]: SessionStatus.DISCONNECTED,
          [EngineStatus.INITIALIZING]: SessionStatus.INITIALIZING,
          [EngineStatus.QR_READY]: SessionStatus.QR_READY,
          [EngineStatus.AUTHENTICATING]: SessionStatus.AUTHENTICATING,
          [EngineStatus.READY]: SessionStatus.READY,
          [EngineStatus.FAILED]: SessionStatus.FAILED,
        };
        const newStatus = statusMap[engineState];
        if (newStatus) {
          void this.updateStatus(id, newStatus, false);
        }
      },
    });
    } catch (err) {
      this.engines.delete(id);
      throw err;
    }
  }

  private scheduleReconnect(id: string, session: Session): void {
    const state = this.reconnectStates.get(id);
    if (!state) return;

    // Exponential backoff capped at 30 seconds for persistent reconnection
    const delay = Math.min(state.baseDelay * Math.pow(1.5, Math.min(state.attempts, 6)) + Math.random() * 1000, 30000);
    state.attempts++;

    this.logger.log(
      `Scheduling reconnect attempt ${state.attempts} in ${Math.round(delay / 1000)}s for session: ${session.name}`,
      {
        sessionId: id,
        attempt: state.attempts,
        delayMs: delay,
        action: 'reconnect_scheduled',
      },
    );

    state.timer = setTimeout(() => {
      void this.executeReconnect(id, session, state);
    }, delay);
  }

  private async executeReconnect(id: string, session: Session, state: ReconnectState): Promise<void> {
    try {
      // Clean up old engine
      const oldEngine = this.engines.get(id);
      if (oldEngine) {
        await oldEngine.destroy();
        this.engines.delete(id);
      }

      // Re-initialize
      await this.initializeEngine(id, session);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Reconnect attempt ${state.attempts} failed`, errorMessage, {
        sessionId: id,
        action: 'reconnect_error',
      });
      // Schedule another attempt
      this.scheduleReconnect(id, session);
    }
  }

  private cancelReconnect(id: string): void {
    const state = this.reconnectStates.get(id);
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.reconnectStates.delete(id);
  }

  async stop(id: string): Promise<Session> {
    const session = await this.findOne(id);

    // Cancel any reconnection attempts
    this.cancelReconnect(id);

    const engine = this.engines.get(id);

    if (engine) {
      await engine.disconnect();
      this.engines.delete(id);
    }

    this.logger.log(`Session stopped: ${session.name}`, {
      sessionId: id,
      action: 'stop',
    });
    await this.updateStatus(id, SessionStatus.DISCONNECTED, true);
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateSessionDto): Promise<Session> {
    const session = await this.findOne(id);

    if (dto.name && dto.name !== session.name) {
      const existing = await this.sessionRepository.findOne({
        where: { name: dto.name },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Session with name '${dto.name}' already exists`);
      }
      session.name = dto.name;
    }

    if (dto.config) {
      session.config = { ...session.config, ...dto.config };
    }

    if (dto.proxyUrl !== undefined) {
      session.proxyUrl = dto.proxyUrl;
    }

    if (dto.proxyType !== undefined) {
      session.proxyType = dto.proxyType;
    }

    if (dto.status !== undefined && dto.status !== session.status) {
      if (dto.status === SessionStatus.DISCONNECTED) {
        await this.stop(id);
      } else {
        await this.updateStatus(id, dto.status, true);
        if (dto.status === SessionStatus.READY && !this.engines.has(id)) {
          this.start(id).catch(err => {
            this.logger.warn(`Failed to start engine after setting status to READY: ${err}`);
          });
        }
      }
    }

    await this.sessionRepository.save(session);
    return this.findOne(id);
  }

  async getQRCode(id: string): Promise<{ qrCode: string | null; status: SessionStatus }> {
    const session = await this.findOne(id);
    const engine = this.engines.get(id);

    if (!engine) {
      throw new BadRequestException('Session is not started. Call POST /sessions/:id/start first.');
    }

    const qrCode = engine.getQRCode();

    if (!qrCode && session.status === SessionStatus.READY) {
      throw new BadRequestException('Session is already authenticated, no QR code needed');
    }

    return {
      qrCode: qrCode || null,
      status: session.status,
    };
  }

  getEngine(id: string): IWhatsAppEngine | undefined {
    return this.engines.get(id);
  }

  async getGroups(id: string): Promise<{ id: string; name: string }[]> {
    await this.findOne(id); // Verify session exists
    const engine = this.engines.get(id);

    if (!engine || engine.getStatus() !== EngineStatus.READY) {
      return [];
    }

    try {
      const groups = await engine.getGroups();
      return groups.map(g => ({
        id: g.id,
        name: g.name,
      }));
    } catch (err) {
      this.logger.warn(`Could not fetch groups for session ${id}: ${String(err)}`);
      return [];
    }
  }

  private async updateStatus(id: string, status: SessionStatus, force: boolean = false): Promise<void> {
    const current = await this.sessionRepository.findOne({ where: { id } });
    if (!current) return;

    // Rule: "if its connected then until i disconnect it should be connected"
    // Never change status away from READY unless user explicitly disconnects (force = true)
    if (current.status === SessionStatus.READY && status !== SessionStatus.READY && !force) {
      this.logger.log(
        `Preserving READY status for session ${current.name} (${id}) - suppressed automatic change to ${status}`,
        {
          sessionId: id,
          currentStatus: current.status,
          suppressedStatus: status,
        },
      );
      return;
    }

    await this.sessionRepository.update(id, { status });
    this.logger.debug(`Session status updated to ${status}`, {
      sessionId: id,
      status,
      action: 'status_update',
    });
    // Emit real-time event to connected WebSocket clients
    this.eventsGateway.emitSessionStatus(id, status);
  }

  /**
   * Get overall session statistics for multi-session monitoring
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    ready: number;
    disconnected: number;
    byStatus: Record<string, number>;
    memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
  }> {
    const sessions = await this.findAll();
    const byStatus: Record<string, number> = {};

    for (const session of sessions) {
      byStatus[session.status] = (byStatus[session.status] || 0) + 1;
    }

    const memory = process.memoryUsage();

    return {
      total: sessions.length,
      active: this.engines.size,
      ready: byStatus[SessionStatus.READY] || 0,
      disconnected: byStatus[SessionStatus.DISCONNECTED] || 0,
      byStatus,
      memoryUsage: {
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        rss: Math.round(memory.rss / 1024 / 1024),
      },
    };
  }

  /**
   * Get count of currently active (running) sessions
   */
  getActiveCount(): number {
    return this.engines.size;
  }

  /**
   * Check if session is currently active (engine running)
   */
  isActive(id: string): boolean {
    return this.engines.has(id);
  }
}

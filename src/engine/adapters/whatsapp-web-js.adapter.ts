import { EventEmitter } from 'events';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  IWhatsAppEngine,
  EngineStatus,
  EngineEventCallbacks,
  MessageResult,
  MediaInput,
  IncomingMessage,
  Contact,
  Group,
  GroupInfo,
  GroupParticipant,
  LocationInput,
  ContactCard,
  MessageReaction,
  Label,
  Channel,
  ChannelMessage,
  Status,
  TextStatusOptions,
  StatusResult,
  Catalog,
  Product,
  ProductQueryOptions,
  PaginatedProducts,
} from '../interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';
import {
  GroupChat,
  MessageWithReactions,
  BusinessClient,
  WwjsChannelData,
  GroupCreateResult,
} from '../types/whatsapp-web-js.types';

export interface WhatsAppWebJsConfig {
  sessionId: string;
  sessionDataPath: string;
  puppeteer?: {
    headless?: boolean;
    args?: string[];
    executablePath?: string;
  };
  // Phase 3: Proxy per session
  proxy?: {
    url: string;
    type: 'http' | 'https' | 'socks4' | 'socks5';
  };
}

export class WhatsAppWebJsAdapter extends EventEmitter implements IWhatsAppEngine {
  private client: Client | null = null;
  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private qrCode: string | null = null;
  private phoneNumber: string | null = null;
  private pushName: string | null = null;
  private callbacks: EngineEventCallbacks = {};

  constructor(private readonly config: WhatsAppWebJsConfig) {
    super();
  }

  private readonly logger = createLogger('WhatsAppWebJsAdapter');

  async initialize(callbacks: EngineEventCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.setStatus(EngineStatus.INITIALIZING);

    try {
      // Build puppeteer args, including proxy if configured
      const puppeteerArgs = this.config.puppeteer?.args || [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
      ];

      // Add proxy configuration if provided
      if (this.config.proxy) {
        puppeteerArgs.push(`--proxy-server=${this.config.proxy.url}`);
        this.logger.log(
          `Using proxy: ${this.config.proxy.type}://${this.config.proxy.url.replace(/:[^:@]*@/, ':***@')}`,
        );
      }

      // Clean up any stale singleton lock files from previous unexpected exits
      const sessionDir = path.resolve(this.config.sessionDataPath, `session-${this.config.sessionId}`);
      try {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        for (const file of lockFiles) {
          const filePath = path.join(sessionDir, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            this.logger.log(`Cleaned up stale lock file: ${filePath}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Could not clean up stale singleton locks: ${String(err)}`);
      }

      // Resolve Chromium executable path for ARM / Raspberry Pi or custom installations
      let chromiumBinary: string | undefined =
        this.config.puppeteer?.executablePath || process.env.PUPPETEER_EXECUTABLE_PATH;

      if (!chromiumBinary || !fs.existsSync(chromiumBinary)) {
        const candidatePaths = [
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/lib/chromium-browser/chromium-browser',
          '/usr/lib/chromium/chromium',
          '/snap/bin/chromium',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
        ];
        for (const candidate of candidatePaths) {
          if (fs.existsSync(candidate)) {
            chromiumBinary = candidate;
            break;
          }
        }
      }

      if (!chromiumBinary && process.platform === 'linux') {
        try {
          const whichOutput = execSync('which chromium-browser || which chromium || which google-chrome', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          if (whichOutput && fs.existsSync(whichOutput)) {
            chromiumBinary = whichOutput;
          }
        } catch {
          // ignore
        }
      }

      if (chromiumBinary) {
        this.logger.log(`Using Chromium executable: ${chromiumBinary}`);
      } else if (process.platform === 'linux') {
        this.logger.warn(
          'No native Chromium executable found in standard paths! If running on Raspberry Pi, please run: sudo apt update && sudo apt install -y chromium-browser',
        );
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.config.sessionId,
          dataPath: path.resolve(this.config.sessionDataPath),
        }),
        puppeteer: {
          headless: this.config.puppeteer?.headless ?? true,
          args: puppeteerArgs,
          timeout: 120000,
          ...(chromiumBinary ? { executablePath: chromiumBinary } : {}),
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wwebjs/web-versions/main/html/{version}.html',
          strict: false,
        },
        authTimeoutMs: 120000,
        qrMaxRetries: 10,
      });

      this.setupEventHandlers();
      await this.client.initialize();
    } catch (error) {
      this.setStatus(EngineStatus.FAILED);
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Engine initialization failed for ${this.config.sessionId}: ${msg}`);
      if (
        msg.includes('Could not find Chromium') ||
        msg.includes('Failed to launch the browser process') ||
        msg.includes('Exec format error')
      ) {
        this.logger.error(
          'Raspberry Pi / ARM Note: Ensure native Chromium and its libraries are installed: sudo apt update && sudo apt install -y chromium-browser libnss3 libgbm1 libasound2',
        );
      }
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('loading_screen', (percent: number, message: string) => {
      this.logger.log(`WhatsApp loading: ${percent}% - ${message}`);
    });

    this.client.on('change_state', (state: string) => {
      this.logger.log(`WhatsApp state changed: ${state}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.client.on('qr', async (qr: string) => {
      try {
        this.qrCode = await qrcode.toDataURL(qr);
        this.setStatus(EngineStatus.QR_READY);
        this.callbacks.onQRCode?.(this.qrCode);
      } catch (error) {
        this.logger.error('Error generating QR code', String(error));
      }
    });

    this.client.on('authenticated', () => {
      this.logger.log(`WhatsApp authenticated for session ${this.config.sessionId}`);
      this.setStatus(EngineStatus.AUTHENTICATING);
      this.qrCode = null;
    });

    this.client.on('ready', () => {
      this.logger.log(`WhatsApp client ready for session ${this.config.sessionId}`);
      try {
        const info = this.client?.info;
        this.phoneNumber = info?.wid?.user || null;
        this.pushName = info?.pushname || null;
        this.setStatus(EngineStatus.READY);
        this.callbacks.onReady?.(this.phoneNumber || '', this.pushName || '');
      } catch (error) {
        this.logger.error('Error getting client info', String(error));
        this.setStatus(EngineStatus.READY);
        this.callbacks.onReady?.('', '');
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.client.on('message', async msg => {
      try {
        const incomingMessage: IncomingMessage = {
          id: msg?.id?._serialized,
          from: msg.from,
          to: msg.to,
          chatId: msg.from,
          body: msg.body,
          type: msg.type,
          timestamp: msg?.timestamp,
          fromMe: msg.fromMe,
          isGroup: msg.from.endsWith('@g.us'),
        };

        // Handle media safely
        const downloadableMediaTypes = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker']);
        if (msg.hasMedia && downloadableMediaTypes.has(msg.type)) {
          try {
            // Guard downloadMedia with timeout (6s) to prevent hanging on expired or non-cached media
            const downloadPromise = msg.downloadMedia();
            const timeoutPromise = new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('Media download timed out')), 6000),
            );
            const media = await Promise.race([downloadPromise, timeoutPromise]);

            if (media && media.data) {
              incomingMessage.media = {
                mimetype: media.mimetype,
                filename: media.filename || undefined,
                data: media.data,
              };
            }
          } catch (error) {
            // Expired media, revoked media, or WhatsApp Web internal decrypter misses are expected
            const errorMsg =
              error instanceof Error
                ? error.message
                : typeof error === 'object'
                  ? JSON.stringify(error)
                  : String(error);
            this.logger.warn(
              `Media download skipped for message ${msg.id?._serialized || 'unknown'} (${msg.type}): ${errorMsg}`,
            );
          }
        }

        // Handle quoted message
        if (msg.hasQuotedMsg) {
          try {
            const quotedPromise = msg.getQuotedMessage();
            const timeoutPromise = new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('Quoted message retrieval timed out')), 3000),
            );
            const quoted = (await Promise.race([quotedPromise, timeoutPromise])) as {
              id?: { _serialized?: string };
              body?: string;
            } | null;

            if (quoted && quoted.id?._serialized) {
              incomingMessage.quotedMessage = {
                id: quoted.id._serialized,
                body: quoted.body || '',
              };
            }
          } catch (error) {
            const errorMsg =
              error instanceof Error
                ? error.message
                : typeof error === 'object'
                  ? JSON.stringify(error)
                  : String(error);
            this.logger.warn(`Could not retrieve quoted message for ${msg.id?._serialized || 'unknown'}: ${errorMsg}`);
          }
        }

        this.callbacks.onMessage?.(incomingMessage);
      } catch (error) {
        this.logger.error('Error processing incoming message', String(error));
      }
    });

    this.client.on('message_ack', (msg, ack) => {
      this.callbacks.onMessageAck?.(msg?.id?._serialized, ack);
    });

    this.client.on('disconnected', reason => {
      this.setStatus(EngineStatus.DISCONNECTED);
      this.callbacks.onDisconnected?.(reason);
    });

    this.client.on('auth_failure', () => {
      this.setStatus(EngineStatus.FAILED);
      this.callbacks.onDisconnected?.('Authentication failed');
    });
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status);
    this.emit('stateChanged', status);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        // Use destroy instead of logout to preserve session data
        // This allows reconnecting without needing to scan QR again
        await this.client.destroy();
      } catch (error) {
        this.logger.warn('Destroy client failed:', String(error));
        // Already destroyed or not initialized - ignore
      }
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  async logout(): Promise<void> {
    if (this.client) {
      try {
        // Logout clears session data - user will need to scan QR again
        await this.client.logout();
      } catch (error) {
        this.logger.warn('Logout failed:', String(error));
        // Fall back to destroy if logout fails
        try {
          await this.client.destroy();
        } catch (destroyError) {
          this.logger.warn('Client destroy also failed during logout fallback', String(destroyError));
        }
      }
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.setStatus(EngineStatus.DISCONNECTED);
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  getPushName(): string | null {
    return this.pushName;
  }

  async sendTextMessage(chatId: string, text: string): Promise<MessageResult> {
    this.ensureReady();
    const msg = await this.client!.sendMessage(chatId, text);
    return {
      id: msg?.id?._serialized,
      timestamp: msg?.timestamp,
    };
  }

  async sendImageMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMediaMessage(chatId, media, 'image/jpeg');
  }

  async sendVideoMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMediaMessage(chatId, media, 'video/mp4');
  }

  async sendAudioMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMediaMessage(chatId, media, 'audio/ogg', { sendAudioAsVoice: true });
  }

  async sendDocumentMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    return this.sendMediaMessage(chatId, media, 'application/octet-stream');
  }

  private detectMimeFromBase64(b64: string): string {
    const head = b64.slice(0, 30);
    if (head.startsWith('/9j/')) return 'image/jpeg';
    if (head.startsWith('iVBORw0KGgo')) return 'image/png';
    if (head.startsWith('R0lGOD')) return 'image/gif';
    if (head.startsWith('UklGR')) return 'image/webp';
    if (head.startsWith('JVBERi')) return 'application/pdf';
    if (head.startsWith('AAAA') || head.includes('ftyp')) return 'video/mp4';
    if (head.startsWith('OggS')) return 'audio/ogg';
    if (head.startsWith('ID3') || head.startsWith('//u')) return 'audio/mp3';
    return 'image/jpeg';
  }

  private detectMimeFromBuffer(buf: Buffer): string {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return 'image/png';
    }
    if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF8')) {
      return 'image/gif';
    }
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') {
      return 'application/pdf';
    }
    if (buf.length >= 4 && (buf.toString('ascii', 4, 8) === 'ftyp' || buf.toString('ascii', 0, 4) === 'ftyp')) {
      return 'video/mp4';
    }
    if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
      return 'audio/ogg';
    }
    if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') {
      return 'audio/mp3';
    }
    return 'application/octet-stream';
  }

  private getExtensionForMime(mime: string): string {
    const cleanMime = (mime || '').split(';')[0].trim().toLowerCase();
    switch (cleanMime) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'image/gif':
        return 'gif';
      case 'video/mp4':
        return 'mp4';
      case 'audio/ogg':
      case 'audio/opus':
        return 'ogg';
      case 'audio/mp3':
      case 'audio/mpeg':
        return 'mp3';
      case 'application/pdf':
        return 'pdf';
      case 'application/zip':
        return 'zip';
      default:
        return 'bin';
    }
  }

  private async prepareMessageMedia(media: MediaInput, defaultMime = 'image/jpeg'): Promise<MessageMedia> {
    if (typeof media.data === 'string') {
      if (media.data.startsWith('http://') || media.data.startsWith('https://')) {
        // Fetch URL safely with timeout
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          const res = await fetch(media.data, {
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`Failed to fetch media from URL ${media.data}: ${res.status} ${res.statusText}`);
          }

          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          let mime = res.headers.get('content-type')?.split(';')[0]?.trim();
          if (!mime || mime === 'application/octet-stream') {
            const detected = this.detectMimeFromBuffer(buffer);
            mime = detected !== 'application/octet-stream' ? detected : (media.mimetype || defaultMime);
          }
          const ext = this.getExtensionForMime(mime);
          let filename = media.filename;
          if (!filename) {
            try {
              const urlPath = new URL(media.data).pathname;
              const baseName = path.basename(urlPath);
              filename = baseName && path.extname(baseName) ? baseName : `media_${Date.now()}.${ext}`;
            } catch {
              filename = `media_${Date.now()}.${ext}`;
            }
          } else if (!path.extname(filename)) {
            filename = `${filename}.${ext}`;
          }

          return new MessageMedia(mime, buffer.toString('base64'), filename);
        } catch (fetchErr) {
          this.logger.warn(
            `Direct fetch failed for URL ${media.data}, falling back to MessageMedia.fromUrl: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          );
          return MessageMedia.fromUrl(media.data, { unsafeMime: true });
        }
      }

      // Base64 string
      let base64 = media.data;
      if (base64.includes(';base64,')) {
        base64 = base64.split(';base64,')[1];
      }
      base64 = base64.replace(/\s+/g, '');

      let mime = media.mimetype;
      if (!mime || mime === 'application/octet-stream') {
        mime = this.detectMimeFromBase64(base64) || defaultMime;
      }
      const ext = this.getExtensionForMime(mime);
      let filename = media.filename;
      if (!filename) {
        filename = `media_${Date.now()}.${ext}`;
      } else if (!path.extname(filename)) {
        filename = `${filename}.${ext}`;
      }

      return new MessageMedia(mime, base64, filename);
    }

    // Buffer
    const buffer = media.data;
    let mime = media.mimetype;
    if (!mime || mime === 'application/octet-stream') {
      const detected = this.detectMimeFromBuffer(buffer);
      mime = detected !== 'application/octet-stream' ? detected : defaultMime;
    }
    const ext = this.getExtensionForMime(mime);
    let filename = media.filename;
    if (!filename) {
      filename = `media_${Date.now()}.${ext}`;
    } else if (!path.extname(filename)) {
      filename = `${filename}.${ext}`;
    }

    return new MessageMedia(mime, buffer.toString('base64'), filename);
  }

  private async sendMediaMessage(
    chatId: string,
    media: MediaInput,
    defaultMime = 'image/jpeg',
    extraOptions?: Record<string, unknown>,
  ): Promise<MessageResult> {
    this.ensureReady();

    let targetChatId = chatId.trim();
    if (!targetChatId.includes('@')) {
      targetChatId = targetChatId.replace(/[^0-9]/g, '') + '@c.us';
    }

    const messageMedia = await this.prepareMessageMedia(media, defaultMime);

    this.logger.log(
      `Sending media to ${targetChatId} (mimetype: ${messageMedia.mimetype}, filename: ${messageMedia.filename}, dataLength: ${messageMedia.data?.length || 0})`,
    );

    try {
      const msg = await this.client!.sendMessage(targetChatId, messageMedia, {
        caption: media.caption,
        ...extraOptions,
      });

      if (!msg) {
        throw new Error(`WhatsApp client returned empty response when sending media to ${targetChatId}`);
      }

      return {
        id: msg.id?._serialized,
        timestamp: msg.timestamp,
      };
    } catch (err) {
      const detail = err instanceof Error ? (err.stack || err.message) : String(err);
      this.logger.error(`sendMediaMessage failed for ${targetChatId}: ${detail}`);
      throw err;
    }
  }

  async getContacts(): Promise<Contact[]> {
    this.ensureReady();
    const contacts = await this.client!.getContacts();

    return contacts.map(c => ({
      id: c?.id?._serialized,
      name: c.name || undefined,
      pushName: c.pushname || undefined,
      number: c.number,
      isMyContact: c.isMyContact,
      isBlocked: c.isBlocked,
    }));
  }

  async getContactById(contactId: string): Promise<Contact | null> {
    this.ensureReady();
    try {
      const contact = await this.client!.getContactById(contactId);
      return {
        id: contact?.id?._serialized,
        name: contact.name || undefined,
        pushName: contact.pushname || undefined,
        number: contact.number,
        isMyContact: contact.isMyContact,
        isBlocked: contact.isBlocked,
      };
    } catch (error) {
      this.logger.warn(`Failed to get contact: ${contactId}`, String(error));
      return null;
    }
  }

  async checkNumberExists(number: string): Promise<boolean> {
    this.ensureReady();
    const numberId = await this.client!.getNumberId(number);
    return numberId !== null;
  }

  async getGroups(): Promise<Group[]> {
    this.ensureReady();
    const chats = await this.client!.getChats();

    // Filter only group chats
    const groups = chats.filter(chat => chat.isGroup);

    return groups.map(g => {
      const groupChat = g as unknown as GroupChat;
      return {
        id: g?.id?._serialized || '',
        name: g.name,
        participantsCount: groupChat.participants?.length,
        isAdmin: groupChat.participants?.some(
          p => p?.isAdmin && p?.id?._serialized === this.client?.info?.wid?._serialized,
        ),
      };
    });
  }

  // ============= Phase 3: Extended Messaging =============

  async sendLocationMessage(chatId: string, location: LocationInput): Promise<MessageResult> {
    this.ensureReady();
    // Import Location class dynamically from whatsapp-web.js
    const { Location } = await import('whatsapp-web.js');
    const loc = new Location(location.latitude, location.longitude, {
      name: location.description || '',
      address: location.address || '',
    });
    const msg = await this.client!.sendMessage(chatId, loc);
    return {
      id: msg?.id?._serialized,
      timestamp: msg?.timestamp,
    };
  }

  async sendContactMessage(chatId: string, contact: ContactCard): Promise<MessageResult> {
    this.ensureReady();
    // Create vCard format
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${contact.name}`,
      `TEL;type=CELL;type=VOICE;waid=${contact.number}:+${contact.number}`,
      'END:VCARD',
    ].join('\n');

    const msg = await this.client!.sendMessage(chatId, vcard, {
      parseVCards: true,
    });
    return {
      id: msg?.id?._serialized,
      timestamp: msg?.timestamp,
    };
  }

  async sendStickerMessage(chatId: string, media: MediaInput): Promise<MessageResult> {
    this.ensureReady();
    let messageMedia: MessageMedia;

    if (typeof media.data === 'string') {
      if (media.data.startsWith('http://') || media.data.startsWith('https://')) {
        messageMedia = await MessageMedia.fromUrl(media.data);
      } else {
        messageMedia = new MessageMedia(media.mimetype, media.data, media.filename);
      }
    } else {
      messageMedia = new MessageMedia(media.mimetype, media.data.toString('base64'), media.filename);
    }

    const msg = await this.client!.sendMessage(chatId, messageMedia, {
      sendMediaAsSticker: true,
    });
    return {
      id: msg?.id?._serialized,
      timestamp: msg?.timestamp,
    };
  }

  async replyToMessage(chatId: string, quotedMsgId: string, text: string): Promise<MessageResult> {
    this.ensureReady();
    // Find the message to quote
    const chat = await this.client!.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    const quotedMsg = messages.find(m => m?.id?._serialized === quotedMsgId);

    if (!quotedMsg) {
      throw new Error(`Message ${quotedMsgId} not found`);
    }

    const msg = await quotedMsg.reply(text);
    return {
      id: msg?.id?._serialized,
      timestamp: msg?.timestamp,
    };
  }

  async forwardMessage(fromChatId: string, toChatId: string, messageId: string): Promise<MessageResult> {
    this.ensureReady();
    const chat = await this.client!.getChatById(fromChatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    const msgToForward = messages.find(m => m?.id?._serialized === messageId);

    if (!msgToForward) {
      throw new Error(`Message ${messageId} not found`);
    }

    await msgToForward.forward(toChatId);
    // forward() returns void, so we generate a result based on original message
    return {
      id: `fwd_${messageId}`,
      timestamp: Date.now(),
    };
  }

  // ============= Phase 3: Group Management =============

  async getGroupInfo(groupId: string): Promise<GroupInfo | null> {
    this.ensureReady();
    try {
      const chat = await this.client!.getChatById(groupId);
      if (!chat.isGroup) {
        return null;
      }
      const groupChat = chat as unknown as GroupChat;
      const participants: GroupParticipant[] = (groupChat.participants || []).map(p => ({
        id: String(p?.id?._serialized || ''),
        number: String(p?.id?.user || ''),
        name: p?.name ? String(p.name) : undefined,
        isAdmin: Boolean(p?.isAdmin),
        isSuperAdmin: Boolean(p?.isSuperAdmin),
      }));

      return {
        id: chat?.id?._serialized || '',
        name: chat.name,
        description: groupChat.description ? String(groupChat.description) : undefined,
        owner: groupChat.owner?._serialized ? String(groupChat.owner._serialized) : undefined,
        createdAt: groupChat.createdAt,
        participants,
        isReadOnly: Boolean(groupChat.isReadOnly),
        isAnnounce: Boolean(groupChat.isAnnounce),
      };
    } catch (error) {
      this.logger.warn(`Failed to get group: ${groupId}`, String(error));
      return null;
    }
  }

  async createGroup(name: string, participants: string[]): Promise<Group> {
    this.ensureReady();
    // Ensure participant IDs are in correct format
    const participantIds = participants.map(p => (p.includes('@') ? p : `${p}@c.us`));
    const result = await this.client!.createGroup(name, participantIds);

    const groupId = String((result as unknown as GroupCreateResult).gid._serialized);
    return {
      id: groupId,
      name: name,
      participantsCount: participants.length,
    };
  }

  async addParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    const participantIds = participants.map(p => (p.includes('@') ? p : `${p}@c.us`));
    await (chat as unknown as GroupChat).addParticipants(participantIds);
  }

  async removeParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    const participantIds = participants.map(p => (p.includes('@') ? p : `${p}@c.us`));
    await (chat as unknown as GroupChat).removeParticipants(participantIds);
  }

  async promoteParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    const participantIds = participants.map(p => (p.includes('@') ? p : `${p}@c.us`));
    await (chat as unknown as GroupChat).promoteParticipants(participantIds);
  }

  async demoteParticipants(groupId: string, participants: string[]): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    const participantIds = participants.map(p => (p.includes('@') ? p : `${p}@c.us`));
    await (chat as unknown as GroupChat).demoteParticipants(participantIds);
  }

  async leaveGroup(groupId: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    await (chat as unknown as GroupChat).leave();
  }

  async setGroupSubject(groupId: string, subject: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    await (chat as unknown as GroupChat).setSubject(subject);
  }

  async setGroupDescription(groupId: string, description: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error('Chat is not a group');
    }
    await (chat as unknown as GroupChat).setDescription(description);
  }

  // Reactions (Phase 3)
  async reactToMessage(chatId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    const message = messages.find(m => m?.id?._serialized === messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found in chat ${chatId}`);
    }
    await (message as MessageWithReactions).react(emoji);
    this.logger.log(`Reacted to message ${messageId} with ${emoji || '(removed)'}`);
  }

  async getMessageReactions(chatId: string, messageId: string): Promise<MessageReaction[]> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    const message = messages.find(m => m?.id?._serialized === messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found in chat ${chatId}`);
    }
    const msgWithReactions = message as MessageWithReactions;
    if (!msgWithReactions.hasReaction) {
      return [];
    }
    const reactions = await msgWithReactions.getReactions();
    if (!reactions) {
      return [];
    }
    // Map reactions to our interface format
    const result: MessageReaction[] = [];

    for (const r of reactions) {
      result.push({
        emoji: String(r.id),
        senders: (r.senders || []).map(s => ({
          senderId: String(s.senderId),
          emoji: String(s.reaction),
          timestamp: Number(s?.timestamp),
        })),
      });
    }
    return result;
  }

  // Labels (Phase 3) - WhatsApp Business only
  async getLabels(): Promise<Label[]> {
    this.ensureReady();
    const labels = await (this.client as unknown as BusinessClient).getLabels();
    if (!labels) {
      return [];
    }

    return labels.map(label => ({
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    }));
  }

  async getLabelById(labelId: string): Promise<Label | null> {
    this.ensureReady();
    const label = await (this.client as unknown as BusinessClient).getLabelById(labelId);
    if (!label) {
      return null;
    }
    return {
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    };
  }

  async getChatLabels(chatId: string): Promise<Label[]> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    const labels = await (chat as unknown as GroupChat).getLabels();
    if (!labels) {
      return [];
    }

    return labels.map(label => ({
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    }));
  }

  async addLabelToChat(chatId: string, labelId: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    await (chat as unknown as GroupChat).addLabel(labelId);
    this.logger.log(`Added label ${labelId} to chat ${chatId}`);
  }

  async removeLabelFromChat(chatId: string, labelId: string): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    await (chat as unknown as GroupChat).removeLabel(labelId);
    this.logger.log(`Removed label ${labelId} from chat ${chatId}`);
  }

  // Channels/Newsletter (Phase 3)
  async getSubscribedChannels(): Promise<Channel[]> {
    this.ensureReady();
    const channels = await (this.client as unknown as BusinessClient).getChannels();
    if (!channels) {
      return [];
    }
    return channels.map((ch: WwjsChannelData) => ({
      id: String(typeof ch.id === 'object' ? ch?.id?._serialized : ch.id),
      name: String(ch.name || ''),
      description: ch.description ? String(ch.description) : undefined,
      inviteCode: ch.inviteCode ? String(ch.inviteCode) : undefined,
      subscriberCount: ch.subscriberCount ? Number(ch.subscriberCount) : undefined,
      verified: ch.verified ? Boolean(ch.verified) : undefined,
    }));
  }

  async getChannelById(channelId: string): Promise<Channel | null> {
    this.ensureReady();
    try {
      const ch = await (this.client as unknown as BusinessClient).getChannelById(channelId);
      if (!ch) {
        return null;
      }
      return {
        id: String(typeof ch.id === 'object' ? ch?.id?._serialized : ch.id),
        name: String(ch.name || ''),
        description: ch.description ? String(ch.description) : undefined,
        inviteCode: ch.inviteCode ? String(ch.inviteCode) : undefined,
        subscriberCount: ch.subscriberCount ? Number(ch.subscriberCount) : undefined,
        verified: ch.verified ? Boolean(ch.verified) : undefined,
      };
    } catch (error) {
      this.logger.warn(`Failed to get channel: ${channelId}`, String(error));
      return null;
    }
  }

  async subscribeToChannel(inviteCode: string): Promise<Channel> {
    this.ensureReady();
    const ch = await (this.client as unknown as BusinessClient).subscribeToChannel(inviteCode);
    this.logger.log(`Subscribed to channel with invite code: ${inviteCode}`);
    return {
      id: String(typeof ch.id === 'object' ? ch?.id?._serialized : ch.id),
      name: String(ch.name || ''),
      description: ch.description ? String(ch.description) : undefined,
    };
  }

  async unsubscribeFromChannel(channelId: string): Promise<void> {
    this.ensureReady();
    await (this.client as unknown as BusinessClient).unsubscribeFromChannel(channelId);
    this.logger.log(`Unsubscribed from channel: ${channelId}`);
  }

  async getChannelMessages(channelId: string, limit: number = 50): Promise<ChannelMessage[]> {
    this.ensureReady();
    try {
      const ch = await (this.client as unknown as BusinessClient).getChannelById(channelId);
      if (!ch) {
        throw new Error(`Channel ${channelId} not found`);
      }
      const messages = await ch.fetchMessages({ limit });
      if (!messages) {
        return [];
      }
      return messages.map(msg => ({
        id: String(typeof msg.id === 'object' ? msg?.id?._serialized : msg.id),
        body: String(msg.body || ''),
        timestamp: Number(msg?.timestamp),
        hasMedia: Boolean(msg.hasMedia),
        mediaUrl: msg.mediaUrl ? String(msg.mediaUrl) : undefined,
      }));
    } catch (error) {
      this.logger.error(`Failed to get channel messages: ${String(error)}`);
      return [];
    }
  }

  // ========== Gap Quick Wins Implementation ==========

  // Delete Message
  async deleteMessage(chatId: string, messageId: string, forEveryone: boolean = true): Promise<void> {
    this.ensureReady();
    const chat = await this.client!.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });
    const message = messages.find(m => m?.id?._serialized === messageId || m?.id?.id === messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found in chat ${chatId}`);
    }
    await message.delete(forEveryone);
    this.logger.log(`Deleted message ${messageId} from chat ${chatId} (forEveryone: ${forEveryone})`);
  }

  // Get Profile Picture
  async getProfilePicture(contactId: string): Promise<string | null> {
    this.ensureReady();
    try {
      const url = await this.client!.getProfilePicUrl(contactId);
      return url || null;
    } catch (error) {
      this.logger.warn(`Failed to get profile picture for ${contactId}: ${String(error)}`);
      return null;
    }
  }

  // Block Contact
  async blockContact(contactId: string): Promise<void> {
    this.ensureReady();
    const contact = await this.client!.getContactById(contactId);
    await contact.block();
    this.logger.log(`Blocked contact ${contactId}`);
  }

  // Unblock Contact
  async unblockContact(contactId: string): Promise<void> {
    this.ensureReady();
    const contact = await this.client!.getContactById(contactId);
    await contact.unblock();
    this.logger.log(`Unblocked contact ${contactId}`);
  }

  // Get Group Invite Code
  async getGroupInviteCode(groupId: string): Promise<string> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error(`${groupId} is not a group`);
    }
    const inviteCode = await (chat as unknown as GroupChat).getInviteCode();
    this.logger.log(`Got invite code for group ${groupId}`);
    return String(inviteCode);
  }

  // Revoke Group Invite Code
  async revokeGroupInviteCode(groupId: string): Promise<string> {
    this.ensureReady();
    const chat = await this.client!.getChatById(groupId);
    if (!chat.isGroup) {
      throw new Error(`${groupId} is not a group`);
    }
    const newCode = await (chat as unknown as GroupChat).revokeInvite();
    this.logger.log(`Revoked invite code for group ${groupId}, new code generated`);
    return String(newCode);
  }

  // ========== Status/Stories (Phase 3) ==========
  // Note: These are stub implementations - whatsapp-web.js has limited Status API support
  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  async getContactStatuses(): Promise<Status[]> {
    this.ensureReady();
    // whatsapp-web.js has limited Status API support
    // This is a stub that can be enhanced when the library adds support
    this.logger.warn('getContactStatuses not fully implemented in whatsapp-web.js');
    return [];
  }

  async getContactStatus(_contactId: string): Promise<Status[]> {
    this.ensureReady();
    this.logger.warn('getContactStatus not fully implemented in whatsapp-web.js');
    return [];
  }

  async postTextStatus(_text: string, _options?: TextStatusOptions): Promise<StatusResult> {
    this.ensureReady();
    // whatsapp-web.js doesn't have native status posting
    // This would require using the underlying WhatsApp Web API directly
    throw new Error('postTextStatus not yet implemented in whatsapp-web.js adapter');
  }

  async postImageStatus(_media: MediaInput, _caption?: string): Promise<StatusResult> {
    this.ensureReady();
    throw new Error('postImageStatus not yet implemented in whatsapp-web.js adapter');
  }

  async postVideoStatus(_media: MediaInput, _caption?: string): Promise<StatusResult> {
    this.ensureReady();
    throw new Error('postVideoStatus not yet implemented in whatsapp-web.js adapter');
  }

  async deleteStatus(_statusId: string): Promise<void> {
    this.ensureReady();
    throw new Error('deleteStatus not yet implemented in whatsapp-web.js adapter');
  }

  // ========== Catalog (Phase 3) ==========

  async getCatalog(): Promise<Catalog | null> {
    this.ensureReady();
    // whatsapp-web.js doesn't have native Catalog API support
    this.logger.warn('getCatalog not implemented in whatsapp-web.js adapter');
    return null;
  }

  async getProducts(_options?: ProductQueryOptions): Promise<PaginatedProducts> {
    this.ensureReady();
    this.logger.warn('getProducts not implemented in whatsapp-web.js adapter');
    return {
      products: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  }

  async getProduct(_productId: string): Promise<Product | null> {
    this.ensureReady();
    this.logger.warn('getProduct not implemented in whatsapp-web.js adapter');
    return null;
  }

  async sendProduct(_chatId: string, _productId: string, _body?: string): Promise<MessageResult> {
    this.ensureReady();
    throw new Error('sendProduct not yet implemented in whatsapp-web.js adapter');
  }

  async sendCatalog(_chatId: string, _body?: string): Promise<MessageResult> {
    this.ensureReady();
    throw new Error('sendCatalog not yet implemented in whatsapp-web.js adapter');
  }

  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private ensureReady(): void {
    if (this.status !== EngineStatus.READY || !this.client) {
      throw new ServiceUnavailableException(`WhatsApp client is not ready (current status: ${this.status})`);
    }
  }
}

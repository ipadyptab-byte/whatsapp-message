import { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Users,
  Send,
  MessageSquare,
  Image as ImageIcon,
  Video,
  Volume2,
  FileText,
  UploadCloud,
  Link2,
  X,
  AlertCircle,
  Loader2,
  FileCheck,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import { useSessionsQuery } from '../hooks/queries';
import { bulkMessageApi, messageApi, type BulkMessageItem } from '../services/api';
import './Marketing.css';

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB limit

type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

interface UploadedFileState {
  name: string;
  size: number;
  type: string;
  base64: string;
  previewUrl?: string;
}

const messageTypes: { type: MessageType; label: string; icon: typeof MessageSquare }[] = [
  { type: 'text', label: 'Text', icon: MessageSquare },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'video', label: 'Video', icon: Video },
  { type: 'audio', label: 'Audio', icon: Volume2 },
  { type: 'document', label: 'Document', icon: FileText },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAcceptedMimeTypes(type: MessageType): string {
  switch (type) {
    case 'image':
      return 'image/*,.png,.jpg,.jpeg,.gif,.webp';
    case 'video':
      return 'video/*,.mp4,.3gp,.mov,.webm';
    case 'audio':
      return 'audio/*,.mp3,.ogg,.wav,.aac,.m4a';
    case 'document':
      return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';
    default:
      return '*/*';
  }
}

export function Marketing() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.marketing') || 'Marketing');

  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // Target audience
  const [inputMode, setInputMode] = useState<'csv' | 'manual'>('csv');
  const [contacts, setContacts] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedCsvContacts, setParsedCsvContacts] = useState<string[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Message & Media composition
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [mediaSource, setMediaSource] = useState<'upload' | 'url'>('upload');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadedFile, setUploadedFile] = useState<UploadedFileState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [documentFilename, setDocumentFilename] = useState('');

  // Sending options
  const [delayBetweenMessages, setDelayBetweenMessages] = useState<number>(3000);
  const [randomizeDelay, setRandomizeDelay] = useState<boolean>(true);

  // Campaign progress
  const [isSending, setIsSending] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [campaignProgress, setCampaignProgress] = useState<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
    error?: string;
  }>({
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    status: 'idle',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Auto-select first active session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      const readySession = sessions.find(s => s.status === 'ready');
      setSelectedSessionId(readySession ? readySession.id : sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Extract phone numbers from manual input
  const manualRecipients = useMemo(() => {
    if (!contacts.trim()) return [];
    return contacts
      .split(/[\n,;]+/)
      .map(p => p.trim().replace(/[^0-9]/g, ''))
      .filter(p => p.length >= 7);
  }, [contacts]);

  // Handle CSV file upload & parsing
  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError(null);
    if (!e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    setCsvFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const lines = text.split(/\r?\n/);
        const extracted: string[] = [];

        for (const line of lines) {
          if (!line.trim()) continue;
          // split by comma or semicolon
          const cells = line.split(/[,;\t]/);
          for (const cell of cells) {
            const cleaned = cell.trim().replace(/['"]/g, '').replace(/[^0-9]/g, '');
            // check if length is valid for international phone numbers (usually 8 to 15 digits)
            if (cleaned.length >= 7 && cleaned.length <= 16) {
              extracted.push(cleaned);
              break; // Found one valid number in row, move to next line
            }
          }
        }

        // Deduplicate
        const uniqueContacts = Array.from(new Set(extracted));
        if (uniqueContacts.length === 0) {
          setCsvError('No valid phone numbers found in CSV file. Ensure numbers contain country code.');
          setParsedCsvContacts([]);
        } else {
          setParsedCsvContacts(uniqueContacts);
        }
      } catch {
        setCsvError('Failed to parse CSV file');
        setParsedCsvContacts([]);
      }
    };
    reader.onerror = () => {
      setCsvError('Failed to read CSV file');
    };
    reader.readAsText(file);
  };

  // Process media file for message upload
  const processMediaFile = (file: File) => {
    setFileError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`File size exceeds 30MB limit (${formatFileSize(file.size)})`);
      return;
    }

    if (messageType === 'document' && !documentFilename) {
      setDocumentFilename(file.name);
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : dataUrl;

      setUploadedFile({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        base64: base64Data,
        previewUrl: file.type.startsWith('image/') ? dataUrl : undefined,
      });
    };
    reader.onerror = () => {
      setFileError('Failed to read file');
    };
    reader.readAsDataURL(file);
  };

  const handleMediaDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleMediaDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleMediaDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processMediaFile(e.dataTransfer.files[0]);
    }
  };

  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processMediaFile(e.target.files[0]);
    }
  };

  const handleRemoveMediaFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Active target phone numbers
  const targetNumbers = inputMode === 'csv' ? parsedCsvContacts : manualRecipients;

  // Validation
  const isSubmitDisabled =
    !selectedSessionId ||
    targetNumbers.length === 0 ||
    (messageType === 'text' && !message.trim()) ||
    (messageType !== 'text' && mediaSource === 'upload' && !uploadedFile) ||
    (messageType !== 'text' && mediaSource === 'url' && !mediaUrl.trim()) ||
    isSending;

  // Execute campaign
  const handleStartCampaign = async () => {
    if (isSubmitDisabled) return;

    setIsSending(true);
    setCampaignProgress({
      total: targetNumbers.length,
      sent: 0,
      failed: 0,
      pending: targetNumbers.length,
      status: 'running',
    });

    const messagesList: BulkMessageItem[] = targetNumbers.map(phone => {
      const chatId = `${phone}@c.us`;
      if (messageType === 'text') {
        return {
          chatId,
          type: 'text',
          content: { text: message.trim() },
        };
      } else if (messageType === 'image') {
        return {
          chatId,
          type: 'image',
          content: {
            caption: message.trim() || undefined,
            image:
              mediaSource === 'upload' && uploadedFile
                ? { base64: uploadedFile.base64, mimetype: uploadedFile.type }
                : { url: mediaUrl.trim() },
          },
        };
      } else if (messageType === 'video') {
        return {
          chatId,
          type: 'video',
          content: {
            caption: message.trim() || undefined,
            video:
              mediaSource === 'upload' && uploadedFile
                ? { base64: uploadedFile.base64, mimetype: uploadedFile.type }
                : { url: mediaUrl.trim() },
          },
        };
      } else if (messageType === 'audio') {
        return {
          chatId,
          type: 'audio',
          content: {
            audio:
              mediaSource === 'upload' && uploadedFile
                ? { base64: uploadedFile.base64, mimetype: uploadedFile.type }
                : { url: mediaUrl.trim() },
          },
        };
      } else {
        // Document
        return {
          chatId,
          type: 'document',
          content: {
            caption: message.trim() || undefined,
            document:
              mediaSource === 'upload' && uploadedFile
                ? {
                    base64: uploadedFile.base64,
                    mimetype: uploadedFile.type,
                    filename: documentFilename.trim() || uploadedFile.name,
                  }
                : {
                    url: mediaUrl.trim(),
                    filename: documentFilename.trim() || 'document',
                  },
          },
        };
      }
    });

    try {
      // Attempt to dispatch via backend bulk batch endpoint
      const batchRes = await bulkMessageApi.sendBulk(selectedSessionId, {
        messages: messagesList,
        options: {
          delayBetweenMessages,
          randomizeDelay,
          stopOnError: false,
        },
      });

      setBatchId(batchRes.batchId);

      // Poll batch progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await bulkMessageApi.getBatchStatus(selectedSessionId, batchRes.batchId);
          setCampaignProgress({
            total: statusRes.progress.total,
            sent: statusRes.progress.sent,
            failed: statusRes.progress.failed,
            pending: statusRes.progress.pending,
            status:
              statusRes.status === 'completed' || statusRes.status === 'failed'
                ? 'completed'
                : statusRes.status === 'cancelled'
                ? 'cancelled'
                : 'running',
          });

          if (
            statusRes.status === 'completed' ||
            statusRes.status === 'failed' ||
            statusRes.status === 'cancelled'
          ) {
            clearInterval(pollInterval);
            setIsSending(false);
          }
        } catch {
          // If polling fails, keep polling until done
        }
      }, 2000);
    } catch {
      // Fallback to client-side sequential sender if batch route isn't available or fails
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < messagesList.length; i++) {
        const item = messagesList[i];
        try {
          if (item.type === 'text') {
            await messageApi.sendText(selectedSessionId, item.chatId, item.content.text || '');
          } else if (item.type === 'image') {
            await messageApi.sendImage(selectedSessionId, {
              chatId: item.chatId,
              caption: item.content.caption,
              ...(item.content.image?.base64
                ? { base64: item.content.image.base64, mimetype: item.content.image.mimetype }
                : { url: item.content.image?.url }),
            });
          } else if (item.type === 'video') {
            await messageApi.sendVideo(selectedSessionId, {
              chatId: item.chatId,
              caption: item.content.caption,
              ...(item.content.video?.base64
                ? { base64: item.content.video.base64, mimetype: item.content.video.mimetype }
                : { url: item.content.video?.url }),
            });
          } else if (item.type === 'audio') {
            await messageApi.sendAudio(selectedSessionId, {
              chatId: item.chatId,
              ...(item.content.audio?.base64
                ? { base64: item.content.audio.base64, mimetype: item.content.audio.mimetype }
                : { url: item.content.audio?.url }),
            });
          } else if (item.type === 'document') {
            await messageApi.sendDocument(selectedSessionId, {
              chatId: item.chatId,
              filename: item.content.document?.filename,
              caption: item.content.caption,
              ...(item.content.document?.base64
                ? { base64: item.content.document.base64, mimetype: item.content.document.mimetype }
                : { url: item.content.document?.url }),
            });
          }
          sentCount++;
        } catch {
          failedCount++;
        }

        setCampaignProgress({
          total: messagesList.length,
          sent: sentCount,
          failed: failedCount,
          pending: messagesList.length - (sentCount + failedCount),
          status: i === messagesList.length - 1 ? 'completed' : 'running',
        });

        // Delay between messages
        if (i < messagesList.length - 1) {
          const delay = randomizeDelay
            ? delayBetweenMessages + Math.floor(Math.random() * 1500)
            : delayBetweenMessages;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      setIsSending(false);
    }
  };

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const isSessionReady = selectedSession?.status === 'ready';

  return (
    <div className="marketing-page" id="marketing-page">
      <PageHeader
        title={t('nav.marketing') || 'Marketing Campaigns'}
        subtitle="Broadcast text, images, videos, audio, or documents to your contact lists with automated batch delivery."
      />

      <div className="marketing-card" id="marketing-campaign-card">
        {/* Step 1: Active WhatsApp Session */}
        <h3 className="section-title">1. Select WhatsApp Session</h3>
        <div className="form-group" style={{ marginBottom: '2rem' }}>
          <label htmlFor="session-select">Sending Channel</label>
          <select
            id="session-select"
            className="session-select"
            value={selectedSessionId}
            onChange={e => setSelectedSessionId(e.target.value)}
            disabled={loadingSessions || isSending}
          >
            {sessions.length === 0 ? (
              <option value="">No sessions found (create one in Sessions page)</option>
            ) : (
              sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''} - [{s.status.toUpperCase()}]
                </option>
              ))
            )}
          </select>
          {selectedSession && !isSessionReady && (
            <span className="upload-error-msg" style={{ marginTop: '0.5rem' }}>
              <AlertCircle size={14} />
              Session is currently {selectedSession.status}. Please ensure it is scanned and ready before sending.
            </span>
          )}
        </div>

        <div className="divider"></div>

        {/* Step 2: Audience Selection */}
        <h3 className="section-title">2. Select Target Audience</h3>
        <div className="radio-cards">
          <label className={`radio-card ${inputMode === 'csv' ? 'active' : ''}`} id="radio-card-csv">
            <input
              type="radio"
              name="inputMode"
              checked={inputMode === 'csv'}
              onChange={() => setInputMode('csv')}
              className="sr-only"
              disabled={isSending}
            />
            <div className="radio-card-content">
              <div className="icon-wrapper">
                <Upload size={24} />
              </div>
              <span className="card-title">Upload CSV File</span>
              <p className="card-desc">Import a contact list or spreadsheet</p>
            </div>
          </label>

          <label className={`radio-card ${inputMode === 'manual' ? 'active' : ''}`} id="radio-card-manual">
            <input
              type="radio"
              name="inputMode"
              checked={inputMode === 'manual'}
              onChange={() => setInputMode('manual')}
              className="sr-only"
              disabled={isSending}
            />
            <div className="radio-card-content">
              <div className="icon-wrapper">
                <Users size={24} />
              </div>
              <span className="card-title">Manual Entry</span>
              <p className="card-desc">Paste phone numbers directly</p>
            </div>
          </label>
        </div>

        <div className="input-section">
          {inputMode === 'csv' ? (
            <div className="form-group">
              <label htmlFor="csv-upload">Choose a CSV File</label>
              <input
                ref={csvInputRef}
                type="file"
                id="csv-upload"
                accept=".csv"
                onChange={handleCsvChange}
                className="file-input"
                disabled={isSending}
              />
              <span className="hint">
                Upload a CSV containing phone numbers in international format (e.g. 14155552671 or 919876543210).
              </span>

              {csvFile && parsedCsvContacts.length > 0 && (
                <div className="audience-badge">
                  <FileCheck size={14} />
                  <span>
                    {parsedCsvContacts.length} valid recipient{parsedCsvContacts.length === 1 ? '' : 's'} detected in {csvFile.name}
                  </span>
                </div>
              )}

              {csvError && (
                <div className="upload-error-msg">
                  <AlertCircle size={14} />
                  <span>{csvError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="manual-contacts">Phone Numbers (comma or newline separated)</label>
              <textarea
                id="manual-contacts"
                placeholder="e.g. 14155552671, 919876543210, 447700900077"
                value={contacts}
                onChange={e => setContacts(e.target.value)}
                className="contacts-textarea"
                disabled={isSending}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="hint">Enter numbers with country code, without + or spaces.</span>
                {manualRecipients.length > 0 && (
                  <div className="audience-badge">
                    <Users size={14} />
                    <span>
                      {manualRecipients.length} valid recipient{manualRecipients.length === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="divider"></div>

        {/* Step 3: Compose Message & Upload Media provision */}
        <h3 className="section-title">3. Compose Message & Media</h3>

        {/* Message Type Selector */}
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label>Message Type</label>
          <div className="type-selector" id="message-type-selector">
            {messageTypes.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                className={`type-btn ${messageType === type ? 'active' : ''}`}
                onClick={() => {
                  setMessageType(type);
                  setFileError(null);
                }}
                disabled={isSending}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Media Upload Provision when type is image, video, audio, or document */}
        {messageType !== 'text' && (
          <div className="media-source-section" id="media-source-section">
            <div className="form-group">
              <label>Media Source</label>
              <div className="toggle-group">
                <button
                  type="button"
                  className={mediaSource === 'upload' ? 'active' : ''}
                  onClick={() => setMediaSource('upload')}
                  disabled={isSending}
                >
                  <UploadCloud size={16} />
                  <span>Upload File</span>
                </button>
                <button
                  type="button"
                  className={mediaSource === 'url' ? 'active' : ''}
                  onClick={() => setMediaSource('url')}
                  disabled={isSending}
                >
                  <Link2 size={16} />
                  <span>Media URL</span>
                </button>
              </div>
            </div>

            {mediaSource === 'upload' ? (
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>
                  Upload {messageType.charAt(0).toUpperCase() + messageType.slice(1)} File (max 30MB)
                </label>

                <input
                  ref={fileInputRef}
                  id="media-file-input"
                  type="file"
                  accept={getAcceptedMimeTypes(messageType)}
                  onChange={handleMediaFileChange}
                  style={{ display: 'none' }}
                />

                {!uploadedFile ? (
                  <div
                    id="marketing-media-dropzone"
                    className={`media-upload-zone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleMediaDragOver}
                    onDragLeave={handleMediaDragLeave}
                    onDrop={handleMediaDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                  >
                    <div className="upload-icon-wrapper">
                      <UploadCloud size={24} />
                    </div>
                    <div className="upload-text-primary">Drag & drop your file here, or click to browse</div>
                    <div className="upload-text-secondary">
                      {messageType === 'image' && 'PNG, JPG, GIF, WebP (max 30MB)'}
                      {messageType === 'video' && 'MP4, 3GP, MOV, WebM (max 30MB)'}
                      {messageType === 'audio' && 'MP3, OGG, WAV, AAC, M4A (max 30MB)'}
                      {messageType === 'document' && 'PDF, DOCX, XLSX, TXT, CSV, ZIP (max 30MB)'}
                    </div>
                  </div>
                ) : (
                  <div className="uploaded-file-card" id="marketing-uploaded-file-card">
                    {uploadedFile.previewUrl ? (
                      <img src={uploadedFile.previewUrl} alt={uploadedFile.name} className="file-thumbnail" />
                    ) : (
                      <div className="file-icon-badge">
                        {messageType === 'video' ? (
                          <Video size={20} />
                        ) : messageType === 'audio' ? (
                          <Volume2 size={20} />
                        ) : (
                          <FileText size={20} />
                        )}
                      </div>
                    )}
                    <div className="file-info">
                      <span className="file-name" title={uploadedFile.name}>
                        {uploadedFile.name}
                      </span>
                      <div className="file-meta">
                        <span className="file-badge">{messageType}</span>
                        <span>{formatFileSize(uploadedFile.size)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-remove-file"
                      onClick={handleRemoveMediaFile}
                      title="Remove file"
                      disabled={isSending}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}

                {fileError && (
                  <div className="upload-error-msg">
                    <AlertCircle size={14} />
                    <span>{fileError}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="media-url-input">Public Media URL</label>
                <input
                  id="media-url-input"
                  type="url"
                  placeholder="https://example.com/media.jpg"
                  value={mediaUrl}
                  onChange={e => setMediaUrl(e.target.value)}
                  className="contacts-textarea"
                  style={{ minHeight: 'unset', height: '44px' }}
                  disabled={isSending}
                />
                <span className="hint">Directly accessible URL for your media asset.</span>
              </div>
            )}

            {messageType === 'document' && (
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="doc-filename">Custom Filename (optional)</label>
                <input
                  id="doc-filename"
                  type="text"
                  placeholder="e.g. Catalog-2026.pdf"
                  value={documentFilename}
                  onChange={e => setDocumentFilename(e.target.value)}
                  className="contacts-textarea"
                  style={{ minHeight: 'unset', height: '44px' }}
                  disabled={isSending}
                />
              </div>
            )}
          </div>
        )}

        {/* Message / Caption Input */}
        <div className="form-group">
          <label htmlFor="campaign-message">
            {messageType === 'text' ? 'Message Content' : 'Caption (Optional)'}
          </label>
          <div className="message-composer">
            <MessageSquare size={18} className="composer-icon" />
            <textarea
              id="campaign-message"
              placeholder={
                messageType === 'text'
                  ? 'Type your marketing message here...'
                  : 'Add an optional caption for your media message...'
              }
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="message-textarea"
              disabled={isSending}
            />
          </div>
          <span className="hint">
            {messageType === 'text'
              ? 'This text will be delivered to all selected contacts.'
              : 'Caption will accompany the uploaded media in the chat.'}
          </span>
        </div>

        {/* Delay & Anti-Ban Controls */}
        <div className="divider"></div>
        <h3 className="section-title">4. Delivery & Pacing</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="form-group">
            <label htmlFor="delay-select">Pacing Delay</label>
            <select
              id="delay-select"
              className="session-select"
              value={delayBetweenMessages}
              onChange={e => setDelayBetweenMessages(Number(e.target.value))}
              disabled={isSending}
            >
              <option value={1500}>1.5 seconds (Fast)</option>
              <option value={3000}>3.0 seconds (Recommended)</option>
              <option value={5000}>5.0 seconds (Safer)</option>
              <option value={10000}>10.0 seconds (Safest)</option>
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '1.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={randomizeDelay}
                onChange={e => setRandomizeDelay(e.target.checked)}
                disabled={isSending}
              />
              <span style={{ fontSize: '0.875rem' }}>Add jitter (0-1.5s random delay)</span>
            </label>
          </div>
        </div>

        {/* Real-time Campaign Progress Indicator */}
        {campaignProgress.status !== 'idle' && (
          <div className="campaign-progress-box" id="campaign-progress-box">
            <div className="progress-header">
              <h4>
                {campaignProgress.status === 'running' && 'Campaign in Progress...'}
                {campaignProgress.status === 'completed' && 'Campaign Completed'}
                {campaignProgress.status === 'cancelled' && 'Campaign Stopped'}
                {campaignProgress.status === 'error' && 'Campaign Failed'}
              </h4>
              {batchId && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Batch: {batchId}</span>}
            </div>

            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${
                    campaignProgress.total > 0
                      ? Math.round(((campaignProgress.sent + campaignProgress.failed) / campaignProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-val">{campaignProgress.total}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-item">
                <div className="stat-val" style={{ color: 'var(--primary)' }}>
                  {campaignProgress.sent}
                </div>
                <div className="stat-label">Delivered</div>
              </div>
              <div className="stat-item">
                <div className="stat-val" style={{ color: '#dc2626' }}>
                  {campaignProgress.failed}
                </div>
                <div className="stat-label">Failed</div>
              </div>
              <div className="stat-item">
                <div className="stat-val" style={{ color: 'var(--text-muted)' }}>
                  {campaignProgress.pending}
                </div>
                <div className="stat-label">Remaining</div>
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="action-bar">
          <button
            id="start-campaign-btn"
            className="btn-primary"
            disabled={isSubmitDisabled}
            onClick={handleStartCampaign}
          >
            {isSending ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Sending Broadcast...
              </>
            ) : (
              <>
                <Send size={18} />
                Start Campaign ({targetNumbers.length} Recipient{targetNumbers.length === 1 ? '' : 's'})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  UploadCloud,
  Link2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  File as FileIcon,
  X,
  AlertCircle,
} from 'lucide-react';
import { messageApi } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useSessionsQuery, useSessionGroupsQuery } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './MessageTester.css';

interface ApiResponse {
  success: boolean;
  messageId?: string;
  timestamp: string;
  error?: string;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  base64: string;
  previewUrl?: string;
}

const messageTypes = ['text', 'image', 'video', 'audio', 'document'] as const;
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getAcceptedMimeTypes(type: typeof messageTypes[number]) {
  switch (type) {
    case 'image':
      return 'image/*';
    case 'video':
      return 'video/*';
    case 'audio':
      return 'audio/*';
    case 'document':
      return '*/*';
    default:
      return '*/*';
  }
}

function getFileTypeIcon(type: string, messageType: string) {
  if (messageType === 'image' || type.startsWith('image/')) {
    return <ImageIcon size={22} />;
  }
  if (messageType === 'video' || type.startsWith('video/')) {
    return <Film size={22} />;
  }
  if (messageType === 'audio' || type.startsWith('audio/')) {
    return <Music size={22} />;
  }
  if (type.includes('pdf') || type.includes('word') || type.includes('text') || type.includes('document')) {
    return <FileText size={22} />;
  }
  return <FileIcon size={22} />;
}

export function MessageTester() {
  const { t } = useTranslation();
  useDocumentTitle(t('messageTester.title'));
  const { canWrite } = useRole();
  const { data: allSessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const sessions = allSessions.filter(s => s.status === 'ready');
  const [session, setSession] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientType, setRecipientType] = useState<'personal' | 'group'>('personal');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [messageType, setMessageType] = useState<typeof messageTypes[number]>('text');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaSource, setMediaSource] = useState<'upload' | 'url'>('upload');
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: groups = [], isLoading: loadingGroups } = useSessionGroupsQuery(
    session,
    recipientType === 'group',
  );

  useEffect(() => {
    if (sessions.length > 0 && !session) {
      setSession(sessions[0].id);
    }
  }, [sessions, session]);

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0].id);
    }
    if (recipientType !== 'group') {
      setSelectedGroup('');
    }
  }, [groups, selectedGroup, recipientType]);

  const processFile = (file: File) => {
    setFileError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(t('messageTester.fileSizeTooLarge'));
      return;
    }

    if (messageType === 'document' && !content) {
      setContent(file.name);
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : dataUrl;

      let resolvedType = file.type;
      if (!resolvedType || resolvedType === 'application/octet-stream') {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') resolvedType = 'image/jpeg';
        else if (ext === 'png') resolvedType = 'image/png';
        else if (ext === 'webp') resolvedType = 'image/webp';
        else if (ext === 'gif') resolvedType = 'image/gif';
        else if (ext === 'mp4') resolvedType = 'video/mp4';
        else if (ext === 'mp3') resolvedType = 'audio/mp3';
        else if (ext === 'ogg') resolvedType = 'audio/ogg';
        else if (ext === 'pdf') resolvedType = 'application/pdf';
        else if (messageType === 'image') resolvedType = 'image/jpeg';
        else if (messageType === 'video') resolvedType = 'video/mp4';
        else if (messageType === 'audio') resolvedType = 'audio/ogg';
        else resolvedType = 'application/octet-stream';
      }

      setUploadedFile({
        name: file.name,
        size: file.size,
        type: resolvedType,
        base64: base64Data,
        previewUrl: resolvedType.startsWith('image/') ? dataUrl : undefined,
      });
    };
    reader.onerror = () => {
      setFileError('Failed to read file');
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleOpenMediaFileChooser = () => {
    setMediaSource('upload');
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMessageTypeChange = (type: typeof messageTypes[number]) => {
    setMessageType(type);
    setFileError(null);
  };

  const handleSend = async () => {
    const targetId = recipientType === 'group' ? selectedGroup : recipient;
    if (!session || !targetId) return;

    if (messageType !== 'text') {
      if (mediaSource === 'upload' && !uploadedFile) {
        setFileError(t('messageTester.dragDrop'));
        return;
      }
      if (mediaSource === 'url' && !mediaUrl.trim()) {
        return;
      }
    }

    setIsLoading(true);
    setResponse(null);

    const chatId = recipientType === 'group' ? targetId : targetId.replace(/[^0-9]/g, '') + '@c.us';

    try {
      let result;
      if (messageType === 'text') {
        result = await messageApi.sendText(session, chatId, content);
      } else {
        const payload =
          mediaSource === 'upload' && uploadedFile
            ? {
                chatId,
                base64: uploadedFile.base64,
                mimetype: uploadedFile.type,
                filename: messageType === 'document' ? (content.trim() || uploadedFile.name) : uploadedFile.name,
                caption: messageType !== 'audio' && messageType !== 'document' ? (content.trim() || undefined) : undefined,
              }
            : {
                chatId,
                url: mediaUrl.trim(),
                mimetype:
                  messageType === 'image'
                    ? 'image/jpeg'
                    : messageType === 'video'
                    ? 'video/mp4'
                    : messageType === 'audio'
                    ? 'audio/ogg'
                    : undefined,
                filename: messageType === 'document' ? (content.trim() || undefined) : undefined,
                caption: messageType !== 'audio' && messageType !== 'document' ? (content.trim() || undefined) : undefined,
              };

        if (messageType === 'image') {
          result = await messageApi.sendImage(session, payload);
        } else if (messageType === 'video') {
          result = await messageApi.sendVideo(session, payload);
        } else if (messageType === 'audio') {
          result = await messageApi.sendAudio(session, payload);
        } else {
          result = await messageApi.sendDocument(session, payload);
        }
      }

      setResponse({
        success: true,
        messageId: result.messageId,
        timestamp: result.timestamp ? new Date(result.timestamp * 1000).toISOString() : new Date().toISOString(),
      });
    } catch (err) {
      setResponse({
        success: false,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : t('messageTester.sendFailed'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isMediaValid =
    messageType === 'text' ||
    (mediaSource === 'upload' ? !!uploadedFile : !!mediaUrl.trim());

  const isSendDisabled =
    !canWrite ||
    isLoading ||
    !session ||
    (recipientType === 'group' ? !selectedGroup : !recipient) ||
    !isMediaValid;

  if (loadingSessions) {
    return (
      <div
        className="message-tester"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="message-tester">
      <PageHeader title={t('messageTester.title')} subtitle={t('messageTester.subtitle')} />

      <div className="tester-panels">
        <div className="compose-panel">
          <h2>{t('messageTester.compose')}</h2>

          <div className="form-group">
            <label>{t('messageTester.session')}</label>
            <select id="session-select" value={session ?? ''} onChange={e => setSession(e.target.value)}>
              {sessions.length === 0 && <option value="">{t('messageTester.noReadySessions')}</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.phone || t('messageTester.sessionOptionPhoneNone')})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t('messageTester.recipientType')}</label>
            <div className="toggle-group">
              <button
                type="button"
                id="recipient-personal-btn"
                className={recipientType === 'personal' ? 'active' : ''}
                onClick={() => setRecipientType('personal')}
              >
                {t('messageTester.personal')}
              </button>
              <button
                type="button"
                id="recipient-group-btn"
                className={recipientType === 'group' ? 'active' : ''}
                onClick={() => setRecipientType('group')}
              >
                {t('messageTester.group')}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>{recipientType === 'group' ? t('messageTester.selectGroup') : t('messageTester.recipientPhone')}</label>
            {recipientType === 'group' ? (
              <>
                <select
                  id="group-select"
                  value={selectedGroup ?? ''}
                  onChange={e => setSelectedGroup(e.target.value)}
                  disabled={loadingGroups || groups.length === 0}
                >
                  {loadingGroups && <option value="">{t('messageTester.loadingGroups')}</option>}
                  {!loadingGroups && groups.length === 0 && <option value="">{t('messageTester.noGroupsFound')}</option>}
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <span className="hint">{t('messageTester.selectGroupHint')}</span>
              </>
            ) : (
              <>
                <input
                  id="recipient-phone-input"
                  type="text"
                  value={recipient ?? ''}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="1234567890"
                />
                <span className="hint">{t('messageTester.phoneHint')}</span>
              </>
            )}
          </div>

          <div className="form-group">
            <label>{t('messageTester.messageType')}</label>
            <div className="toggle-group">
              {messageTypes.map(type => (
                <button
                  type="button"
                  key={type}
                  id={`msg-type-${type}-btn`}
                  className={messageType === type ? 'active' : ''}
                  onClick={() => handleMessageTypeChange(type)}
                >
                  {t(`messageTester.types.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {messageType === 'text' ? (
            <div className="form-group">
              <label>{t('messageTester.messageContent')}</label>
              <textarea
                id="message-text-content"
                value={content ?? ''}
                onChange={e => setContent(e.target.value)}
                placeholder={t('messageTester.messagePlaceholder')}
                rows={5}
              />
            </div>
          ) : (
            <>
              {/* Always mounted in DOM so fileInputRef is immediately accessible on click */}
              <input
                ref={fileInputRef}
                id="file-upload-input"
                type="file"
                accept={getAcceptedMimeTypes(messageType)}
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              <div className="form-group">
                <label>{t('messageTester.mediaSource')}</label>
                <div className="toggle-group" id="message-tester-media-toggle-group">
                  <button
                    type="button"
                    id="media-source-upload-btn"
                    className={mediaSource === 'upload' ? 'active' : ''}
                    onClick={handleOpenMediaFileChooser}
                    title={t('messageTester.uploadFile')}
                  >
                    <UploadCloud size={16} />
                    <span>{t('messageTester.uploadFile')}</span>
                  </button>
                  <button
                    type="button"
                    id="media-source-url-btn"
                    className={mediaSource === 'url' ? 'active' : ''}
                    onClick={() => {
                      setMediaSource('url');
                      setFileError(null);
                    }}
                    title={t('messageTester.mediaUrlOption')}
                  >
                    <Link2 size={16} />
                    <span>{t('messageTester.mediaUrlOption')}</span>
                  </button>
                </div>
              </div>

              {mediaSource === 'upload' ? (
                <div className="form-group">
                  <label>
                    {messageType === 'document' ? t('messageTester.types.document') : t(`messageTester.types.${messageType}`)} (
                    {t('messageTester.uploadFile')})
                  </label>

                  {!uploadedFile ? (
                    <div
                      id="media-dropzone"
                      className={`media-upload-zone ${isDragging ? 'dragging' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={handleOpenMediaFileChooser}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenMediaFileChooser();
                        }
                      }}
                    >
                      <div className="upload-icon-wrapper">
                        <UploadCloud size={24} />
                      </div>
                      <div className="upload-text-primary">{t('messageTester.dragDrop')}</div>
                      <div className="upload-text-secondary">
                        {messageType === 'image' && 'PNG, JPG, GIF, WebP (max 30MB)'}
                        {messageType === 'video' && 'MP4, 3GP, MOV, WebM (max 30MB)'}
                        {messageType === 'audio' && 'MP3, OGG, WAV, AAC, M4A (max 30MB)'}
                        {messageType === 'document' && 'PDF, DOCX, XLSX, TXT, ZIP, etc. (max 30MB)'}
                      </div>
                    </div>
                  ) : (
                    <div className="uploaded-file-card" id="uploaded-file-card">
                      {uploadedFile.previewUrl ? (
                        <img
                          src={uploadedFile.previewUrl}
                          alt={uploadedFile.name}
                          className="file-thumbnail"
                        />
                      ) : (
                        <div className="file-icon-badge">
                          {getFileTypeIcon(uploadedFile.type, messageType)}
                        </div>
                      )}
                      <div className="file-info">
                        <span className="file-name" title={uploadedFile.name}>
                          {uploadedFile.name}
                        </span>
                        <div className="file-meta">
                          <span className="file-size">{formatBytes(uploadedFile.size)}</span>
                          <span className="file-badge">{uploadedFile.type.split('/')[1] || uploadedFile.type}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        id="btn-change-file"
                        className="btn-change-file"
                        onClick={handleOpenMediaFileChooser}
                        title="Choose another file"
                      >
                        <UploadCloud size={14} />
                        <span>Change</span>
                      </button>
                      <button
                        type="button"
                        id="btn-remove-file"
                        className="btn-remove-file"
                        onClick={handleRemoveFile}
                        title={t('messageTester.removeFile')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  )}

                  {fileError && (
                    <div className="upload-error-msg" id="upload-error-msg">
                      <AlertCircle size={14} />
                      <span>{fileError}</span>
                    </div>
                  )}

                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      type="button"
                      id="switch-to-url-link"
                      className="switch-source-link"
                      onClick={() => setMediaSource('url')}
                    >
                      {t('messageTester.mediaUrl')} &rarr;
                    </button>
                    {uploadedFile && (
                      <button
                        type="button"
                        id="change-file-link"
                        className="switch-source-link"
                        style={{ textDecoration: 'none' }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t('messageTester.clickToBrowse')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label>{t('messageTester.mediaUrl')}</label>
                    <button
                      type="button"
                      id="switch-to-upload-link"
                      className="switch-source-link"
                      onClick={() => setMediaSource('upload')}
                    >
                      &larr; {t('messageTester.uploadFile')}
                    </button>
                  </div>
                  <input
                    id="media-url-input"
                    type="text"
                    value={mediaUrl ?? ''}
                    onChange={e => setMediaUrl(e.target.value)}
                    placeholder="https://example.com/file.jpg"
                  />
                  <span className="hint">{t('messageTester.mediaUrlHint')}</span>
                </div>
              )}

              {messageType !== 'audio' && (
                <div className="form-group">
                  <label>
                    {messageType === 'document' ? t('messageTester.filename') : t('messageTester.caption')} ({t('common.optional')})
                  </label>
                  <input
                    id="media-content-input"
                    type="text"
                    value={content ?? ''}
                    onChange={e => setContent(e.target.value)}
                    placeholder={
                      messageType === 'document'
                        ? (uploadedFile ? uploadedFile.name : t('messageTester.filenamePlaceholder'))
                        : t('messageTester.captionPlaceholder')
                    }
                  />
                </div>
              )}
            </>
          )}

          <button
            type="button"
            id="send-message-btn"
            className="send-btn"
            onClick={handleSend}
            disabled={isSendDisabled}
          >
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {isLoading ? t('messageTester.sending') : canWrite ? t('messageTester.send') : t('messageTester.viewOnly')}
          </button>
        </div>

        <div className="response-panel">
          <h2>{t('messageTester.responseTitle')}</h2>

          {response ? (
            <>
              <div className={`response-status ${response.success ? 'success' : 'error'}`}>
                {response.success ? (
                  <>
                    <CheckCircle size={20} />
                    <span>{t('messageTester.successLabel')}</span>
                  </>
                ) : (
                  <>
                    <XCircle size={20} />
                    <span>{t('messageTester.failedLabel')}</span>
                  </>
                )}
              </div>

              <div className="response-details">
                <div className="detail-row">
                  <span className="detail-label">{t('messageTester.response.timestamp')}</span>
                  <span className="detail-value">{response.timestamp}</span>
                </div>
                {response.messageId && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.messageId')}</span>
                    <span className="detail-value mono">{response.messageId}</span>
                  </div>
                )}
                {response.error && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.error')}</span>
                    <span className="detail-value" style={{ color: '#DC2626' }}>
                      {response.error}
                    </span>
                  </div>
                )}
              </div>

              <div className="response-json">
                <pre>{JSON.stringify(response, null, 2)}</pre>
              </div>
            </>
          ) : (
            <div className="response-empty">
              <p>{t('messageTester.responseEmpty')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

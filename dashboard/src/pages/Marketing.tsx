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
  Sparkles,
  Eye,
  UserCheck,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PageHeader } from '../components/PageHeader';
import { useSessionsQuery } from '../hooks/queries';
import { bulkMessageApi, messageApi, type BulkMessageItem } from '../services/api';
import './Marketing.css';

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB limit

export interface RecipientContact {
  phone: string;
  name: string;
}

export interface CsvParseSummary {
  total: number;
  withName: number;
  colName?: string;
  colPhone?: string;
}

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

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === ';' || char === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(cell => cell.replace(/^["']|["']$/g, '').trim());
}

function sanitizePhoneNumber(str: string): string {
  return str.replace(/[^0-9]/g, '');
}

function isLikelyPhoneNumber(str: string): boolean {
  const digits = sanitizePhoneNumber(str);
  return digits.length >= 7 && digits.length <= 16 && (digits.length / Math.max(1, str.trim().length)) >= 0.45;
}

export function parseContactsFromCsv(text: string): {
  contacts: RecipientContact[];
  summary: CsvParseSummary;
  error?: string;
} {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    return { contacts: [], summary: { total: 0, withName: 0 }, error: 'CSV file is empty' };
  }

  const rows = rawLines.map(parseCsvLine).filter(r => r.length > 0 && r.some(c => c.length > 0));
  if (rows.length === 0) {
    return { contacts: [], summary: { total: 0, withName: 0 }, error: 'No data rows found in CSV' };
  }

  const headerRow = rows[0];
  const lowerHeaders = headerRow.map(h => h.toLowerCase());

  const hasHeaderKeywords = lowerHeaders.some(h =>
    /name|phone|mobile|cell|tel|number|contact|recipient|customer|client/.test(h)
  );

  let startRow = 0;
  let nameColIdx = -1;
  let firstNameColIdx = -1;
  let lastNameColIdx = -1;
  let phoneColIdx = -1;
  let detectedColName = '';
  let detectedColPhone = '';

  if (hasHeaderKeywords) {
    startRow = 1;
    phoneColIdx = lowerHeaders.findIndex(h => /phone|mobile|tel|cell|whatsapp|contact.*num|number/.test(h));
    if (phoneColIdx === -1) {
      phoneColIdx = lowerHeaders.findIndex(h => /number|contact/.test(h));
    }

    nameColIdx = lowerHeaders.findIndex(h =>
      /(^|\b)(full[_\s]?name|name|recipient|customer|client|contact[_\s]?name)(\b|$)/.test(h)
    );
    if (nameColIdx === -1) {
      firstNameColIdx = lowerHeaders.findIndex(h => /first[_\s]?name|fname/.test(h));
      lastNameColIdx = lowerHeaders.findIndex(h => /last[_\s]?name|lname|surname/.test(h));
    }

    if (phoneColIdx !== -1) detectedColPhone = headerRow[phoneColIdx];
    if (nameColIdx !== -1) detectedColName = headerRow[nameColIdx];
    else if (firstNameColIdx !== -1) detectedColName = 'First + Last Name';
  }

  // Infer missing columns from data rows if needed
  if (phoneColIdx === -1 || (nameColIdx === -1 && firstNameColIdx === -1)) {
    const sampleRows = rows.slice(startRow, Math.min(rows.length, startRow + 10));
    const colCount = Math.max(...sampleRows.map(r => r.length));

    if (phoneColIdx === -1) {
      let bestPhoneScore = -1;
      for (let c = 0; c < colCount; c++) {
        const phoneMatches = sampleRows.filter(r => r[c] && isLikelyPhoneNumber(r[c])).length;
        if (phoneMatches > bestPhoneScore) {
          bestPhoneScore = phoneMatches;
          phoneColIdx = c;
        }
      }
      if (phoneColIdx !== -1) {
        detectedColPhone = `Column ${phoneColIdx + 1}`;
      }
    }

    if (nameColIdx === -1 && firstNameColIdx === -1) {
      for (let c = 0; c < colCount; c++) {
        if (c === phoneColIdx) continue;
        const textMatches = sampleRows.filter(r => r[c] && /[a-zA-Z\u00C0-\u024F\u0900-\u097F]/.test(r[c])).length;
        if (textMatches > 0) {
          nameColIdx = c;
          detectedColName = `Column ${c + 1}`;
          break;
        }
      }
      if (nameColIdx === -1 && colCount === 2) {
        nameColIdx = phoneColIdx === 0 ? 1 : 0;
        detectedColName = `Column ${nameColIdx + 1}`;
      }
    }
  }

  const contactsMap = new Map<string, RecipientContact>();

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    let phone = '';

    if (phoneColIdx !== -1 && row[phoneColIdx]) {
      phone = sanitizePhoneNumber(row[phoneColIdx]);
    } else {
      for (let c = 0; c < row.length; c++) {
        if (isLikelyPhoneNumber(row[c])) {
          phone = sanitizePhoneNumber(row[c]);
          break;
        }
      }
    }

    if (phone.length < 7 || phone.length > 16) continue;

    let name = '';
    if (nameColIdx !== -1 && row[nameColIdx]) {
      name = row[nameColIdx].trim();
    } else if (firstNameColIdx !== -1) {
      const first = row[firstNameColIdx]?.trim() || '';
      const last = lastNameColIdx !== -1 ? (row[lastNameColIdx]?.trim() || '') : '';
      name = `${first} ${last}`.trim();
    } else {
      for (let c = 0; c < row.length; c++) {
        if (c !== phoneColIdx && sanitizePhoneNumber(row[c]) !== phone && /[a-zA-Z]/.test(row[c])) {
          name = row[c].trim();
          break;
        }
      }
    }

    if (!contactsMap.has(phone) || (!contactsMap.get(phone)!.name && name)) {
      contactsMap.set(phone, { phone, name });
    }
  }

  const contacts = Array.from(contactsMap.values());
  const withName = contacts.filter(c => Boolean(c.name)).length;

  if (contacts.length === 0) {
    return {
      contacts: [],
      summary: { total: 0, withName: 0 },
      error: 'No valid phone numbers found in CSV. Ensure numbers include country code (e.g. 14155552671 or 919876543210).',
    };
  }

  return {
    contacts,
    summary: {
      total: contacts.length,
      withName,
      colName: detectedColName,
      colPhone: detectedColPhone,
    },
  };
}

function parseManualContacts(rawText: string): RecipientContact[] {
  if (!rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result: RecipientContact[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const parts = line.split(/[,;\t]/);
    if (parts.length === 2 && !isLikelyPhoneNumber(parts[0]) && isLikelyPhoneNumber(parts[1])) {
      const name = parts[0].trim();
      const phone = sanitizePhoneNumber(parts[1]);
      if (phone.length >= 7 && phone.length <= 16 && !seen.has(phone)) {
        seen.add(phone);
        result.push({ phone, name });
      }
      continue;
    }
    if (parts.length === 2 && isLikelyPhoneNumber(parts[0]) && !isLikelyPhoneNumber(parts[1])) {
      const phone = sanitizePhoneNumber(parts[0]);
      const name = parts[1].trim();
      if (phone.length >= 7 && phone.length <= 16 && !seen.has(phone)) {
        seen.add(phone);
        result.push({ phone, name });
      }
      continue;
    }

    const splitByColonOrDash = line.split(/[:\-]/);
    if (splitByColonOrDash.length === 2) {
      const [p1, p2] = splitByColonOrDash;
      if (!isLikelyPhoneNumber(p1) && isLikelyPhoneNumber(p2)) {
        const phone = sanitizePhoneNumber(p2);
        if (phone.length >= 7 && phone.length <= 16 && !seen.has(phone)) {
          seen.add(phone);
          result.push({ phone, name: p1.trim() });
          continue;
        }
      }
    }

    const phone = sanitizePhoneNumber(line);
    if (phone.length >= 7 && phone.length <= 16 && !seen.has(phone)) {
      seen.add(phone);
      result.push({ phone, name: '' });
    }
  }

  return result;
}

export function formatPersonalizedMessage(
  template: string,
  contactName: string,
  prefixGreeting: boolean,
  greetingTemplate: string
): string {
  let result = template.trim();
  const hasNamePlaceholder = /\{name\}|\{\{name\}\}|\{Name\}|\{\{Name\}\}|\{NAME\}|\{\{NAME\}\}/i.test(result);

  if (hasNamePlaceholder) {
    const replacement = contactName.trim() || '';
    result = result.replace(/\{\{?name\}?\}|\{\{?Name\}?\}|\{\{?NAME\}?\}/gi, replacement);
    result = result.replace(/\s{2,}/g, ' ').trim();
  } else if (prefixGreeting && contactName.trim()) {
    const greeting = greetingTemplate.replace(/\{\{?name\}?\}|\{\{?Name\}?\}|\{\{?NAME\}?\}/gi, contactName.trim());
    result = `${greeting.trim()} ${result}`.trim();
  }

  return result;
}

export function Marketing() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.marketing') || 'Marketing');

  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // Target audience
  const [inputMode, setInputMode] = useState<'csv' | 'manual'>('csv');
  const [contactsText, setContactsText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedCsvContacts, setParsedCsvContacts] = useState<RecipientContact[]>([]);
  const [csvSummary, setCsvSummary] = useState<CsvParseSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Message & Media composition
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [mediaSource, setMediaSource] = useState<'upload' | 'url'>('upload');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadedFile, setUploadedFile] = useState<UploadedFileState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState('Hello {name}, we are excited to share our latest updates with you!');
  const [documentFilename, setDocumentFilename] = useState('');

  // Personalization settings
  const [prefixGreeting, setPrefixGreeting] = useState<boolean>(false);
  const [greetingTemplate, setGreetingTemplate] = useState<string>('Hello {name},');
  const [previewContactIdx, setPreviewContactIdx] = useState<number>(0);

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
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-select first active session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      const readySession = sessions.find(s => s.status === 'ready');
      setSelectedSessionId(readySession ? readySession.id : sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Extract recipients from manual input
  const manualRecipients = useMemo(() => {
    return parseManualContacts(contactsText);
  }, [contactsText]);

  // Active target contacts list
  const targetContacts = inputMode === 'csv' ? parsedCsvContacts : manualRecipients;

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
        const parseResult = parseContactsFromCsv(text);

        if (parseResult.error) {
          setCsvError(parseResult.error);
          setParsedCsvContacts([]);
          setCsvSummary(null);
        } else {
          setParsedCsvContacts(parseResult.contacts);
          setCsvSummary(parseResult.summary);
          setPreviewContactIdx(0);
          // If message does not currently have {name}, enable prefix greeting automatically
          if (!/\{name\}/i.test(message)) {
            setPrefixGreeting(true);
          }
        }
      } catch {
        setCsvError('Failed to parse CSV file. Please check file formatting.');
        setParsedCsvContacts([]);
        setCsvSummary(null);
      }
    };
    reader.onerror = () => {
      setCsvError('Failed to read CSV file');
    };
    reader.readAsText(file);
  };

  // Insert {name} tag at current cursor position in message textarea
  const handleInsertNameTag = () => {
    const textarea = messageInputRef.current;
    const tag = '{name}';
    if (!textarea) {
      setMessage(prev => (prev ? `${prev} ${tag}` : `Hello ${tag}, `));
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newMsg = message.substring(0, start) + tag + message.substring(end);
    setMessage(newMsg);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
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

  const handleOpenMediaFileChooser = () => {
    setMediaSource('upload');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
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

  // Validation
  const isSubmitDisabled =
    !selectedSessionId ||
    targetContacts.length === 0 ||
    (messageType === 'text' && !message.trim()) ||
    (messageType !== 'text' && mediaSource === 'upload' && !uploadedFile) ||
    (messageType !== 'text' && mediaSource === 'url' && !mediaUrl.trim()) ||
    isSending;

  // Execute campaign
  const handleStartCampaign = async () => {
    if (isSubmitDisabled) return;

    setIsSending(true);
    setCampaignProgress({
      total: targetContacts.length,
      sent: 0,
      failed: 0,
      pending: targetContacts.length,
      status: 'running',
    });

    // Build personalized messages for all contacts
    const messagesList: BulkMessageItem[] = targetContacts.map(contact => {
      const chatId = `${contact.phone}@c.us`;
      const personalizedText = formatPersonalizedMessage(
        message,
        contact.name,
        prefixGreeting,
        greetingTemplate
      );
      const personalizedCaption = formatPersonalizedMessage(
        message,
        contact.name,
        prefixGreeting,
        greetingTemplate
      );

      const variables: Record<string, string> = {
        name: contact.name || '',
        Name: contact.name || '',
      };

      if (messageType === 'text') {
        return {
          chatId,
          type: 'text',
          content: { text: personalizedText },
          variables,
        };
      } else if (messageType === 'image') {
        return {
          chatId,
          type: 'image',
          content: {
            caption: personalizedCaption || undefined,
            image:
              mediaSource === 'upload' && uploadedFile
                ? { base64: uploadedFile.base64, mimetype: uploadedFile.type }
                : { url: mediaUrl.trim() },
          },
          variables,
        };
      } else if (messageType === 'video') {
        return {
          chatId,
          type: 'video',
          content: {
            caption: personalizedCaption || undefined,
            video:
              mediaSource === 'upload' && uploadedFile
                ? { base64: uploadedFile.base64, mimetype: uploadedFile.type }
                : { url: mediaUrl.trim() },
          },
          variables,
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
          variables,
        };
      } else {
        // Document
        return {
          chatId,
          type: 'document',
          content: {
            caption: personalizedCaption || undefined,
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
          variables,
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

  // Preview contact info
  const previewContact = targetContacts[previewContactIdx] || targetContacts[0] || { name: 'Customer Name', phone: '14155552671' };
  const renderedPreviewText = formatPersonalizedMessage(
    message,
    previewContact.name,
    prefixGreeting,
    greetingTemplate
  );

  return (
    <div className="marketing-page" id="marketing-page">
      <PageHeader
        title={t('nav.marketing') || 'Marketing Campaigns'}
        subtitle="Broadcast personalized messages with recipient names, images, videos, or documents to your contact lists."
      />

      <div className="marketing-card" id="marketing-campaign-card">
        {/* Step 1: Active WhatsApp Session */}
        <h3 className="section-title">1. Select WhatsApp Session</h3>
        <div className="form-group" style={{ marginBottom: '2rem' }}>
          <label htmlFor="session-select">Sending Channel</label>
          <select
            id="session-select"
            className="session-select"
            value={selectedSessionId ?? ''}
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
              value="csv"
              checked={Boolean(inputMode === 'csv')}
              onChange={() => setInputMode('csv')}
              className="sr-only"
              disabled={isSending}
            />
            <div className="radio-card-content">
              <div className="icon-wrapper">
                <Upload size={24} />
              </div>
              <span className="card-title">Upload CSV File</span>
              <p className="card-desc">Import contacts with names and numbers</p>
            </div>
          </label>

          <label className={`radio-card ${inputMode === 'manual' ? 'active' : ''}`} id="radio-card-manual">
            <input
              type="radio"
              name="inputMode"
              value="manual"
              checked={Boolean(inputMode === 'manual')}
              onChange={() => setInputMode('manual')}
              className="sr-only"
              disabled={isSending}
            />
            <div className="radio-card-content">
              <div className="icon-wrapper">
                <Users size={24} />
              </div>
              <span className="card-title">Manual Entry</span>
              <p className="card-desc">Paste "Name, Phone" or phone numbers</p>
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
                Supports CSV spreadsheets with columns like <strong>Name, Phone</strong> or <strong>First Name, Last Name, Mobile</strong>. Numbers must contain country codes (e.g. 14155552671 or 919876543210).
              </span>

              {csvFile && parsedCsvContacts.length > 0 && (
                <>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                    <div className="audience-badge">
                      <FileCheck size={14} />
                      <span>
                        {parsedCsvContacts.length} recipient{parsedCsvContacts.length === 1 ? '' : 's'} in {csvFile.name}
                      </span>
                    </div>

                    {csvSummary && csvSummary.withName > 0 && (
                      <div className="audience-badge" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb' }}>
                        <UserCheck size={14} />
                        <span>
                          {csvSummary.withName} with names detected {csvSummary.colName ? `(${csvSummary.colName})` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Contacts preview table */}
                  <div className="contacts-preview-box" id="csv-contacts-preview-box">
                    <div className="contacts-preview-header">
                      <span>Imported Contacts Preview</span>
                      <span>Showing {Math.min(parsedCsvContacts.length, 50)} of {parsedCsvContacts.length}</span>
                    </div>
                    <div className="contacts-table-scroll">
                      <table className="contacts-table">
                        <thead>
                          <tr>
                            <th style={{ width: '40px' }}>#</th>
                            <th>Contact Name</th>
                            <th>Phone Number</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedCsvContacts.slice(0, 50).map((c, idx) => (
                            <tr key={`${c.phone}-${idx}`}>
                              <td>{idx + 1}</td>
                              <td>
                                {c.name ? (
                                  <span className="contact-name-badge">{c.name}</span>
                                ) : (
                                  <span className="contact-no-name">— (No name in CSV)</span>
                                )}
                              </td>
                              <td style={{ fontFamily: 'monospace' }}>+{c.phone}</td>
                              <td>
                                <span style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.75rem' }}>
                                  Ready
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
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
              <label htmlFor="manual-contacts">
                Contacts List (one per line, e.g. "John Doe, 14155552671" or "14155552671")
              </label>
              <textarea
                id="manual-contacts"
                placeholder="Devi Jewellers, 912162228131&#10;John Doe, 14155552671&#10;Jane Smith, 447700900077"
                value={contactsText ?? ''}
                onChange={e => setContactsText(e.target.value)}
                className="contacts-textarea"
                disabled={isSending}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="hint">Format: "Name, Phone" or numbers with country code.</span>
                {manualRecipients.length > 0 && (
                  <div className="audience-badge">
                    <Users size={14} />
                    <span>
                      {manualRecipients.length} recipient{manualRecipients.length === 1 ? '' : 's'} (
                      {manualRecipients.filter(c => Boolean(c.name)).length} with names)
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="divider"></div>

        {/* Step 3: Compose Message & Personalization */}
        <h3 className="section-title">3. Compose Personalized Message & Media</h3>

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
            {/* Always mounted in DOM so fileInputRef is immediately accessible on click */}
            <input
              ref={fileInputRef}
              id="media-file-input"
              type="file"
              accept={getAcceptedMimeTypes(messageType)}
              onChange={handleMediaFileChange}
              style={{ display: 'none' }}
            />

            <div className="form-group">
              <label>Media Source</label>
              <div className="toggle-group" id="media-source-toggle-group">
                <button
                  type="button"
                  id="media-source-upload-btn"
                  className={mediaSource === 'upload' ? 'active' : ''}
                  onClick={handleOpenMediaFileChooser}
                  disabled={isSending}
                  title="Click to open file picker and choose media"
                >
                  <UploadCloud size={16} />
                  <span>Upload File</span>
                </button>
                <button
                  type="button"
                  id="media-source-url-btn"
                  className={mediaSource === 'url' ? 'active' : ''}
                  onClick={() => setMediaSource('url')}
                  disabled={isSending}
                  title="Provide direct web URL"
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

                {!uploadedFile ? (
                  <div
                    id="marketing-media-dropzone"
                    className={`media-upload-zone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleMediaDragOver}
                    onDragLeave={handleMediaDragLeave}
                    onDrop={handleMediaDrop}
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
                      className="btn-change-file"
                      id="marketing-btn-change-file"
                      onClick={handleOpenMediaFileChooser}
                      title="Choose another file"
                      disabled={isSending}
                    >
                      <UploadCloud size={14} />
                      <span>Change</span>
                    </button>
                    <button
                      type="button"
                      className="btn-remove-file"
                      id="marketing-btn-remove-file"
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
                  value={mediaUrl ?? ''}
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
                  value={documentFilename ?? ''}
                  onChange={e => setDocumentFilename(e.target.value)}
                  className="contacts-textarea"
                  style={{ minHeight: 'unset', height: '44px' }}
                  disabled={isSending}
                />
              </div>
            )}
          </div>
        )}

        {/* Personalization Variable Insert Bar */}
        <div className="variable-bar" id="personalization-variable-bar">
          <div className="variable-bar-left">
            <span className="variable-bar-label">
              <Sparkles size={15} color="var(--primary)" />
              Personalize with CSV name:
            </span>
            <button
              type="button"
              className="variable-tag-btn"
              onClick={handleInsertNameTag}
              title="Click to insert {name} placeholder"
              disabled={isSending}
            >
              + {'{name}'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label className="personalization-toggle-label">
              <input
                type="checkbox"
                checked={Boolean(prefixGreeting)}
                onChange={e => setPrefixGreeting(e.target.checked)}
                disabled={isSending}
              />
              <span>Auto-greeting prefix if not in message</span>
            </label>

            {prefixGreeting && (
              <select
                className="session-select"
                style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                value={greetingTemplate ?? 'Hello {name},'}
                onChange={e => setGreetingTemplate(e.target.value)}
                disabled={isSending}
              >
                <option value="Hello {name},">Hello {"{name}"},</option>
                <option value="Hi {name},">Hi {"{name}"},</option>
                <option value="Dear {name},">Dear {"{name}"},</option>
                <option value="{name},">{"{name}"},</option>
              </select>
            )}
          </div>
        </div>

        {/* Message / Caption Input */}
        <div className="form-group">
          <label htmlFor="campaign-message">
            {messageType === 'text' ? 'Message Content' : 'Caption (Optional)'}
          </label>
          <div className="message-composer">
            <MessageSquare size={18} className="composer-icon" />
            <textarea
              ref={messageInputRef}
              id="campaign-message"
              placeholder={
                messageType === 'text'
                  ? 'e.g. Hello {name}, your special offer is ready!'
                  : 'Add an optional caption for your media message...'
              }
              value={message ?? ''}
              onChange={e => setMessage(e.target.value)}
              className="message-textarea"
              disabled={isSending}
            />
          </div>
          <span className="hint">
            Tip: Use <code>{'{name}'}</code> anywhere in the message. Each recipient will receive their real name from the CSV file.
          </span>
        </div>

        {/* Live Personalization Preview Box */}
        {targetContacts.length > 0 && (
          <div className="live-preview-box" id="live-message-preview-box">
            <div className="live-preview-header">
              <div className="live-preview-title">
                <Eye size={15} color="var(--primary)" />
                <span>Live Personalization Preview (as seen by recipient)</span>
              </div>
              {targetContacts.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Preview for:</span>
                  <select
                    className="live-preview-recipient-select"
                    value={previewContactIdx ?? 0}
                    onChange={e => setPreviewContactIdx(Number(e.target.value))}
                  >
                    {targetContacts.slice(0, 10).map((c, i) => (
                      <option key={`${c.phone}-${i}`} value={i}>
                        {c.name ? `${c.name} (+${c.phone})` : `+${c.phone}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="preview-bubble-wrapper">
              <div className="preview-recipient-info">
                To: {previewContact.name ? <strong>{previewContact.name}</strong> : 'Contact'} (+{previewContact.phone})
              </div>
              <div className="preview-whatsapp-bubble">
                {messageType !== 'text' && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem', color: 'var(--primary)', fontWeight: 600, fontSize: '0.75rem' }}>
                    {messageType === 'image' && <ImageIcon size={14} />}
                    {messageType === 'video' && <Video size={14} />}
                    {messageType === 'audio' && <Volume2 size={14} />}
                    {messageType === 'document' && <FileText size={14} />}
                    <span>[{uploadedFile ? uploadedFile.name : messageType.toUpperCase()}]</span>
                  </div>
                )}
                <div>{renderedPreviewText || <span style={{ color: 'var(--text-muted)' }}>(No text)</span>}</div>
              </div>
            </div>
          </div>
        )}

        {/* Delay & Anti-Ban Controls */}
        <div className="divider"></div>
        <h3 className="section-title">4. Delivery & Pacing</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="form-group">
            <label htmlFor="delay-select">Pacing Delay</label>
            <select
              id="delay-select"
              className="session-select"
              value={delayBetweenMessages ?? 3000}
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
                checked={Boolean(randomizeDelay)}
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
                Start Campaign ({targetContacts.length} Recipient{targetContacts.length === 1 ? '' : 's'})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

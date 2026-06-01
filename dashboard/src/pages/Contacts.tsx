import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Download, Search, Trash2, Users, FileSpreadsheet, Loader2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { sessionApi, type Session } from '../services/api';
import './Contacts.css';

interface Contact {
  id: string;
  number: string;
  name?: string;
  notes?: string;
  isWhatsAppUser: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ImportResult {
  number: string;
  name?: string;
  notes?: string;
  imported: boolean;
  error?: string;
}

export function Contacts() {
  const { t } = useTranslation();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportResults, setShowImportResults] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadContacts(selectedSession);
    } else {
      setContacts([]);
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      const data = await sessionApi.list();
      setSessions(data);
      // Auto-select first ready session
      const readySession = data.find((s: Session) => s.status === 'ready' || s.status === 'qr_ready');
      if (readySession) {
        setSelectedSession(readySession.id);
      }
    } catch (err) {
      toast.error(t('common.errorGeneric'), err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async (sessionId: string) => {
    try {
      setLoading(true);
      const apiKey = sessionStorage.getItem('openwa_api_key');
      const response = await fetch(`/api/sessions/${sessionId}/contacts`, {
        headers: { 'X-API-Key': apiKey || '' },
      });
      if (response.ok) {
        const data = await response.json();
        setContacts(data);
      }
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSession) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const apiKey = sessionStorage.getItem('openwa_api_key');
      const response = await fetch(`/api/sessions/${selectedSession}/contacts/import/excel`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey || '' },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Import failed');
      }

      const result = await response.json();
      setImportResults(result.results || []);
      setShowImportResults(true);
      
      const successCount = result.imported || 0;
      const failCount = result.failed || 0;
      
      toast.success(
        t('contacts.import.success'),
        `${successCount} ${t('contacts.import.successCount', { count: successCount })}${failCount > 0 ? `, ${failCount} ${t('contacts.import.failedCount', { count: failCount })}` : ''}`
      );

      // Reload contacts
      loadContacts(selectedSession);
    } catch (err) {
      toast.error(t('contacts.import.error'), err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!selectedSession) return;
    
    try {
      const apiKey = sessionStorage.getItem('openwa_api_key');
      const response = await fetch(`/api/sessions/${selectedSession}/contacts/${contactId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey || '' },
      });

      if (response.ok) {
        setContacts(contacts.filter(c => c.id !== contactId));
        toast.success(t('contacts.delete.success'));
      } else {
        throw new Error('Delete failed');
      }
    } catch (err) {
      toast.error(t('contacts.delete.error'), err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleExportCSV = () => {
    if (contacts.length === 0) return;

    const headers = ['number', 'name', 'notes', 'isWhatsAppUser', 'createdAt'];
    const csvContent = [
      headers.join(','),
      ...contacts.map(c => 
        headers.map(h => {
          const value = c[h as keyof Contact];
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts-${selectedSession}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredContacts = contacts.filter(c => {
    const query = searchQuery.toLowerCase();
    return (
      c.number.toLowerCase().includes(query) ||
      c.name?.toLowerCase().includes(query) ||
      c.notes?.toLowerCase().includes(query)
    );
  });

  if (loading && sessions.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="contacts-page">
      <PageHeader
        title={t('contacts.title')}
        subtitle={t('contacts.subtitle')}
      />

      <div className="contacts-toolbar">
        <div className="session-selector">
          <label>{t('contacts.session')}:</label>
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
            disabled={loading}
          >
            <option value="">{t('contacts.selectSession')}</option>
            {sessions.map(session => (
              <option key={session.id} value={session.id}>
                {session.name} ({session.status})
              </option>
            ))}
          </select>
        </div>

        {selectedSession && (
          <>
            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                placeholder={t('contacts.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="toolbar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                id="file-upload"
              />
              <label htmlFor="file-upload" className={`btn-primary ${importing ? 'disabled' : ''}`}>
                {importing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Upload size={18} />
                )}
                {t('contacts.import')}
              </label>
              
              <button
                className="btn-secondary"
                onClick={handleExportCSV}
                disabled={contacts.length === 0}
              >
                <Download size={18} />
                {t('contacts.export')}
              </button>
            </div>
          </>
        )}
      </div>

      {!selectedSession ? (
        <div className="empty-state">
          <Users size={48} />
          <h3>{t('contacts.selectSessionPrompt')}</h3>
          <p>{t('contacts.selectSessionHint')}</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="empty-state">
          <FileSpreadsheet size={48} />
          <h3>{contacts.length === 0 ? t('contacts.empty.title') : t('contacts.noResults')}</h3>
          <p>{contacts.length === 0 ? t('contacts.empty.description') : t('contacts.noResultsHint')}</p>
          {contacts.length === 0 && (
            <label htmlFor="file-upload" className="btn-primary" style={{ marginTop: '1rem' }}>
              <Upload size={18} />
              {t('contacts.import')}
            </label>
          )}
        </div>
      ) : (
        <div className="contacts-table-container">
          <table className="contacts-table">
            <thead>
              <tr>
                <th>{t('contacts.columns.number')}</th>
                <th>{t('contacts.columns.name')}</th>
                <th>{t('contacts.columns.notes')}</th>
                <th>{t('contacts.columns.whatsApp')}</th>
                <th>{t('contacts.columns.created')}</th>
                <th>{t('contacts.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map(contact => (
                <tr key={contact.id}>
                  <td className="phone-cell">{contact.number}</td>
                  <td>{contact.name || '—'}</td>
                  <td>{contact.notes || '—'}</td>
                  <td>
                    <span className={`whatsapp-badge ${contact.isWhatsAppUser ? 'yes' : 'no'}`}>
                      {contact.isWhatsAppUser ? t('contacts.yes') : t('contacts.no')}
                    </span>
                  </td>
                  <td>{new Date(contact.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn-icon danger"
                      onClick={() => handleDeleteContact(contact.id)}
                      title={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="contacts-stats">
        {t('contacts.stats', { count: filteredContacts.length, total: contacts.length })}
      </div>

      {showImportResults && importResults.length > 0 && (
        <div className="modal-overlay" onClick={() => setShowImportResults(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('contacts.import.results')}</h2>
            </div>
            <div className="modal-body">
              <div className="import-results-list">
                {importResults.map((result, i) => (
                  <div key={i} className={`import-result-item ${result.imported ? 'success' : 'error'}`}>
                    <span className="result-number">{result.number}</span>
                    {result.name && <span className="result-name">{result.name}</span>}
                    {result.error && <span className="result-error">{result.error}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowImportResults(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
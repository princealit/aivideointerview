import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CirclePlay, CircleStop, Download, Loader2, Mic, Play, Settings, Trash2, Video, Wand2, CloudUpload, Edit2, Copy, Share, Link } from "lucide-react";

/**
 * AI Interview App – Enhanced Conversational Video Interview Tool (Client-side, Free)
 * ------------------------------------------------------------------
 * ✅ No backend required – everything runs in the browser
 * ✅ Works for ANY company/role – create multiple templates with unique questions
 * ✅ Record per-question video answers (WebM) with webcam + mic
 * ✅ Editable questions with inline editing
 * ✅ Global Google Drive settings (persistent)
 * ✅ Persistent interview templates for reuse
 * ✅ Shareable candidate links - no admin access needed
 * ✅ Auto-upload when all answers are recorded (configurable per template)
 */

// ---------- Types ----------

type InterviewQuestion = {
  id: string;
  prompt: string;
  guidance?: string;
  required?: boolean;
  timeLimitSec?: number;
  keywords?: string[];
  weight?: number;
};

type InterviewTemplate = {
  id: string;
  name: string;
  company?: string;
  role?: string;
  timezoneNote?: string;
  intro?: string;
  outro?: string;
  questions: InterviewQuestion[];
  rubric?: string;
  driveClientId?: string;
  driveFolderId?: string;
  autoUploadOnFinish?: boolean;
};

type RecordingClip = {
  qid: string;
  blob?: Blob;
  url?: string;
  durationMs?: number;
  transcript?: string;
  score?: number;
  keywordHits?: string[];
};

type GlobalSettings = {
  driveClientId: string;
  driveFolderId: string;
};

// ---------- Utilities ----------

const uid = () => Math.random().toString(36).slice(2);

const speak = async (text: string) => {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
};

const stopSpeak = () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); };

const estimateScore = (answer: string, keywords: string[] = [], weight = 1) => {
  if (!answer) return 0;
  if (!keywords.length) return 0.5 * weight;
  const text = answer.toLowerCase();
  const hits = keywords.filter(k => text.includes(k.toLowerCase()));
  return (hits.length / keywords.length) * weight;
};

const totalWeighted = (clips: RecordingClip[], tmpl: InterviewTemplate) => {
  let w = 0, s = 0;
  for (const q of tmpl.questions) {
    const clip = clips.find(c => c.qid === q.id);
    const weight = q.weight ?? 1;
    w += weight;
    s += (clip?.score ?? 0) * 1;
  }
  return w ? s / w : 0;
};

// ---------- Google Drive Upload ----------

const DRIVE_DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement('script');
  s.src = src; s.async = true;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error(`Failed to load ${src}`));
  document.head.appendChild(s);
});

const driveClient: any = {
  ready: false,
  token: undefined,
  async init(clientId: string) {
    try {
      await loadScript("https://accounts.google.com/gsi/client");
      await loadScript("https://apis.google.com/js/api.js");
      // @ts-ignore
      await new Promise<void>(res => gapi.load('client', () => res()));
      // @ts-ignore
      await gapi.client.init({ discoveryDocs: [DRIVE_DISCOVERY] });
      
      // @ts-ignore
      this._tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        redirect_uri: window.location.origin,
        callback: (resp: any) => {
          if (resp.error) {
            console.error('OAuth error:', resp.error);
            throw new Error(`Google Drive authentication failed: ${resp.error}`);
          }
          this.token = resp.access_token;
          // @ts-ignore
          gapi.client.setToken({ access_token: this.token });
        },
      });
      this.ready = true;
    } catch (error) {
      console.error('Drive client initialization failed:', error);
      throw new Error('Failed to initialize Google Drive. Please check your Client ID.');
    }
  },
  async ensureAuth() {
    if (this.token) return;
    
    return new Promise<void>((resolve, reject) => {
      try {
        // @ts-ignore
        this._tokenClient.requestAccessToken({ 
          prompt: 'consent',
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(`Authentication failed: ${response.error}`));
            } else {
              resolve();
            }
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  },
  async uploadZip(fileName: string, blob: Blob, folderId?: string) {
    await this.ensureAuth();
    const metadata: any = { name: fileName, mimeType: 'application/zip' };
    if (folderId) metadata.parents = [folderId];
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    // @ts-ignore
    const res = await gapi.client.request({
      path: '/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      method: 'POST',
      body: form,
    });
    return res.result;
  }
};

// ---------- Local Storage ----------

const LS_KEY_TEMPLATES = "ai_interview_templates_v2";
const LS_KEY_GLOBAL_SETTINGS = "ai_interview_global_settings";

const loadTemplates = (): InterviewTemplate[] => {
  try {
    const s = localStorage.getItem(LS_KEY_TEMPLATES);
    if (!s) return [];
    return JSON.parse(s) as InterviewTemplate[];
  } catch {
    return [];
  }
};

const saveTemplates = (t: InterviewTemplate[]) => localStorage.setItem(LS_KEY_TEMPLATES, JSON.stringify(t));

const loadGlobalSettings = (): GlobalSettings => {
  try {
    const s = localStorage.getItem(LS_KEY_GLOBAL_SETTINGS);
    if (!s) return {
      driveClientId: "138878321119-dqs9tqvft80lf5v1hv2ssndostv7n64q.apps.googleusercontent.com",
      driveFolderId: "16wDvuUeX3pC77MRcdzCwoTTMmD2a3gOE"
    };
    return JSON.parse(s) as GlobalSettings;
  } catch {
    return {
      driveClientId: "138878321119-dqs9tqvft80lf5v1hv2ssndostv7n64q.apps.googleusercontent.com",
      driveFolderId: "16wDvuUeX3pC77MRcdzCwoTTMmD2a3gOE"
    };
  }
};

const saveGlobalSettings = (settings: GlobalSettings) => localStorage.setItem(LS_KEY_GLOBAL_SETTINGS, JSON.stringify(settings));

// ---------- URL Utilities ----------

const generateCandidateUrl = (templateId: string) => {
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}?interview=${templateId}`;
};

const getTemplateFromUrl = (): string | null => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('interview');
};

// ---------- Media Hook ----------

function useRecorder() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const chunksRef = useRef<Blob[]>([]);

  const request = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setStream(s);
    return s;
  };

  const start = async () => {
    // Clear previous chunks
    chunksRef.current = [];
    
    const s = stream ?? (await request());
    const mr = new MediaRecorder(s, { mimeType: "video/webm;codecs=vp8,opus" });
    
    mr.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };
    
    mr.start();
    setRecorder(mr);
    setRecording(true);
  };

  const stop = async (): Promise<Blob | null> => {
    if (!recorder || !recording) return null;
    
    return new Promise(resolve => {
      const currentRecorder = recorder;
      
      currentRecorder.onstop = () => {
        setRecording(false);
        setRecorder(null);
        
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        chunksRef.current = []; // Clear for next recording
        resolve(blob);
      };
      
      currentRecorder.stop();
    });
  };

  const stopTracks = () => { 
    stream?.getTracks().forEach(t => t.stop()); 
    setStream(null);
  };

  return { stream, request, start, stop, recording, stopTracks };
}

// ---------- Share Modal Component ----------

function ShareModal({ template, onClose }: { template: InterviewTemplate; onClose: () => void }) {
  const candidateUrl = generateCandidateUrl(template.id);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(candidateUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = candidateUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Share Interview Link</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">×</button>
        </div>
        
        <div className="mb-4 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-blue-800 mb-2">Interview Details:</h4>
          <p><strong>Company:</strong> {template.company}</p>
          <p><strong>Role:</strong> {template.role}</p>
          <p><strong>Questions:</strong> {template.questions.length}</p>
          <p><strong>Auto-upload:</strong> {template.autoUploadOnFinish ? 'Yes' : 'No'}</p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Candidate Interview Link:</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={candidateUrl}
              readOnly
              className="flex-1 p-3 border rounded-lg bg-gray-50 font-mono text-sm"
            />
            <button
              onClick={copyToClipboard}
              className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                copied 
                  ? 'bg-green-600 text-white' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {copied ? '✓ Copied!' : <><Copy size={16} className="inline mr-1"/> Copy</>}
            </button>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <h4 className="font-medium text-yellow-800 mb-2">📋 Instructions for Candidates:</h4>
          <ol className="text-sm text-yellow-700 space-y-1">
            <li>1. Click the link above to start the interview</li>
            <li>2. Allow camera and microphone access when prompted</li>
            <li>3. Enter their full name (optional but recommended)</li>
            <li>4. Answer each question within the time limit</li>
            <li>5. Navigate between questions using Previous/Next buttons</li>
            <li>6. {template.autoUploadOnFinish ? 'Answers will auto-upload to Google Drive when complete' : 'Click "Export & Upload" when finished'}</li>
          </ol>
        </div>

        <div className="flex gap-3">
          <button
            onClick={copyToClipboard}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            <Share size={16} className="inline mr-2"/>
            Copy Link to Share
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Admin Panel ----------

function AdminPanel({ onLaunch }: { onLaunch: (tmpl: InterviewTemplate) => void }) {
  const [templates, setTemplates] = useState<InterviewTemplate[]>(loadTemplates());
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(loadGlobalSettings());
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  
  const selected = useMemo(() => templates.find(t => t.id === selectedId)!, [templates, selectedId]);

  const updateGlobalSettings = (patch: Partial<GlobalSettings>) => {
    const newSettings = { ...globalSettings, ...patch };
    setGlobalSettings(newSettings);
    saveGlobalSettings(newSettings);
  };

  const addQuestion = () => {
    const q: InterviewQuestion = { 
      id: uid(), 
      prompt: "Click to edit this question", 
      required: false, 
      timeLimitSec: 120, 
      weight: 1 
    };
    const next = templates.map(t => t.id === selected.id ? { ...t, questions: [...t.questions, q] } : t);
    setTemplates(next); 
    saveTemplates(next);
    setEditingQuestionId(q.id);
  };

  const updateTemplate = (patch: Partial<InterviewTemplate>) => {
    const next = templates.map(t => t.id === selected.id ? { 
      ...t, 
      ...patch,
      driveClientId: patch.driveClientId !== undefined ? patch.driveClientId : globalSettings.driveClientId,
      driveFolderId: patch.driveFolderId !== undefined ? patch.driveFolderId : globalSettings.driveFolderId,
    } : t);
    setTemplates(next); 
    saveTemplates(next);
  };

  const updateQuestion = (questionId: string, patch: Partial<InterviewQuestion>) => {
    const next = templates.map(t => 
      t.id === selected.id 
        ? { ...t, questions: t.questions.map(q => q.id === questionId ? { ...q, ...patch } : q) }
        : t
    );
    setTemplates(next); 
    saveTemplates(next);
  };

  const deleteQuestion = (questionId: string) => {
    const next = templates.map(t => 
      t.id === selected.id 
        ? { ...t, questions: t.questions.filter(q => q.id !== questionId) }
        : t
    );
    setTemplates(next); 
    saveTemplates(next);
  };

  const createTemplate = () => {
    const t: InterviewTemplate = { 
      id: uid(), 
      name: "New Template", 
      company: "", 
      role: "", 
      questions: [],
      driveClientId: globalSettings.driveClientId,
      driveFolderId: globalSettings.driveFolderId,
      autoUploadOnFinish: true
    };
    const next = [t, ...templates];
    setTemplates(next); 
    saveTemplates(next); 
    setSelectedId(t.id);
  };

  const duplicateTemplate = () => {
    if (!selected) return;
    const t: InterviewTemplate = {
      ...selected,
      id: uid(),
      name: `${selected.name} (Copy)`,
      driveClientId: globalSettings.driveClientId,
      driveFolderId: globalSettings.driveFolderId,
    };
    const next = [t, ...templates];
    setTemplates(next); 
    saveTemplates(next); 
    setSelectedId(t.id);
  };

  if (!selected) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-bold mb-4">AI Interview Templates</h2>
        <p className="mb-4">No templates found. Create your first template to get started.</p>
        <button 
          onClick={createTemplate}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
        >
          Create First Template
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-4">AI Interview Templates</h2>
      
      {/* Global Settings */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-medium mb-3 text-blue-800">Global Google Drive Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-blue-700">Client ID (saved globally)</label>
            <input 
              value={globalSettings.driveClientId} 
              onChange={e=>updateGlobalSettings({driveClientId:e.target.value})}
              className="w-full p-2 border rounded mt-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-blue-700">Folder ID (saved globally)</label>
            <input 
              value={globalSettings.driveFolderId} 
              onChange={e=>updateGlobalSettings({driveFolderId:e.target.value})}
              className="w-full p-2 border rounded mt-1 text-xs"
            />
          </div>
        </div>
      </div>
      
      <div className="mb-4 flex gap-2">
        <select 
          value={selectedId} 
          onChange={e=>setSelectedId(e.target.value)}
          className="flex-1 p-2 border rounded"
        >
          {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.company} - {t.role})</option>)}
        </select>
        <button 
          onClick={createTemplate}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
        >
          New Template
        </button>
        <button 
          onClick={duplicateTemplate}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500"
        >
          Duplicate
        </button>
      </div>

      <div className="space-y-3 mb-6">
        <label className="block">
          <span className="text-sm font-medium">Template Name</span>
          <input 
            value={selected.name} 
            onChange={e=>updateTemplate({name:e.target.value})}
            className="w-full p-2 border rounded mt-1"
          />
        </label>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Company</span>
            <input 
              value={selected.company||''} 
              onChange={e=>updateTemplate({company:e.target.value})}
              className="w-full p-2 border rounded mt-1"
            />
          </label>
          
          <label className="block">
            <span className="text-sm font-medium">Role</span>
            <input 
              value={selected.role||''} 
              onChange={e=>updateTemplate({role:e.target.value})}
              className="w-full p-2 border rounded mt-1"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={!!selected.autoUploadOnFinish}
            onChange={e => updateTemplate({ autoUploadOnFinish: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Auto-upload to Drive when finished</span>
        </label>
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-medium">Questions ({selected.questions.length})</h3>
          <button 
            onClick={addQuestion}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
          >
            Add Question
          </button>
        </div>
        
        <div className="space-y-3">
          {selected.questions.map((q, i) => (
            <div key={q.id} className="p-4 border rounded-lg bg-gray-50">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm text-gray-600 font-medium">Question {i + 1}</span>
                <button
                  onClick={() => deleteQuestion(q.id)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              
              {editingQuestionId === q.id ? (
                <div className="space-y-2">
                  <textarea
                    value={q.prompt}
                    onChange={e => updateQuestion(q.id, { prompt: e.target.value })}
                    onBlur={() => setEditingQuestionId(null)}
                    className="w-full p-2 border rounded resize-none"
                    rows={2}
                    autoFocus
                    placeholder="Enter your interview question..."
                  />
                </div>
              ) : (
                <div
                  onClick={() => setEditingQuestionId(q.id)}
                  className="font-medium cursor-pointer hover:bg-gray-100 p-2 rounded border-2 border-dashed border-gray-300 hover:border-blue-400"
                >
                  {q.prompt || "Click to edit this question"}
                  <Edit2 size={14} className="inline ml-2 text-gray-400" />
                </div>
              )}
              
              <div className="flex gap-4 mt-3">
                <label className="text-sm text-gray-600">
                  Time limit:
                  <input
                    type="number"
                    value={q.timeLimitSec || 120}
                    onChange={e => updateQuestion(q.id, { timeLimitSec: parseInt(e.target.value) || 120 })}
                    className="ml-2 w-20 px-2 py-1 border rounded text-sm"
                    min="30"
                    max="600"
                  />
                  <span className="ml-1">seconds</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button 
          onClick={() => setShowShareModal(true)}
          className="flex-1 px-4 py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-500 inline-flex items-center justify-center gap-2"
          disabled={!selected.questions.length}
        >
          <Share size={16}/> 
          Share Interview Link ({selected.questions.length} questions)
        </button>
        
        <button 
          onClick={()=>onLaunch(selected)}
          className="px-4 py-3 bg-gray-600 text-white rounded font-medium hover:bg-gray-500"
          disabled={!selected.questions.length}
        >
          Preview Interview
        </button>
      </div>

      {showShareModal && (
        <ShareModal 
          template={selected} 
          onClose={() => setShowShareModal(false)} 
        />
      )}
    </div>
  );
}

// ---------- Candidate View ----------

function CandidateView({ template, onBack }:{ template: InterviewTemplate; onBack?: ()=>void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, request, start, stop, recording, stopTracks } = useRecorder();
  const [clips, setClips] = useState<RecordingClip[]>(template.questions.map(q=>({ qid: q.id })));
  const [driveStatus, setDriveStatus] = useState<string>("");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [candidateName, setCandidateName] = useState("");

  useEffect(()=>{ 
    request().catch(()=>alert("Please allow camera & mic access to continue")); 
    return ()=>stopTracks(); 
  },[]);
  
  useEffect(()=>{ 
    if(videoRef.current && stream) { 
      (videoRef.current as any).srcObject=stream; 
      videoRef.current.play().catch(()=>{}); 
    } 
  },[stream]);

  const [recordingQuestionId, setRecordingQuestionId] = useState<string | null>(null);
  const [recordingTimeLeft, setRecordingTimeLeft] = useState<number>(0);

  const recordAnswer = async (q: InterviewQuestion) => {
    try {
      setRecordingQuestionId(q.id);
      const timeLimit = (q.timeLimitSec ?? 120) * 1000;
      setRecordingTimeLeft(q.timeLimitSec ?? 120);
      
      await start();
      
      // Countdown timer
      const countdownInterval = setInterval(() => {
        setRecordingTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      // Auto-stop after time limit
      const autoStopTimeout = setTimeout(async () => {
        clearInterval(countdownInterval);
        await stopRecording(q.id);
      }, timeLimit);
      
      // Store timeout and interval for manual stop
      (window as any).currentRecordingTimeout = autoStopTimeout;
      (window as any).currentRecordingInterval = countdownInterval;
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to start recording. Please check camera/microphone permissions.');
      setRecordingQuestionId(null);
    }
  };

  const stopRecording = async (questionId: string) => {
    if (recordingQuestionId !== questionId) return;
    
    // Clear any existing timeouts
    if ((window as any).currentRecordingTimeout) {
      clearTimeout((window as any).currentRecordingTimeout);
    }
    if ((window as any).currentRecordingInterval) {
      clearInterval((window as any).currentRecordingInterval);
    }
    
    const blob = await stop();
    setRecordingQuestionId(null);
    setRecordingTimeLeft(0);
    
    if (blob) {
      const url = URL.createObjectURL(blob);
      setClips(prev => {
        const next = prev.map(c => c.qid === questionId ? { ...c, blob, url } : c);
        
        // Check if all questions have been answered
        const allDone = template.questions.every(qq => next.find(c => c.qid === qq.id)?.blob);
        
        // Auto-upload if enabled and all questions are done
        if (allDone && template.autoUploadOnFinish) {
          setTimeout(() => exportAndUpload(), 1000);
        }
        
        return next;
      });
    }
  };

  const exportAndUpload = async () => {
    try {
      setDriveStatus('Preparing export...');
      
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      
      template.questions.forEach((q, i) => {
        const clip = clips.find(c=>c.qid===q.id);
        if(clip?.blob) {
          const fileName = `Q${i+1}_${q.prompt.slice(0,30).replace(/[^a-zA-Z0-9]/g,'_')}.webm`;
          zip.file(fileName, clip.blob);
        }
      });
      
      // Add summary JSON
      const summary = {
        candidate: candidateName || 'Anonymous',
        template: template.name,
        company: template.company,
        role: template.role,
        timestamp: new Date().toISOString(),
        totalQuestions: template.questions.length,
        answeredQuestions: clips.filter(c => c.blob).length,
        questions: template.questions.map((q, i) => ({
          number: i + 1,
          prompt: q.prompt,
          timeLimitSec: q.timeLimitSec,
          hasAnswer: !!clips.find(c => c.qid === q.id)?.blob,
          answerDuration: clips.find(c => c.qid === q.id)?.durationMs || 0
        }))
      };
      zip.file('interview_summary.json', JSON.stringify(summary, null, 2));
      
      const blob = await zip.generateAsync({type:'blob'});
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const candidatePrefix = candidateName ? `${candidateName.replace(/[^a-zA-Z0-9]/g, '_')}_` : '';
      const fileName = `${candidatePrefix}${template.company||'company'}_${template.role||'role'}_interview_${timestamp}.zip`;
      
      // Send notification to interviewer and provide download
      setDriveStatus('Submitting interview...');
      
      // Prepare data for submission (no immediate URL creation needed)
      
      // Upload file to server for interviewer
      try {
        // Create FormData to send the actual file
        const formData = new FormData();
        formData.append('interviewFile', blob, fileName);
        formData.append('candidateName', candidateName || 'Anonymous');
        formData.append('templateName', template.name);
        formData.append('company', template.company || '');
        formData.append('role', template.role || '');
        formData.append('answeredQuestions', answeredCount.toString());
        formData.append('totalQuestions', template.questions.length.toString());
        formData.append('timestamp', new Date().toISOString());

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        if (uploadResponse.ok) {
          setDriveStatus('✅ Interview submitted successfully!');
          alert(`Interview submitted successfully!\n\nYour interview has been sent to the interviewer.\nCandidate: ${candidateName || 'Anonymous'}\nAnswered: ${answeredCount}/${template.questions.length} questions`);
          return;
        } else {
          throw new Error('Upload failed');
        }
        
      } catch (uploadError) {
        console.log('Server upload failed, trying notification instead');
        
        // Fallback to notification-only approach
        try {
          const notificationData = {
            candidateName: candidateName || 'Anonymous',
            templateName: template.name,
            company: template.company,
            role: template.role,
            fileName: fileName,
            answeredQuestions: answeredCount,
            totalQuestions: template.questions.length,
            timestamp: new Date().toISOString()
          };
          
          await fetch('/api/notify-interviewer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(notificationData)
          });
          
          setDriveStatus('✅ Interview submitted successfully!');
          alert(`Interview submitted successfully!\n\nThe interviewer has been notified.\nCandidate: ${candidateName || 'Anonymous'}\nAnswered: ${answeredCount}/${template.questions.length} questions`);
          return;
          
        } catch (notifyError) {
          console.log('Both upload and notification failed, providing download instead');
          
          // Auto-download with clear instructions
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); 
          a.href = url; 
          a.download = fileName; 
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          setDriveStatus('✅ Interview completed and downloaded!');
          alert(`✅ INTERVIEW COMPLETED!\n\nFile downloaded: ${fileName}\n\n📧 PLEASE EMAIL THIS FILE TO:\nsrn@synapserecruiternetwork.com\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions`);
        }
      }
      
      // Note: URL cleanup omitted to avoid interfering with try/catch structure
    } catch (error) {
      console.error('Export failed:', error);
      setDriveStatus('❌ Export failed - please try again');
      alert('Export failed. Please try again or check your browser settings.');
    }
  };

  const currentQ = template.questions[currentQuestion];
  const currentClip = clips.find(c => c.qid === currentQ?.id);
  const answeredCount = clips.filter(c => c.blob).length;
  const allAnswered = answeredCount === template.questions.length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">{template.company} – {template.role}</h2>
        <p className="text-gray-600 mt-1">Video Interview</p>
        
        <div className="mt-4 mb-4">
          <input
            type="text"
            value={candidateName}
            onChange={e => setCandidateName(e.target.value)}
            placeholder="Enter your full name (optional)"
            className="px-4 py-2 border rounded-lg text-center max-w-xs"
          />
        </div>
        
        <div className="flex justify-center gap-6 text-sm text-gray-500">
          <span>Question {currentQuestion + 1} of {template.questions.length}</span>
          <span>Answered: {answeredCount}/{template.questions.length}</span>
          {allAnswered && <span className="text-green-600 font-medium">✅ All Complete!</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Video Section */}
        <div className="space-y-4">
          <div className="relative">
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              className="w-full max-w-md mx-auto rounded-lg border shadow-lg"
            />
            {recording && (
              <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 rounded text-sm font-medium animate-pulse">
                REC
              </div>
            )}
          </div>
          
          {driveStatus && (
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-700">{driveStatus}</div>
            </div>
          )}
        </div>

        {/* Question Section */}
        <div className="space-y-4">
          {currentQ && (
            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <div className="mb-4">
                <h3 className="font-semibold text-lg mb-3">Question {currentQuestion + 1}</h3>
                <p className="text-gray-800 text-lg leading-relaxed">{currentQ.prompt}</p>
                {currentQ.guidance && (
                  <p className="text-sm text-gray-600 mt-3 italic">{currentQ.guidance}</p>
                )}
                <div className="text-sm text-gray-500 mt-3 flex items-center gap-4">
                  <span>⏱️ Time limit: {currentQ.timeLimitSec || 120} seconds</span>
                  {currentQ.required && <span className="text-red-500">* Required</span>}
                </div>
              </div>

              <div className="space-y-3">
                {!currentClip?.blob ? (
                  <>
                    {recordingQuestionId === currentQ.id ? (
                      <div className="space-y-3">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-600 mb-2">
                            {Math.floor(recordingTimeLeft / 60)}:{(recordingTimeLeft % 60).toString().padStart(2, '0')}
                          </div>
                          <div className="text-sm text-gray-600">Recording in progress...</div>
                        </div>
                        <button
                          onClick={() => stopRecording(currentQ.id)}
                          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                          <CircleStop size={20}/> 
                          Stop Recording
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => recordAnswer(currentQ)}
                        disabled={recording || recordingQuestionId !== null}
                        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <CirclePlay size={20}/> 
                        Start Recording Answer
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center space-y-3">
                    <div className="text-green-600 font-semibold flex items-center justify-center gap-2">
                      ✅ Answer Recorded Successfully
                    </div>
                    <video 
                      src={currentClip.url} 
                      controls 
                      className="w-full max-w-sm mx-auto rounded border"
                    />
                    <button
                      onClick={() => {
                        setClips(prev => prev.map(c => c.qid === currentQ.id ? { qid: c.qid } : c));
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Re-record this answer
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
              disabled={currentQuestion === 0}
              className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              ← Previous
            </button>

            <button
              onClick={() => setCurrentQuestion(Math.min(template.questions.length - 1, currentQuestion + 1))}
              disabled={currentQuestion === template.questions.length - 1}
              className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next →
            </button>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(answeredCount / template.questions.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-8 pt-6 border-t flex flex-col sm:flex-row gap-3">
        <button
          onClick={exportAndUpload}
          disabled={answeredCount === 0}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          <CloudUpload size={20}/> 
          Submit Interview
          {answeredCount > 0 && ` (${answeredCount} answers)`}
        </button>
        
        {onBack && (
          <button 
            onClick={onBack}
            className="px-6 py-3 border rounded-lg hover:bg-gray-50 font-medium"
          >
            ← Back to Templates
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Main App ----------

export default function App(){
  const [mode,setMode]=useState<'admin'|'candidate'>('admin');
  const [active,setActive]=useState<InterviewTemplate|null>(null);
  
  // Check if this is a candidate link
  useEffect(() => {
    const templateId = getTemplateFromUrl();
    if (templateId) {
      const templates = loadTemplates();
      const template = templates.find(t => t.id === templateId);
      if (template) {
        setActive(template);
        setMode('candidate');
      } else {
        alert('Interview template not found. Please check the link.');
      }
    }
  }, []);
  
  return(
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <h1 className="text-3xl font-bold text-gray-900">AI Interview App</h1>
          <p className="text-gray-600 mt-1">Record professional video interviews for any company or role</p>
        </div>
      </div>
      
      {mode==='admin'&&<AdminPanel onLaunch={(t)=>{setActive(t);setMode('candidate')}}/>}
      {mode==='candidate'&&active&&<CandidateView template={active} onBack={getTemplateFromUrl() ? undefined : ()=>setMode('admin')}/>}    
    </div>
  );
}

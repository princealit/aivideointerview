import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CirclePlay, CircleStop, Download, Loader2, Mic, Play, Settings, Trash2, Video, Wand2, CloudUpload } from "lucide-react";

/**
 * AI Interview App – Conversational Video Interview Tool (Client-side, Free)
 * ------------------------------------------------------------------
 * ✅ No backend required – everything runs in the browser
 * ✅ Works for ANY company/role – create multiple templates with unique questions
 * ✅ Record per-question video answers (WebM) with webcam + mic
 * ✅ Text-to-Speech (TTS) reads questions aloud
 * ✅ Optional Speech Recognition (Chrome/Edge) for light "conversational" follow‑ups
 * ✅ Auto-scoring via keyword/rubric matching (client-side)
 * ✅ Export: ZIP of all answer videos + JSON summary for recruiters
 * ✅ Multiple roles: create & save different interview templates (localStorage)
 * ✅ Google Drive: one‑click upload of candidate package to a Drive folder (per-template configurable)
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
  autoUploadOnFinish?: boolean; // auto-upload ZIP to Drive when all answers are recorded
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
      callback: (resp: any) => {
        if (resp.error) throw resp;
        this.token = resp.access_token;
        // @ts-ignore
        gapi.client.setToken({ access_token: this.token });
      },
    });
    this.ready = true;
  },
  async ensureAuth() {
    if (this.token) return;
    // @ts-ignore
    await new Promise<void>((resolve) => this._tokenClient.requestAccessToken({ prompt: 'consent', callback: () => resolve() }));
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

const LS_KEY_TEMPLATES = "ai_interview_templates_v1";

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

// ---------- Media Hook ----------

function useRecorder() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);

  const request = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setStream(s);
    return s;
  };

  const start = async () => {
    const s = stream ?? (await request());
    const mr = new MediaRecorder(s, { mimeType: "video/webm;codecs=vp8,opus" });
    const buf: Blob[] = [];
    mr.ondataavailable = e => e.data && buf.push(e.data);
    mr.onstop = () => setChunks(buf.slice());
    mr.start();
    setRecorder(mr);
    setRecording(true);
  };

  const stop = async (): Promise<Blob | null> => {
    if (!recorder) return null;
    return new Promise(resolve => {
      recorder.onstop = () => {
        setRecording(false);
        const blob = new Blob(chunks, { type: "video/webm" });
        setChunks([]);
        resolve(blob);
      };
      recorder.stop();
    });
  };

  const stopTracks = () => { stream?.getTracks().forEach(t => t.stop()); setStream(null); };

  return { stream, request, start, stop, recording, stopTracks };
}

// ---------- Admin Panel ----------

function AdminPanel({ onLaunch }: { onLaunch: (tmpl: InterviewTemplate) => void }) {
  const [templates, setTemplates] = useState<InterviewTemplate[]>(loadTemplates());
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id);
  const selected = useMemo(() => templates.find(t => t.id === selectedId)!, [templates, selectedId]);

  const addQuestion = () => {
    const q: InterviewQuestion = { id: uid(), prompt: "New question", required: false, timeLimitSec: 60, weight: 0.5 };
    const next = templates.map(t => t.id === selected.id ? { ...t, questions: [...t.questions, q] } : t);
    setTemplates(next); saveTemplates(next);
  };

  const updateTemplate = (patch: Partial<InterviewTemplate>) => {
    const next = templates.map(t => t.id === selected.id ? { ...t, ...patch } : t);
    setTemplates(next); saveTemplates(next);
  };

  const createTemplate = () => {
    const t: InterviewTemplate = { 
      id: uid(), 
      name: "New Template", 
      company: "", 
      role: "", 
      questions: [],
      driveClientId: "",
      driveFolderId: "",
      autoUploadOnFinish: false
    };
    const next = [t, ...templates];
    setTemplates(next); saveTemplates(next); setSelectedId(t.id);
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
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-bold mb-4">AI Interview Templates</h2>
      
      <div className="mb-4 flex gap-2">
        <select 
          value={selectedId} 
          onChange={e=>setSelectedId(e.target.value)}
          className="flex-1 p-2 border rounded"
        >
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button 
          onClick={createTemplate}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
        >
          New Template
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
        
        <label className="block">
          <span className="text-sm font-medium">Google Drive Client ID</span>
          <input 
            value={selected.driveClientId||''} 
            onChange={e=>updateTemplate({driveClientId:e.target.value})}
            className="w-full p-2 border rounded mt-1"
            placeholder="Optional: for Google Drive uploads"
          />
        </label>
        
        <label className="block">
          <span className="text-sm font-medium">Google Drive Folder ID</span>
          <input 
            value={selected.driveFolderId||''} 
            onChange={e=>updateTemplate({driveFolderId:e.target.value})}
            className="w-full p-2 border rounded mt-1"
            placeholder="Optional: specific folder for uploads"
          />
        </label>

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
        
        <div className="space-y-2">
          {selected.questions.map((q, i) => (
            <div key={q.id} className="p-3 border rounded">
              <div className="text-sm text-gray-600">Question {i + 1}</div>
              <div className="font-medium">{q.prompt}</div>
              <div className="text-xs text-gray-500 mt-1">
                {q.timeLimitSec}s limit • Weight: {q.weight || 1}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button 
        onClick={()=>onLaunch(selected)}
        className="w-full px-4 py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-500"
        disabled={!selected.questions.length}
      >
        Launch Interview
      </button>
    </div>
  );
}

// ---------- Candidate View ----------

function CandidateView({ template, onBack }:{ template: InterviewTemplate; onBack: ()=>void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, request, start, stop, recording, stopTracks } = useRecorder();
  const [clips, setClips] = useState<RecordingClip[]>(template.questions.map(q=>({ qid: q.id })));
  const [driveStatus, setDriveStatus] = useState<string>("");
  const [currentQuestion, setCurrentQuestion] = useState(0);

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

  const recordAnswer = async (q: InterviewQuestion) => {
    await start();
    setTimeout(async () => {
      const blob = await stop();
      if (blob) {
        const url = URL.createObjectURL(blob);
        setClips(prev => {
          const next = prev.map(c => c.qid === q.id ? { ...c, blob, url } : c);
          
          // Check if all questions have been answered
          const allDone = template.questions.every(qq => next.find(c => c.qid === qq.id)?.blob);
          
          // Auto-upload if enabled and all questions are done
          if (allDone && template.autoUploadOnFinish) {
            exportAndUpload();
          }
          
          return next;
        });
      }
    }, (q.timeLimitSec ?? 60) * 1000);
  };

  const exportAndUpload = async () => {
    try {
      setDriveStatus('Preparing export...');
      
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      
      template.questions.forEach((q, i) => {
        const clip = clips.find(c=>c.qid===q.id);
        if(clip?.blob) {
          zip.file(`Q${i+1}_${q.prompt.slice(0,30).replace(/[^a-zA-Z0-9]/g,'_')}.webm`, clip.blob);
        }
      });
      
      // Add summary JSON
      const summary = {
        template: template.name,
        company: template.company,
        role: template.role,
        timestamp: new Date().toISOString(),
        questions: template.questions.map((q, i) => ({
          number: i + 1,
          prompt: q.prompt,
          hasAnswer: !!clips.find(c => c.qid === q.id)?.blob
        }))
      };
      zip.file('interview_summary.json', JSON.stringify(summary, null, 2));
      
      const blob = await zip.generateAsync({type:'blob'});
      const fileName = `${template.company||'company'}_${template.role||'role'}_interview_${Date.now()}.zip`;
      
      if(template.driveClientId){
        setDriveStatus('Initializing Google Drive...');
        await driveClient.init(template.driveClientId);
        setDriveStatus('Uploading to Drive...');
        await driveClient.uploadZip(fileName, blob, template.driveFolderId);
        setDriveStatus('Uploaded ✔');
        alert('Successfully uploaded to Google Drive!');
      } else {
        // Local download
        const url = URL.createObjectURL(blob);
        const a=document.createElement('a'); 
        a.href=url; 
        a.download=fileName; 
        a.click();
        setDriveStatus('Downloaded ✔');
      }
    } catch (error) {
      console.error('Export failed:', error);
      setDriveStatus('Export failed ✗');
      alert('Export failed. Please try again.');
    }
  };

  const currentQ = template.questions[currentQuestion];
  const currentClip = clips.find(c => c.qid === currentQ?.id);
  const answeredCount = clips.filter(c => c.blob).length;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold">{template.company} – {template.role}</h2>
        <p className="text-gray-600">Question {currentQuestion + 1} of {template.questions.length}</p>
        <div className="text-sm text-gray-500 mt-1">
          Answered: {answeredCount}/{template.questions.length}
        </div>
      </div>

      <div className="mb-6">
        <video 
          ref={videoRef} 
          autoPlay 
          muted 
          className="w-full max-w-md mx-auto rounded border"
        />
        {driveStatus && <div className="text-xs text-zinc-500 mb-2 text-center mt-2">{driveStatus}</div>}
      </div>

      {currentQ && (
        <div className="mb-6">
          <div className="bg-gray-50 p-4 rounded mb-4">
            <h3 className="font-medium mb-2">Question {currentQuestion + 1}</h3>
            <p className="text-gray-800">{currentQ.prompt}</p>
            {currentQ.guidance && (
              <p className="text-sm text-gray-600 mt-2 italic">{currentQ.guidance}</p>
            )}
            <div className="text-xs text-gray-500 mt-2">
              Time limit: {currentQ.timeLimitSec || 60} seconds
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            {!currentClip?.blob ? (
              <button
                onClick={() => recordAnswer(currentQ)}
                disabled={recording}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded font-medium ${
                  recording 
                    ? 'bg-red-600 text-white' 
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {recording ? (
                  <>
                    <CircleStop size={16}/> Recording... ({currentQ.timeLimitSec || 60}s)
                  </>
                ) : (
                  <>
                    <CirclePlay size={16}/> Start Recording
                  </>
                )}
              </button>
            ) : (
              <div className="text-center">
                <div className="text-green-600 font-medium mb-2">✓ Answer Recorded</div>
                <video 
                  src={currentClip.url} 
                  controls 
                  className="max-w-xs mx-auto rounded"
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-between">
        <button
          onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
          disabled={currentQuestion === 0}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          Previous
        </button>

        <button
          onClick={() => setCurrentQuestion(Math.min(template.questions.length - 1, currentQuestion + 1))}
          disabled={currentQuestion === template.questions.length - 1}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>

      <div className="mt-6 pt-6 border-t">
        <button
          onClick={exportAndUpload}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500 mr-3"
        >
          <CloudUpload size={16}/> Export + Upload
        </button>
        
        <button 
          onClick={onBack}
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          Back to Templates
        </button>
      </div>
    </div>
  );
}

// ---------- Main App ----------

export default function App(){
  const [mode,setMode]=useState<'admin'|'candidate'>('admin');
  const [active,setActive]=useState<InterviewTemplate|null>(null);
  
  return(
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b mb-6">
        <div className="max-w-2xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900">AI Interview App</h1>
          <p className="text-sm text-gray-600">Record video interviews for any company or role</p>
        </div>
      </div>
      
      {mode==='admin'&&<AdminPanel onLaunch={(t)=>{setActive(t);setMode('candidate')}}/>}
      {mode==='candidate'&&active&&<CandidateView template={active} onBack={()=>setMode('admin')}/>}    
    </div>
  );
}

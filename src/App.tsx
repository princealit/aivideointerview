import React, { useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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

// Google Drive settings removed - all interviews save to admin submissions only

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

// Google Drive removed - interviews now save to admin submissions panel only

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

// Google Drive settings functions removed

// ---------- URL Utilities ----------

const generateCandidateUrl = async (template: InterviewTemplate) => {
  // Store template on server first
  try {
    await fetch('/api/store-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template)
    });
  } catch (error) {
    console.warn('Failed to store template on server:', error);
  }
  
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}?interview=${template.id}`;
};

const getTemplateFromUrl = async (): Promise<InterviewTemplate | null> => {
  const urlParams = new URLSearchParams(window.location.search);
  const templateId = urlParams.get('interview');
  if (!templateId) return null;
  
  try {
    // Try to fetch from server first
    const response = await fetch(`/api/get-template?id=${templateId}`);
    if (response.ok) {
      const template = await response.json();
      return template as InterviewTemplate;
    }
  } catch (error) {
    console.warn('Failed to fetch template from server:', error);
  }
  
  // Fallback: try localStorage
  const templates = loadTemplates();
  return templates.find(t => t.id === templateId) || null;
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
  const [candidateUrl, setCandidateUrl] = useState('Generating link...');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generateCandidateUrl(template).then(url => setCandidateUrl(url));
  }, [template]);

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
          <p><strong>Auto-save:</strong> Yes (all interviews save to admin submissions)</p>
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
            <li>6. Click "Submit Interview" when finished - files will be saved to admin panel</li>
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
  // Google Drive settings removed
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  
  const selected = useMemo(() => templates.find(t => t.id === selectedId)!, [templates, selectedId]);

  // Google Drive settings functions removed

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
      ...patch
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
      questions: []
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
      name: `${selected.name} (Copy)`
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
      
      {/* Google Drive settings removed - all interviews save to admin submissions panel */}
      
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

        {/* Auto-upload checkbox removed - all interviews automatically save to admin submissions */}
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
  const ensureRecordingStopped = async () => {
    if (recordingQuestionId) {
      await stopRecording(recordingQuestionId);
    }
  };

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
        
        // All interviews are manually submitted by clicking Submit button
        
        return next;
      });
    }
  };

  const exportAndUpload = async () => {
    try {
      await ensureRecordingStopped();
      setDriveStatus('Preparing export...');
      
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      
      // Try to merge clips into a single webm using ffmpeg.wasm
      let mergedBlob: Blob | null = null;
      const recorded = template.questions.map((q, i) => ({ q, clip: clips.find(c => c.qid === q.id) }));
      const videoClips = recorded.filter(rc => rc.clip?.blob);
      
      if (videoClips.length > 1) {
        try {
          setDriveStatus('Merging videos...');
          console.log(`🎬 Starting merge of ${videoClips.length} videos`);
          
          const ffmpeg = new FFmpeg();
          ffmpeg.on('log', ({ message }) => {
            console.log('FFmpeg:', message);
          });
          ffmpeg.on('progress', ({ progress }) => {
            console.log(`FFmpeg progress: ${Math.round(progress * 100)}%`);
          });
          
          console.log('Loading FFmpeg...');
          await ffmpeg.load();
          console.log('FFmpeg loaded successfully');
          
          // Write all recorded blobs to ffmpeg FS
          const inputNames: string[] = [];
          for (let i = 0; i < videoClips.length; i++) {
            const rc = videoClips[i];
            const name = `input${i}.webm`;
            inputNames.push(name);
            console.log(`Writing ${name} (${rc.clip!.blob!.size} bytes)`);
            await ffmpeg.writeFile(name, await fetchFile(rc.clip!.blob!));
          }
          console.log('All input files written to FFmpeg');
          
          // Simple concat approach - create a concat list file
          const concatList = inputNames.map(name => `file '${name}'`).join('\n');
          await ffmpeg.writeFile('concat.txt', concatList);
          
          const outName = 'merged.webm';
          console.log('Starting FFmpeg concat...');
          await ffmpeg.exec([
            '-f', 'concat',
            '-safe', '0',
            '-i', 'concat.txt',
            '-c', 'copy',
            outName
          ]);
          console.log('FFmpeg concat completed');
          
          const data = await ffmpeg.readFile(outName);
          mergedBlob = new Blob([data], { type: 'video/webm' });
          console.log(`✅ Video merge successful! Output size: ${mergedBlob.size} bytes`);
          setDriveStatus('Videos merged successfully!');
          
        } catch (error) {
          console.error('❌ Video merge failed:', error);
          setDriveStatus('Video merge failed, packaging individual files...');
        }
      } else if (videoClips.length === 1) {
        // If only one video, use it as the merged file
        mergedBlob = videoClips[0].clip?.blob || null;
        console.log('✅ Single video used as merged file');
      }
      
      template.questions.forEach((q, i) => {
        const clip = clips.find(c=>c.qid===q.id);
        if(clip?.blob) {
          const fileName = `Q${i+1}_${q.prompt.slice(0,30).replace(/[^a-zA-Z0-9]/g,'_')}.webm`;
          zip.file(fileName, clip.blob);
        }
      });
      
      if (mergedBlob) {
        const mergedName = `ALL_${template.company||'company'}_${template.role||'role'}.webm`;
        zip.file(mergedName, mergedBlob);
      }
      
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
      
      // Upload file to Vercel Blob (server-side storage) with retry
      let uploadSuccess = false;
      let lastError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`📤 Upload attempt ${attempt}/3:`, {
            fileName,
            blobSize: blob.size,
            candidateName: candidateName || 'Anonymous',
            company: template.company,
            role: template.role
          });
          
          const uploadResponse = await fetch('/api/store-interview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/zip',
            'x-filename': fileName,
            'x-meta': JSON.stringify({
              candidateName: candidateName || 'Anonymous',
              templateName: template.name,
              company: template.company,
              role: template.role,
              answeredQuestions: answeredCount,
              totalQuestions: template.questions.length,
              timestamp: new Date().toISOString(),
            }),
          },
          body: blob,
        });

        console.log('📥 Upload response:', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          ok: uploadResponse.ok,
          url: uploadResponse.url
        });
        
        if (uploadResponse.ok) {
          const responseData = await uploadResponse.json();
          console.log('✅ Upload successful on attempt', attempt, ':', responseData);
          uploadSuccess = true;
          
          // Interview saved to admin submissions panel
          setDriveStatus('✅ Interview submitted successfully!');
          
          // Send notification email to interviewer
          try {
            await fetch('/api/notify-interviewer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                candidateName: candidateName || 'Anonymous',
                company: template.company,
                role: template.role,
                answeredQuestions: answeredCount,
                totalQuestions: template.questions.length,
                downloadUrl: responseData.url,
                fileName: fileName
              })
            });
            console.log('📧 Notification sent to interviewer');
          } catch (emailError) {
            console.warn('⚠️ Failed to send notification:', emailError);
          }
          
          // Auto-download the file for the candidate using the local blob
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          // Verify the upload by checking if we can list it
          try {
            const verifyResponse = await fetch('/api/list-interviews');
            if (verifyResponse.ok) {
              const interviews = await verifyResponse.json();
              const uploadedInterview = interviews.blobs?.find(b => b.pathname.includes(fileName.split('/')[1]));
              if (uploadedInterview) {
                console.log('✅ Upload verified - interview found in submissions');
                alert(`✅ INTERVIEW COMPLETED!\n\nFile uploaded to admin submissions and downloaded locally: ${fileName}\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions\n\n📧 Admin has been notified at srn@synapserecruiternetwork.com`);
              } else {
                console.warn('⚠️ Upload may have failed - interview not found in listings');
                alert(`⚠️ UPLOAD MAY HAVE FAILED!\n\nFile downloaded locally: ${fileName}\n\n🚨 PLEASE EMAIL THIS FILE TO:\nsrn@synapserecruiternetwork.com\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions`);
              }
            } else {
              alert(`✅ INTERVIEW COMPLETED!\n\nFile uploaded to admin submissions and downloaded locally: ${fileName}\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions\n\n📧 Admin has been notified at srn@synapserecruiternetwork.com`);
            }
          } catch (verifyError) {
            console.warn('⚠️ Could not verify upload:', verifyError);
            alert(`✅ INTERVIEW COMPLETED!\n\nFile uploaded to admin submissions and downloaded locally: ${fileName}\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions\n\n📧 Admin has been notified at srn@synapserecruiternetwork.com`);
          }
          break;
        } else {
          const errorText = await uploadResponse.text();
          console.error(`❌ Upload attempt ${attempt} failed:`, {
            status: uploadResponse.status,
            statusText: uploadResponse.statusText,
            errorBody: errorText
          });
          lastError = new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
          
          if (attempt < 3) {
            console.log(`⏳ Retrying in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
      } catch (attemptError) {
        console.error(`❌ Upload attempt ${attempt} error:`, attemptError);
        lastError = attemptError;
        
        if (attempt < 3) {
          console.log(`⏳ Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      }
      
      // If all attempts failed
      if (!uploadSuccess) {
        console.error('❌ All upload attempts failed:', lastError);
        console.error('Upload error details:', {
          error: lastError instanceof Error ? lastError.message : String(lastError),
          fileName,
          blobSize: blob.size,
          timestamp: new Date().toISOString()
        });
        
        // No Google Drive backup - just local download
        setDriveStatus('⚠️ Cloud storage failed - File downloaded locally');
        
        // FORCE LOCAL DOWNLOAD - Don't hide the failure!
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = fileName; 
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setDriveStatus('⚠️ Upload failed - File downloaded locally');
        alert(`⚠️ UPLOAD FAILED BUT FILE SAVED!\n\nFile downloaded: ${fileName}\n\n🚨 CRITICAL: PLEASE EMAIL THIS FILE IMMEDIATELY TO:\nsrn@synapserecruiternetwork.com\n\nCandidate: ${candidateName || 'Anonymous'}\nPosition: ${template.role} at ${template.company}\nAnswered: ${answeredCount}/${template.questions.length} questions\n\nTechnical Error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
              onClick={async () => { await ensureRecordingStopped(); setCurrentQuestion(Math.max(0, currentQuestion - 1)); }}
              disabled={currentQuestion === 0}
              className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              ← Previous
            </button>

            <button
              onClick={async () => { await ensureRecordingStopped(); setCurrentQuestion(Math.min(template.questions.length - 1, currentQuestion + 1)); }}
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
  const [mode,setMode]=useState<'admin'|'candidate'|'submissions'>('admin');
  const [active,setActive]=useState<InterviewTemplate|null>(null);
  const [isCandidateLink, setIsCandidateLink] = useState(false);
  
  // Check if this is a candidate link
  useEffect(() => {
    const hasInterviewParam = new URLSearchParams(window.location.search).get('interview');
    if (hasInterviewParam) {
      setIsCandidateLink(true);
      getTemplateFromUrl().then(template => {
        if (template) {
          setActive(template);
          setMode('candidate');
        }
      });
    }
  }, []);
  
  // If this is a candidate link, only show the interview interface
  if (isCandidateLink) {
    return(
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <h1 className="text-3xl font-bold text-gray-900">AI Interview App</h1>
            <p className="text-gray-600 mt-1">Record professional video interviews for any company or role</p>
          </div>
        </div>
        
        {active && <CandidateView template={active} onBack={undefined}/>}
      </div>
    );
  }
  
  // Admin interface (only shown when NOT accessed via candidate link)
  return(
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <h1 className="text-3xl font-bold text-gray-900">AI Interview App</h1>
          <p className="text-gray-600 mt-1">Record professional video interviews for any company or role</p>
        </div>
      </div>
      
      <div className="max-w-6xl mx-auto px-6 mt-4 flex gap-2">
        <button className={`px-3 py-1 rounded border ${mode==='admin'?'bg-gray-900 text-white':''}`} onClick={()=>setMode('admin')}>Templates</button>
        <button className={`px-3 py-1 rounded border ${mode==='submissions'?'bg-gray-900 text-white':''}`} onClick={()=>setMode('submissions')}>Submissions</button>
      </div>

      {mode==='admin'&&<AdminPanel onLaunch={(t)=>{setActive(t);setMode('candidate')}}/>}
      {mode==='candidate'&&active&&<CandidateView template={active} onBack={()=>setMode('admin')}/>}
      {mode==='submissions'&&<SubmissionsPanel/>}
    </div>
  );
}

function SubmissionsPanel(){
  const [files,setFiles]=useState<{pathname:string;url:string;size:number;uploadedAt:string}[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string>('');

  const refresh = async () => {
    setLoading(true); setError('');
    try{
      const res = await fetch('/api/list-interviews');
      const data = await res.json();
      setFiles(data.files||[]);
    }catch(e:any){
      setError('Failed to load submissions');
    }finally{ setLoading(false); }
  };

  useEffect(()=>{ refresh(); },[]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Interview Submissions</h2>
        <button onClick={refresh} className="px-3 py-1 border rounded">Refresh</button>
      </div>
      {loading && <div>Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}
      {!loading && !files.length && <div>No submissions yet.</div>}
      <div className="space-y-2">
        {files.map(f=> (
          <div key={f.pathname} className="flex items-center justify-between border rounded p-3">
            <div>
              <div className="font-mono text-sm">{f.pathname}</div>
              <div className="text-xs text-gray-500">{(f.size/1024/1024).toFixed(2)} MB • {new Date(f.uploadedAt).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">
              <a className="px-3 py-1 border rounded bg-green-600 text-white" href={f.url} target="_blank" rel="noreferrer">Download</a>
              <button className="px-3 py-1 border rounded" onClick={()=> navigator.clipboard.writeText(f.url)}>Copy Link</button>
              <button className="px-3 py-1 border rounded text-red-600" onClick={async ()=>{
                // eslint-disable-next-line no-restricted-globals
                if (!confirm('Delete this interview?')) return;
                const resp = await fetch('/api/delete-interview', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ pathname: f.pathname })});
                if (resp.ok) { refresh(); } else { alert('Delete failed'); }
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

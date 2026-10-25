import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Upload,
  Download,
  RotateCcw,
  Shuffle,
  Menu,
  X,
  FileSpreadsheet,
  Award,
  CheckCheck,
  Filter,
  HelpCircle,
  Layers,
  Sparkles,
  Lock,
  Clock,
  History,
  Trash2,
  Eye,
  EyeOff,
  ArrowLeft,
  Target,
  Play,
} from 'lucide-react';
import defaultData from './data/defaultData.json';
import { parseExcelBuffer, exportDatasetToExcel } from './utils/excelParser.js';
import { verifyExcelPassword } from './utils/sha256.js';

const MIXED_EXAM_KEY = '__MIXED_EXAM_20__';
const HISTORY_VIEW_KEY = '__EXAM_HISTORY__';
const EXAM_DURATION_SECONDS = 30 * 60; // 30 phút
const PASS_PERCENT = 80; // 80% (16/20 câu)
const HISTORY_STORAGE_KEY = 'xd_mep_exam_history_v1';

/**
 * Lấy ngẫu nhiên k phần tử từ mảng
 */
function pickRandomItems(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

/**
 * Tạo đề thi trộn ngẫu nhiên 20 câu:
 * - 20% QĐQC chung (Sheet 1) = 4 câu
 * - 20% ATLĐ VSMT (Sheet 5) = 4 câu
 * - 60% Chuyên môn MEP (Sheet 4) = 12 câu
 */
function generateMixedExamQuestions(sheets) {
  if (!sheets || sheets.length === 0) return [];

  const sheetQDQC =
    sheets.find((s) => s.name.toLowerCase().includes('qđqc')) || sheets[0];
  const sheetATLD =
    sheets.find(
      (s) =>
        s.name.toLowerCase().includes('atlđ') ||
        s.name.toLowerCase().includes('vsmt')
    ) ||
    sheets[4] ||
    sheets[sheets.length - 1];
  const sheetMEP =
    sheets.find(
      (s) =>
        s.name.toLowerCase().includes('me') ||
        s.name.toLowerCase().includes('mep')
    ) ||
    sheets[3] ||
    sheets[0];

  const qQDQC = pickRandomItems(sheetQDQC?.questions || [], 4).map((q) => ({
    ...q,
    sourceGroup: 'QĐQC chung (20%)',
    section: '',
  }));

  const qATLD = pickRandomItems(sheetATLD?.questions || [], 4).map((q) => ({
    ...q,
    sourceGroup: 'ATLĐ & VSMT (20%)',
    section: '',
  }));

  const qMEP = pickRandomItems(sheetMEP?.questions || [], 12).map((q) => ({
    ...q,
    sourceGroup: 'Chuyên môn MEP (60%)',
    section: '',
  }));

  // Trộn ngẫu nhiên toàn bộ 20 câu hỏi
  const combined = pickRandomItems([...qQDQC, ...qATLD, ...qMEP], 20);

  return combined.map((q, idx) => ({
    ...q,
    id: idx + 1,
    stt: String(idx + 1),
  }));
}

function formatTimeMMSS(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationText(secondsUsed) {
  const sec = Math.max(1, Math.floor(secondsUsed));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} giây`;
  return `${m} phút ${String(s).padStart(2, '0')} giây`;
}

export default function App() {
  const [dataset, setDataset] = useState(defaultData);
  // Mặc định khi mới vào mở Sheet đầu tiên, chỉ khi bấm menu mới vào trang Thi
  const [activeSheetName, setActiveSheetName] = useState(
    defaultData.sheets[0]?.name || ''
  );

  // Bộ câu hỏi 20 câu của đề thi trộn hiện tại
  const [mixedQuestions, setMixedQuestions] = useState(() =>
    generateMixedExamQuestions(defaultData.sheets)
  );
  // Trạng thái đã bấm "Bắt đầu thi" hay chưa
  const [examStarted, setExamStarted] = useState(false);
  // Đồng hồ đếm ngược 30 phút cho Đề thi trộn 20 câu
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_SECONDS);
  // Popup thông báo hết thời gian
  const [timeUpModalOpen, setTimeUpModalOpen] = useState(false);

  // Lưu trạng thái làm bài theo từng sheet
  const [sheetStates, setSheetStates] = useState({});
  // Chế độ: 'exam' (Nộp bài mới chấm) | 'practice' (Chọn xong báo Đúng/Sai ngay)
  const [quizMode, setQuizMode] = useState('exam');
  // Bộ lọc câu hỏi khi xem kết quả: 'all' | 'correct' | 'wrong' | 'unanswered'
  const [resultFilter, setResultFilter] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);

  // Lịch sử thi lưu trong localStorage
  const [examHistory, setExamHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  // Xem lại chi tiết 1 lần thi trong lịch sử
  const [reviewingHistoryItem, setReviewingHistoryItem] = useState(null);

  // Modal mật khẩu cho tính năng Upload / Download Excel
  const [authModal, setAuthModal] = useState({
    open: false,
    action: null, // 'upload-click' | 'upload-drop' | 'download'
    file: null,
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const fileInputRef = useRef(null);
  const summaryRef = useRef(null);
  const verifiedPasswordRef = useRef('');

  // Tải bộ đề mới nhất từ API Server (/api/dataset) khi mở trang
  useEffect(() => {
    let cancelled = false;
    fetch('/api/dataset', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (
          !cancelled &&
          res?.ok &&
          res.dataset &&
          Array.isArray(res.dataset.sheets) &&
          res.dataset.sheets.length > 0
        ) {
          setDataset(res.dataset);
          setActiveSheetName((prev) => {
            if (prev === MIXED_EXAM_KEY || prev === HISTORY_VIEW_KEY) return prev;
            const exists = res.dataset.sheets.some((s) => s.name === prev);
            return exists ? prev : res.dataset.sheets[0].name;
          });
          setMixedQuestions(generateMixedExamQuestions(res.dataset.sheets));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Lưu lịch sử thi vào localStorage
  const saveHistoryToStorage = useCallback((newHistory) => {
    setExamHistory(newHistory);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.error('Không thể lưu lịch sử thi:', e);
    }
  }, []);

  // Tạo danh sách sheet bao gồm các sheet trong file + 1 mục Tổng hợp tất cả
  const allSheetsWithCombined = useMemo(() => {
    if (!dataset.sheets || dataset.sheets.length === 0) return [];
    if (dataset.sheets.length === 1) return dataset.sheets;

    let combinedId = 1;
    const combinedQuestions = [];
    for (const s of dataset.sheets) {
      for (const q of s.questions) {
        combinedQuestions.push({
          ...q,
          id: combinedId++,
          section: q.section ? `${s.name} • ${q.section}` : s.name,
        });
      }
    }
    return [
      ...dataset.sheets,
      {
        name: '📚 Tổng hợp tất cả các Sheet',
        isCombined: true,
        questions: combinedQuestions,
      },
    ];
  }, [dataset]);

  const isMixedExam = activeSheetName === MIXED_EXAM_KEY;
  const isHistoryView = activeSheetName === HISTORY_VIEW_KEY;

  const currentSheet = useMemo(() => {
    if (isMixedExam) {
      return {
        name: 'Đề thi sát hạch chuyên môn MEP',
        key: MIXED_EXAM_KEY,
        questions: mixedQuestions,
        isMixed: true,
      };
    }
    const found =
      allSheetsWithCombined.find((s) => s.name === activeSheetName) ||
      allSheetsWithCombined[0] || { name: '', questions: [] };
    return {
      ...found,
      key: found.name,
    };
  }, [isMixedExam, mixedQuestions, allSheetsWithCombined, activeSheetName]);

  const currentSheetState = useMemo(() => {
    return (
      sheetStates[currentSheet.key] || {
        answers: {},
        submitted: false,
        shuffledIds: null,
      }
    );
  }, [sheetStates, currentSheet.key]);

  // Danh sách câu hỏi hiển thị
  const displayedQuestions = useMemo(() => {
    const base = currentSheet.questions || [];
    if (!currentSheetState.shuffledIds) return base;
    const map = new Map(base.map((q) => [q.id, q]));
    return currentSheetState.shuffledIds.map((id) => map.get(id)).filter(Boolean);
  }, [currentSheet.questions, currentSheetState.shuffledIds]);

  // Tính toán thống kê Đúng / Sai / Chưa làm & ĐẠT (>= 80%)
  const stats = useMemo(() => {
    const total = displayedQuestions.length;
    let answered = 0;
    let correct = 0;
    let wrong = 0;

    const groupStats = {
      'QĐQC chung (20%)': { correct: 0, total: 0 },
      'ATLĐ & VSMT (20%)': { correct: 0, total: 0 },
      'Chuyên môn MEP (60%)': { correct: 0, total: 0 },
    };

    for (const q of displayedQuestions) {
      const userAns = currentSheetState.answers[q.id];
      const isRight = Boolean(userAns && userAns === q.correctAnswer);

      if (q.sourceGroup && groupStats[q.sourceGroup]) {
        groupStats[q.sourceGroup].total += 1;
        if (isRight) groupStats[q.sourceGroup].correct += 1;
      }

      if (userAns) {
        answered += 1;
        if (isRight) {
          correct += 1;
        } else {
          wrong += 1;
        }
      }
    }

    const unanswered = total - answered;
    const score10 = total > 0 ? ((correct / total) * 10).toFixed(2) : '0.00';
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const requiredCorrect = Math.ceil((total * PASS_PERCENT) / 100);
    const passed = total > 0 && correct >= requiredCorrect;

    return {
      total,
      answered,
      unanswered,
      correct,
      wrong,
      score10,
      accuracy,
      requiredCorrect,
      passed,
      groupStats,
    };
  }, [displayedQuestions, currentSheetState.answers]);

  const showResults = currentSheetState.submitted;
  const isTimeUp = isMixedExam && examStarted && timeLeft === 0 && !showResults;

  // Nộp bài & Lưu vào lịch sử thi
  const handleSubmitQuiz = useCallback(() => {
    if (currentSheetState.submitted) return;

    setTimeUpModalOpen(false);
    setSheetStates((prev) => {
      const prevSheet = prev[currentSheet.key] || {
        answers: {},
        submitted: false,
        shuffledIds: null,
      };
      return {
        ...prev,
        [currentSheet.key]: {
          ...prevSheet,
          submitted: true,
        },
      };
    });

    const durationUsed = isMixedExam ? EXAM_DURATION_SECONDS - timeLeft : 0;

    const historyEntry = {
      id: Date.now(),
      timestamp: new Date().toLocaleString('vi-VN'),
      examTitle: isMixedExam
        ? 'Đề thi sát hạch chuyên môn MEP'
        : currentSheet.name,
      isMixedExam,
      isAutoTimeout: timeLeft === 0 && isMixedExam,
      total: stats.total,
      correct: stats.correct,
      wrong: stats.wrong,
      unanswered: stats.unanswered,
      score10: stats.score10,
      accuracy: stats.accuracy,
      requiredCorrect: stats.requiredCorrect,
      passed: stats.passed,
      durationUsed: isMixedExam ? durationUsed : null,
      groupStats: isMixedExam ? stats.groupStats : null,
      questionsSnapshot: displayedQuestions,
      answersSnapshot: { ...currentSheetState.answers },
    };

    saveHistoryToStorage([historyEntry, ...examHistory]);
    setResultFilter('all');

    setTimeout(() => {
      if (summaryRef.current) {
        summaryRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 80);
  }, [
    currentSheetState.submitted,
    currentSheetState.answers,
    currentSheet.key,
    currentSheet.name,
    isMixedExam,
    timeLeft,
    stats,
    displayedQuestions,
    examHistory,
    saveHistoryToStorage,
  ]);

  // Đồng hồ đếm ngược 30 phút khi đã bấm "Bắt đầu thi" và chưa nộp bài
  useEffect(() => {
    if (!isMixedExam || !examStarted || currentSheetState.submitted) return;
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isMixedExam, examStarted, currentSheetState.submitted, timeLeft]);

  // Khi hết 30 phút (timeLeft === 0) -> hiện popup hết thời gian và khóa chọn đáp án
  useEffect(() => {
    if (isMixedExam && examStarted && timeLeft === 0 && !currentSheetState.submitted) {
      setTimeUpModalOpen(true);
    }
  }, [isMixedExam, examStarted, timeLeft, currentSheetState.submitted]);

  // Lọc câu hỏi khi xem tổng kết
  const filteredQuestions = useMemo(() => {
    if (!currentSheetState.submitted && quizMode !== 'practice') {
      return displayedQuestions;
    }
    if (resultFilter === 'all') return displayedQuestions;
    return displayedQuestions.filter((q) => {
      const userAns = currentSheetState.answers[q.id];
      if (resultFilter === 'correct') return userAns && userAns === q.correctAnswer;
      if (resultFilter === 'wrong') return userAns && userAns !== q.correctAnswer;
      if (resultFilter === 'unanswered') return !userAns;
      return true;
    });
  }, [
    displayedQuestions,
    currentSheetState.submitted,
    currentSheetState.answers,
    quizMode,
    resultFilter,
  ]);

  // Chọn mục từ Sidebar
  const handleSelectSheet = (sheetKey) => {
    setActiveSheetName(sheetKey);
    setReviewingHistoryItem(null);
    setResultFilter('all');
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Bấm "Bắt đầu thi" để trộn 20 câu hỏi và bắt đầu tính giờ 30 phút
  const handleStartMixedExam = () => {
    const newQuestions = generateMixedExamQuestions(dataset.sheets);
    setMixedQuestions(newQuestions);
    setTimeLeft(EXAM_DURATION_SECONDS);
    setTimeUpModalOpen(false);
    setExamStarted(true);
    setQuizMode('exam');
    setSheetStates((prev) => ({
      ...prev,
      [MIXED_EXAM_KEY]: {
        answers: {},
        submitted: false,
        shuffledIds: null,
      },
    }));
    setActiveSheetName(MIXED_EXAM_KEY);
    setReviewingHistoryItem(null);
    setResultFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Chọn đáp án A / B / C / D cho 1 câu hỏi
  const handleSelectOption = (questionId, optionKey) => {
    if (currentSheetState.submitted || isTimeUp) return;

    setSheetStates((prev) => {
      const prevSheet = prev[currentSheet.key] || {
        answers: {},
        submitted: false,
        shuffledIds: null,
      };
      const updatedAnswers = {
        ...prevSheet.answers,
        [questionId]: optionKey,
      };

      return {
        ...prev,
        [currentSheet.key]: {
          ...prevSheet,
          answers: updatedAnswers,
        },
      };
    });
  };

  // Làm lại bộ câu hỏi hiện tại
  const handleResetSheet = () => {
    if (isMixedExam) {
      handleStartMixedExam();
      return;
    }
    setSheetStates((prev) => ({
      ...prev,
      [currentSheet.key]: {
        answers: {},
        submitted: false,
        shuffledIds: prev[currentSheet.key]?.shuffledIds || null,
      },
    }));
    setResultFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Đảo thứ tự câu hỏi
  const handleShuffleQuestions = () => {
    if (isMixedExam) {
      handleStartMixedExam();
      return;
    }
    const ids = (currentSheet.questions || []).map((q) => q.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setSheetStates((prev) => ({
      ...prev,
      [currentSheet.key]: {
        answers: {},
        submitted: false,
        shuffledIds: ids,
      },
    }));
    setResultFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Xử lý Upload file Excel mới & đồng bộ lên Server (/api/dataset -> GitHub)
  const handleExcelFile = async (file, pwd = verifiedPasswordRef.current) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseExcelBuffer(buffer, file.name);
      if (!parsed.sheets || parsed.sheets.length === 0) {
        alert(
          'Không tìm thấy câu hỏi hợp lệ trong file Excel! Vui lòng kiểm tra lại định dạng file.'
        );
        return;
      }

      const newDataset = {
        fileName: parsed.fileName,
        sheets: parsed.sheets,
      };

      setDataset(newDataset);
      setMixedQuestions(generateMixedExamQuestions(parsed.sheets));
      setExamStarted(false);
      setTimeLeft(EXAM_DURATION_SECONDS);
      setTimeUpModalOpen(false);
      setActiveSheetName(parsed.sheets[0].name);
      setSheetStates({});
      setResultFilter('all');
      setSidebarOpen(false);
      setUploadNotice(
        `Đang đồng bộ bộ đề "${file.name}" (${parsed.sheets.length} chuyên đề, ${parsed.totalQuestions} câu hỏi) lên hệ thống...`
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Gửi lên API Server của Vercel để kiểm tra pass & lưu vào GitHub Repo
      try {
        const res = await fetch('/api/dataset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upload',
            password: pwd,
            dataset: newDataset,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok && data.savedToServer) {
          setUploadNotice(
            `Đã tải lên thành công "${file.name}" (${parsed.sheets.length} chuyên đề, ${parsed.totalQuestions} câu hỏi) và cập nhật lên hệ thống cho toàn bộ người dùng!`
          );
        } else if (res.ok && data.missingToken) {
          setUploadNotice(
            `Đã tải lên "${file.name}" (${parsed.sheets.length} chuyên đề, ${parsed.totalQuestions} câu hỏi). Lưu ý: Hãy thêm biến môi trường GITHUB_TOKEN trên Vercel để tự động lưu vĩnh viễn vào GitHub.`
          );
        } else {
          setUploadNotice(
            `Đã tải lên "${file.name}" (${parsed.sheets.length} chuyên đề, ${parsed.totalQuestions} câu hỏi). ${data.error || ''}`
          );
        }
      } catch {
        setUploadNotice(
          `Đã tải lên thành công "${file.name}" với ${parsed.sheets.length} chuyên đề (${parsed.totalQuestions} câu hỏi).`
        );
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi khi đọc file Excel: ' + (err.message || 'Định dạng không hợp lệ'));
    }
  };

  const handleRestoreDefault = () => {
    setDataset(defaultData);
    setMixedQuestions(generateMixedExamQuestions(defaultData.sheets));
    setExamStarted(false);
    setTimeLeft(EXAM_DURATION_SECONDS);
    setTimeUpModalOpen(false);
    setActiveSheetName(defaultData.sheets[0]?.name || '');
    setSheetStates({});
    setResultFilter('all');
    setUploadNotice(null);
  };

  const handleClearHistory = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử thi không?')) {
      saveHistoryToStorage([]);
      setReviewingHistoryItem(null);
    }
  };

  // Mở modal yêu cầu mật khẩu trước khi Upload / Download
  const requestProtectedAction = (action, file = null) => {
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
    setAuthModal({ open: true, action, file });
  };

  const closeAuthModal = () => {
    setAuthModal({ open: false, action: null, file: null });
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  const handleVerifyPassword = (e) => {
    e.preventDefault();
    if (!verifyExcelPassword(passwordInput)) {
      setPasswordError('Mật khẩu không chính xác. Vui lòng thử lại!');
      return;
    }

    const { action, file } = authModal;
    const pwd = passwordInput;
    verifiedPasswordRef.current = pwd;
    closeAuthModal();

    if (action === 'upload-click') {
      fileInputRef.current?.click();
    } else if (action === 'upload-drop' && file) {
      handleExcelFile(file, pwd);
    } else if (action === 'download') {
      exportDatasetToExcel(dataset);
    }
  };

  const scrollToQuestion = (qId) => {
    const el = document.getElementById(`question-card-${qId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const progressPercent =
    stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;

  const isCompletedAll = stats.total > 0 && stats.answered === stats.total;

  return (
    <div className="app-layout">
      {/* Backdrop cho mobile sidebar */}
      <div
        className={`sidebar-backdrop ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* SIDEBAR MENU */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-icon">
            <BookOpen size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="brand-title">Ôn thi trắc nghiệm chuyên môn XD-MEP</div>
            <div className="brand-subtitle">Hệ thống luyện thi &amp; sát hạch</div>
          </div>
          <button
            className="mobile-menu-btn"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
            onClick={() => setSidebarOpen(false)}
            aria-label="Đóng menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* MỤC THI SÁT HẠCH & LỊCH SỬ THI */}
        <div className="sidebar-section-label">
          <span>Thi sát hạch &amp; Kết quả</span>
          <Target size={14} />
        </div>
        <div
          style={{
            padding: '4px 12px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <button
            type="button"
            className={`sheet-item ${isMixedExam ? 'active' : ''}`}
            onClick={() => handleSelectSheet(MIXED_EXAM_KEY)}
          >
            <div className="sheet-item-left">
              <Target
                size={16}
                style={{
                  flexShrink: 0,
                  color: isMixedExam ? '#fff' : '#60a5fa',
                }}
              />
              <span className="sheet-item-name">Đề thi ngẫu nhiên (30P)</span>
            </div>
            <div className="sheet-badges">
              <span className="sheet-count-badge">20 câu</span>
            </div>
          </button>

          <button
            type="button"
            className={`sheet-item ${isHistoryView ? 'active' : ''}`}
            onClick={() => handleSelectSheet(HISTORY_VIEW_KEY)}
          >
            <div className="sheet-item-left">
              <History
                size={16}
                style={{
                  flexShrink: 0,
                  color: isHistoryView ? '#fff' : '#34d399',
                }}
              />
              <span className="sheet-item-name">Lịch sử thi</span>
            </div>
            <div className="sheet-badges">
              <span className="sheet-count-badge">{examHistory.length} lần</span>
            </div>
          </button>
        </div>

        <div className="sidebar-section-label">
          <span>Ôn tập theo Sheet ({dataset.sheets.length} Sheet)</span>
          <Layers size={14} />
        </div>

        <nav className="sheet-menu" aria-label="Danh sách sheet câu hỏi">
          {allSheetsWithCombined.map((sheet) => {
            const isActive =
              !isMixedExam && !isHistoryView && sheet.name === currentSheet.name;
            const sState = sheetStates[sheet.name];
            const totalQ = sheet.questions.length;
            const answeredCount = sState ? Object.keys(sState.answers).length : 0;

            let scoreBadge = null;
            if (sState?.submitted && totalQ > 0) {
              let cCount = 0;
              for (const q of sheet.questions) {
                if (sState.answers[q.id] === q.correctAnswer) cCount++;
              }
              scoreBadge = `${cCount}/${totalQ} đúng`;
            } else if (answeredCount > 0) {
              scoreBadge = `${answeredCount}/${totalQ}`;
            }

            return (
              <button
                key={sheet.name}
                type="button"
                className={`sheet-item ${isActive ? 'active' : ''}`}
                onClick={() => handleSelectSheet(sheet.name)}
              >
                <div className="sheet-item-left">
                  <FileSpreadsheet
                    size={16}
                    style={{
                      flexShrink: 0,
                      opacity: isActive ? 1 : 0.7,
                    }}
                  />
                  <span className="sheet-item-name" title={sheet.name}>
                    {sheet.name}
                  </span>
                </div>
                <div className="sheet-badges">
                  {scoreBadge && (
                    <span className="sheet-score-pill">{scoreBadge}</span>
                  )}
                  <span className="sheet-count-badge">{totalQ} câu</span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* KHU VỰC UPLOAD & QUẢN LÝ FILE EXCEL */}
        <div className="sidebar-footer">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleExcelFile(file);
              e.target.value = '';
            }}
          />
          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onClick={() => requestProtectedAction('upload-click')}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) requestProtectedAction('upload-drop', file);
            }}
          >
            <Upload size={20} style={{ color: '#60a5fa', margin: '0 auto' }} />
            <div className="upload-zone-title">Upload file Excel đề thi (.xlsx)</div>
            <div className="upload-zone-desc">
              Kéo thả hoặc nhấn để chọn file đề thi
            </div>
          </div>

          <div className="file-info-bar">
            <div className="file-info-name">
              <FileSpreadsheet size={14} style={{ flexShrink: 0 }} />
              <span>{dataset.fileName}</span>
            </div>
            <div className="sidebar-action-btns">
              <button
                type="button"
                className="btn-sidebar-sm"
                onClick={() => requestProtectedAction('download')}
                title="Tải file Excel bộ đề hiện tại"
              >
                <Download size={13} />
                <span>Tải file đề</span>
              </button>
              {dataset.fileName !== defaultData.fileName && (
                <button
                  type="button"
                  className="btn-sidebar-sm"
                  onClick={handleRestoreDefault}
                  title="Khôi phục bộ đề mặc định"
                >
                  <RotateCcw size={13} />
                  <span>Đề gốc</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN AREA */}
      <div className="main-area">
        {/* TOP HEADER */}
        <header className="top-header">
          <div className="top-header-inner">
            <div className="header-sheet-info">
              <button
                type="button"
                className="mobile-menu-btn"
                onClick={() => setSidebarOpen(true)}
                aria-label="Mở danh mục đề thi"
              >
                <Menu size={20} />
              </button>
              <div>
                <h1 className="header-title">
                  <span>
                    {isHistoryView
                      ? 'Lịch sử thi sát hạch & ôn tập'
                      : currentSheet.name}
                  </span>
                </h1>
                {!isHistoryView ? (
                  isMixedExam && !examStarted && !showResults ? (
                    <div className="header-meta">
                      Thời gian làm bài: <strong>30 phút</strong> • Số lượng:{' '}
                      <strong>20 câu hỏi</strong> • Đạt: <strong>≥ 80% (16/20 câu)</strong>
                    </div>
                  ) : (
                    <div className="header-meta">
                      Đã trả lời <strong>{stats.answered}</strong> /{' '}
                      <strong>{stats.total}</strong> câu ({progressPercent}%) • Điều kiện
                      ĐẠT: <strong>≥ {PASS_PERCENT}% ({stats.requiredCorrect}/{stats.total} câu đúng)</strong>
                    </div>
                  )
                ) : (
                  <div className="header-meta">
                    Tổng cộng <strong>{examHistory.length}</strong> lần thi đã lưu trên trình duyệt
                  </div>
                )}
              </div>
            </div>

            {!isHistoryView ? (
              isMixedExam && !examStarted && !showResults ? null : (
                <div className="header-controls">
                  {/* Đồng hồ đếm ngược 30 phút cho Đề thi trộn 20 câu */}
                  {isMixedExam && (
                    <div
                      className={`timer-badge ${
                        timeLeft <= 60
                          ? 'timer-danger'
                          : timeLeft <= 300
                          ? 'timer-warning'
                          : ''
                      }`}
                      title="Thời gian làm bài 30 phút"
                    >
                      <Clock size={16} />
                      <span>{formatTimeMMSS(timeLeft)}</span>
                    </div>
                  )}

                  {!isMixedExam && (
                    <div className="mode-switch" role="group" aria-label="Chế độ làm bài">
                      <button
                        type="button"
                        className={`mode-btn ${quizMode === 'exam' ? 'active' : ''}`}
                        onClick={() => setQuizMode('exam')}
                      >
                        Thi kiểm tra
                      </button>
                      <button
                        type="button"
                        className={`mode-btn ${quizMode === 'practice' ? 'active' : ''}`}
                        onClick={() => setQuizMode('practice')}
                      >
                        Ôn tập (Báo đáp án ngay)
                      </button>
                    </div>
                  )}

                  {!isMixedExam && (
                    <>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleShuffleQuestions}
                        title="Đảo ngẫu nhiên thứ tự câu hỏi"
                      >
                        <Shuffle size={15} />
                        <span>Đảo câu hỏi</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={handleResetSheet}
                        title="Làm lại từ đầu sheet này"
                      >
                        <RotateCcw size={15} />
                        <span>Làm lại</span>
                      </button>
                    </>
                  )}
                </div>
              )
            ) : (
              <div className="header-controls">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleSelectSheet(MIXED_EXAM_KEY)}
                >
                  <Target size={15} />
                  <span>Vào trang Thi sát hạch</span>
                </button>
                {examHistory.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleClearHistory}
                    style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  >
                    <Trash2 size={15} />
                    <span>Xóa lịch sử</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* THANH TIẾN ĐỘ STICKY CÙNG HEADER */}
          {!isHistoryView && (!isMixedExam || examStarted || showResults) && (
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </header>

        {/* MÀN HÌNH LỊCH SỬ THI */}
        {isHistoryView ? (
          <main className="history-container">
            {reviewingHistoryItem ? (
              <div className="questions-column">
                <div className="history-review-topbar">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setReviewingHistoryItem(null)}
                  >
                    <ArrowLeft size={16} />
                    <span>Quay lại danh sách lịch sử</span>
                  </button>
                  <div style={{ fontSize: 13.5, color: '#475569' }}>
                    Thời gian nộp: <strong>{reviewingHistoryItem.timestamp}</strong>
                  </div>
                </div>

                <section className="summary-card">
                  <div className="summary-header">
                    <div className="summary-title-group">
                      <h2>
                        <Award size={24} style={{ color: '#2563eb' }} />
                        <span>Chi tiết lần thi: {reviewingHistoryItem.examTitle}</span>
                      </h2>
                      <p>
                        Kết quả:{' '}
                        <strong
                          style={{
                            color: reviewingHistoryItem.passed ? '#059669' : '#dc2626',
                          }}
                        >
                          {reviewingHistoryItem.passed ? 'ĐẠT (PASSED)' : 'CHƯA ĐẠT (FAILED)'}
                        </strong>{' '}
                        • Đúng {reviewingHistoryItem.correct}/{reviewingHistoryItem.total} câu (
                        {reviewingHistoryItem.accuracy}%)
                        {reviewingHistoryItem.durationUsed != null &&
                          ` • Thời gian làm bài: ${formatDurationText(
                            reviewingHistoryItem.durationUsed
                          )}`}
                      </p>
                    </div>

                    <div className="score-highlight">
                      <span
                        className={`pass-status-pill ${
                          reviewingHistoryItem.passed ? 'passed' : 'failed'
                        }`}
                      >
                        {reviewingHistoryItem.passed ? '✓ ĐẠT' : '✕ CHƯA ĐẠT'}
                      </span>
                      <div>
                        <div className="score-big">{reviewingHistoryItem.score10}</div>
                        <div className="score-sub">Thang điểm 10</div>
                      </div>
                    </div>
                  </div>
                </section>

                {(reviewingHistoryItem.questionsSnapshot || []).map((q) => {
                  const userAns = reviewingHistoryItem.answersSnapshot?.[q.id];
                  const isCorrect = userAns === q.correctAnswer;

                  return (
                    <article
                      key={q.id}
                      className={`question-card ${
                        userAns ? (isCorrect ? 'card-correct' : 'card-wrong') : ''
                      }`}
                    >
                      <div className="question-header">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span className="question-number-badge">Câu {q.id}</span>
                        </div>
                        <div>
                          {userAns ? (
                            isCorrect ? (
                              <span className="question-status-badge correct">
                                <CheckCircle2 size={14} /> Chính xác
                              </span>
                            ) : (
                              <span className="question-status-badge wrong">
                                <XCircle size={14} /> Sai (Đáp án đúng: {q.correctAnswer})
                              </span>
                            )
                          ) : (
                            <span className="question-status-badge unanswered">
                              <AlertCircle size={14} /> Chưa trả lời (Đáp án:{' '}
                              {q.correctAnswer})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="question-text">{q.question}</div>

                      <div className="options-list">
                        {q.options.map((opt) => {
                          const isSelected = userAns === opt.key;
                          const isRightOption = opt.key === q.correctAnswer;
                          let optClass = 'option-btn';
                          if (isRightOption) optClass += ' is-correct';
                          else if (isSelected && !isRightOption)
                            optClass += ' is-wrong-choice';

                          return (
                            <div key={opt.key} className={optClass}>
                              <span className="option-key">{opt.key}</span>
                              <span className="option-text">{opt.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="history-list-wrapper">
                {examHistory.length === 0 ? (
                  <div className="empty-history-card">
                    <History
                      size={44}
                      style={{ color: '#94a3b8', margin: '0 auto 12px' }}
                    />
                    <h3>Chưa có lịch sử thi nào</h3>
                    <p>
                      Hãy hoàn thành và bấm &ldquo;Nộp bài &amp; Chấm điểm&rdquo; để hệ
                      thống lưu lại kết quả các lần thi tại đây.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginTop: 14 }}
                      onClick={() => handleSelectSheet(MIXED_EXAM_KEY)}
                    >
                      <Target size={16} />
                      <span>Đi tới trang Thi sát hạch</span>
                    </button>
                  </div>
                ) : (
                  <div className="history-table-card">
                    <div className="history-summary-strip">
                      <div className="stat-box">
                        <span className="stat-label">Tổng số lần thi</span>
                        <span className="stat-value">{examHistory.length}</span>
                      </div>
                      <div className="stat-box correct">
                        <span className="stat-label">Số lần ĐẠT (≥ 80%)</span>
                        <span className="stat-value">
                          {examHistory.filter((h) => h.passed).length}
                        </span>
                      </div>
                      <div className="stat-box wrong">
                        <span className="stat-label">Số lần CHƯA ĐẠT</span>
                        <span className="stat-value">
                          {examHistory.filter((h) => !h.passed).length}
                        </span>
                      </div>
                      <div className="stat-box">
                        <span className="stat-label">Kết quả cao nhất</span>
                        <span className="stat-value" style={{ color: '#2563eb' }}>
                          {Math.max(...examHistory.map((h) => h.accuracy))}%
                        </span>
                      </div>
                    </div>

                    <div className="history-items">
                      {examHistory.map((item, idx) => (
                        <div key={item.id} className="history-row">
                          <div className="history-row-main">
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                className={`pass-status-pill ${
                                  item.passed ? 'passed' : 'failed'
                                }`}
                              >
                                {item.passed ? '✓ ĐẠT' : '✕ CHƯA ĐẠT'}
                              </span>
                              <strong style={{ fontSize: 15, color: '#0f172a' }}>
                                Lần #{examHistory.length - idx}: {item.examTitle}
                              </strong>
                            </div>
                            <div className="history-row-meta">
                              <span>🕒 Nộp lúc: {item.timestamp}</span>
                              {item.durationUsed != null && (
                                <span>
                                  • ⏱ Thời gian làm: {formatDurationText(item.durationUsed)}
                                </span>
                              )}
                              {item.isAutoTimeout && (
                                <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                  • Hết thời gian làm bài (30 phút)
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="history-row-right">
                            <div className="history-score-col">
                              <div
                                style={{
                                  fontWeight: 800,
                                  fontSize: 16,
                                  color: item.passed ? '#059669' : '#dc2626',
                                }}
                              >
                                {item.correct}/{item.total} câu ({item.accuracy}%)
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b' }}>
                                Điểm: {item.score10}/10 • Sai: {item.wrong}
                              </div>
                            </div>

                            {item.questionsSnapshot && (
                              <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => setReviewingHistoryItem(item)}
                              >
                                <Eye size={15} />
                                <span>Xem lại</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        ) : isMixedExam && !examStarted && !showResults ? (
          /* MÀN HÌNH CHUẨN BỊ BẮT ĐẦU THI (CHỈ HIỆN CÂU HỎI KHI BẤM BẮT ĐẦU THI) */
          <main className="history-container">
            <div className="exam-start-card">
              <div className="exam-start-icon">
                <Target size={36} />
              </div>
              <h2 className="exam-start-title">
                Đề thi sát hạch chuyên môn MEP
              </h2>
              <p className="exam-start-desc">
                Hệ thống sẽ trộn ngẫu nhiên <strong>20 câu hỏi</strong> từ ngân hàng đề
                thi. Thời gian làm bài được tính ngược <strong>30 phút</strong> ngay sau
                khi bạn nhấn nút <strong>Bắt đầu thi</strong>.
              </p>

              <div className="exam-info-grid">
                <div className="exam-info-item">
                  <span className="exam-info-label">Số lượng câu hỏi</span>
                  <strong className="exam-info-val">20 câu trắc nghiệm</strong>
                </div>
                <div className="exam-info-item">
                  <span className="exam-info-label">Thời gian làm bài</span>
                  <strong className="exam-info-val">30 phút</strong>
                </div>
                <div className="exam-info-item">
                  <span className="exam-info-label">Tiêu chuẩn ĐẠT</span>
                  <strong className="exam-info-val" style={{ color: '#059669' }}>
                    ≥ 80% (16/20 câu đúng)
                  </strong>
                </div>
              </div>

              <div className="exam-structure-box">
                <div className="exam-structure-box-title">
                  Tỷ lệ phân bổ câu hỏi trong đề thi:
                </div>
                <div className="exam-structure-pills" style={{ justifyContent: 'center' }}>
                  <span className="structure-pill">
                    20% QĐQC chung: <strong>4 câu</strong>
                  </span>
                  <span className="structure-pill">
                    20% ATLĐ &amp; VSMT: <strong>4 câu</strong>
                  </span>
                  <span className="structure-pill">
                    60% Chuyên môn MEP: <strong>12 câu</strong>
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary exam-start-btn"
                onClick={handleStartMixedExam}
              >
                <Play size={18} />
                <span>Bắt đầu thi</span>
              </button>
            </div>
          </main>
        ) : (
          /* MÀN HÌNH LÀM BÀI THI / ÔN TẬP */
          <main className="content-container">
            <div className="questions-column">
              {/* Thông báo khi upload file Excel */}
              {uploadNotice && (
                <div className="notice-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Sparkles size={18} style={{ flexShrink: 0 }} />
                    <span>{uploadNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadNotice(null)}
                    style={{ color: '#1e40af', fontWeight: 700, padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* BẢNG TỔNG KẾT KẾT QUẢ SAU KHI HOÀN THÀNH */}
              {(showResults || (quizMode === 'practice' && isCompletedAll)) && (
                <section className="summary-card" ref={summaryRef}>
                  <div className="summary-header">
                    <div className="summary-title-group">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <h2>
                          <Award size={24} style={{ color: '#2563eb' }} />
                          <span>Tổng kết kết quả</span>
                        </h2>
                        <span
                          className={`pass-status-pill ${
                            stats.passed ? 'passed' : 'failed'
                          }`}
                        >
                          {stats.passed
                            ? `✓ ĐẠT (${stats.correct}/${stats.total} câu ≥ 80%)`
                            : `✕ CHƯA ĐẠT (Cần ≥ ${stats.requiredCorrect}/${stats.total} câu)`}
                        </span>
                      </div>
                      <p>
                        {stats.passed
                          ? 'Chúc mừng! Bạn đã vượt qua ngưỡng 80% yêu cầu của bài thi.'
                          : `Bạn cần đạt tối thiểu ${stats.requiredCorrect}/${stats.total} câu đúng (80%) để được đánh giá ĐẠT.`}
                        {isMixedExam &&
                          ` • Thời gian làm bài: ${formatDurationText(
                            EXAM_DURATION_SECONDS - timeLeft
                          )}.`}
                      </p>
                    </div>

                    <div className="score-highlight">
                      <div>
                        <div className="score-big">{stats.score10}</div>
                        <div className="score-sub">Thang điểm 10</div>
                      </div>
                      <div
                        style={{
                          width: 1,
                          height: 36,
                          backgroundColor: '#cbd5e1',
                        }}
                      />
                      <div>
                        <div
                          className="score-big"
                          style={{
                            color: stats.passed ? '#059669' : '#dc2626',
                          }}
                        >
                          {stats.accuracy}%
                        </div>
                        <div className="score-sub">Tỷ lệ chính xác</div>
                      </div>
                    </div>
                  </div>

                  <div className="summary-stats-grid">
                    <div className="stat-box">
                      <span className="stat-label">Tổng số câu hỏi</span>
                      <span className="stat-value">{stats.total}</span>
                    </div>
                    <div className="stat-box correct">
                      <span className="stat-label">Số câu ĐÚNG</span>
                      <span className="stat-value">{stats.correct}</span>
                    </div>
                    <div className="stat-box wrong">
                      <span className="stat-label">Số câu SAI</span>
                      <span className="stat-value">{stats.wrong}</span>
                    </div>
                    <div className="stat-box unanswered">
                      <span className="stat-label">Chưa trả lời</span>
                      <span className="stat-value">{stats.unanswered}</span>
                    </div>
                  </div>

                  {/* Bộ lọc xem lại câu đúng / câu sai */}
                  <div className="filter-tabs">
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: '#64748b',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        marginRight: 4,
                      }}
                    >
                      <Filter size={14} /> Lọc câu hỏi:
                    </span>
                    <button
                      type="button"
                      className={`filter-tab ${resultFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setResultFilter('all')}
                    >
                      Tất cả ({stats.total})
                    </button>
                    <button
                      type="button"
                      className={`filter-tab ${resultFilter === 'correct' ? 'active' : ''}`}
                      onClick={() => setResultFilter('correct')}
                    >
                      ✅ Câu trả lời Đúng ({stats.correct})
                    </button>
                    <button
                      type="button"
                      className={`filter-tab ${resultFilter === 'wrong' ? 'active' : ''}`}
                      onClick={() => setResultFilter('wrong')}
                    >
                      ❌ Câu trả lời Sai ({stats.wrong})
                    </button>
                    {stats.unanswered > 0 && (
                      <button
                        type="button"
                        className={`filter-tab ${
                          resultFilter === 'unanswered' ? 'active' : ''
                        }`}
                        onClick={() => setResultFilter('unanswered')}
                      >
                        ⚠️ Chưa trả lời ({stats.unanswered})
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* DANH SÁCH CÂU HỎI TRẮC NGHIỆM */}
              {filteredQuestions.map((q, index) => {
                const userAns = currentSheetState.answers[q.id];
                const isGraded =
                  showResults ||
                  (!isMixedExam && quizMode === 'practice' && Boolean(userAns));
                const isCorrect = userAns === q.correctAnswer;

                const prevQuestion = index > 0 ? filteredQuestions[index - 1] : null;
                const showSectionHeader =
                  !isMixedExam &&
                  q.section &&
                  (!prevQuestion || prevQuestion.section !== q.section);

                let cardClass = 'question-card';
                if (isGraded) {
                  if (userAns && isCorrect) cardClass += ' card-correct';
                  else if (userAns && !isCorrect) cardClass += ' card-wrong';
                }

                return (
                  <React.Fragment key={q.id}>
                    {showSectionHeader && (
                      <div className="section-divider">
                        <Layers size={17} />
                        <span>Chuyên mục: {q.section}</span>
                      </div>
                    )}

                    <article id={`question-card-${q.id}`} className={cardClass}>
                      <div className="question-header">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span className="question-number-badge">
                            Câu {q.id}{' '}
                            {!isMixedExam && q.stt && String(q.stt) !== String(q.id)
                              ? `(STT ${q.stt})`
                              : ''}
                          </span>
                          {!isMixedExam && q.section && (
                            <span className="question-section-tag">{q.section}</span>
                          )}
                        </div>

                        {isGraded && (
                          <div>
                            {userAns ? (
                              isCorrect ? (
                                <span className="question-status-badge correct">
                                  <CheckCircle2 size={14} /> Chính xác
                                </span>
                              ) : (
                                <span className="question-status-badge wrong">
                                  <XCircle size={14} /> Sai (Đáp án đúng: {q.correctAnswer})
                                </span>
                              )
                            ) : (
                              <span className="question-status-badge unanswered">
                                <AlertCircle size={14} /> Chưa trả lời (Đáp án:{' '}
                                {q.correctAnswer})
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="question-text">{q.question}</div>

                      <div className="options-list">
                        {q.options.map((opt) => {
                          const isSelected = userAns === opt.key;
                          const isRightOption = opt.key === q.correctAnswer;

                          let optClass = 'option-btn';
                          if (!isGraded) {
                            if (isSelected) optClass += ' selected';
                          } else {
                            if (isRightOption) {
                              optClass += ' is-correct';
                            } else if (isSelected && !isRightOption) {
                              optClass += ' is-wrong-choice';
                            }
                          }

                          return (
                            <button
                              key={opt.key}
                              type="button"
                              className={optClass}
                              disabled={showResults || isTimeUp}
                              onClick={() => handleSelectOption(q.id, opt.key)}
                            >
                              <span className="option-key">{opt.key}</span>
                              <span className="option-text">{opt.text}</span>
                              {isGraded && isRightOption && (
                                <CheckCircle2
                                  size={18}
                                  style={{
                                    color: '#059669',
                                    flexShrink: 0,
                                    marginTop: 4,
                                  }}
                                />
                              )}
                              {isGraded && isSelected && !isRightOption && (
                                <XCircle
                                  size={18}
                                  style={{
                                    color: '#dc2626',
                                    flexShrink: 0,
                                    marginTop: 4,
                                  }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {isGraded && (
                        <div className="answer-explanation-bar">
                          <div>
                            <span>Bạn đã chọn: </span>
                            <strong
                              style={{
                                color: !userAns
                                  ? '#b45309'
                                  : isCorrect
                                  ? '#059669'
                                  : '#dc2626',
                              }}
                            >
                              {userAns ? `Phương án ${userAns}` : 'Chưa chọn'}
                            </strong>
                          </div>
                          <div>
                            <span>Đáp án đúng: </span>
                            <strong style={{ color: '#059669' }}>
                              Phương án {q.correctAnswer}
                            </strong>
                          </div>
                        </div>
                      )}
                    </article>
                  </React.Fragment>
                );
              })}
            </div>

            {/* BẢNG ĐIỀU HƯỚNG CÂU HỎI BÊN PHẢI */}
            <aside className="navigator-card" aria-label="Bảng danh sách câu hỏi">
              <div className="navigator-title">
                <span>Bảng câu hỏi ({stats.answered}/{stats.total})</span>
                <HelpCircle size={15} style={{ color: '#64748b' }} />
              </div>

              <div className="navigator-legend">
                {!showResults && (isMixedExam || quizMode === 'exam') ? (
                  <>
                    <span className="legend-item">
                      <span
                        className="legend-dot"
                        style={{ backgroundColor: '#2563eb' }}
                      />
                      Đã chọn ({stats.answered})
                    </span>
                    <span className="legend-item">
                      <span
                        className="legend-dot"
                        style={{
                          backgroundColor: '#f8fafc',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                      Chưa làm ({stats.unanswered})
                    </span>
                  </>
                ) : (
                  <>
                    <span className="legend-item">
                      <span
                        className="legend-dot"
                        style={{ backgroundColor: '#10b981' }}
                      />
                      Đúng ({stats.correct})
                    </span>
                    <span className="legend-item">
                      <span
                        className="legend-dot"
                        style={{ backgroundColor: '#ef4444' }}
                      />
                      Sai ({stats.wrong})
                    </span>
                    <span className="legend-item">
                      <span
                        className="legend-dot"
                        style={{
                          backgroundColor: '#f8fafc',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                      Trống ({stats.unanswered})
                    </span>
                  </>
                )}
              </div>

              <div className="navigator-grid">
                {displayedQuestions.map((q, idx) => {
                  const userAns = currentSheetState.answers[q.id];
                  const isGraded =
                    showResults ||
                    (!isMixedExam && quizMode === 'practice' && Boolean(userAns));

                  let btnClass = 'nav-num-btn';
                  if (isGraded && userAns) {
                    btnClass += userAns === q.correctAnswer ? ' correct' : ' wrong';
                  } else if (userAns) {
                    btnClass += ' answered';
                  }

                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={btnClass}
                      onClick={() => scrollToQuestion(q.id)}
                      title={`Câu ${q.id}${
                        userAns ? ` - Đã chọn ${userAns}` : ' - Chưa trả lời'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {!showResults ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px' }}
                  onClick={handleSubmitQuiz}
                >
                  <CheckCheck size={16} />
                  <span>Nộp bài &amp; Chấm điểm</span>
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px' }}
                    onClick={handleResetSheet}
                  >
                    <RotateCcw size={15} />
                    <span>{isMixedExam ? 'Thi lại đề mới' : 'Làm lại đề này'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ width: '100%', padding: '9px' }}
                    onClick={() => handleSelectSheet(HISTORY_VIEW_KEY)}
                  >
                    <History size={15} />
                    <span>Xem lịch sử thi ({examHistory.length})</span>
                  </button>
                </div>
              )}
            </aside>
          </main>
        )}
      </div>

      {/* POPUP THÔNG BÁO HẾT THỜI GIAN LÀM BÀI (30 PHÚT) - BẮT BUỘC NỘP BÀI */}
      {timeUpModalOpen && !showResults && (
        <div className="modal-overlay">
          <div
            className="modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="modal-timeup-title"
            style={{ textAlign: 'center', padding: '28px 24px' }}
          >
            <div
              className="modal-icon"
              style={{
                margin: '0 auto 14px',
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: '#fef2f2',
                color: '#dc2626',
              }}
            >
              <Clock size={28} />
            </div>
            <h3
              id="modal-timeup-title"
              className="modal-title"
              style={{ fontSize: 18, color: '#dc2626' }}
            >
              Đã hết thời gian làm bài (30 phút)!
            </h3>
            <p
              className="modal-subtitle"
              style={{ fontSize: 14, marginTop: 8, lineHeight: 1.55 }}
            >
              Thời gian 30 phút làm bài thi đã kết thúc. Hệ thống đã khóa chọn đáp án
              (đã trả lời <strong>{stats.answered}/{stats.total}</strong> câu). Vui lòng
              nhấn nút bên dưới để nộp bài và xem kết quả.
            </p>
            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px', fontSize: 14.5 }}
                onClick={handleSubmitQuiz}
              >
                <CheckCheck size={18} />
                <span>Nộp bài &amp; Chấm điểm</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NHẬP MẬT KHẨU UPLOAD / DOWNLOAD EXCEL */}
      {authModal.open && (
        <div className="modal-overlay" onClick={closeAuthModal}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-auth-title"
          >
            <div className="modal-header">
              <div className="modal-icon">
                <Lock size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 id="modal-auth-title" className="modal-title">
                  Yêu cầu mật khẩu
                </h3>
                <p className="modal-subtitle">
                  {authModal.action === 'download'
                    ? 'Nhập mật khẩu để tải xuống file Excel đề thi'
                    : 'Nhập mật khẩu để tải lên (Upload) file Excel đề thi'}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeAuthModal}
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleVerifyPassword} className="modal-form">
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="modal-input"
                  style={{ paddingRight: '42px' }}
                  placeholder="Nhập mật khẩu..."
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordError && (
                <div className="modal-error">
                  <AlertCircle size={14} />
                  <span>{passwordError}</span>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={closeAuthModal}
                >
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary">
                  Xác nhận
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

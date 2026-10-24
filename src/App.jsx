import React, { useState, useMemo, useRef } from 'react';
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
} from 'lucide-react';
import defaultData from './data/defaultData.json';
import { parseExcelBuffer, exportDatasetToExcel } from './utils/excelParser.js';

export default function App() {
  const [dataset, setDataset] = useState(defaultData);
  const [activeSheetName, setActiveSheetName] = useState(
    defaultData.sheets[0]?.name || ''
  );
  // Lưu trạng thái làm bài theo từng sheet: { [sheetName]: { answers: { [qId]: 'A'|'B'|'C'|'D' }, submitted: boolean, questionOrder: number[] | null } }
  const [sheetStates, setSheetStates] = useState({});
  // Chế độ: 'exam' (Nộp bài mới chấm) | 'practice' (Chọn xong báo Đúng/Sai ngay)
  const [quizMode, setQuizMode] = useState('exam');
  // Bộ lọc câu hỏi khi xem kết quả: 'all' | 'correct' | 'wrong' | 'unanswered'
  const [resultFilter, setResultFilter] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);

  const fileInputRef = useRef(null);
  const summaryRef = useRef(null);

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

  const currentSheet = useMemo(() => {
    return (
      allSheetsWithCombined.find((s) => s.name === activeSheetName) ||
      allSheetsWithCombined[0] || { name: '', questions: [] }
    );
  }, [allSheetsWithCombined, activeSheetName]);

  const currentSheetState = useMemo(() => {
    return (
      sheetStates[currentSheet.name] || {
        answers: {},
        submitted: false,
        shuffledIds: null,
      }
    );
  }, [sheetStates, currentSheet.name]);

  // Danh sách câu hỏi hiển thị (theo thứ tự gốc hoặc đã đảo)
  const displayedQuestions = useMemo(() => {
    const base = currentSheet.questions || [];
    if (!currentSheetState.shuffledIds) return base;
    const map = new Map(base.map((q) => [q.id, q]));
    return currentSheetState.shuffledIds.map((id) => map.get(id)).filter(Boolean);
  }, [currentSheet.questions, currentSheetState.shuffledIds]);

  // Tính toán thống kê Đúng / Sai / Chưa làm dựa vào cột G (correctAnswer)
  const stats = useMemo(() => {
    const total = displayedQuestions.length;
    let answered = 0;
    let correct = 0;
    let wrong = 0;

    for (const q of displayedQuestions) {
      const userAns = currentSheetState.answers[q.id];
      if (userAns) {
        answered += 1;
        if (userAns === q.correctAnswer) {
          correct += 1;
        } else {
          wrong += 1;
        }
      }
    }

    const unanswered = total - answered;
    const score10 = total > 0 ? ((correct / total) * 10).toFixed(2) : '0.00';
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    return {
      total,
      answered,
      unanswered,
      correct,
      wrong,
      score10,
      accuracy,
    };
  }, [displayedQuestions, currentSheetState.answers]);

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

  // Chọn sheet từ Sidebar
  const handleSelectSheet = (sheetName) => {
    setActiveSheetName(sheetName);
    setResultFilter('all');
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Chọn đáp án A / B / C / D cho 1 câu hỏi
  const handleSelectOption = (questionId, optionKey) => {
    if (currentSheetState.submitted) return;

    setSheetStates((prev) => {
      const prevSheet = prev[currentSheet.name] || {
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
        [currentSheet.name]: {
          ...prevSheet,
          answers: updatedAnswers,
        },
      };
    });
  };

  // Nộp bài & Xem tổng kết
  const handleSubmitQuiz = () => {
    setSheetStates((prev) => {
      const prevSheet = prev[currentSheet.name] || {
        answers: {},
        submitted: false,
        shuffledIds: null,
      };
      return {
        ...prev,
        [currentSheet.name]: {
          ...prevSheet,
          submitted: true,
        },
      };
    });
    setResultFilter('all');
    setTimeout(() => {
      if (summaryRef.current) {
        summaryRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 80);
  };

  // Làm lại bộ câu hỏi của sheet hiện tại
  const handleResetSheet = () => {
    setSheetStates((prev) => ({
      ...prev,
      [currentSheet.name]: {
        answers: {},
        submitted: false,
        shuffledIds: prev[currentSheet.name]?.shuffledIds || null,
      },
    }));
    setResultFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Đảo thứ tự câu hỏi trong sheet hiện tại
  const handleShuffleQuestions = () => {
    const ids = (currentSheet.questions || []).map((q) => q.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setSheetStates((prev) => ({
      ...prev,
      [currentSheet.name]: {
        answers: {},
        submitted: false,
        shuffledIds: ids,
      },
    }));
    setResultFilter('all');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Xử lý Upload file Excel mới
  const handleExcelFile = async (file) => {
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
      setDataset({
        fileName: parsed.fileName,
        sheets: parsed.sheets,
      });
      setActiveSheetName(parsed.sheets[0].name);
      setSheetStates({});
      setResultFilter('all');
      setSidebarOpen(false);

      setUploadNotice(
        `Đã tải lên thành công "${file.name}" với ${parsed.sheets.length} chuyên đề (${parsed.totalQuestions} câu hỏi).`
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      alert('Lỗi khi đọc file Excel: ' + (err.message || 'Định dạng không hợp lệ'));
    }
  };

  const handleRestoreDefault = () => {
    setDataset(defaultData);
    setActiveSheetName(defaultData.sheets[0]?.name || '');
    setSheetStates({});
    setResultFilter('all');
    setUploadNotice(null);
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
  const showResults = currentSheetState.submitted;

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
            <div className="brand-subtitle">Hệ thống luyện thi & kiểm tra</div>
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

        <div className="sidebar-section-label">
          <span>Danh mục Chuyên đề ({dataset.sheets.length} Sheet)</span>
          <Layers size={14} />
        </div>

        <nav className="sheet-menu" aria-label="Danh sách sheet câu hỏi">
          {allSheetsWithCombined.map((sheet) => {
            const isActive = sheet.name === currentSheet.name;
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
          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleExcelFile(file);
            }}
          >
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
                onClick={() => exportDatasetToExcel(dataset)}
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
                  <span>{currentSheet.name}</span>
                </h1>
                <div className="header-meta">
                  Đã trả lời <strong>{stats.answered}</strong> /{' '}
                  <strong>{stats.total}</strong> câu hỏi ({progressPercent}%)
                </div>
              </div>
            </div>

            <div className="header-controls">
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
            </div>
          </div>

          {/* THANH TIẾN ĐỘ STICKY CÙNG HEADER */}
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </header>

        {/* NỘI DUNG CHÍNH */}
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
                    <h2>
                      <Award size={24} style={{ color: '#2563eb' }} />
                      <span>Tổng kết kết quả: {currentSheet.name}</span>
                    </h2>
                    <p>
                      Kết quả chấm điểm bài làm của bạn. Xem chi tiết từng câu đúng/sai bên dưới.
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
                          color: stats.accuracy >= 70 ? '#059669' : '#d97706',
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
                showResults || (quizMode === 'practice' && Boolean(userAns));
              const isCorrect = userAns === q.correctAnswer;

              const prevQuestion = index > 0 ? filteredQuestions[index - 1] : null;
              const showSectionHeader =
                q.section && (!prevQuestion || prevQuestion.section !== q.section);

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

                  <article
                    id={`question-card-${q.id}`}
                    className={cardClass}
                  >
                    <div className="question-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="question-number-badge">
                          Câu {q.id} {q.stt && String(q.stt) !== String(q.id) ? `(STT ${q.stt})` : ''}
                        </span>
                        {q.section && (
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
                              <AlertCircle size={14} /> Chưa trả lời (Đáp án: {q.correctAnswer})
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
                            disabled={showResults}
                            onClick={() => handleSelectOption(q.id, opt.key)}
                          >
                            <span className="option-key">{opt.key}</span>
                            <span className="option-text">{opt.text}</span>
                            {isGraded && isRightOption && (
                              <CheckCircle2
                                size={18}
                                style={{ color: '#059669', flexShrink: 0, marginTop: 4 }}
                              />
                            )}
                            {isGraded && isSelected && !isRightOption && (
                              <XCircle
                                size={18}
                                style={{ color: '#dc2626', flexShrink: 0, marginTop: 4 }}
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
              {!showResults && quizMode === 'exam' ? (
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
                  showResults || (quizMode === 'practice' && Boolean(userAns));

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
                    title={`Câu ${q.id}${userAns ? ` - Đã chọn ${userAns}` : ' - Chưa trả lời'}`}
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
                <span>Nộp bài & Chấm điểm</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', padding: '10px' }}
                onClick={handleResetSheet}
              >
                <RotateCcw size={15} />
                <span>Làm lại đề này</span>
              </button>
            )}
          </aside>
        </main>
      </div>
    </div>
  );
}


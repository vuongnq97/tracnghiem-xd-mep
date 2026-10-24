import * as XLSX from 'xlsx';

/**
 * Chuẩn hóa giá trị cột G ("Đáp án đúng") về A, B, C, D
 */
function normalizeAnswerKey(rawG, validKeys, prevAns = null) {
  const cleaned = String(rawG ?? '').trim().toUpperCase();
  if (validKeys.includes(cleaned)) {
    return { key: cleaned, wasRandom: false };
  }
  const numMap = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
  if (numMap[cleaned] && validKeys.includes(numMap[cleaned])) {
    return { key: numMap[cleaned], wasRandom: false };
  }
  // Nếu câu hỏi trong file Excel upload lên chưa có cột G hoặc cột G trống -> random A, B, C, D
  const pool = validKeys.filter((k) => k !== prevAns);
  const choices = pool.length > 0 ? pool : validKeys;
  const randomKey = choices[Math.floor(Math.random() * choices.length)];
  return { key: randomKey, wasRandom: true };
}

/**
 * Đọc ArrayBuffer của file Excel (.xlsx / .xls) và trích xuất toàn bộ các sheet + câu hỏi
 */
export function parseExcelBuffer(arrayBuffer, fileName = 'Bo-de-trac-nghiem.xlsx') {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = [];
  let totalQuestions = 0;
  let autoFilledCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 'A',
      defval: '',
    });

    let currentSection = '';
    const questions = [];
    let prevAns = null;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const a = String(r.A ?? '').trim();
      const b = String(r.B ?? '').trim();
      const c = String(r.C ?? '').trim();
      const d = String(r.D ?? '').trim();
      const e = String(r.E ?? '').trim();
      const f = String(r.F ?? '').trim();
      const g = String(r.G ?? '').trim();

      if (!a && !b && !c && !d && !e && !f) continue;

      // Bỏ qua dòng tiêu đề cột
      if (
        a.toUpperCase() === 'STT' ||
        b.toLowerCase().includes('nội dung câu hỏi') ||
        (c.toLowerCase().includes('phương án') && d.toLowerCase().includes('phương án'))
      ) {
        continue;
      }

      const options = [];
      if (c) options.push({ key: 'A', text: c });
      if (d) options.push({ key: 'B', text: d });
      if (e) options.push({ key: 'C', text: e });
      if (f) options.push({ key: 'D', text: f });

      // Dòng phân mục (VD: I - Cọc khoan nhồi, 2. PHẦN ĐIỆN)
      if (options.length === 0) {
        const secText = [a, b].filter(Boolean).join(' - ').trim();
        if (secText) {
          currentSection = secText;
        }
        continue;
      }

      // Dòng câu hỏi hợp lệ
      if (b && options.length >= 2) {
        const validKeys = options.map((o) => o.key);
        const { key: correctAnswer, wasRandom } = normalizeAnswerKey(g, validKeys, prevAns);
        prevAns = correctAnswer;
        if (wasRandom) autoFilledCount += 1;

        questions.push({
          id: questions.length + 1,
          stt: a.replace(/\.0$/, '') || String(questions.length + 1),
          question: b,
          options,
          correctAnswer,
          section: currentSection,
        });
      }
    }

    if (questions.length > 0) {
      sheets.push({
        name: sheetName,
        questions,
      });
      totalQuestions += questions.length;
    }
  }

  return {
    fileName,
    sheets,
    totalQuestions,
    autoFilledCount,
  };
}

/**
 * Xuất dữ liệu bộ đề hiện tại ra file Excel (.xlsx) chuẩn có đầy đủ cột G ("Đáp án đúng")
 */
export function exportDatasetToExcel(dataset) {
  const wb = XLSX.utils.book_new();

  for (const sheet of dataset.sheets) {
    const aoa = [
      [
        'STT',
        'Nội dung câu hỏi (*)',
        'Phương án 1',
        'Phương án 2',
        'Phương án 3',
        'Phương án 4',
        'Đáp án đúng',
      ],
    ];

    let lastSection = '';
    for (const q of sheet.questions) {
      if (q.section && q.section !== lastSection) {
        lastSection = q.section;
        const parts = q.section.split(' - ');
        if (parts.length > 1) {
          aoa.push([parts[0], parts.slice(1).join(' - '), '', '', '', '', '']);
        } else {
          aoa.push([q.section, '', '', '', '', '', '']);
        }
      }

      const optMap = { A: '', B: '', C: '', D: '' };
      for (const opt of q.options) {
        optMap[opt.key] = opt.text;
      }

      aoa.push([
        q.stt,
        q.question,
        optMap.A,
        optMap.B,
        optMap.C,
        optMap.D,
        q.correctAnswer,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 8 },
      { wch: 55 },
      { wch: 30 },
      { wch: 30 },
      { wch: 30 },
      { wch: 30 },
      { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }

  const outName = dataset.fileName?.endsWith('.xlsx')
    ? dataset.fileName
    : 'Bo-de-chuyen-mon-XD-MEP.xlsx';
  XLSX.writeFile(wb, outName);
}


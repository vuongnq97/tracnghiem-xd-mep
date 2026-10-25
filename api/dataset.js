import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PASSWORD_SALT = 'xd-mep-2026-salt:';
const DEFAULT_PASSWORD_HASH =
  '9ec4fd72765817a786e4ec6890aa9e069f1921511afda230f1991923ce11307f'; // Abcd@1234

const GITHUB_REPO = process.env.GITHUB_REPO || 'vuongnq97/tracnghiem-xd-mep';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const TARGET_FILE_PATH = 'src/data/defaultData.json';

function verifyServerPassword(inputPassword) {
  const raw = String(inputPassword ?? '');
  if (process.env.ADMIN_PASSWORD) {
    return raw === process.env.ADMIN_PASSWORD;
  }
  const hash = crypto
    .createHash('sha256')
    .update(PASSWORD_SALT + raw)
    .digest('hex');
  return hash === DEFAULT_PASSWORD_HASH;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // GET /api/dataset -> Lấy bộ đề mới nhất từ GitHub (hoặc file local)
  if (req.method === 'GET') {
    const token = process.env.GITHUB_TOKEN;
    try {
      const headers = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'tracnghiem-xd-mep-vercel',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const ghRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${TARGET_FILE_PATH}?ref=${GITHUB_BRANCH}`,
        { headers }
      );

      if (ghRes.ok) {
        const meta = await ghRes.json();
        if (meta && meta.content) {
          const decoded = Buffer.from(meta.content, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          return res.status(200).json({ ok: true, dataset: parsed, source: 'github' });
        }
      }
    } catch (err) {
      console.error('GET /api/dataset GitHub fetch error:', err);
    }

    // Fallback đọc từ file hệ thống nếu có
    try {
      const localPath = path.join(process.cwd(), TARGET_FILE_PATH);
      if (fs.existsSync(localPath)) {
        const raw = fs.readFileSync(localPath, 'utf-8');
        return res.status(200).json({ ok: true, dataset: JSON.parse(raw), source: 'local' });
      }
    } catch (err) {
      console.error('GET /api/dataset local fallback error:', err);
    }

    return res.status(200).json({ ok: false });
  }

  // POST /api/dataset -> Xác thực mật khẩu & Cập nhật bộ đề lên GitHub Repo
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, password, dataset } = body;

    if (!verifyServerPassword(password)) {
      return res.status(401).json({
        ok: false,
        error: 'Mật khẩu không chính xác. Vui lòng thử lại!',
      });
    }

    // Nếu chỉ kiểm tra mật khẩu trước khi mở hộp chọn file hoặc tải file
    if (action === 'verify') {
      return res.status(200).json({ ok: true });
    }

    if (action === 'upload') {
      if (!dataset || !Array.isArray(dataset.sheets) || dataset.sheets.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Dữ liệu bộ đề không hợp lệ.',
        });
      }

      const contentStr = JSON.stringify(dataset, null, 2);
      const token = process.env.GITHUB_TOKEN;

      // 1. Nếu có GITHUB_TOKEN (trên Vercel) -> Commit thẳng vào repo GitHub
      if (token) {
        try {
          const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${TARGET_FILE_PATH}`;
          const headers = {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'tracnghiem-xd-mep-vercel',
          };

          // Lấy SHA hiện tại của file trên GitHub
          const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
          let currentSha = undefined;
          if (getRes.ok) {
            const getJson = await getRes.json();
            currentSha = getJson.sha;
          }

          // PUT cập nhật nội dung mới lên GitHub
          const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              message: `Cập nhật bộ đề Excel từ Web: ${dataset.fileName}`,
              content: Buffer.from(contentStr, 'utf-8').toString('base64'),
              sha: currentSha,
              branch: GITHUB_BRANCH,
            }),
          });

          if (!putRes.ok) {
            const errText = await putRes.text();
            return res.status(500).json({
              ok: false,
              error: `Không thể lưu lên GitHub (${putRes.status}): ${errText}`,
            });
          }

          return res.status(200).json({
            ok: true,
            savedToServer: true,
            mode: 'github',
          });
        } catch (err) {
          return res.status(500).json({
            ok: false,
            error: 'Lỗi khi kết nối GitHub API: ' + (err.message || ''),
          });
        }
      }

      // 2. Nếu chạy ở môi trường Local Dev (không có GITHUB_TOKEN nhưng ghi được file local)
      try {
        const localPath = path.join(process.cwd(), TARGET_FILE_PATH);
        fs.writeFileSync(localPath, contentStr, 'utf-8');
        return res.status(200).json({
          ok: true,
          savedToServer: true,
          mode: 'local',
        });
      } catch {
        // Trên Vercel nhưng chưa cài biến môi trường GITHUB_TOKEN
        return res.status(200).json({
          ok: true,
          savedToServer: false,
          missingToken: true,
        });
      }
    }

    return res.status(400).json({ ok: false, error: 'Hành động không hợp lệ.' });
  }

  return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
}


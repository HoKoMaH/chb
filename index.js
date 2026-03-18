const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios'); // لإضافة محرك بحث IMDb
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- إعدادات قاعدة البيانات ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Database Connected"))
    .catch(err => console.error("❌ DB Error:", err));

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * 1. محرك بحث IMDb سريع
 * لاستخراج المعرف بسهولة من اسم الفيلم
 */
app.get("/search-id", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        const results = response.data.d.map(item => ({
            id: item.id,
            title: item.l,
            year: item.y,
            type: item.q // 'feature' للفيلم أو 'TV series' للمسلسل
        }));
        res.json(results);
    } catch (e) { res.status(500).json([]); }
});

/**
 * 2. مسار التعديل المباشر (Edit)
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    res.send(`
        <html dir="rtl"><body style="font-family:sans-serif; padding:20px; background:#f4f7f6;">
            <h2>تعديل ملف: ${sub.label}</h2>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea name="newText" style="width:100%; height:70vh; padding:15px; border-radius:10px;">${sub.arabicText}</textarea>
                <button type="submit" style="background:#27ae60; color:white; padding:15px 30px; border:none; border-radius:10px; cursor:pointer; margin-top:10px;">حفظ التعديلات ✅</button>
                <a href="/stats" style="margin-right:15px; color:#666;">إلغاء</a>
            </form>
        </body></html>
    `);
});

app.post("/save-edit", async (req, res) => {
    const { fileId, newText } = req.body;
    await Subtitle.findOneAndUpdate({ fileId }, { arabicText: newText });
    res.send("<script>alert('تم الحفظ بنجاح!'); window.location.href='/stats';</script>");
});

/**
 * 3. مسار الرفع اليدوي
 */
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const { imdbId, label } = req.body;
    const file = req.file;
    if (!imdbId || !file) return res.status(400).send("بيانات ناقصة");

    const fileId = `${imdbId.replace(/:/g, '_')}_manual_${Date.now()}`;
    await Subtitle.findOneAndUpdate({ fileId }, {
        imdbId: imdbId.trim(),
        arabicText: file.buffer.toString('utf8'),
        label: label || file.originalname,
        isAI: false
    }, { upsert: true });
    res.redirect('/stats');
});

/**
 * 4. صفحة الإحصائيات (الواجهة الجديدة)
 */
app.get("/stats", async (req, res) => {
    const total = await Subtitle.countDocuments();
    const subs = await Subtitle.find().sort({ createdAt: -1 }).limit(30);
    
    let rows = subs.map(s => `
        <tr style="border-bottom:1px solid #eee;">
            <td style="padding:10px;">${s.label}</td>
            <td style="padding:10px; text-align:center;">
                <a href="/edit/${s.fileId}" style="color:#2980b9; text-decoration:none; margin-left:10px;">تعديل 📝</a>
                <a href="/delete/${s.fileId}" style="color:#e74c3c; text-decoration:none;">حذف 🗑️</a>
            </td>
        </tr>`).join('');

    res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head><meta charset="UTF-8"><title>AR.SA Admin</title></head>
    <body style="font-family:sans-serif; background:#f8f9fa; padding:20px;">
        <div style="max-width:800px; margin:auto;">
            <h1 style="text-align:center;">🛠️ لوحة تحكم AR.SA</h1>
            
            <div style="background:white; padding:20px; border-radius:15px; margin-bottom:20px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                <h3>🔍 ابحث عن معرف الفيلم (IMDb ID)</h3>
                <input type="text" id="movieSearch" placeholder="اكتب اسم الفيلم هنا..." style="width:70%; padding:10px;">
                <button onclick="searchIMDb()" style="width:25%; padding:10px; background:#f1c40f; border:none; cursor:pointer;">بحث</button>
                <div id="results" style="margin-top:10px; font-size:13px; color:#555;"></div>
            </div>

            <div style="background:white; padding:20px; border-radius:15px; margin-bottom:20px;">
                <h3>📤 رفع ترجمة يدوية</h3>
                <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                    <input type="text" name="imdbId" placeholder="IMDb ID (مثال: tt1234567)" required style="width:48%; padding:10px;">
                    <input type="text" name="label" placeholder="اسم النسخة" required style="width:48%; padding:10px;">
                    <input type="file" name="subtitleFile" accept=".srt" required style="width:100%; margin:10px 0;">
                    <button type="submit" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; cursor:pointer;">رفع واعتماد</button>
                </form>
            </div>

            <div style="background:white; padding:20px; border-radius:15px;">
                <h3>📊 آخر الملفات (الإجمالي: ${total})</h3>
                <table style="width:100%; border-collapse:collapse;">
                    ${rows}
                </table>
            </div>
        </div>

        <script>
            async function searchIMDb() {
                const q = document.getElementById('movieSearch').value;
                const res = await fetch('/search-id?q=' + q);
                const data = await res.json();
                let html = '<ul>';
                data.slice(0, 5).forEach(item => {
                    html += '<li><b>' + item.title + ' (' + item.year + '):</b> <code style="background:#eee; padding:2px 5px;">' + item.id + '</code></li>';
                });
                document.getElementById('results').innerHTML = html + '</ul>';
            }
        </script>
    </body>
    </html>`);
});

// --- بقية المسارات ---
app.get("/delete/:fileId", async (req, res) => {
    await Subtitle.deleteOne({ fileId: req.params.fileId });
    res.redirect('/stats');
});
app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(sub.arabicText);
    } else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
const port = process.env.PORT || 10000;
app.listen(port, () => console.log("🚀 Server Online"));

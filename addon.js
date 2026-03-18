const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

// رفع حد استقبال البيانات لـ 50MB لحل مشكلة Payload Too Large
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
 * محرك بحث IMDb سريع
 */
app.get("/search-id", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const response = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
        res.json(response.data.d || []);
    } catch (e) { res.status(500).json([]); }
});

/**
 * واجهة التعديل والتعريب الفوري
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    res.send(`
    <html dir="rtl"><body style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding:20px; background:#f4f7f6;">
        <div style="max-width:950px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color:#2c3e50;">تعديل: ${sub.label}</h2>
            <button onclick="instantTranslate()" style="background:#8e44ad; color:white; padding:10px 20px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; margin-bottom:15px;">🤖 تعريب فوري للنص</button>
            <span id="status" style="margin-right:15px; font-weight:bold; color:#27ae60;"></span>
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText" style="width:100%; height:65vh; padding:15px; border-radius:10px; border:1px solid #ddd; font-family:monospace; line-height:1.5;">${sub.arabicText}</textarea>
                <div style="text-align:center; margin-top:20px;">
                    <button type="submit" style="background:#27ae60; color:white; padding:15px 45px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:16px;">حفظ التعديلات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>
        <script>
            async function instantTranslate() {
                const text = document.getElementById('txt').value;
                if(!text) return;
                if(!confirm('هل تريد بدء التعريب الآلي الآن؟')) return;
                document.getElementById('status').innerText = '⏳ جاري التعريب.. تابع لوقات Render لمشاهدة النسبة المئوية';
                const res = await fetch('/instant-translate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ text })
                });
                const result = await res.text();
                if(result) { 
                    document.getElementById('txt').value = result; 
                    document.getElementById('status').innerText = '✅ اكتمل التعريب! اضغط حفظ الآن.'; 
                } else {
                    document.getElementById('status').innerText = '❌ فشل التعريب أو حدث حظر.';
                }
            }
        </script>
    </body></html>`);
});

/**
 * واجهة الإحصائيات (التصميم الأصلي المستعاد)
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        
        const manifestUrl = "chb-gy3n.onrender.com/manifest.json";
        const installUrl = `stremio://${manifestUrl}`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-weight: 500; font-size: 13px;">${sub.label}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 20px; font-size: 11px; background: ${sub.isAI ? '#e8f5e9; color: #2e7d32;' : '#fff8e1; color: #f57f17;'}">
                        ${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}
                    </span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 12px; border-radius:6px; font-size:11px;">تعديل 📝</a>
                    <a href="/delete/${sub.fileId}" onclick="return confirm('حذف؟')" style="text-decoration:none; background:#e74c3c; color:white; padding:5px 12px; border-radius:6px; font-size:11px; margin-right:5px;">حذف 🗑️</a>
                </td>
            </tr>
        `).join('');

        const html = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AR.SA Dashboard</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #2c3e50; }
                .container { max-width: 900px; margin: auto; }
                .header-section { text-align: center; margin-bottom: 30px; }
                .install-btn { 
                    display: inline-block; background: #8e44ad; color: white; padding: 12px 30px; 
                    border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 16px;
                    box-shadow: 0 4px 15px rgba(142, 68, 173, 0.3); transition: 0.3s; margin-top: 10px;
                }
                .install-btn:hover { transform: translateY(-2px); background: #9b59b6; }
                .admin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                .admin-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
                .card { background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); text-align: center; }
                .card h3 { margin: 0; color: #7f8c8d; font-size: 12px; }
                .card p { font-size: 24px; font-weight: bold; margin: 5px 0; color: #2c3e50; }
                input, button { width: 100%; padding: 10px; margin: 5px 0; border-radius: 8px; border: 1px solid #ddd; box-sizing: border-box; }
                .table-container { background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow-x: auto; }
                table { width: 100%; border-collapse: collapse; min-width: 500px; }
                th { background: #f8f9fa; padding: 12px; text-align: right; font-size: 13px; border-bottom: 2px solid #eee; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header-section">
                    <h1>📊 لوحة تحكم AR.SA الذكية</h1>
                    <a href="${installUrl}" class="install-btn">+ تثبيت الإضافة في Stremio</a>
                </div>
                
                <div class="stats-grid">
                    <div class="card" style="border-top: 4px solid #3498db;"><h3>إجمالي الترجمات</h3><p>${totalSubs}</p></div>
                    <div class="card" style="border-top: 4px solid #2ecc71;"><h3>بواسطة AI 🤖</h3><p>${aiSubs}</p></div>
                    <div class="card" style="border-top: 4px solid #f1c40f;"><h3>ترجمات أصلية</h3><p>${totalSubs - aiSubs}</p></div>
                </div>

                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>🔍 بحث IMDb ID</h3>
                        <input type="text" id="movieSearch" placeholder="اكتب اسم الفيلم...">
                        <button onclick="searchIMDb()" style="background:#f1c40f; font-weight:bold; cursor:pointer;">بحث</button>
                        <div id="results" style="margin-top:10px; font-size:12px; max-height:100px; overflow:auto;"></div>
                    </div>
                    <div class="admin-card">
                        <h3>📤 رفع يدوي (SRT)</h3>
                        <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                            <input type="text" name="imdbId" placeholder="IMDb ID (tt...)" required>
                            <input type="text" name="label" placeholder="اسم النسخة" required>
                            <input type="file" name="subtitleFile" accept=".srt" required>
                            <button type="submit" style="background:#27ae60; color:white; font-weight:bold; cursor:pointer;">رفع واعتماد</button>
                        </form>
                    </div>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr><th>اسم المحتوى</th><th style="text-align: center;">النوع</th><th style="text-align: center;">الإجراء</th></tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="3" style="text-align:center;">لا توجد بيانات</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <script>
                async function searchIMDb() {
                    const q = document.getElementById('movieSearch').value;
                    const res = await fetch('/search-id?q=' + q);
                    const data = await res.json();
                    document.getElementById('results').innerHTML = data.slice(0,5).map(i => '<li>'+i.l+' ('+i.y+'): <code>'+i.id+'</code></li>').join('');
                }
            </script>
        </body>
        </html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) { res.status(500).send("Error"); }
});

// بقية المسارات المعتادة (save-edit, instant-translate, delete, sub, addonRouter)
app.post("/instant-translate", async (req, res) => {
    const translated = await translateToArabic(req.body.text);
    res.send(translated || "");
});
app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});
app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    const { imdbId, label } = req.body;
    const fileId = `${imdbId.replace(/:/g, '_')}_manual_${Date.now()}`;
    await Subtitle.findOneAndUpdate({ fileId }, {
        imdbId: imdbId.trim(),
        arabicText: req.file.buffer.toString('utf8'),
        label: label || req.file.originalname,
        isAI: false
    }, { upsert: true });
    res.redirect('/stats');
});
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
app.listen(port, () => console.log(`🚀 Server Online`));

const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

/**
 * 1. إعدادات استقبال البيانات
 */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * 2. الاتصال بقاعدة البيانات
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected"))
    .catch(err => console.error("❌ [DATABASE] Error:", err));

/**
 * 3. تعريف الموديل
 */
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
 * 4. محرك بحث IMDb ID
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
 * 5. واجهة التحكم (Stats) بتصميم قابل للطي
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);
        const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 12px; font-size: 13px;">${sub.label} <br> <small style="color:#888;">ID: ${sub.imdbId}</small></td>
                <td style="padding: 12px; text-align: center;">${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}</td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/edit/${sub.fileId}" style="text-decoration:none; background:#3498db; color:white; padding:5px 10px; border-radius:5px; font-size:12px;">تعديل</a>
                    <a href="/delete/${sub.fileId}" onclick="return confirm('حذف؟')" style="text-decoration:none; background:#e74c3c; color:white; padding:5px 10px; border-radius:5px; font-size:12px;">حذف</a>
                </td>
            </tr>`).join('');

        res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>لوحة تحكم AR.SA</title>
        <style>
            body { font-family: sans-serif; background: #f4f7f6; padding: 20px; color: #2c3e50; }
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
            .card { background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 15px; overflow: hidden; border: 1px solid #eee; }
            
            /* تصميم رأس النافذة القابلة للطي */
            .card-header { 
                background: #fff; padding: 15px 20px; cursor: pointer; display: flex; 
                justify-content: space-between; align-items: center; font-weight: bold;
                transition: background 0.3s; border-bottom: 1px solid #f0f0f0;
            }
            .card-header:hover { background: #fcfcfc; }
            .card-header::after { content: '▼'; font-size: 12px; color: #95a5a6; transition: 0.3s; }
            .card.active .card-header::after { transform: rotate(180deg); }
            
            /* محتوى النافذة */
            .card-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; background: #fff; }
            .card.active .card-content { max-height: 1000px; padding: 20px; border-top: 1px solid #f9f9f9; }

            input, select, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid #ddd; box-sizing: border-box; outline: none; }
            .search-item { padding: 10px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
            .danger-btn { background:#c0392b; color:white; border:none; padding:8px 15px; border-radius:8px; cursor:pointer; font-size:12px; }
            table { width:100%; border-collapse:collapse; text-align:right; }
            th { background:#f8f9fa; padding:10px; }
        </style></head>
        <body>
            <div style="max-width: 850px; margin: auto; text-align:center;">
                <h1 style="margin-bottom:10px;">📊 إدارة AR.SA</h1>
                <a href="${installUrl}" style="background:#8e44ad; color:white; padding:10px 20px; border-radius:50px; text-decoration:none; font-weight:bold; display:inline-block; margin-bottom:25px; font-size:14px;">+ تثبيت في Stremio</a>
                
                <div class="stats-grid">
                    <div style="background:white; padding:15px; border-radius:12px; border-top:4px solid #3498db;"><b>الإجمالي</b><br>${totalSubs}</div>
                    <div style="background:white; padding:15px; border-radius:12px; border-top:4px solid #2ecc71;"><b>🤖 AI</b><br>${aiSubs}</div>
                    <div style="background:white; padding:15px; border-radius:12px; border-top:4px solid #f1c40f;"><b>أصلي</b><br>${totalSubs - aiSubs}</div>
                </div>

                <div class="card active" id="searchSection">
                    <div class="card-header" onclick="toggleCard('searchSection')">🔍 البحث عن IMDb ID</div>
                    <div class="card-content">
                        <input id="q" placeholder="اكتب اسم الفيلم أو المسلسل..." oninput="autoSearch()">
                        <div id="r" style="text-align:right; font-size:13px; max-height:200px; overflow:auto;"></div>
                    </div>
                </div>

                <div class="card" id="uploadSection">
                    <div class="card-header" onclick="toggleCard('uploadSection')">📤 رفع ترجمة جديدة</div>
                    <div class="card-content">
                        <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                            <select name="type" id="type" onchange="toggleFields()">
                                <option value="movie">🎬 فيلم</option>
                                <option value="series">📺 مسلسل</option>
                            </select>
                            <input name="imdbId" id="manual_id" placeholder="IMDb ID (tt...)" required>
                            <div id="sFields" style="display:none; gap:5px;">
                                <input type="number" name="season" placeholder="موسم" style="width:48%">
                                <input type="number" name="episode" placeholder="حلقة" style="width:48%">
                            </div>
                            <input name="label" id="manual_label" placeholder="اسم النسخة" required>
                            <input type="file" id="subFile" name="subtitleFile" accept=".srt" required onchange="updateLabel(this)">
                            <button type="submit" style="background:#27ae60; color:white; font-weight:bold;">حفظ في السيرفر ✅</button>
                        </form>
                    </div>
                </div>

                <div class="card" id="listSection">
                    <div class="card-header" onclick="toggleCard('listSection')">📁 قائمة الترجمات (الأخيرة)</div>
                    <div class="card-content" style="padding:0 !important;">
                        <div style="padding:15px; text-align:left;">
                            <button onclick="deleteAllSubtitles()" class="danger-btn">حذف الكل ⚠️</button>
                        </div>
                        <table>
                            <thead><tr><th>المحتوى</th><th>المصدر</th><th>إجراء</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            </div>

            <script>
                // دالة التبديل بين الفتح والإغلاق
                function toggleCard(id) {
                    const el = document.getElementById(id);
                    el.classList.toggle('active');
                }

                function toggleFields(){ 
                    document.getElementById('sFields').style.display = document.getElementById('type').value==='series'?'flex':'none'; 
                }
                
                function updateLabel(input) {
                    if (input.files && input.files[0]) {
                        document.getElementById('manual_label').value = input.files[0].name.replace('.srt', '');
                    }
                }

                let timer;
                function autoSearch() {
                    clearTimeout(timer);
                    const q = document.getElementById('q').value;
                    if(!q || q.length < 2) { document.getElementById('r').innerHTML = ''; return; }
                    timer = setTimeout(async () => {
                        document.getElementById('r').innerHTML = '⏳ جاري البحث...';
                        const res = await fetch('/search-id?q=' + q);
                        const data = await res.json();
                        document.getElementById('r').innerHTML = data.slice(0,8).map(i => {
                            return \`<div class="search-item" onclick="copyToUpload('\${i.id}', \${i.q === 'TV series'}, event)"><b>\${i.l} (\${i.y || ''})</b> - <code>\${i.id}</code></div>\`;
                        }).join('');
                    }, 500);
                }

                function copyToUpload(id, isSeries, event) {
                    document.getElementById('manual_id').value = id;
                    document.getElementById('type').value = isSeries ? 'series' : 'movie';
                    toggleFields();
                    navigator.clipboard.writeText(id);
                    // تغذية بصرية
                    const items = document.querySelectorAll('.search-item');
                    items.forEach(el => el.style.background = 'white');
                    event.currentTarget.style.background = '#e8f4fd';
                    // فتح نافذة الرفع تلقائياً ليسهل العمل
                    document.getElementById('uploadSection').classList.add('active');
                }

                async function deleteAllSubtitles() {
                    if(confirm("⚠️ حذف كل شيء؟") && confirm("❗ متأكد؟")) window.location.href = '/delete-all-now';
                }
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send("Error"); }
});

// باقي المسارات الخلفية (الحذف، الرفع، المزامنة) تبقى كما هي...
app.get("/delete-all-now", async (req, res) => {
    try { await Subtitle.deleteMany({}); res.send("<script>alert('تم الحذف!'); window.location.href='/stats';</script>"); } catch (e) { res.status(500).send(e.message); }
});

app.post("/upload-manual", upload.single('subtitleFile'), async (req, res) => {
    try {
        let { imdbId, type, season, episode, label } = req.body;
        let technicalId = type === 'series' ? `${imdbId.trim()}:${season || 1}:${episode || 1}` : imdbId.trim();
        await Subtitle.findOneAndUpdate({ fileId: technicalId.replace(/:/g, '_') + '_' + Date.now() }, {
            imdbId: technicalId, arabicText: req.file.buffer.toString('utf8'), label, isAI: false
        }, { upsert: true });
        res.redirect('/stats');
    } catch (e) { res.status(500).send(e.message); }
});

app.post("/save-edit", async (req, res) => {
    await Subtitle.findOneAndUpdate({ fileId: req.body.fileId }, { arabicText: req.body.newText, isAI: /[\u0600-\u06FF]/.test(req.body.newText) });
    res.send("<script>alert('تم الحفظ!'); window.location.href='/stats';</script>");
});

app.get("/delete/:fileId", async (req, res) => { await Subtitle.deleteOne({ fileId: req.params.fileId }); res.redirect('/stats'); });

app.get("/sub/:fileId.srt", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId.replace('.srt', '') });
    if (sub) { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Access-Control-Allow-Origin', '*'); res.send(sub.arabicText); }
    else res.status(404).send("Not found");
});

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

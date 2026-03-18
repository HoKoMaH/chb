const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); // استدعاء دالة الترجمة من السكرابر
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- إعدادات قاعدة البيانات والموديل (تبقى كما هي) ---
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
 * 1. مسار البحث عن معرف IMDb (كما هو)
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
 * 2. ميزة التعديل المباشر وزر "التعريب الفوري" 🤖
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    
    // واجهة التعديل مع زر التعريب الفوري
    res.send(`
    <html dir="rtl"><body style="font-family:sans-serif; padding:20px; background:#f4f7f6; color:#2c3e50;">
        <div style="max-width:900px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
            <h2 style="margin-top:0;">تعديل ملف: ${sub.label}</h2>
            
            <button onclick="instantTranslate()" style="background:#8e44ad; color:white; padding:10px 20px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-bottom:15px;">
                🤖 تعريب فوري للنص بالكامل
            </button>
            <span id="transStatus" style="font-size:13px; color:#27ae60; margin-right:10px;"></span>
            
            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="subTextArea" name="newText" style="width:100%; height:70vh; padding:15px; border-radius:10px; border:1px solid #ddd; font-family:monospace; line-height:1.4;">${sub.arabicText}</textarea>
                <div style="margin-top:20px; text-align:center;">
                    <button type="submit" style="background:#27ae60; color:white; padding:15px 40px; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:16px;">حفظ التعديلات ✅</button>
                    <a href="/stats" style="margin-right:20px; color:#666; text-decoration:none;">إلغاء</a>
                </div>
            </form>
        </div>

        <script>
            async function instantTranslate() {
                const text = document.getElementById('subTextArea').value;
                const status = document.getElementById('transStatus');
                
                if(!text || text.length < 50) return alert('النص قصير جداً لترجمته.');
                if(!confirm('هل أنت متأكد من تعريب النص بالكامل؟ سيتم استبدال النص الحالي.')) return;

                status.innerText = '⏳ جاري التعريب الفوري... راقب اللوقات لمعرفة النسبة.';
                document.getElementById('subTextArea').style.opacity = '0.5';

                try {
                    // إرسال النص للسيرفر لترجمته
                    const res = await fetch('/instant-translate', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ text })
                    });
                    const translatedText = await res.text();
                    
                    if(translatedText && translatedText.length > 50) {
                        document.getElementById('subTextArea').value = translatedText;
                        status.innerText = '✅ اكتمل التعريب! اضغط "حفظ" الآن لتعميد التعديل.';
                    } else {
                        status.innerText = '❌ فشل التعريب أو الحظر من جوجل.';
                    }
                } catch(e) {
                    status.innerText = '❌ حدث خطأ غير متوقع.';
                }
                document.getElementById('subTextArea').style.opacity = '1';
            }
        </script>
    </body></html>
    `);
});

/**
 * 3. المسار السري الذي يستلم النص الإنجليزي ويرجعه عربياً 🤖
 */
app.post("/instant-translate", async (req, res) => {
    try {
        const { text } = req.body;
        console.log(`[MANUAL-AI] 🤖 طلب تعريب يدوي فوري من الموقع.`);
        
        // استدعاء دالة التعريب المطورة في سكرابر (التي تحتوي على العداد)
        const translatedContent = await translateToArabic(text);
        
        if (translatedContent) {
            console.log(`[MANUAL-AI] ✅ اكتمل التعريب اليدوي.`);
            res.send(translatedContent);
        } else {
            res.status(500).send("");
        }
    } catch (e) { res.status(500).send(""); }
});

// --- بقية المسارات المعتادة ( تبقى كما هي) ---
app.post("/save-edit", async (req, res) => {
    const { fileId, newText } = req.body;
    await Subtitle.findOneAndUpdate({ fileId }, { arabicText: newText });
    res.send("<script>alert('تم الحفظ بنجاح!'); window.location.href='/stats';</script>");
});
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
app.get("/stats", async (req, res) => {
    const total = await Subtitle.countDocuments();
    const subs = await Subtitle.find().sort({ createdAt: -1 }).limit(30);
    const installUrl = `stremio://${process.env.RENDER_EXTERNAL_HOSTNAME || "chb-gy3n.onrender.com"}/manifest.json`;

    let rows = subs.map(s => `
        <tr style="border-bottom:1px solid #eee;">
            <td style="padding:10px;">${s.label}</td>
            <td style="padding:10px; text-align:center;">
                <span style="font-size:10px; background:#f8f9fa; padding:3px 7px; border-radius:10px;">
                    ${s.fileId.includes('manual') ? '👤 يدوي' : (s.isAI ? '🤖 AI' : '🇸🇦 أصلي')}
                </span>
            </td>
            <td style="padding:10px; text-align:center;">
                <a href="/edit/${s.fileId}" style="color:#2980b9; text-decoration:none; margin-left:10px;">تعديل 📝</a>
                <a href="/delete/${s.fileId}" style="color:#e74c3c; text-decoration:none;" onclick="return confirm('حذف؟')">حذف 🗑️</a>
            </td>
        </tr>`).join('');

    res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>AR.SA Dashboard</title></head>
    <body style="font-family:sans-serif; background:#f8f9fa; padding:20px; color:#2c3e50;">
        <div style="max-width:850px; margin:auto;">
            <div style="text-align:center; margin-bottom:30px;">
                <h1>🛠️ لوحة تحكم AR.SA</h1>
                <a href="${installUrl}" style="display:inline-block; background:#8e44ad; color:white; padding:10px 25px; border-radius:50px; text-decoration:none; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.1);">تثبيت الإضافة في Stremio</a>
            </div>

            <div style="background:white; padding:20px; border-radius:15px; margin-bottom:20px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                <h3>🔍 ابحث عن معرف الفيلم (IMDb ID)</h3>
                <input type="text" id="movieSearch" placeholder="اكتب اسم الفيلم هنا..." style="width:70%; padding:10px; border-radius:5px; border:1px solid #ddd;">
                <button onclick="searchIMDb()" style="width:25%; padding:10px; background:#f1c40f; border:none; cursor:pointer; font-weight:bold; border-radius:5px;">بحث</button>
                <div id="results" style="margin-top:15px; font-size:13px; color:#555; background:#fcfcfc; padding:10px; border-radius:5px;"></div>
            </div>

            <div style="background:white; padding:20px; border-radius:15px; margin-bottom:20px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                <h3>📤 رفع ترجمة يدوية (👤)</h3>
                <form action="/upload-manual" method="POST" enctype="multipart/form-data">
                    <input type="text" name="imdbId" placeholder="IMDb ID (مثال: tt1234567)" required style="width:48%; padding:10px; margin:5px 0;">
                    <input type="text" name="label" placeholder="اسم النسخة" required style="width:48%; padding:10px; margin:5px 0;">
                    <input type="file" name="subtitleFile" accept=".srt" required style="width:100%; margin:15px 0;">
                    <button type="submit" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; cursor:pointer; font-weight:bold; border-radius:5px; font-size:16px;">رفع واعتماد الترجمة</button>
                </form>
            </div>

            <div style="background:white; padding:20px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
                <h3>📊 آخر الملفات (الإجمالي: ${total})</h3>
                <table style="width:100%; border-collapse:collapse; font-size:14px;">
                    <thead><tr style="background:#eee;"><th style="padding:10px; text-align:right;">المحتوى</th><th style="padding:10px; text-align:center;">النوع</th><th style="padding:10px; text-align:center;">التحكم</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="3" style="text-align:center; padding:20px;">لا يوجد بيانات</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <script>
            async function searchIMDb() {
                const q = document.getElementById('movieSearch').value;
                if(!q) return;
                const results = document.getElementById('results');
                results.innerText = '⏳ جاري البحث...';
                const res = await fetch('/search-id?q=' + q);
                const data = await res.json();
                let html = '<ul>';
                data.slice(0, 5).forEach(item => {
                    html += '<li><b>' + item.l + ' (' + item.y + '):</b> <code style="background:#eee; padding:2px 5px; cursor:pointer;" onclick="navigator.clipboard.writeText(\\''+item.id+'\\'); alert(\\'تم نسخ الـ ID\\');">' + item.id + '</code> (' + item.q + ')</li>';
                });
                results.innerHTML = html + '</ul>';
            }
        </script>
    </body>
    </html>`);
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
app.listen(port, () => console.log("🚀 Server Online"));

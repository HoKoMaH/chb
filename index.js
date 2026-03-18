const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const { translateToArabic } = require('./scraper'); 
const upload = multer({ storage: multer.memoryStorage() });

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected"))
    .catch(err => console.error("❌ [DATABASE] Error:", err));

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
 * 1. مسار التعريب مع إرسال تحديثات الحالة (Server-Sent Events)
 * ملاحظة: قمنا بتعديل هذا المسار ليدعم الـ Streaming لتظهر اللوقات فوراً
 */
app.post("/instant-translate", async (req, res) => {
    // إعداد الـ Headers للسماح بالبث المباشر للنصوص (Logs)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendLog = (msg) => res.write(`data: ${msg}\n\n`);

    try {
        sendLog("🚀 بدء عملية التعريب اليدوي...");
        
        if (!req.body.text || req.body.text.length < 10) {
            throw new Error("نص الترجمة فارغ أو قصير جداً.");
        }

        sendLog("⏳ جاري تحليل ملف SRT واستخراج النصوص...");
        
        // هنا نقوم باستدعاء الدالة من scraper.js مع تمرير callback للوقات إذا أردت (اختياري)
        // حالياً سنفترض أنها ترجع النص كاملاً
        const translated = await translateToArabic(req.body.text);

        if (translated && translated.length > 10) {
            sendLog("✅ تمت عملية الترجمة بنجاح!");
            // نرسل النص المترجم في آخر رسالة بماركر خاص
            res.write(`data: [RESULT]${translated}\n\n`);
        } else {
            throw new Error("فشل التعريب: النتيجة فارغة.");
        }
    } catch (e) {
        sendLog(`❌ خطأ: ${e.message}`);
    } finally {
        res.end();
    }
});

/**
 * 2. واجهة التعديل مع نافذة الـ Logs الذكية
 */
app.get("/edit/:fileId", async (req, res) => {
    const sub = await Subtitle.findOne({ fileId: req.params.fileId });
    if (!sub) return res.send("الملف غير موجود");
    res.send(`
    <html dir="rtl"><head><meta charset="UTF-8"><title>محرر الترجمة</title>
    <style>
        body { font-family:sans-serif; padding:20px; background:#f4f7f6; color:#333; }
        .container { max-width:1100px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); }
        textarea { width:100%; height:55vh; padding:15px; border-radius:10px; font-family:monospace; border:1px solid #ddd; margin-top:10px; }
        .log-window { 
            background: #1e1e1e; color: #00ff00; padding: 15px; border-radius: 8px; 
            font-family: 'Courier New', monospace; font-size: 13px; max-height: 150px; 
            overflow-y: auto; margin-bottom: 15px; display: none; border-left: 5px solid #8e44ad;
        }
        .btn { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight:bold; transition:0.2s; }
        .btn-ai { background:#8e44ad; color:white; }
        .btn-save { background:#2ecc71; color:white; width:200px; margin-top:20px; }
        .btn-sync { background:#e67e22; color:white; margin-right:5px; }
    </style></head>
    <body>
        <div class="container">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2>🛠️ تعديل: ${sub.label}</h2>
                <button onclick="downloadSrt()" class="btn" style="background:#34495e; color:white;">📥 تحميل SRT</button>
            </div>

            <div id="logWin" class="log-window"></div>

            <div style="background:#f8f9fa; padding:12px; border-radius:10px; margin-bottom:15px; display:flex; gap:10px; align-items:center;">
                <b>🤖 ذكاء اصطناعي:</b> 
                <button onclick="startInstantTranslate()" class="btn btn-ai">ابدأ التعريب اليدوي الآن</button>
                <b style="margin-right:20px;">⏱️ مزامنة:</b>
                <button onclick="shiftSync(-0.5)" class="btn btn-sync">-0.5s</button>
                <button onclick="shiftSync(0.5)" class="btn btn-sync" style="background:#3498db;">+0.5s</button>
            </div>

            <form action="/save-edit" method="POST">
                <input type="hidden" name="fileId" value="${sub.fileId}">
                <textarea id="txt" name="newText">${sub.arabicText}</textarea>
                <div style="text-align:center;"><button type="submit" class="btn btn-save">حفظ التغييرات ✅</button></div>
            </form>
        </div>

        <script>
            function addLog(msg) {
                const win = document.getElementById('logWin');
                win.style.display = 'block';
                win.innerHTML += '<div>' + msg + '</div>';
                win.scrollTop = win.scrollHeight;
            }

            async function startInstantTranslate() {
                if(!confirm('سيتم محاولة تعريب النص الحالي، هل أنت متأكد؟')) return;
                
                const logWin = document.getElementById('logWin');
                logWin.innerHTML = ''; // تنظيف اللوقات السابقة
                addLog('📡 جارِ الاتصال بالسيرفر...');

                try {
                    const response = await fetch('/instant-translate', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ text: document.getElementById('txt').value })
                    });

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\\n\\n');
                        
                        for (let line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.replace('data: ', '');
                                if (data.startsWith('[RESULT]')) {
                                    const finalSrt = data.replace('[RESULT]', '');
                                    document.getElementById('txt').value = finalSrt;
                                } else {
                                    addLog(data);
                                }
                            }
                        }
                    }
                } catch (e) {
                    addLog('❌ فشل الاتصال: ' + e.message);
                }
            }

            async function shiftSync(offset) {
                const res = await fetch('/adjust-sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ text: document.getElementById('txt').value, offset }) });
                const result = await res.text();
                if(result) { document.getElementById('txt').value = result; addLog('✅ تم ضبط المزامنة بـ ' + offset + ' ثانية'); }
            }

            function downloadSrt() {
                const blob = new Blob([document.getElementById('txt').value], { type: 'text/plain' });
                const a = document.createElement('a'); a.download = "${sub.label}.srt"; a.href = window.URL.createObjectURL(blob); a.click();
            }
        </script>
    </body></html>`);
});

// باقي المسارات (Stats, Search, etc.) تبقى كما هي...

app.use("/", getRouter(addonInterface));
app.listen(process.env.PORT || 10000);

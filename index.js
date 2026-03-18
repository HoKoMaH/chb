const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

/**
 * 1. لاقط الطلبات (Network Logger)
 */
app.use((req, res, next) => {
    if (!req.url.includes('favicon')) {
        console.log(`\n[NETWORK] 📡 ${new Date().toLocaleString('ar-SA')}`);
        console.log(`   - النوع: ${req.method} | المسار: ${req.url}`);
    }
    next();
});

/**
 * 2. الاتصال بقاعدة البيانات
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] Connected"))
    .catch(err => console.error("❌ [DATABASE] Error:", err));

/**
 * 3. تعريف الموديل (Subtitle Schema)
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
 * 4. مسار الحذف (Delete Route)
 * هذا المسار سيسمح لك بمسح أي ترجمة إنجليزية لإجبار السيرفر على إعادة المحاولة
 */
app.get("/delete/:fileId", async (req, res) => {
    try {
        const fileId = req.params.fileId;
        await Subtitle.deleteOne({ fileId: fileId });
        console.log(`[DELETE] 🗑️ تم حذف الملف من القاعدة: ${fileId}`);
        
        // إعادة توجيه المستخدم لصفحة الإحصائيات مع رسالة تنبيه
        res.send(`
            <script>
                alert('تم حذف الملف بنجاح! الآن عند تشغيل الحلقة في Stremio سيقوم السيرفر بترجمتها من جديد.');
                window.location.href = '/stats';
            </script>
        `);
    } catch (e) {
        res.status(500).send("خطأ أثناء الحذف: " + e.message);
    }
});

/**
 * 5. مسار جلب ملف الـ SRT
 */
app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        const sub = await Subtitle.findOne({ fileId });
        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sub.label)}.srt"`);
            return res.send(sub.arabicText);
        }
        res.status(404).send("File not found.");
    } catch (e) { res.status(500).send(e.message); }
});

/**
 * 6. لوحة التحكم المطورة (مع زر الحذف والتحميل)
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
                    <span style="padding: 3px 8px; border-radius: 15px; font-size: 10px; background: ${sub.isAI ? '#e8f5e9; color: #2e7d32;' : '#fff8e1; color: #f57f17;'}">
                        ${sub.isAI ? '🤖 AI' : '🇸🇦 أصلية'}
                    </span>
                </td>
                <td style="padding: 12px; text-align: center;">
                    <a href="/sub/${sub.fileId}.srt" style="text-decoration: none; background: #3498db; color: white; padding: 4px 10px; border-radius: 5px; font-size: 10px;">تحميل ↓</a>
                    
                    <a href="/delete/${sub.fileId}" onclick="return confirm('هل أنت متأكد من حذف هذه الترجمة؟ سيتم إعادة ترجمتها عند الطلب القادم.')" 
                       style="text-decoration: none; background: #e74c3c; color: white; padding: 4px 10px; border-radius: 5px; font-size: 10px; margin-right: 5px;">حذف 🗑️</a>
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
                body { font-family: 'Segoe UI', sans-serif; background: #f4f7f6; margin: 0; padding: 20px; }
                .container { max-width: 850px; margin: auto; }
                .install-btn { display: inline-block; background: #8e44ad; color: white; padding: 10px 25px; border-radius: 50px; text-decoration: none; font-weight: bold; margin-bottom: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
                .card { background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); text-align: center; }
                .card p { font-size: 22px; font-weight: bold; margin: 5px 0; color: #2c3e50; }
                .table-container { background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #f8f9fa; padding: 12px; text-align: right; font-size: 12px; border-bottom: 2px solid #eee; }
            </style>
        </head>
        <body>
            <div class="container" style="text-align: center;">
                <h1>📊 لوحة تحكم AR.SA</h1>
                <a href="${installUrl}" class="install-btn">تثبيت الإضافة في Stremio</a>
                
                <div class="stats-grid">
                    <div class="card"><h3>الإجمالي</h3><p>${totalSubs}</p></div>
                    <div class="card"><h3>AI 🤖</h3><p>${aiSubs}</p></div>
                    <div class="card"><h3>أصلي</h3><p>${totalSubs - aiSubs}</p></div>
                </div>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>اسم المحتوى</th>
                                <th style="text-align: center;">النوع</th>
                                <th style="text-align: center;">التحكم</th>
                            </tr>
                        </thead>
                        <tbody>${rows || '<tr><td colspan="3" style="text-align:center; padding:20px;">لا يوجد بيانات</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) { res.status(500).send("Error"); }
});

/**
 * 7. تشغيل الواجهة
 */
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`🚀 Server Online: https://chb-gy3n.onrender.com/stats`);
});

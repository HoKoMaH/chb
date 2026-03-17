const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

/**
 * 1. لاقط الطلبات (Network Logger)
 * لمراقبة أي اتصال قادم من تطبيق Stremio أو المتصفح
 */
app.use((req, res, next) => {
    if (!req.url.includes('favicon')) {
        console.log(`\n[NETWORK] 📡 ${new Date().toLocaleString('ar-SA')}`);
        console.log(`   - نوع الطلب: ${req.method}`);
        console.log(`   - المسار: ${req.url}`);
    }
    next();
});

/**
 * 2. الاتصال بقاعدة البيانات MongoDB
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ [DATABASE] تم الاتصال بقاعدة البيانات بنجاح"))
    .catch(err => console.error("❌ [DATABASE] خطأ في الاتصال:", err));

/**
 * 3. إعدادات منع الكاش لضمان التحديث المستمر
 */
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

/**
 * 4. تعريف الـ Schema والموديل
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
 * 5. مسار جلب ملف الـ SRT (للمشغل وللتحميل)
 */
app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        const sub = await Subtitle.findOne({ fileId });

        if (sub && sub.arabicText) {
            console.log(`[FILE-SEND] ✅ إرسال ملف: ${sub.label}`);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sub.label)}.srt"`);
            return res.send(sub.arabicText);
        }
        res.status(404).send("File not found.");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

/**
 * 6. لوحة التحكم المتقدمة (Stats & Explorer)
 * تفتح عبر: https://your-app-link.onrender.com/stats
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const latestSubs = await Subtitle.find().sort({ createdAt: -1 }).limit(40);

        let rows = latestSubs.map(sub => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 15px; font-weight: 500;">${sub.label}</td>
                <td style="padding: 15px; text-align: center;">
                    <span style="padding: 4px 10px; border-radius: 20px; font-size: 12px; background: ${sub.isAI ? '#e8f5e9; color: #2e7d32;' : '#fff8e1; color: #f57f17;'}">
                        ${sub.isAI ? '🤖 ذكاء اصطناعي' : '🇸🇦 أصلية'}
                    </span>
                </td>
                <td style="padding: 15px; color: #7f8c8d; font-size: 13px;">${new Date(sub.createdAt).toLocaleString('ar-SA')}</td>
                <td style="padding: 15px; text-align: center;">
                    <a href="/sub/${sub.fileId}.srt" style="text-decoration: none; background: #3498db; color: white; padding: 6px 15px; border-radius: 8px; font-size: 12px; transition: 0.3s;">تحميل ↓</a>
                </td>
            </tr>
        `).join('');

        const html = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>AR.SA Dashboard</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f4f7f6; margin: 0; padding: 20px; }
                .container { max-width: 1000px; margin: auto; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .card { background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); text-align: center; }
                .card h3 { margin: 0; color: #7f8c8d; font-size: 14px; }
                .card p { font-size: 28px; font-weight: bold; margin: 10px 0; color: #2c3e50; }
                .table-container { background: white; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden; }
                table { width: 100%; border-collapse: collapse; }
                th { background: #f8f9fa; padding: 15px; text-align: right; color: #34495e; border-bottom: 2px solid #eee; }
                tr:hover { background: #fcfcfc; }
                .status-online { color: #27ae60; font-weight: bold; font-size: 14px; margin-top: 20px; display: block; text-align: center; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 style="text-align: center; color: #2c3e50; margin-bottom: 40px;">📊 لوحة تحكم AR.SA الذكية</h1>
                
                <div class="stats-grid">
                    <div class="card" style="border-top: 5px solid #3498db;">
                        <h3>إجمالي الترجمات المخزنة</h3>
                        <p>${totalSubs}</p>
                    </div>
                    <div class="card" style="border-top: 5px solid #2ecc71;">
                        <h3>تمت ترجمتها بـ AI 🤖</h3>
                        <p>${aiSubs}</p>
                    </div>
                    <div class="card" style="border-top: 5px solid #f1c40f;">
                        <h3>ترجمات أصلية 🇸🇦</h3>
                        <p>${totalSubs - aiSubs}</p>
                    </div>
                </div>

                <div class="table-container">
                    <table dir="rtl">
                        <thead>
                            <tr>
                                <th>اسم النسخة / المحتوى</th>
                                <th style="text-align: center;">النوع</th>
                                <th>تاريخ الإضافة</th>
                                <th style="text-align: center;">الإجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد بيانات حالياً</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <span class="status-online">خادم المزامنة نشط وجاهز 🟢</span>
            </div>
        </body>
        </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        res.status(500).send("Error loading dashboard");
    }
});

/**
 * 7. تشغيل واجهة Stremio
 */
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`\n🚀 AR.SA Server is Online!`);
    console.log(`📡 URL: https://chb-gy3n.onrender.com`);
    console.log(`📊 Stats: https://chb-gy3n.onrender.com/stats`);
    console.log(`-----------------------------------------\n`);
});

const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

/**
 * 1. الاتصال بقاعدة البيانات MongoDB
 * يتم سحب الرابط من إعدادات Render (Environment Variables)
 */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB Successfully"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

/**
 * 2. إعدادات منع الكاش (Cache Control)
 * لضمان أن Stremio يطلب ترجمة جديدة عند كل فيلم ولا يعتمد على القديم
 */
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

/**
 * 3. تعريف الـ Schema والموديل (Subtitle)
 * هذا الهيكل يدعم تمييز الترجمة الآلية (isAI)
 */
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now } // حذف تلقائي بعد 15 يوم
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * 4. مسار جلب ملف الـ SRT
 * يقوم بقراءة النص من القاعدة وإرساله للمشغل
 */
app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        const sub = await Subtitle.findOne({ fileId });

        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(sub.arabicText);
        }
        res.status(404).send("Subtitle not found.");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

/**
 * 5. صفحة الإحصائيات (Dashboard)
 * الرابط: https://your-app.onrender.com/stats
 */
app.get("/stats", async (req, res) => {
    try {
        const totalSubs = await Subtitle.countDocuments();
        const aiSubs = await Subtitle.countDocuments({ isAI: true });
        const originalSubs = totalSubs - aiSubs;

        const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 50px; background: #f4f7f6; min-height: 100vh; direction: rtl;">
            <h1 style="color: #2c3e50;">📊 لوحة تحكم AR.SA Smart-Sync</h1>
            <div style="display: flex; justify-content: center; gap: 20px; margin-top: 30px; flex-wrap: wrap;">
                <div style="background: #ffffff; padding: 25px; border-radius: 15px; box-shadow: 0 10px 20px rgba(0,0,0,0.05); width: 220px; border-bottom: 5px solid #3498db;">
                    <h3 style="color: #7f8c8d;">إجمالي الملفات</h3>
                    <p style="font-size: 32px; font-weight: bold; color: #3498db; margin: 10px 0;">${totalSubs}</p>
                </div>
                <div style="background: #ffffff; padding: 25px; border-radius: 15px; box-shadow: 0 10px 20px rgba(0,0,0,0.05); width: 220px; border-bottom: 5px solid #2ecc71;">
                    <h3 style="color: #7f8c8d;">ترجمة آلية 🤖</h3>
                    <p style="font-size: 32px; font-weight: bold; color: #2ecc71; margin: 10px 0;">${aiSubs}</p>
                </div>
                <div style="background: #ffffff; padding: 25px; border-radius: 15px; box-shadow: 0 10px 20px rgba(0,0,0,0.05); width: 220px; border-bottom: 5px solid #f1c40f;">
                    <h3 style="color: #7f8c8d;">ترجمة أصلية 🇸🇦</h3>
                    <p style="font-size: 32px; font-weight: bold; color: #f1c40f; margin: 10px 0;">${originalSubs}</p>
                </div>
            </div>
            <div style="margin-top: 40px; padding: 15px; background: #fff; display: inline-block; border-radius: 10px; color: #27ae60; font-weight: bold;">
                الحالة الآن: متصل بالخادم 🟢
            </div>
        </div>
        `;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        res.status(500).send("خطأ في تحميل الإحصائيات");
    }
});

/**
 * 6. تشغيل واجهة Stremio
 */
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`🚀 AR.SA Smart-Sync Server Live on port ${port}`);
});

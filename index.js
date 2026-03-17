const express = require('express');
const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

// 1. الاتصال بقاعدة البيانات (تأكد من تعريف الموديل)
mongoose.connect(process.env.MONGO_URI);

const SubtitleSchema = new mongoose.Schema({
    imdbId: String,
    arabicText: String,
    source: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

// 2. مسار جلب ملف الـ SRT (يجب أن يكون قبل serveHTTP)
app.get("/sub/:id.srt", async (req, res) => {
    try {
        const imdbId = req.params.id.replace('.srt', ''); // تنظيف الـ ID
        console.log(`[HTTP] طلب ملف لـ: ${imdbId}`);

        const sub = await Subtitle.findOne({ imdbId: imdbId });

        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*'); // حل مشكلة ظهور الترجمة في المتصفح
            return res.send(sub.arabicText);
        }
        
        res.status(404).send("Subtitle not found in database.");
    } catch (e) {
        console.error(`[ERROR] ${e.message}`);
        res.status(500).send("Internal Server Error");
    }
});

// 3. تشغيل الـ Addon SDK
// ملاحظة: serveHTTP ستقوم بإضافة مسارات /manifest.json تلقائياً
serveHTTP(addonInterface, { app, port: process.env.PORT || 10000 });

console.log("🚀 السيرفر جاهز ومسار /sub مفعل");
